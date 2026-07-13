/** Shared plan/hour grant helpers (server-only). */

type Db = {
  from: (table: string) => any;
};

export function isHoursPackPlan(plan: {
  id?: string;
  kind?: string;
  max_bots?: number;
  bot_hours?: number;
}): boolean {
  const id = String(plan.id || "");
  if (id.startsWith("hours_")) return true;
  return (
    plan.kind !== "plugin" &&
    Number(plan.max_bots ?? 0) === 0 &&
    Number(plan.bot_hours ?? 0) > 0 &&
    /hour/i.test(id)
  );
}

export function isPluginPlanId(planId: string): boolean {
  return (
    planId === "verification" ||
    planId === "discord-spam" ||
    planId === "discord-autoreply" ||
    planId === "discord-bundle" ||
    planId.startsWith("discord-") ||
    planId.includes("verification")
  );
}

/** True if user can run MC bots from stored profile fields */
export function profileHasMcAccess(profile: {
  active_plan_id?: string | null;
  plan_expires_at?: string | null;
  bot_hours_remaining?: number | null;
} | null): boolean {
  if (!profile) return false;
  const hours = Number(profile.bot_hours_remaining ?? 0);
  const planOk =
    !!profile.active_plan_id &&
    !!profile.plan_expires_at &&
    new Date(profile.plan_expires_at).getTime() > Date.now();
  // Paid hours alone unlock bots (hours packs + leftover hours after plan expiry)
  return planOk || hours > 0;
}

/**
 * Grant MC plan hours / expiry.
 * - Hour packs only add hours (never overwrite active plan).
 * - Full plans extend expiry and keep the better tier (max_bots).
 * - Ensures a profiles row exists so grants never silently no-op.
 */
export async function grantMcPlanAccess(
  db: Db,
  discordId: string,
  plan: {
    id: string;
    kind?: string;
    duration_days?: number;
    bot_hours?: number;
    max_bots?: number;
    price_usd?: number;
    sort_order?: number;
  },
  extraHours = 0,
): Promise<{
  bot_hours_remaining: number;
  active_plan_id: string | null;
  plan_expires_at: string | null;
}> {
  // Ensure profile exists (PostgREST update with 0 rows does not error)
  const { data: existing } = await db
    .from("profiles")
    .select("plan_expires_at, bot_hours_remaining, active_plan_id")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (!existing) {
    const { error: upsertErr } = await db.from("profiles").upsert(
      { discord_id: discordId, username: discordId },
      { onConflict: "discord_id" },
    );
    if (upsertErr) throw new Error(`Profile ensure failed: ${upsertErr.message}`);
  }

  const { data: profile } = await db
    .from("profiles")
    .select("plan_expires_at, bot_hours_remaining, active_plan_id")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (!profile) throw new Error(`Profile missing for ${discordId}`);

  const hours =
    Number(profile.bot_hours_remaining ?? 0) +
    Number(plan.bot_hours ?? 0) +
    Number(extraHours || 0);

  const hoursOnly = isHoursPackPlan(plan);
  const update: Record<string, unknown> = {
    bot_hours_remaining: hours,
  };

  let activePlanId: string | null = profile.active_plan_id ?? null;
  let planExpires: string | null = profile.plan_expires_at ?? null;

  if (!hoursOnly && plan.kind !== "plugin" && !isPluginPlanId(plan.id)) {
    const now = Date.now();
    const existingExpiry = profile.plan_expires_at
      ? new Date(profile.plan_expires_at).getTime()
      : 0;
    const base = Math.max(existingExpiry, now);
    const expiryDays = plan.duration_days || 90;
    planExpires = new Date(base + expiryDays * 24 * 60 * 60 * 1000).toISOString();

    // Keep better concurrent-bot tier if current plan still active
    let keepExisting = false;
    if (
      profile.active_plan_id &&
      profile.active_plan_id !== plan.id &&
      existingExpiry > now
    ) {
      const { data: currentPlan } = await db
        .from("plans")
        .select("id, max_bots, price_usd, sort_order")
        .eq("id", profile.active_plan_id)
        .maybeSingle();
      if (currentPlan) {
        const curBots = Number(currentPlan.max_bots ?? 0);
        const newBots = Number(plan.max_bots ?? 0);
        const curPrice = Number(currentPlan.price_usd ?? 0);
        const newPrice = Number(plan.price_usd ?? 0);
        if (curBots > newBots || (curBots === newBots && curPrice > newPrice)) {
          keepExisting = true;
        }
      }
    }

    if (!keepExisting) {
      activePlanId = plan.id;
      update.active_plan_id = plan.id;
    }
    update.plan_expires_at = planExpires;
  }

  const { data: updated, error } = await db
    .from("profiles")
    .update(update)
    .eq("discord_id", discordId)
    .select("bot_hours_remaining, active_plan_id, plan_expires_at")
    .maybeSingle();

  if (error) throw new Error(`Profile grant failed: ${error.message}`);
  if (!updated) throw new Error(`Profile grant updated 0 rows for ${discordId}`);

  return {
    bot_hours_remaining: Number(updated.bot_hours_remaining ?? hours),
    active_plan_id: updated.active_plan_id ?? activePlanId,
    plan_expires_at: updated.plan_expires_at ?? planExpires,
  };
}
