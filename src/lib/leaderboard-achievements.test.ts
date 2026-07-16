import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildContextFromEvents,
  computeStreakDays,
  evaluateAchievements,
  pickRowBadgeIds,
  utcDayKey,
} from "./leaderboard-achievements.server.ts";

describe("utcDayKey", () => {
  it("formats ISO to UTC date", () => {
    assert.equal(utcDayKey("2026-07-17T23:00:00.000Z"), "2026-07-17");
  });
});

describe("computeStreakDays", () => {
  it("returns 0 for empty", () => {
    assert.equal(computeStreakDays([], new Date("2026-07-17T12:00:00Z")), 0);
  });

  it("counts consecutive days ending today", () => {
    const now = new Date("2026-07-17T18:00:00Z");
    const events = [
      "2026-07-17T10:00:00Z",
      "2026-07-16T10:00:00Z",
      "2026-07-15T10:00:00Z",
      "2026-07-10T10:00:00Z",
    ];
    assert.equal(computeStreakDays(events, now), 3);
  });

  it("allows streak ending yesterday", () => {
    const now = new Date("2026-07-17T18:00:00Z");
    const events = ["2026-07-16T10:00:00Z", "2026-07-15T10:00:00Z"];
    assert.equal(computeStreakDays(events, now), 2);
  });

  it("breaks on gap", () => {
    const now = new Date("2026-07-17T18:00:00Z");
    const events = ["2026-07-17T10:00:00Z", "2026-07-15T10:00:00Z"];
    assert.equal(computeStreakDays(events, now), 1);
  });
});

describe("evaluateAchievements", () => {
  it("unlocks first blood and milestones", () => {
    const events = Array.from({ length: 25 }, (_, i) => {
      const d = new Date("2026-06-01T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString();
    });
    const c = buildContextFromEvents(events, {
      rank24h: null,
      rank7d: null,
      rankMonth: null,
      trend: null,
      periodTotal: 0,
      now: new Date("2026-07-17T12:00:00Z"),
    });
    const list = evaluateAchievements(c);
    assert.ok(list.find((a) => a.id === "first_blood")?.unlocked);
    assert.ok(list.find((a) => a.id === "getting_started")?.unlocked);
    assert.ok(list.find((a) => a.id === "operator")?.unlocked);
    assert.equal(list.find((a) => a.id === "elite")?.unlocked, false);
  });

  it("unlocks weekly top 10 and monthly king", () => {
    const list = evaluateAchievements({
      lifetimeTotal: 3,
      last24hTotal: 1,
      streakDays: 1,
      rank24h: 1,
      rank7d: 5,
      rankMonth: 1,
      trend: "up",
      periodTotal: 5,
    });
    assert.ok(list.find((a) => a.id === "daily_ace")?.unlocked);
    assert.ok(list.find((a) => a.id === "week_warrior")?.unlocked);
    assert.ok(list.find((a) => a.id === "monthly_king")?.unlocked);
    assert.ok(list.find((a) => a.id === "comeback")?.unlocked);
  });

  it("pickRowBadgeIds prefers legendary/epic", () => {
    const list = evaluateAchievements({
      lifetimeTotal: 100,
      last24hTotal: 6,
      streakDays: 4,
      rank24h: 1,
      rank7d: 2,
      rankMonth: 1,
      trend: "up",
      periodTotal: 10,
    });
    const badges = pickRowBadgeIds(list, 2);
    assert.ok(badges.includes("monthly_king") || badges.includes("elite"));
    assert.equal(badges.length, 2);
  });
});
