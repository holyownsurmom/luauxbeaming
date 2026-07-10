import { createFileRoute } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { PluginPage } from "@/components/plugin-page";

export const Route = createFileRoute("/dashboard/discord-auto-reply")({
  head: () => ({ meta: [{ title: "Discord Auto-Reply — LuauX" }] }),
  component: () => (
    <PluginPage
      pluginId="discord-autoreply"
      title="Discord Auto-Reply"
      tagline="Hands-off DM responder with humanized timing."
      cardTitle="Discord Auto-Reply"
      cardDescription="Hands-off DM auto-responder. Pick DM or Friend mode and let it reply for you — humanized timing, zero captcha solving."
      price={10}
      icon={MessageSquare}
      features={[
        "DM mode & Friend mode",
        "Humanized reply delay & typing",
        "Multi-token rotation",
        "Auto-accept friend requests (safe)",
        "Bring your own proxy, or use our premium pool (Enterprise)",
        "Live console",
      ]}
    />
  ),
});