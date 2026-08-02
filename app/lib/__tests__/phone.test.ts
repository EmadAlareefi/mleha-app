import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizePhoneWithDialCode } from "../phone";

describe("normalizePhoneWithDialCode", () => {
  it("uses Kuwait's dialing code for a local number beginning with 05", () => {
    assert.equal(normalizePhoneWithDialCode("051234567", "+965"), "+96551234567");
  });

  it("uses Yemen's dialing code and removes the local trunk prefix", () => {
    assert.equal(normalizePhoneWithDialCode("0771234567", "+967"), "+967771234567");
  });

  it("does not duplicate a dialing code already included in the number", () => {
    assert.equal(normalizePhoneWithDialCode("96551234567", "+965"), "+96551234567");
  });

  it("does not mistake a short local prefix for an included dialing code", () => {
    assert.equal(normalizePhoneWithDialCode("96512345", "+965"), "+96596512345");
  });

  it("preserves an explicitly-qualified number over a separate dialing code", () => {
    assert.equal(normalizePhoneWithDialCode("+971501234567", "+965"), "+971501234567");
  });

  it("keeps the Saudi fallback when Salla does not provide a dialing code", () => {
    assert.equal(normalizePhoneWithDialCode("0512345678"), "+966512345678");
  });

  it("rejects invalid international numbers", () => {
    assert.equal(normalizePhoneWithDialCode("123", "+965"), "");
  });
});
