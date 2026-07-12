const KEY = "luaux_admin_show_paywalls";

export function getAdminShowPaywalls(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setAdminShowPaywalls(on: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("luaux-admin-preview"));
}

/** Admin bypasses paywalls unless they enabled "show paywalls" preview. */
export function adminBypassesPaywall(isAdmin: boolean): boolean {
  return isAdmin && !getAdminShowPaywalls();
}
