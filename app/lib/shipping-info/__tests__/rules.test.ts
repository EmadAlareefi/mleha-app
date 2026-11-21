import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOrderUpdatePayload,
  defaultLanguageFor,
  extractShippingInfo,
  findMissingFields,
  hasFullName,
  initialFormValues,
  parseSubmission,
  splitName,
} from '../rules';

// Shapes copied from real international orders (personal data replaced).
const uaeOrder = {
  id: 111,
  reference_id: 300111,
  customer: { first_name: 'فاطمة', last_name: 'صالح', mobile: 501234567, mobile_code: '+971' },
  shipping: {
    receiver: { name: 'فاطمة صالح', phone: '+971501234567', email: 'a@example.com' },
    address: {
      city: 'ABU DHABI',
      block: 'alriyadh city',
      country: 'AE',
      postal_code: '',
      country_code: 'AE',
      short_address: '',
      street_number: "Bad' ydeed street",
      building_number: '198',
      geo_coordinates: { lat: 24.355238978059, lng: 54.558252559955 },
      additional_number: '',
    },
  },
  shipments: [
    {
      ship_to: {
        city: 'ABU DHABI',
        name: 'فاطمة صالح',
        block: 'alriyadh city',
        city_id: 2097610897,
        country: 'United Arab Emirates',
        district: null,
        country_id: 566146469,
        postal_code: '',
        country_code: 'AE',
        street_number: "Bad' ydeed street",
        building_number: '198',
        address_line_two: 'Zone 12 alshamkha south',
      },
    },
  ],
};

const usOrder = {
  id: 222,
  shipping: {
    receiver: { name: 'Ranya Doumah', phone: '+15551234567' },
    address: {
      city: 'Midlothian',
      block: '',
      country: 'US',
      postal_code: '23114',
      country_code: 'US',
      street_number: '11413 laurel top place',
      building_number: '',
      geo_coordinates: { lat: 37.449765446406, lng: -77.470640366967 },
    },
  },
  shipments: [{ ship_to: { city_id: 1077468843, country_id: 1411953639, district: null, address_line_two: 'Leave at door' } }],
};

test('full name needs three words of two letters or more', () => {
  assert.equal(hasFullName('فاطمة صالح'), false);
  assert.equal(hasFullName('فاطمة محمد صالح'), true);
  assert.equal(hasFullName('Ranya A Doumah'), false);
  assert.equal(hasFullName('  Ranya   Ahmad  Doumah '), true);
  assert.equal(hasFullName('محمد بن علي'), true);
});

test('extracts the shipping info from the Salla order shape', () => {
  const info = extractShippingInfo({ order: uaeOrder });
  assert.equal(info.name, 'فاطمة صالح');
  assert.equal(info.district, 'alriyadh city');
  assert.equal(info.street, "Bad' ydeed street");
  assert.equal(info.countryCode, 'AE');
  assert.equal(info.country, 'United Arab Emirates');
  assert.equal(info.addressLine2, 'Zone 12 alshamkha south');
});

test('missing fields: 2-part name, empty district, placeholder street', () => {
  assert.deepEqual(findMissingFields(extractShippingInfo(uaeOrder)), ['name']);
  assert.deepEqual(findMissingFields(extractShippingInfo(usOrder)), ['name', 'district']);
  assert.deepEqual(findMissingFields({ name: 'a b c', district: '-', street: 'غير محدد' }), ['name', 'district', 'street']);
  assert.deepEqual(findMissingFields({ name: 'Ali Ahmad Saleh', district: 'Zone 1', street: 'Main st' }), []);
});

test('splits a stored name into the three form fields', () => {
  assert.deepEqual(splitName('فاطمة صالح'), { firstName: 'فاطمة', middleName: '', lastName: 'صالح' });
  assert.deepEqual(splitName('Ali Ahmad bin Saleh'), { firstName: 'Ali', middleName: 'Ahmad bin', lastName: 'Saleh' });
  assert.deepEqual(splitName(''), { firstName: '', middleName: '', lastName: '' });
  assert.equal(initialFormValues(usOrder).postalCode, '23114');
});

test('submission validation', () => {
  const missing = parseSubmission({ firstName: 'Ranya', middleName: ' ', lastName: 'Doumah', district: '', street: 'x st' });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.deepEqual(missing.errors, ['middle_name', 'district']);

  const ok = parseSubmission({
    firstName: ' Ranya ',
    middleName: 'Ahmad',
    lastName: 'Doumah',
    district: 'Chesterfield',
    street: '11413 laurel top place',
    postalCode: '23114',
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.firstName, 'Ranya');
});

test('update payload keeps Salla ids and overlays the customer answers', () => {
  const parsed = parseSubmission({
    firstName: 'فاطمة',
    middleName: 'محمد',
    lastName: 'صالح',
    district: 'Al Shamkha',
    street: "Bad' ydeed street",
    buildingNumber: '198',
    addressLine2: 'Zone 12',
  });
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const body = buildOrderUpdatePayload(uaeOrder, parsed.value);
  assert.equal(body.receiver.name, 'فاطمة محمد صالح');
  assert.equal(body.receiver.phone, '+971501234567');
  assert.equal(body.receiver.notify, false);
  assert.equal(body.ship_to.country, 566146469);
  assert.equal(body.ship_to.city, 2097610897);
  assert.equal('district' in body.ship_to, false); // no Salla id for it
  assert.equal(body.ship_to.block, 'Al Shamkha');
  assert.equal(body.ship_to.street_number, "Bad' ydeed street");
  assert.equal(body.ship_to.building_number, '198');
  assert.equal(body.ship_to.address_line, "Bad' ydeed street, Zone 12, Al Shamkha, ABU DHABI, AE");
  assert.deepEqual(body.ship_to.geo_coordinates, { lat: 24.355238978059, lng: 54.558252559955 });
});

test('postal code from the order is kept when the customer leaves it empty', () => {
  const parsed = parseSubmission({ firstName: 'Ranya', middleName: 'Ahmad', lastName: 'Doumah', district: 'Chesterfield', street: 'Laurel top' });
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.equal(buildOrderUpdatePayload(usOrder, parsed.value).ship_to.postal_code, '23114');
});

test('page language follows the destination', () => {
  assert.equal(defaultLanguageFor('AE'), 'ar');
  assert.equal(defaultLanguageFor('us'), 'en');
  assert.equal(defaultLanguageFor(''), 'en');
});
