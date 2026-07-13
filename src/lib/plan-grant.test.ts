import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isHoursPackPlan,
  isPluginPlanId,
  profileHasMcAccess,
} from "./plan-grant.server.ts";

describe("isHoursPackPlan", () => {
  it("detects hours_ packs", () => {
    assert.equal(isHoursPackPlan({ id: "hours_5", kind: "plan", max_bots: 0, bot_hours: 5 }), true);
  });
  it("rejects full plans", () => {
    assert.equal(isHoursPackPlan({ id: "pro", kind: "plan", max_bots: 5, bot_hours: 7 }), false);
  });
  it("rejects plugins", () => {
    assert.equal(
      isHoursPackPlan({ id: "discord-spam", kind: "plugin", max_bots: 0, bot_hours: 0 }),
      false,
    );
  });
});

describe("isPluginPlanId", () => {
  it("knows plugin ids", () => {
    assert.equal(isPluginPlanId("verification"), true);
    assert.equal(isPluginPlanId("discord-bundle"), true);
    assert.equal(isPluginPlanId("starter"), false);
  });
});

describe("profileHasMcAccess", () => {
  it("allows unexpired plan", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    assert.equal(
      profileHasMcAccess({
        active_plan_id: "pro",
        plan_expires_at: future,
        bot_hours_remaining: 0,
      }),
      true,
    );
  });
  it("allows hours-only access", () => {
    assert.equal(
      profileHasMcAccess({
        active_plan_id: null,
        plan_expires_at: null,
        bot_hours_remaining: 2,
      }),
      true,
    );
  });
  it("denies empty profile", () => {
    assert.equal(
      profileHasMcAccess({
        active_plan_id: null,
        plan_expires_at: null,
        bot_hours_remaining: 0,
      }),
      false,
    );
  });
  it("denies expired plan with no hours", () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    assert.equal(
      profileHasMcAccess({
        active_plan_id: "pro",
        plan_expires_at: past,
        bot_hours_remaining: 0,
      }),
      false,
    );
  });
});
