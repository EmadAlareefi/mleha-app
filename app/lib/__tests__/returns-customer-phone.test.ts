import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getOrderCustomerPhones,
  isPhoneProofRequired,
  orderBelongsToPhone,
} from '../returns/customer-phone';

const saudiOrder = {
  id: 1,
  reference_id: '251263484',
  customer: { id: 42, mobile: '512345678', mobile_code: '966', email: 'r@example.com' },
};

test('every Saudi format the customer might type matches', () => {
  for (const typed of [
    '0512345678',
    '512345678',
    '+966512345678',
    '00966512345678',
    '966512345678',
    '  0512345678  ',
    '05 12 34 56 78',
    '٠٥١٢٣٤٥٦٧٨',
  ]) {
    assert.equal(orderBelongsToPhone(saudiOrder, typed), true, `expected ${typed} to match`);
  }
});

test('a different number does not match', () => {
  for (const typed of ['0512345679', '0501111111', '+966555555555']) {
    assert.equal(orderBelongsToPhone(saudiOrder, typed), false, `expected ${typed} to be rejected`);
  }
});

test('matches an international customer via the separate dial code', () => {
  // Salla splits these: without the dial code, 051234567 would be read as Saudi.
  const kuwaiti = {
    customer: { id: 7, mobile: '51234567', mobile_code: '+965' },
  };

  assert.equal(orderBelongsToPhone(kuwaiti, '+96551234567'), true);
  assert.equal(orderBelongsToPhone(kuwaiti, '0096551234567'), true);
  assert.equal(orderBelongsToPhone(kuwaiti, '+966551234567'), false);
});

test('reads the dial code from any of the spellings Salla uses', () => {
  for (const key of [
    'mobile_code',
    'mobileCode',
    'phone_code',
    'phoneCode',
    'dial_code',
    'dialCode',
    'country_code',
    'countryCode',
  ]) {
    const order = { customer: { mobile: '51234567', [key]: '965' } };
    assert.equal(orderBelongsToPhone(order, '+96551234567'), true, `expected ${key} to be read`);
  }
});

test('falls back to the customer phone field', () => {
  const order = { customer: { id: 3, phone: '0512345678' } };
  assert.equal(orderBelongsToPhone(order, '512345678'), true);
});

test('an ISO country code is ignored rather than mangling the number', () => {
  const order = { customer: { mobile: '0512345678', country_code: 'SA' } };
  assert.equal(orderBelongsToPhone(order, '0512345678'), true);
});

test('fails closed when there is nothing to match against', () => {
  assert.equal(orderBelongsToPhone({ customer: { id: 1 } }, '0512345678'), false);
  assert.equal(orderBelongsToPhone({ customer: { mobile: '' } }, '0512345678'), false);
  assert.equal(orderBelongsToPhone({}, '0512345678'), false);
  assert.equal(orderBelongsToPhone(null, '0512345678'), false);
});

test('an absent or unusable input never matches', () => {
  for (const typed of ['', '   ', null, undefined, 'not a phone', '123', {}, []]) {
    assert.equal(orderBelongsToPhone(saudiOrder, typed), false, `expected ${JSON.stringify(typed)} to be rejected`);
  }
});

test('collects the normalized numbers an order answers to', () => {
  assert.deepEqual(getOrderCustomerPhones(saudiOrder), ['+966512345678']);
  assert.deepEqual(getOrderCustomerPhones({}), []);
});

test('the requirement is on unless explicitly disabled', () => {
  const original = process.env.RETURNS_REQUIRE_PHONE;
  try {
    delete process.env.RETURNS_REQUIRE_PHONE;
    assert.equal(isPhoneProofRequired(), true);

    process.env.RETURNS_REQUIRE_PHONE = 'true';
    assert.equal(isPhoneProofRequired(), true);

    // Only the exact string switches it off, so a typo fails safe.
    process.env.RETURNS_REQUIRE_PHONE = 'no';
    assert.equal(isPhoneProofRequired(), true);

    process.env.RETURNS_REQUIRE_PHONE = 'false';
    assert.equal(isPhoneProofRequired(), false);
  } finally {
    if (original === undefined) {
      delete process.env.RETURNS_REQUIRE_PHONE;
    } else {
      process.env.RETURNS_REQUIRE_PHONE = original;
    }
  }
});
