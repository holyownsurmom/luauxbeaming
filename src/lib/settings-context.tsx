import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Language = "en" | "es" | "fr" | "de" | "pt";
export type Currency = "usd" | "eur" | "gbp" | "cad" | "aud";
export type Theme = "gold" | "blue";
export type Mode = "dark" | "light";

type SettingsState = {
  language: Language;
  currency: Currency;
  theme: Theme;
  mode: Mode;
  notifyDeploys: boolean;
  notifyPayments: boolean;
  notifyDiscord: boolean;
  botDmReading: boolean;
};

const DEFAULTS: SettingsState = {
  language: "en",
  currency: "usd",
  theme: "gold",
  mode: "dark",
  notifyDeploys: true,
  notifyPayments: true,
  notifyDiscord: false,
  botDmReading: false,
};

type SettingsCtx = SettingsState & {
  set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  t: (key: string) => string;
  formatPrice: (usd: number) => string;
  currencySymbol: string;
};

const Ctx = createContext<SettingsCtx | null>(null);

const RATES: Record<Currency, { symbol: string; rate: number }> = {
  usd: { symbol: "$", rate: 1 },
  eur: { symbol: "€", rate: 0.92 },
  gbp: { symbol: "£", rate: 0.79 },
  cad: { symbol: "CA$", rate: 1.37 },
  aud: { symbol: "A$", rate: 1.52 },
};

const DICT: Record<Language, Record<string, string>> = {
  en: {
    settings: "Settings",
    settings_sub: "Manage your account, subscription and preferences.",
    profile: "Profile",
    subscription: "Subscription",
    bot_hours: "Bot hours & keys",
    notifications: "Notifications",
    appearance: "Appearance",
    language_currency: "Language & currency",
    account: "Account",
    workspace: "Workspace",
    language: "Language",
    currency: "Currency",
    language_hint: "The language used across the interface.",
    currency_hint: "Prices are displayed in this currency. Billing is processed in USD.",
    choose_plan: "Choose a plan",
    choose_plan_sub: "Pay in crypto. Access unlocks after 2 confirmations.",
    per_month: "/month",
    get_started: "Get Started",
    most_popular: "Most Popular",
    best_value: "Best value",
    theme: "Accent color",
    theme_hint: "Pick the accent color used across LuauX.",
    mode: "Appearance mode",
    mode_hint: "Switch between dark and light interface.",
    dark: "Dark",
    light: "Light",
    gold: "Gold",
    blue: "Blue",
  },
  es: {
    settings: "Ajustes",
    settings_sub: "Gestiona tu cuenta, suscripción y preferencias.",
    profile: "Perfil",
    subscription: "Suscripción",
    bot_hours: "Horas de bot y claves",
    notifications: "Notificaciones",
    appearance: "Apariencia",
    language_currency: "Idioma y moneda",
    account: "Cuenta",
    workspace: "Espacio de trabajo",
    language: "Idioma",
    currency: "Moneda",
    language_hint: "El idioma usado en la interfaz.",
    currency_hint: "Los precios se muestran en esta moneda. El pago es en USD.",
    choose_plan: "Elige un plan",
    choose_plan_sub: "Paga en cripto. Se activa tras 2 confirmaciones.",
    per_month: "/mes",
    get_started: "Empezar",
    most_popular: "Más popular",
    best_value: "Mejor valor",
    theme: "Color de acento",
    theme_hint: "Elige el color de acento de LuauX.",
    mode: "Modo de apariencia",
    mode_hint: "Cambia entre interfaz oscura y clara.",
    dark: "Oscuro",
    light: "Claro",
    gold: "Dorado",
    blue: "Azul",
  },
  fr: {
    settings: "Paramètres",
    settings_sub: "Gérez votre compte, abonnement et préférences.",
    profile: "Profil",
    subscription: "Abonnement",
    bot_hours: "Heures de bot & clés",
    notifications: "Notifications",
    appearance: "Apparence",
    language_currency: "Langue et devise",
    account: "Compte",
    workspace: "Espace de travail",
    language: "Langue",
    currency: "Devise",
    language_hint: "La langue utilisée dans l'interface.",
    currency_hint: "Les prix s'affichent dans cette devise. Facturation en USD.",
    choose_plan: "Choisissez une offre",
    choose_plan_sub: "Payez en crypto. Activé après 2 confirmations.",
    per_month: "/mois",
    get_started: "Commencer",
    most_popular: "Le plus populaire",
    best_value: "Meilleure offre",
    theme: "Couleur d'accent",
    theme_hint: "Choisissez la couleur d'accent de LuauX.",
    mode: "Mode d'apparence",
    mode_hint: "Basculer entre les interfaces sombre et claire.",
    dark: "Sombre",
    light: "Clair",
    gold: "Or",
    blue: "Bleu",
  },
  de: {
    settings: "Einstellungen",
    settings_sub: "Verwalte Konto, Abo und Präferenzen.",
    profile: "Profil",
    subscription: "Abonnement",
    bot_hours: "Bot-Stunden & Schlüssel",
    notifications: "Benachrichtigungen",
    appearance: "Darstellung",
    language_currency: "Sprache & Währung",
    account: "Konto",
    workspace: "Arbeitsbereich",
    language: "Sprache",
    currency: "Währung",
    language_hint: "Die in der Oberfläche verwendete Sprache.",
    currency_hint: "Preise werden in dieser Währung angezeigt. Abrechnung in USD.",
    choose_plan: "Wähle einen Plan",
    choose_plan_sub: "Krypto-Zahlung. Freischaltung nach 2 Bestätigungen.",
    per_month: "/Monat",
    get_started: "Loslegen",
    most_popular: "Am beliebtesten",
    best_value: "Bester Wert",
    theme: "Akzentfarbe",
    theme_hint: "Wähle die Akzentfarbe von LuauX.",
    mode: "Darstellungsmodus",
    mode_hint: "Zwischen dunkler und heller Oberfläche wechseln.",
    dark: "Dunkel",
    light: "Hell",
    gold: "Gold",
    blue: "Blau",
  },
  pt: {
    settings: "Configurações",
    settings_sub: "Gerencie sua conta, assinatura e preferências.",
    profile: "Perfil",
    subscription: "Assinatura",
    bot_hours: "Horas de bot & chaves",
    notifications: "Notificações",
    appearance: "Aparência",
    language_currency: "Idioma e moeda",
    account: "Conta",
    workspace: "Espaço de trabalho",
    language: "Idioma",
    currency: "Moeda",
    language_hint: "O idioma usado na interface.",
    currency_hint: "Os precios são exibidos nesta moeda. Cobrança em USD.",
    choose_plan: "Escolha um plano",
    choose_plan_sub: "Pague em cripto. Libera após 2 confirmações.",
    per_month: "/mês",
    get_started: "Começar",
    most_popular: "Mais popular",
    best_value: "Melhor valor",
    theme: "Cor de destaque",
    theme_hint: "Escolha a cor de destaque do LuauX.",
    mode: "Modo de aparência",
    mode_hint: "Alternar entre interface escura e clara.",
    dark: "Escuro",
    light: "Claro",
    gold: "Dourado",
    blue: "Azul",
  },
};

function applyMode(mode: Mode) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", mode === "dark");
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SettingsState>(DEFAULTS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("luaux_settings");
      if (raw) {
        const saved = JSON.parse(raw);
        setState((s) => ({ ...s, ...saved }));
      }
    } catch {
      /* ignore localStorage parse errors */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("luaux_settings", JSON.stringify(state));
    } catch {
      /* ignore localStorage write errors */
    }
    applyMode(state.mode);
    applyTheme(state.theme);
  }, [state]);

  const set = useCallback<SettingsCtx["set"]>((key, value) => {
    setState((s) => ({ ...s, [key]: value }));
  }, []);

  const value = useMemo<SettingsCtx>(() => {
    const { symbol, rate } = RATES[state.currency];
    return {
      ...state,
      set,
      t: (key: string) => DICT[state.language]?.[key] ?? DICT.en[key] ?? key,
      currencySymbol: symbol,
      formatPrice: (usd: number) => {
        const converted = usd * rate;
        const rounded =
          converted >= 100 ? Math.round(converted) : Math.round(converted * 100) / 100;
        return `${symbol}${rounded}`;
      },
    };
  }, [state, set]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSettings must be inside <SettingsProvider>");
  return v;
}
