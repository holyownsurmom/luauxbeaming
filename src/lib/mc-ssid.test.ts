import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatUuidDashed,
  looksLikeMcToken,
  normalizeMcAccessToken,
} from "./mc-ssid.server.ts";

describe("normalizeMcAccessToken", () => {
  it("strips bearer and whitespace", () => {
    assert.equal(normalizeMcAccessToken("  Bearer  abc.def.ghi  "), "abc.def.ghi");
  });
  it("strips quotes", () => {
    assert.equal(normalizeMcAccessToken('"eyJhbGciOi"'), "eyJhbGciOi");
  });
});

describe("looksLikeMcToken", () => {
  it("accepts JWT-like tokens", () => {
    assert.equal(
      looksLikeMcToken("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig"),
      true,
    );
  });
  it("rejects short strings", () => {
    assert.equal(looksLikeMcToken("short"), false);
  });
});

describe("formatUuidDashed", () => {
  it("dashes 32-char hex", () => {
    const raw = "0123456789abcdef0123456789abcdef";
    assert.equal(formatUuidDashed(raw), "01234567-89ab-cdef-0123-456789abcdef");
  });
});
