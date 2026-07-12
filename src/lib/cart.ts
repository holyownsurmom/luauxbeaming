export type CartItem = {
  planId: string;
  name: string;
  priceUsd: number;
  kind?: "plan" | "plugin" | "hours";
};

const STORAGE_KEY = "luaux_cart_v1";
const EVENT = "luaux-cart";

function read(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CartItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i) => i && typeof i.planId === "string" && typeof i.name === "string" && Number(i.priceUsd) >= 0,
    );
  } catch {
    return [];
  }
}

function write(items: CartItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(EVENT));
}

export function getCart(): CartItem[] {
  return read();
}

export function getCartCount(): number {
  return read().length;
}

export function getCartTotalUsd(): number {
  return read().reduce((s, i) => s + Number(i.priceUsd || 0), 0);
}

export function addToCart(item: CartItem): { ok: boolean; reason?: string } {
  const items = read();
  if (items.some((i) => i.planId === item.planId)) {
    return { ok: false, reason: "Already in cart" };
  }
  // Only one MC subscription plan at a time
  if (item.kind === "plan") {
    const withoutPlans = items.filter((i) => i.kind !== "plan");
    write([...withoutPlans, item]);
    return { ok: true };
  }
  write([...items, item]);
  return { ok: true };
}

export function removeFromCart(planId: string) {
  write(read().filter((i) => i.planId !== planId));
}

export function clearCart() {
  write([]);
}

export function isInCart(planId: string): boolean {
  return read().some((i) => i.planId === planId);
}

export function subscribeCart(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
