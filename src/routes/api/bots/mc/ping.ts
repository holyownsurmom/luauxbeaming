import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bots/mc/ping")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const host = url.searchParams.get("host");
        const port = parseInt(url.searchParams.get("port") || "25565", 10);

        if (!host) return Response.json({ error: "host required" }, { status: 400 });

        const result = await pingMcServer(host, port);
        return Response.json(result);
      },
    },
  },
});

async function pingMcServer(host: string, port = 25565): Promise<{
  online: boolean;
  version?: string;
  players?: { online: number; max: number };
  motd?: string;
  latency?: number;
}> {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.createConnection(port, host, () => {
      const latency = Date.now() - start;

      const writeVarInt = (val: number) => {
        const bytes: number[] = [];
        let v = val;
        while (v > 0x7f) {
          bytes.push((v & 0x7f) | 0x80);
          v >>>= 7;
        }
        bytes.push(v & 0x7f);
        return Buffer.from(bytes);
      };

      const handshake = Buffer.concat([
        writeVarInt(0),
        writeVarInt(-1),
        writeVarInt(host.length),
        Buffer.from(host),
        Buffer.alloc(2),
        writeVarInt(1),
      ]);

      const packet = Buffer.concat([writeVarInt(handshake.length), handshake]);
      socket.write(packet);

      const statusReq = Buffer.concat([writeVarInt(1), writeVarInt(0)]);
      socket.write(Buffer.concat([writeVarInt(statusReq.length), statusReq]));

      let data = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        data = Buffer.concat([data, chunk]);
        try {
          let offset = 0;
          const readVarInt = () => {
            let result = 0;
            let shift = 0;
            while (offset < data.length) {
              const byte = data[offset++];
              result |= (byte & 0x7f) << shift;
              if ((byte & 0x80) === 0) break;
              shift += 7;
            }
            return result;
          };

          const len = readVarInt();
          if (data.length < offset + len) return;
          readVarInt();
          const jsonLen = readVarInt();
          const jsonStr = data.toString("utf8", offset, offset + jsonLen);
          const parsed = JSON.parse(jsonStr);
          socket.destroy();
          resolve({
            online: true,
            version: parsed.version?.name,
            players: parsed.players,
            motd: parsed.description?.text || parsed.description?.extra?.map((e: { text: string }) => e.text).join(""),
            latency,
          });
        } catch {
          // partial data
        }
      });

      socket.setTimeout(5000);
      socket.on("timeout", () => {
        socket.destroy();
        resolve({ online: false });
      });
      socket.on("error", () => {
        socket.destroy();
        resolve({ online: false });
      });
    });

    socket.on("error", () => {
      resolve({ online: false });
    });

    setTimeout(() => {
      socket.destroy();
      resolve({ online: false });
    }, 5000);
  });
}
