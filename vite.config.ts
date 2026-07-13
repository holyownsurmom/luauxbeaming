// Shared Vite/TanStack Start config (includes tanstackStart, react, tailwind, tsconfig paths, nitro).
// Do not re-add those plugins manually or the build will break with duplicates.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Nitro target: Vercel when VERCEL=1 (or NITRO_PRESET=vercel)
const nitroPreset =
  process.env.NITRO_PRESET ||
  (process.env.VERCEL ? "vercel" : undefined);

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  ...(nitroPreset
    ? {
        nitro: {
          preset: nitroPreset,
        },
      }
    : {}),
  vite: {
    build: {
      rollupOptions: {
        external: [
          "mineflayer",
          "discord.js",
          "minecraft-protocol",
          "minecraft-data",
          "prismarine-chunk",
          "prismarine-world",
          "prismarine-registry",
          "node-minecraft-protocol",
        ],
      },
    },
    optimizeDeps: {
      exclude: ["mineflayer", "discord.js", "minecraft-protocol", "minecraft-data"],
    },
  },
});
