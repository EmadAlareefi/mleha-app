import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isE164, normalizeKSA, normalizeCustomerPhone } from "../phone";

describe("normalizeKSA", () => {
  it("normalizes the local 05xxxxxxxx form", () => {
    assert.equal(normalizeKSA("0512345678"), "+966512345678");
  });

  it("normalizes a bare 9-digit mobile (leading 0 lost by Salla)", () => {
    // This used to become +512345678 — a Peruvian number — and message
    // a stranger instead of the customer.
    assert.equal(normalizeKSA(512345678), "+966512345678");
  });

  it("keeps numbers that already carry the 966 country code", () => {
    assert.equal(normalizeKSA("966512345678"), "+966512345678");
    assert.equal(normalizeKSA("+966 51 234 5678"), "+966512345678");
    assert.equal(normalizeKSA("00966512345678"), "+966512345678");
  });

  it("drops a stray 0 kept after the country code", () => {
    assert.equal(normalizeKSA("9660512345678"), "+966512345678");
  });

  it("keeps full international numbers", () => {
    assert.equal(normalizeKSA("+971501234567"), "+971501234567");
    assert.equal(normalizeKSA("96551234567"), "+96551234567");
  });

  it("returns empty for numbers it cannot confidently resolve", () => {
    // Egyptian national number without a dial code — prepending "+" would
    // fabricate a number in another country.
    assert.equal(normalizeKSA("1012345678"), "");
    assert.equal(normalizeKSA("12345"), "");
    assert.equal(normalizeKSA("0123456789"), "");
    assert.equal(normalizeKSA(""), "");
    assert.equal(normalizeKSA(null), "");
    assert.equal(normalizeKSA(undefined), "");
  });
});

describe("normalizeCustomerPhone", () => {
  it("combines Salla's mobile + mobile_code", () => {
    assert.equal(normalizeCustomerPhone(512345678, "+966"), "+966512345678");
    assert.equal(normalizeCustomerPhone("0512345678", "966"), "+966512345678");
    assert.equal(normalizeCustomerPhone("1012345678", "+20"), "+201012345678");
    assert.equal(normalizeCustomerPhone(51234567, "+965"), "+96551234567");
  });

  it("does not duplicate a dial code already in the number", () => {
    assert.equal(
      normalizeCustomerPhone("966512345678", "+966"),
      "+966512345678"
    );
  });

  it("falls back to KSA heuristics without a dial code", () => {
    assert.equal(normalizeCustomerPhone("512345678", null), "+966512345678");
    assert.equal(normalizeCustomerPhone("0512345678", ""), "+966512345678");
  });

  it("returns empty for missing or implausible numbers", () => {
    assert.equal(normalizeCustomerPhone(null, "+966"), "");
    assert.equal(normalizeCustomerPhone("", "+966"), "");
    assert.equal(normalizeCustomerPhone("123", "+966"), "");
  });
});

describe("isE164", () => {
  it("accepts plus-prefixed international numbers", () => {
    assert.equal(isE164("+966512345678"), true);
    assert.equal(isE164("+96551234567"), true);
  });

  it("rejects malformed recipients", () => {
    assert.equal(isE164("966512345678"), false);
    assert.equal(isE164("+0512345678"), false);
    assert.equal(isE164("+12345"), false);
    assert.equal(isE164(""), false);
    assert.equal(isE164(null), false);
  });
});
