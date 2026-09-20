import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeE164Phone, normalizeKSA, normalizePhoneWithDialCode } from "../phone";

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

describe("normalizeKSA", () => {
  it("adds the country code to a bare Saudi mobile", () => {
    // Salla returns `mobile` without the country code; before this the number
    // became "+540426074" and every OTP was dropped by the gateway.
    assert.equal(normalizeKSA("540426074"), "+966540426074");
  });

  it("still handles the local trunk-prefixed form", () => {
    assert.equal(normalizeKSA("0540426074"), "+966540426074");
  });

  it("leaves an already-qualified Saudi number alone", () => {
    assert.equal(normalizeKSA("+966540426074"), "+966540426074");
    assert.equal(normalizeKSA("00966540426074"), "+966540426074");
    assert.equal(normalizeKSA("966540426074"), "+966540426074");
  });

  it("does not claim nine-digit numbers that are not Saudi mobiles", () => {
    assert.equal(normalizeKSA("412345678"), "+412345678");
  });
});

describe("normalizeE164Phone", () => {
  it("accepts a bare Saudi mobile as the SMS gateway now receives it", () => {
    assert.equal(normalizeE164Phone("540426074"), "+966540426074");
  });

  it("rejects a Saudi number that is not a mobile", () => {
    assert.equal(normalizeE164Phone("966126543210"), "");
  });
});
