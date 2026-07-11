import { createFileRoute } from "@tanstack/react-router";
import { verify } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function verifyDiscordSignature(
  rawBody: string,
  signature: string,
  timestamp: string,
  clientPublicKey: string,
): boolean {
  try {
    const data = Buffer.from(timestamp + rawBody);
    const sig = Buffer.from(signature, "hex");

    // Ed25519 SPKI DER prefix
    const publicKeyDer = Buffer.concat([
      Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
      Buffer.from(clientPublicKey, "hex"),
    ]);

    return verify(
      undefined,
      data,
      {
        key: publicKeyDer,
        format: "der",
        type: "spki",
      },
      sig,
    );
  } catch (e) {
    console.error("[discord webhook] verification exception:", e);
    return false;
  }
}

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const Route = createFileRoute("/api/discord/interactions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const signature = request.headers.get("x-signature-ed25519") || "";
        const timestamp = request.headers.get("x-signature-timestamp") || "";
        const rawBody = await request.text();

        const publicKey =
          process.env.DISCORD_PUBLIC_KEY || process.env.DISCORD_CLIENT_PUBLIC_KEY || "";

        if (!publicKey) {
          console.error("[discord webhook] Missing DISCORD_PUBLIC_KEY environment variable.");
          return new Response("Server configuration error", { status: 500 });
        }

        if (!verifyDiscordSignature(rawBody, signature, timestamp, publicKey)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let body;
        try {
          body = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        // Handle Ping (Type 1)
        if (body.type === 1) {
          return Response.json({ type: 1 });
        }

        // Handle Message Component (Type 3)
        if (body.type === 3) {
          const { data, guild_id, member } = body;

          if (data && data.custom_id === "verify_member") {
            const memberId = member?.user?.id;
            if (!memberId || !guild_id) {
              return Response.json({
                type: 4,
                data: {
                  content: "⚠️ Missing member or guild information.",
                  flags: 64,
                },
              });
            }

            // Retrieve settings for this guild
            const { data: settings, error } = await db()
              .from("verification_settings")
              .select("verified_role_id")
              .eq("guild_id", guild_id)
              .maybeSingle();

            if (error || !settings) {
              return Response.json({
                type: 4,
                data: {
                  content:
                    "⚠️ This server has not been configured for verification yet. Please set it up in the LuauX Dashboard.",
                  flags: 64,
                },
              });
            }

            // Assign role to member
            const roleId = settings.verified_role_id;
            try {
              const roleRes = await fetch(
                `https://discord.com/api/v10/guilds/${guild_id}/members/${memberId}/roles/${roleId}`,
                {
                  method: "PUT",
                  headers: {
                    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
                    "Content-Type": "application/json",
                  },
                },
              );

              if (roleRes.ok || roleRes.status === 204) {
                return Response.json({
                  type: 4,
                  data: {
                    content: "✅ Verification successful! You have been given the verified role.",
                    flags: 64,
                  },
                });
              } else {
                const errText = await roleRes.text();
                console.error("[discord webhook] role assign failed:", roleRes.status, errText);
                return Response.json({
                  type: 4,
                  data: {
                    content: `⚠️ Failed to assign role. Make sure the LuauX bot has role management permissions and its role is positioned above the target role.`,
                    flags: 64,
                  },
                });
              }
            } catch (err) {
              console.error("[discord webhook] role API error:", err);
              return Response.json({
                type: 4,
                data: {
                  content: "⚠️ Connection error while assigning role.",
                  flags: 64,
                },
              });
            }
          }
        }

        return Response.json({ type: 4, data: { content: "Unknown interaction", flags: 64 } });
      },
    },
  },
});
