import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateDiscordSpamBody,
  validateMcLaunchFields,
  clampInterval,
} from "./bot-job-validate.server.ts";

describe("clampInterval", () => {
  it("clamps below min", () => {
    assert.equal(clampInterval(1, 300, 1000, 300), 300);
  });
  it("uses fallback for NaN", () => {
    assert.equal(clampInterval("x", 5, 100, 30), 30);
  });
});

describe("validateDiscordSpamBody", () => {
  it("clamps short interval to anti-ban v7 floors", () => {
    const r = validateDiscordSpamBody({
      token: "abc.def.ghi",
      channelId: "123456789012345678",
      messages: ["hi"],
      interval: 5,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.config.interval, 600);
      assert.ok(r.config.minDelay >= 1800);
      assert.equal(r.config.humanize, true);
    }
  });
  it("rejects missing token", () => {
    const r = validateDiscordSpamBody({
      token: "",
      channelId: "123456789012345678",
      messages: ["hi"],
    });
    assert.equal(r.ok, false);
  });
  it("rejects private MC hosts", () => {
    const r = validateMcLaunchFields({
      serverHost: "127.0.0.1",
      messages: ["a"],
    });
    assert.equal(r.ok, false);
  });
});

describe("validateMcLaunchFields", () => {
  it("accepts valid host/messages and defaults port", () => {
    const r = validateMcLaunchFields({
      serverHost: "play.example.com",
      messages: [" /spawn "],
      interval: 60,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.serverPort, 25565);
      assert.equal(r.serverHost, "play.example.com");
      assert.deepEqual(r.messages, ["/spawn"]);
    }
  });
  it("parses host:port from serverHost", () => {
    const r = validateMcLaunchFields({
      serverHost: "play.example.com:25566",
      messages: ["a"],
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.serverHost, "play.example.com");
      assert.equal(r.serverPort, 25566);
    }
  });
  it("ignores invalid body.serverPort", () => {
    const r = validateMcLaunchFields({
      serverHost: "x.com",
      serverPort: 99999,
      messages: ["a"],
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.serverPort, 25565);
  });
});
