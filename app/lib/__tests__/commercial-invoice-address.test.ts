import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCommercialInvoiceConsignee } from '@/lib/commercial-invoice-address';

test('prefers Salla shipment destination over customer address for commercial invoices', () => {
  const consignee = resolveCommercialInvoiceConsignee({
    customer: {
      first_name: 'Old',
      last_name: 'Customer',
      address: 'Customer profile address',
      city: 'Riyadh',
      country: 'Saudi Arabia',
      mobile_code: '+966',
      mobile: '500000000',
      email: 'customer@example.com',
    },
    shipping: {
      ship_to: {
        name: 'Actual Receiver',
        address_line: '221B Baker Street',
        district: 'Marylebone',
        city: 'London',
        country: 'United Kingdom',
        postal_code: 'NW1 6XE',
        phone: '+442000000000',
      },
    },
    shipping_address: {
      address: 'Old shipping address',
      city: 'Jeddah',
      country: 'Saudi Arabia',
    },
  });

  assert.equal(consignee.name, 'Actual Receiver');
  assert.equal(consignee.address, '221B Baker Street, Marylebone');
  assert.equal(consignee.city, 'London');
  assert.equal(consignee.country, 'United Kingdom');
  assert.equal(consignee.postalCode, 'NW1 6XE');
  assert.equal(consignee.phone, '+442000000000');
  assert.equal(consignee.email, 'customer@example.com');
});

test('falls back to legacy shipping address when shipment destination is absent', () => {
  const consignee = resolveCommercialInvoiceConsignee({
    customer: {
      first_name: 'Fallback',
      last_name: 'Customer',
      mobile_code: '+966',
      mobile: '511111111',
    },
    shipping_address: {
      address: 'Legacy shipping line',
      city: 'Dubai',
      country: 'United Arab Emirates',
    },
  });

  assert.equal(consignee.name, 'Fallback Customer');
  assert.equal(consignee.address, 'Legacy shipping line');
  assert.equal(consignee.city, 'Dubai');
  assert.equal(consignee.country, 'United Arab Emirates');
  assert.equal(consignee.phone, '+966511111111');
});
