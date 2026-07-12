// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Nitro target: Cloudflare on Lovable; Vercel when VERCEL=1 (or NITRO_PRESET=vercel)
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
