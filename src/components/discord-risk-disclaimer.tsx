import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Tool = "spam" | "autoreply";

const STORAGE: Record<Tool, string> = {
  spam: "luaux_disclaimer_discord_spam_v1",
  autoreply: "luaux_disclaimer_discord_autoreply_v1",
};

export function hasAcceptedDiscordRisk(tool: Tool): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE[tool]) === "1";
  } catch {
    return false;
  }
}

export function acceptDiscordRisk(tool: Tool) {
  try {
    localStorage.setItem(STORAGE[tool], "1");
  } catch {
    /* ignore */
  }
}

/**
 * Forced disclaimer before using Discord Auto-Spam / Auto-Reply.
 * Self-bot automation violates Discord ToS — accounts can be banned.
 */
export function DiscordRiskDisclaimer({
  tool,
  open,
  onAccepted,
}: {
  tool: Tool;
  open: boolean;
  onAccepted: () => void;
}) {
  const title =
    tool === "spam" ? "Disclaimer — Discord Auto-Spam" : "Disclaimer — Discord Auto-Reply";

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-lg brutal-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground leading-relaxed text-left">
              <p className="font-semibold text-foreground">Use at your own risk.</p>
              <p>
                This tool automates a Discord <strong className="text-foreground">user account</strong>{" "}
                (self-bot style). That violates Discord&apos;s Terms of Service. Accounts can be{" "}
                <strong className="text-foreground">limited, locked, or permanently banned</strong> —
                sometimes with little or no warning.
              </p>
              <p>
                Built-in delays and humanization only reduce risk. They do{" "}
                <strong className="text-foreground">not</strong> make this safe or ToS-compliant.
                LuauX cannot prevent bans and is{" "}
                <strong className="text-foreground">not responsible</strong> if an account is banned,
                locked, or loses access.
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>
                  Use a <strong className="text-foreground">throwaway / alt account</strong> — never
                  your main.
                </li>
                <li>Do not run this on high-value or aged accounts you care about.</li>
                <li>Slow pacing is intentional. Faster settings increase ban risk.</li>
                <li>You are solely responsible for how you use this tool.</li>
              </ul>
              <p className="text-xs">
                By continuing, you confirm you understand the risks and accept full responsibility.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            className="w-full sm:w-auto btn-premium"
            onClick={() => {
              acceptDiscordRisk(tool);
              onAccepted();
            }}
          >
            I understand — continue at my own risk
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Hook: show disclaimer once per browser until accepted. */
export function useDiscordRiskDisclaimer(tool: Tool, enabled: boolean) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }
    if (!hasAcceptedDiscordRisk(tool)) setOpen(true);
  }, [tool, enabled]);

  return {
    open,
    accepted: hasAcceptedDiscordRisk(tool),
    onAccepted: () => setOpen(false),
    requireAccepted: () => {
      if (hasAcceptedDiscordRisk(tool)) return true;
      setOpen(true);
      return false;
    },
  };
}
