import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeRefreshToken,
  normalizeRefreshToken,
} from "./mc-refresh.server.ts";

describe("normalizeRefreshToken", () => {
  it("strips whitespace and quotes", () => {
    assert.equal(normalizeRefreshToken('  "M.C512_abc"  '), "M.C512_abc");
  });
});

describe("looksLikeRefreshToken", () => {
  it("rejects short strings", () => {
    assert.equal(looksLikeRefreshToken("short"), false);
  });
  it("accepts long opaque tokens", () => {
    assert.equal(
      looksLikeRefreshToken("M.C512_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF"),
      true,
    );
  });
});
