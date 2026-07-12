import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  LifeBuoy, MessageCircle, ExternalLink, ChevronDown, Search,
  Bot, Zap, ShieldCheck, CreditCard, Clock, Settings, AlertTriangle,
  Key, Wifi, RefreshCw,
} from "lucide-react";

export const Route = createFileRoute("/dashboard/support")({
  head: () => ({ meta: [{ title: "Support — LuauX" }] }),
  component: SupportPage,
});

const DISCORD_INVITE = "https://discord.gg/n6nEcvwzYQ";

type FAQItem = {
  q: string;
  a: string;
  category: string;
  icon: React.ComponentType<{ className?: string }>;
};

const FAQS: FAQItem[] = [
  // Getting Started
  {
    q: "How do I get started with LuauX?",
    a: "Sign in with Discord, go to Purchase, pick a plan, and pay with crypto. Once confirmed (usually 2-5 min), your bot hours are added. Head to MC Auto-Message or Plugins to create your first bot.",
    category: "Getting Started",
    icon: Bot,
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept Bitcoin, Ethereum, USDT, USDC, Litecoin, Dogecoin, and 50+ other cryptocurrencies through NOWPayments. No credit card needed.",
    category: "Getting Started",
    icon: CreditCard,
  },
  {
    q: "How long does payment confirmation take?",
    a: "Usually 2-5 minutes depending on the blockchain. Bitcoin may take 10-30 min for full confirmations. Your bot hours activate after 2 confirmations.",
    category: "Getting Started",
    icon: Clock,
  },
  {
    q: "Do I need a Minecraft account to use MC Auto-Message?",
    a: "Yes. You need a premium Minecraft account with a valid SSID token. Add your account in MC Auto-Message > Add Account, enter your username and SSID token. We auto-fetch your UUID.",
    category: "Getting Started",
    icon: Bot,
  },
  {
    q: "How do I get my SSID token?",
    a: "Log into minecraft.net, open browser DevTools (F12), go to Application > Cookies, and find the `accessToken` or `sessionId` value. Paste it into the SSID field when adding your account.",
    category: "Getting Started",
    icon: Key,
  },

  // MC Auto-Message
  {
    q: "What is MC Auto-Message?",
    a: "MC Auto-Message connects to any Minecraft server using your account and sends automated chat messages at intervals you configure. Great for server advertising, AFK farms, or chat activity.",
    category: "MC Auto-Message",
    icon: Bot,
  },
  {
    q: "Will I get banned for using MC Auto-Message?",
    a: "Our anti-ban system uses randomized delays, typing simulation, message variation, long AFK breaks, and speed decay over time. No system is 100% ban-proof, but our v2 anti-ban is designed for 8+ hour runs.",
    category: "MC Auto-Message",
    icon: ShieldCheck,
  },
  {
    q: "Can I run multiple MC bots at the same time?",
    a: "Yes, if your plan allows it. Each concurrent bot needs its own Minecraft account (SSID/Microsoft) and an active paid plan with enough max bots and bot hours. Hours are shared across all running bots. Free / no plan = no multi-bot. Upgrade on Purchase to unlock higher concurrent limits.",
    category: "MC Auto-Message",
    icon: Bot,
  },
  {
    q: "What does the message interval mean?",
    a: "The base time between messages in seconds. Actual delays are randomized (0.7x to 1.5x your interval plus jitter) to look human. Minimum is 5 seconds.",
    category: "MC Auto-Message",
    icon: Clock,
  },
  {
    q: "My bot disconnected / says 'Authentication failed'. What do I do?",
    a: "Your SSID token probably expired. Log into minecraft.net again, get a fresh token, delete the old account in dashboard, and re-add it with the new SSID.",
    category: "MC Auto-Message",
    icon: Wifi,
  },
  {
    q: "How does the anti-AFK system work?",
    a: "The bot periodically looks around, moves in random directions, jumps, sneaks, and swaps hotbar items. This keeps the account active and prevents AFK kick on most servers.",
    category: "MC Auto-Message",
    icon: RefreshCw,
  },
  {
    q: "Can I send the same message to multiple servers?",
    a: "Each bot connects to one server. To send to multiple servers, create separate bots with different server addresses. Each uses bot hours while running.",
    category: "MC Auto-Message",
    icon: Bot,
  },

  // Discord Auto-Spam
  {
    q: "What is Discord Auto-Spam?",
    a: "Discord Auto-Spam uses your user token to send messages to a Discord channel at configured intervals. Great for server advertising or keeping a channel active.",
    category: "Discord Auto-Spam",
    icon: Zap,
  },
  {
    q: "Is Discord Auto-Spam safe? Will I get banned?",
    a: "Self-botting is against Discord ToS. Our anti-ban v2 includes typing simulation, message shuffling, long AFK pauses, speed decay, and presence switching. Risk exists but is minimized.",
    category: "Discord Auto-Spam",
    icon: AlertTriangle,
  },
  {
    q: "What is a Discord user token?",
    a: "A user token is your personal Discord authentication token (NOT a bot token). You can find it using browser DevTools: open Discord in Chrome, press F12, go to Network tab, find any API request, and copy the Authorization header value.",
    category: "Discord Auto-Spam",
    icon: Key,
  },
  {
    q: "What does 'Delete after send' do?",
    a: "When enabled, your bot automatically deletes each message a few seconds after sending. Useful for advertising where you don't want spam to pile up.",
    category: "Discord Auto-Spam",
    icon: Zap,
  },
  {
    q: "What does 'Humanize' do?",
    a: "Humanize mode adds random suffixes (. , ! , :) to messages, simulates realistic typing speed before sending, and uses variable delays between messages instead of fixed intervals.",
    category: "Discord Auto-Spam",
    icon: Settings,
  },
  {
    q: "What is the minimum delay between messages?",
    a: "The minimum is 12 seconds. We enforce this to reduce ban risk. The actual delay is randomized between your min and max settings, with additional slowdown over time.",
    category: "Discord Auto-Spam",
    icon: Clock,
  },

  // Discord Auto-Reply
  {
    q: "What is Discord Auto-Reply?",
    a: "Auto-Reply listens for incoming DMs and automatically responds with a message from your configured list. It connects via Discord Gateway WebSocket for real-time responses.",
    category: "Discord Auto-Reply",
    icon: MessageCircle,
  },
  {
    q: "Does Auto-Reply respond to everyone?",
    a: "Auto-Reply only responds to DMs (direct messages). It does not respond to server messages. It also has a throttle (max 3 replies per minute) and randomly skips some messages to appear natural.",
    category: "Discord Auto-Reply",
    icon: MessageCircle,
  },
  {
    q: "What is 'Auto-accept friends'?",
    a: "When enabled, the bot automatically accepts incoming friend requests. This is useful if you're using Auto-Reply for customer support or a public-facing bot.",
    category: "Discord Auto-Reply",
    icon: Settings,
  },
  {
    q: "What is 'Typing simulation'?",
    a: "Before sending a reply, the bot shows a typing indicator for a duration calculated from the message length (like a real person typing). This makes responses feel natural.",
    category: "Discord Auto-Reply",
    icon: Settings,
  },

  // Verification Bot
  {
    q: "What is the Verification Bot?",
    a: "The Verification Bot secures Minecraft accounts for Discord server members. Users enter their MC username and email, receive a verification code, and the bot auto-removes 2FA, changes passwords, and generates recovery codes.",
    category: "Verification Bot",
    icon: ShieldCheck,
  },
  {
    q: "How do I set up the Verification Bot?",
    a: "Go to Verification Bot > enter your Guild ID, Role ID, and Channel ID. Save & Post. The bot will post a verification embed in your channel. Users click Verify, follow the steps, and get verified automatically.",
    category: "Verification Bot",
    icon: ShieldCheck,
  },
  {
    q: "Where do I find my Discord Guild ID, Role ID, and Channel ID?",
    a: "Enable Developer Mode in Discord (Settings > Advanced > Developer Mode). Then right-click the server icon > Copy Server ID (Guild ID), right-click a role > Copy Role ID, right-click a channel > Copy Channel ID.",
    category: "Verification Bot",
    icon: Settings,
  },
  {
    q: "What does the Verification Bot do to the account?",
    a: "It removes 2FA and passkeys, removes security proofs and services, changes the security email and password, generates a new recovery code, and logs out all sessions. All credentials are shown in the Discord embed.",
    category: "Verification Bot",
    icon: ShieldCheck,
  },
  {
    q: "Does the Verification Bot require a license key?",
    a: "Yes. The Verification Bot costs $10/month. Purchase it in the Purchase tab. The key is delivered via Discord DM and visible in your dashboard.",
    category: "Verification Bot",
    icon: Key,
  },

  // Account & Billing
  {
    q: "How do I check my remaining bot hours?",
    a: "Go to Overview or Settings to see your remaining bot hours. They're deducted while any bot (MC or Discord) is running.",
    category: "Account & Billing",
    icon: Clock,
  },
  {
    q: "Can I get a refund?",
    a: "Contact us in the Discord support channel. We handle refunds case-by-case within 7 days of purchase.",
    category: "Account & Billing",
    icon: CreditCard,
  },
  {
    q: "How do I add another Minecraft account?",
    a: "Go to MC Auto-Message > Add Account. Enter your MC username, email, and SSID token. You can add multiple accounts and create separate bots for each.",
    category: "Account & Billing",
    icon: Bot,
  },
  {
    q: "My bot hours ran out. What happens?",
    a: "Running bots are stopped automatically when your hours reach zero. Top up by purchasing another plan in the Purchase tab.",
    category: "Account & Billing",
    icon: Clock,
  },
  {
    q: "Do bot hours pause when no bot is running?",
    a: "Yes. Hours are only consumed while a bot is actively running. If all bots are stopped, your hours are preserved.",
    category: "Account & Billing",
    icon: Clock,
  },

  // Troubleshooting
  {
    q: "My Discord bot says 'Token invalid'. What do I do?",
    a: "Your token may have been reset or revoked. Get a fresh token from browser DevTools (F12 > Network > copy Authorization header) and update it in your bot settings.",
    category: "Troubleshooting",
    icon: AlertTriangle,
  },
  {
    q: "I'm getting rate limited on Discord. What now?",
    a: "The bot automatically handles rate limits with exponential backoff and long pauses. If you see repeated 429 errors, the bot will go idle for 15-30 min before retrying. No action needed.",
    category: "Troubleshooting",
    icon: RefreshCw,
  },
  {
    q: "The bot-worker is offline. What do I do?",
    a: "The bot-worker runs on our servers and auto-reconnects. If it's been down for more than 5 min, open a support ticket in Discord with your dashboard screenshot.",
    category: "Troubleshooting",
    icon: Wifi,
  },
  {
    q: "How do I stop a running bot?",
    a: "Go to the bot's page (MC Auto-Message, Discord Auto-Spam, or Auto-Reply) and click the Stop button. You can also use 'Stop & Clear All' to stop everything at once.",
    category: "Troubleshooting",
    icon: Settings,
  },
  {
    q: "Can I use LuauX on mobile?",
    a: "Yes. The dashboard is responsive and works on mobile browsers. The sidebar becomes a hamburger menu. Bot management works the same way.",
    category: "Troubleshooting",
    icon: Settings,
  },
];

const CATEGORIES = [...new Set(FAQS.map((f) => f.category))];

function FAQAccordion({ item }: { item: FAQItem }) {
  const [open, setOpen] = useState(false);
  const Icon = item.icon;

  return (
    <div className="rounded-xl brutal-border bg-card/60 overflow-hidden transition-all duration-300 hover:border-primary/20">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left group"
      >
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <span className="flex-1 text-sm font-medium group-hover:text-primary transition-colors">
          {item.q}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform duration-300 shrink-0 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="px-5 pb-4 pl-16">
          <p className="text-sm text-foreground/70 leading-relaxed">{item.a}</p>
        </div>
      )}
    </div>
  );
}

function SupportPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filtered = FAQS.filter((f) => {
    const matchesSearch =
      !search ||
      f.q.toLowerCase().includes(search.toLowerCase()) ||
      f.a.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !activeCategory || f.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-8 animate-page-in">
      <header className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-xl brutal-border bg-primary/15 text-primary flex items-center justify-center animate-border">
          <LifeBuoy className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-4xl font-semibold tracking-tight">Support</h1>
          <p className="mt-1 text-muted-foreground">
            Browse FAQs below or open a ticket in the LuauX Discord.
          </p>
        </div>
      </header>

      {/* Discord CTA */}
      <div className="rounded-2xl brutal-border bg-card p-6 animated-border noise-texture relative overflow-hidden">
        <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-primary">
          <MessageCircle className="h-4 w-4" /> Official Discord
        </div>
        <h2 className="mt-3 font-display text-xl font-semibold">Join the LuauX server</h2>
        <p className="mt-2 text-sm text-foreground/80 max-w-lg">
          Open a <span className="font-semibold text-foreground">#support</span> ticket for direct help from the team.
          Priority tickets are handled first for Pro and Enterprise users.
        </p>
        <a
          href={DISCORD_INVITE}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground brutal-border px-5 py-3 text-sm font-semibold hover:bg-primary/90 magnetic-hover btn-premium"
        >
          Open Discord ticket
          <ExternalLink className="h-4 w-4" />
        </a>
        <div className="mt-3 text-xs text-muted-foreground break-all">{DISCORD_INVITE}</div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search FAQs..."
          className="w-full rounded-xl brutal-border bg-card/60 pl-11 pr-4 py-3 text-sm outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/40"
        />
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveCategory(null)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
            !activeCategory
              ? "bg-primary text-primary-foreground"
              : "bg-card/60 brutal-border text-muted-foreground hover:text-foreground hover:border-primary/20"
          }`}
        >
          All ({FAQS.length})
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              activeCategory === cat
                ? "bg-primary text-primary-foreground"
                : "bg-card/60 brutal-border text-muted-foreground hover:text-foreground hover:border-primary/20"
            }`}
          >
            {cat} ({FAQS.filter((f) => f.category === cat).length})
          </button>
        ))}
      </div>

      {/* FAQ list */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground/50">
            No matching FAQs found. Try a different search or category.
          </div>
        )}
        {filtered.map((item) => (
          <FAQAccordion key={item.q} item={item} />
        ))}
      </div>
    </div>
  );
}
