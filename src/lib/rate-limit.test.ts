import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rateLimit } from "./rate-limit.server.ts";

describe("rateLimit", () => {
  it("allows under the limit", () => {
    const key = `test-allow-${Date.now()}-${Math.random()}`;
    const a = rateLimit(key, 3, 60_000);
    const b = rateLimit(key, 3, 60_000);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
  });

  it("blocks over the limit", () => {
    const key = `test-block-${Date.now()}-${Math.random()}`;
    rateLimit(key, 2, 60_000);
    rateLimit(key, 2, 60_000);
    const blocked = rateLimit(key, 2, 60_000);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.ok(blocked.retryAfterSec >= 1);
    }
  });
});
