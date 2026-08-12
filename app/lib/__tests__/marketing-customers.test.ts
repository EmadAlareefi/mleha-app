import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMarketingCustomerCsv,
} from '../marketing-customers';

test('parseMarketingCustomerCsv supports Arabic headers, quoted cells, and deduplication', () => {
  const result = parseMarketingCustomerCsv(
    'الاسم,رقم الجوال,البريد الإلكتروني\n"سارة، محمد",0501234567,SARA@example.com\nسارة ثانية,+966501234567,other@example.com',
    'opted_in'
  );
  assert.equal(result.customers.length, 1);
  assert.equal(result.customers[0].phone, '+966501234567');
  assert.equal(result.customers[0].name, 'سارة، محمد');
  assert.equal(result.customers[0].consentStatus, 'opted_in');
  assert.equal(result.duplicatePhones, 1);
});

test('parseMarketingCustomerCsv reports invalid phones without importing them', () => {
  const result = parseMarketingCustomerCsv('name,phone\nInvalid,123\nValid,0501234567');
  assert.equal(result.customers.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].row, 2);
});
