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
  // hour top-ups: not plugins, zero concurrent bots, positive hours
  return (
    plan.kind !== "plugin" &&
    Number(plan.max_bots ?? 0) === 0 &&
    Number(plan.bot_hours ?? 0) > 0 &&
    /hour/i.test(id)
  );
}

/** Grant MC plan hours / expiry. Hour packs only add hours (never overwrite active plan). */
export async function grantMcPlanAccess(
  db: Db,
  discordId: string,
  plan: {
    id: string;
    kind?: string;
    duration_days?: number;
    bot_hours?: number;
    max_bots?: number;
  },
  extraHours = 0,
): Promise<{ bot_hours_remaining: number; active_plan_id: string | null; plan_expires_at: string | null }> {
  const { data: profile } = await db
    .from("profiles")
    .select("plan_expires_at, bot_hours_remaining, active_plan_id")
    .eq("discord_id", discordId)
    .maybeSingle();

  const hours =
    Number(profile?.bot_hours_remaining ?? 0) + Number(plan.bot_hours ?? 0) + Number(extraHours || 0);

  const hoursOnly = isHoursPackPlan(plan);
  const update: Record<string, unknown> = {
    bot_hours_remaining: hours,
  };

  let activePlanId: string | null = profile?.active_plan_id ?? null;
  let planExpires: string | null = profile?.plan_expires_at ?? null;

  if (!hoursOnly && plan.kind !== "plugin") {
    const now = Date.now();
    const existingExpiry = profile?.plan_expires_at
      ? new Date(profile.plan_expires_at).getTime()
      : 0;
    const base = Math.max(existingExpiry, now);
    const expiryDays = plan.duration_days || 90;
    planExpires = new Date(base + expiryDays * 24 * 60 * 60 * 1000).toISOString();
    activePlanId = plan.id;
    update.active_plan_id = plan.id;
    update.plan_expires_at = planExpires;
  }

  const { error } = await db.from("profiles").update(update).eq("discord_id", discordId);
  if (error) throw new Error(`Profile grant failed: ${error.message}`);

  return {
    bot_hours_remaining: hours,
    active_plan_id: activePlanId,
    plan_expires_at: planExpires,
  };
}
