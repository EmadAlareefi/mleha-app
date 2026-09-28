import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAjexReturnOrder,
  buildAjexReturnReference,
  type AjexWarehouseAddress,
} from '../returns/ajex-return-shipment';

const warehouse: AjexWarehouseAddress = {
  name: 'Mleha Warehouse',
  phone: '0501234567',
  city: 'الرياض',
  district: 'العليا',
  addressLine1: 'King Fahd Road',
  shortAddress: 'RRRD1234',
};

const order = {
  id: 1,
  reference_id: '240001',
  customer: { first_name: 'Sara', last_name: 'Ali', mobile: '555555555', mobile_code: '+966', email: 'sara@example.com' },
  shipping: {
    receiver: { name: 'Sara Ali', phone: '0555555555' },
    ship_to: {
      city: 'جدة',
      block: 'الروضة',
      address_line: 'شارع الأمير سلطان',
      short_address: 'JEDA1234',
      postal_code: '23435',
      geo_coordinates: { lat: '21.56', lng: '39.15' },
    },
  },
};

const items = [
  { productName: 'Abaya', variantName: 'L', productSku: 'AB-1', quantity: 2, price: 150 },
  { productName: 'Scarf', quantity: 1, price: 49.5 },
];

test('builds a prepaid courier pickup from the customer to the warehouse', () => {
  const result = buildAjexReturnOrder({ order, items, warehouse, referenceNumber: 'RET-240001-X', currency: 'SAR' });
  assert.ok(result.ok);
  const request = result.request;

  assert.equal(request.productCode, 'AJEX RPU');
  assert.equal(request.pickupMethod, 'COURIER_PICKUP');
  assert.equal(request.cod, false);
  assert.equal(request.codAmount, 0);
  assert.equal(request.declaredValue, 349.5);

  assert.equal(request.pickupAddress.name, 'Sara Ali');
  assert.equal(request.pickupAddress.phone, '+966555555555');
  assert.equal(request.pickupAddress.city, 'Jeddah');
  assert.equal(request.pickupAddress.districtCode, 'SAU-WESTERN-JED-AR RAWDAH');
  assert.equal(request.pickupAddress.addressType, 'CUSTOMER_MAPPINGS');
  assert.equal(request.pickupAddress.shortAddress, 'JEDA1234');
  assert.equal(request.pickupAddress.latitude, 21.56);

  assert.equal(request.deliveryAddress.city, 'Riyadh');
  assert.equal(request.deliveryAddress.districtCode, 'SAU-CENTERAL-RUH-AL OLAYA');
  assert.equal(request.deliveryAddress.phone, '+966501234567');

  assert.equal(request.packages[0].weight, 1.5);
  assert.deepEqual(request.items[0], {
    description: 'Abaya - L',
    quantity: 2,
    unitPrice: 150,
    currency: 'SAR',
    sku: 'AB-1',
    packageSequence: 1,
  });
});

test('falls back to free text when the district is not in the AJEX list', () => {
  const unmapped = {
    ...order,
    shipping: { ...order.shipping, ship_to: { ...order.shipping.ship_to, block: 'حي تجريبي' } },
  };
  const result = buildAjexReturnOrder({ order: unmapped, items, warehouse, referenceNumber: 'R', currency: 'SAR' });
  assert.ok(result.ok);
  assert.equal(result.request.pickupAddress.addressType, 'FREE_TEXT');
  assert.equal(result.request.pickupAddress.city, 'Jeddah');
  assert.equal(result.request.pickupAddress.district, 'حي تجريبي');
  assert.equal(result.request.pickupAddress.districtCode, undefined);
});

test('refuses to build without a customer phone or city', () => {
  const noPhone = { ...order, customer: {}, shipping: { ship_to: order.shipping.ship_to } };
  assert.equal(
    buildAjexReturnOrder({ order: noPhone, items, warehouse, referenceNumber: 'R', currency: 'SAR' }).ok,
    false,
  );
  const noCity = { ...order, shipping: { receiver: order.shipping.receiver, ship_to: {} } };
  assert.equal(
    buildAjexReturnOrder({ order: noCity, items, warehouse, referenceNumber: 'R', currency: 'SAR' }).ok,
    false,
  );
});

test('builds unique references within the 40 character limit', () => {
  const reference = buildAjexReturnReference('9'.repeat(60), 1_790_000_000_000);
  assert.ok(reference.length <= 40);
  assert.ok(reference.startsWith('RET-'));
  assert.notEqual(
    buildAjexReturnReference('240001', 1_790_000_000_000),
    buildAjexReturnReference('240001', 1_790_000_000_001),
  );
});
