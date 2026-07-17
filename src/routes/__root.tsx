import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import appCss from "../styles.css?url";
import { SettingsProvider } from "../lib/settings-context";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "LuauX — Minecraft Bot Manager & Discord Automation" },
      {
        name: "description",
        content:
          "Hosted Minecraft auto-message bots and Discord plugins. Live console, crypto billing, Discord login. Deploy in under a minute.",
      },
      {
        name: "keywords",
        content:
          "minecraft bot, minecraft auto message, discord auto reply, discord spam bot, verification bot, bot manager, luaux",
      },
      { name: "author", content: "LuauX" },
      { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" },
      { name: "googlebot", content: "index, follow" },
      { name: "theme-color", content: "#e11d48" },
      { name: "color-scheme", content: "dark light" },
      { property: "og:title", content: "LuauX — Minecraft Bot Manager & Discord Automation" },
      {
        property: "og:description",
        content:
          "Hosted Minecraft bots + Discord automation. Live logs, crypto plans from $7/mo, Discord sign-in.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://luaux.wtf/" },
      { property: "og:site_name", content: "LuauX" },
      { property: "og:locale", content: "en_US" },
      { property: "og:image", content: "https://luaux.wtf/og.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "LuauX — Minecraft & Discord bot control panel" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "LuauX — Minecraft Bot Manager & Discord Automation" },
      {
        name: "twitter:description",
        content: "Hosted Minecraft bots + Discord plugins. Live console. Crypto billing.",
      },
      { name: "twitter:image", content: "https://luaux.wtf/og.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=Syne:wght@700;800&display=swap",
      },
      { rel: "manifest", href: "/site.webmanifest" },
      { rel: "canonical", href: "https://luaux.wtf/" },
      { rel: "sitemap", type: "application/xml", href: "https://luaux.wtf/sitemap.xml" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <Outlet />
        <Toaster position="bottom-right" richColors />
        <Analytics />
        <SpeedInsights />
      </SettingsProvider>
    </QueryClientProvider>
  );
}
