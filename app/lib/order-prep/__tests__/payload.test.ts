import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPrepOrder,
  compareLocations,
  matchLocation,
  trimOrderData,
  type LocationRecord,
} from '@/app/lib/order-prep/payload';

// Shape of a real webhook-stored Salla order (values anonymized).
const sizeOption = (size: string) => ({
  id: 1,
  name: 'المقاسات',
  type: 'radio',
  value: { id: 2, name: size, price: { amount: 0, currency: 'SAR' }, option_value: size },
  product_option_id: 3,
});

const rawOrder = {
  id: 111,
  reference_id: 241105,
  date: { date: '2026-11-09 21:51:12.000000', timezone: 'Asia/Riyadh' },
  status: { id: 566146469, slug: 'under_review', customized: { id: 449146439, name: 'طلب جديد' } },
  tags: ['VIP', { name: 'مستعجل' }],
  gift: { text: 'مبروك', image: null, deliver_at: null, expiry_date: '2027-01-04 21:03:21' },
  shipping: { company: 'SMSA', receiver: { name: 'x', phone: 'y' }, address: { country_code: 'SA', city: 'الرياض' } },
  customer: { first_name: 'secret', mobile: '0500000000', country: 'SA', city: 'الرياض' },
  items: [
    {
      id: 9001,
      name: 'فستان سهرة',
      sku: '0115',
      quantity: '1',
      product_thumbnail: 'https://cdn.salla.sa/a.jpg',
      options: [sizeOption('XL')],
      product: { id: 67940739, sku: '0115' },
    },
    {
      id: 9002,
      name: 'عباية',
      sku: '7413-BLK',
      quantity: 2,
      product_thumbnail: 'https://cdn.salla.sa/b.jpg',
      options: [sizeOption('M')],
      product: { id: 1082863548, sku: '7413-BLK' },
    },
  ],
};

const locations: LocationRecord[] = [
  { sku: '0115', productId: null, location: 'E12-1', notes: null },
  { sku: '7413', productId: null, location: 'E5-3', notes: 'الرف العلوي' },
];

test('builds the packer view from a stored Salla order', () => {
  const order = buildPrepOrder({
    orderId: '111',
    orderNumber: '241105',
    placedAt: new Date('2026-11-09T21:51:12Z'),
    rawOrder,
    locations,
    promoProductIds: new Set(['1082863548']),
  });
  assert.equal(order.orderNumber, '241105');
  assert.equal(order.totalUnits, 3);
  assert.equal(order.isPromo, true);
  assert.deepEqual(order.tags, ['VIP', 'مستعجل']);
  assert.deepEqual(order.gift, { flagged: false, message: 'مبروك' });
  // Sorted by shelf: E5-3 before E12-1.
  assert.deepEqual(order.items.map((item) => item.sku), ['7413-BLK', '0115']);
  const abaya = order.items[0];
  assert.equal(abaya.size, 'M');
  assert.equal(abaya.quantity, 2);
  assert.equal(abaya.location, 'E5-3');
  assert.equal(abaya.locationNote, 'الرف العلوي');
  assert.equal(abaya.imageUrl, 'https://cdn.salla.sa/b.jpg');
  assert.equal(order.items[1].size, 'XL');
  assert.equal(order.items[1].quantity, 1);
});

test('falls back to stored items when the payload has none', () => {
  const order = buildPrepOrder({
    orderId: '5',
    orderNumber: null,
    placedAt: null,
    rawOrder: { id: 5, reference_id: 77 },
    storedItems: [{ sku: '0115', name: 'فستان', quantity: 1, productId: null }],
    locations,
  });
  assert.equal(order.orderNumber, '77');
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].location, 'E12-1');
  assert.equal(order.gift, null);
});

test('location match: exact, then longest prefix (4+ chars), then product id', () => {
  const rows: LocationRecord[] = [
    { sku: 'ABCD', productId: null, location: 'A1-1', notes: null },
    { sku: 'ABCDE', productId: null, location: 'A2-2', notes: null },
    { sku: 'XYZ', productId: null, location: 'Z9-9', notes: null },
    { sku: 'OTHER', productId: '42', location: 'P4-2', notes: null },
  ];
  assert.equal(matchLocation('abcde', null, rows)?.location, 'A2-2');
  assert.equal(matchLocation('ABCDE-RED', null, rows)?.location, 'A2-2');
  assert.equal(matchLocation('ABCD-RED', null, rows)?.location, 'A1-1');
  // Prefixes shorter than 4 characters never match.
  assert.equal(matchLocation('XYZ-1', null, rows), null);
  assert.equal(matchLocation('NOPE', '42', rows)?.location, 'P4-2');
  assert.equal(matchLocation(null, null, rows), null);
});

test('shelf locations sort naturally, unknown last', () => {
  const sorted = ['E12-1', null, 'E5-10', 'AB1-4', 'E5-3', 'A9-1'].sort(compareLocations);
  assert.deepEqual(sorted, ['A9-1', 'AB1-4', 'E5-3', 'E5-10', 'E12-1', null]);
});

test('an empty gift object is not a gift', () => {
  const order = buildPrepOrder({
    orderId: '1',
    orderNumber: '1',
    placedAt: null,
    rawOrder: { ...rawOrder, gift: { text: null, image: null, deliver_at: null } },
    locations: [],
  });
  assert.equal(order.gift, null);
});

test('the stored claim payload drops customer contact details', () => {
  const trimmed = trimOrderData(rawOrder);
  assert.deepEqual(trimmed.customer, { country: 'SA', city: 'الرياض' });
  assert.ok(Array.isArray(trimmed.items));
  assert.equal(trimmed.reference_id, 241105);
});
