import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAddressSearchQuery,
  extractCoordinatesFromMapUrl,
  extractShipToLocation,
} from "../local-shipping/ship-to-location";
import { extractPrimaryShipTo } from "../local-shipping/messenger";

// Shapes taken from stored Salla webhook orders (personal fields removed).
const webhookOrder = {
  id: 975034943,
  receiver: { name: "x", phone: "x" },
  shipping: {
    company: "مندوب توصيل - جدة",
    receiver: { name: "x", phone: "x" },
    address: {
      city: "جدة",
      block: "الصفا",
      country: "SA",
      postal_code: "23455",
      short_address: "JDSD6629",
      street_number: "هند بنت عمرو,6629",
      building_number: "6629",
      geo_coordinates: { lat: 21.58530926333, lng: 39.213156230096 },
      shipping_address: "هند بنت عمرو, 6629, الصفا, جدة, MQ, SA",
      additional_number: "4170",
    },
  },
  shipments: [
    {
      courier_name: "مندوب توصيل - جدة",
      ship_to: {
        city: "Jeddah",
        block: "الصفا",
        district: { id: 1, name: "الصفا" },
        latitude: 21.58530926333,
        longitude: 39.213156230096,
        postal_code: "23455",
        address_line: "هند بنت عمرو, 6629, الصفا, جدة, MQ, SA",
        short_address: "JDSD6629",
        street_number: "هند بنت عمرو,6629",
        building_number: "6629",
        address_line_two: "الدور الأرضي شقة يسار",
        additional_number: "4170",
      },
    },
  ],
};

describe("extractShipToLocation", () => {
  it("reads the pin and address parts from shipments[].ship_to", () => {
    const location = extractShipToLocation(webhookOrder);
    assert.ok(location);
    assert.equal(location.latitude, 21.58530926333);
    assert.equal(location.longitude, 39.213156230096);
    assert.equal(location.buildingNumber, "6629");
    assert.equal(location.street, "هند بنت عمرو");
    assert.equal(location.district, "الصفا");
    assert.equal(location.shortAddress, "JDSD6629");
    assert.equal(location.addressNote, "الدور الأرضي شقة يسار");
  });

  it("falls back to shipping.address.geo_coordinates", () => {
    const location = extractShipToLocation({ shipping: webhookOrder.shipping });
    assert.equal(location?.latitude, 21.58530926333);
    assert.equal(location?.city, "جدة");
  });

  it("ignores the 0,0 placeholder sent when the customer set no pin", () => {
    const location = extractShipToLocation({
      shipping: { address: { city: "جدة", block: "الصفا", geo_coordinates: { lat: 0, lng: 0 } } },
    });
    assert.equal(location?.latitude, null);
    assert.equal(location?.district, "الصفا");
  });

  it("returns null for the live API shape that has no shipping sections", () => {
    assert.equal(extractShipToLocation({ id: 1, receiver: { name: "x" } }), null);
  });
});

describe("extractPrimaryShipTo", () => {
  it("does not settle for a receiver block that has no address", () => {
    const shipTo = extractPrimaryShipTo({ shipping: webhookOrder.shipping });
    assert.equal(shipTo?.district, "الصفا");
    assert.equal(shipTo?.city, "جدة");
  });
});

describe("buildAddressSearchQuery", () => {
  it("builds a geocodable query without names, phones or short codes", () => {
    assert.equal(
      buildAddressSearchQuery({
        buildingNumber: "6629",
        street: "هند بنت عمرو",
        district: "الصفا",
        city: "جدة",
        postalCode: "23455",
      }),
      "6629 هند بنت عمرو، الصفا، جدة 23455، السعودية",
    );
  });

  it("refuses a city-only query that would drop a pin in the city centre", () => {
    assert.equal(buildAddressSearchQuery({ city: "جدة" }), null);
  });
});

describe("extractCoordinatesFromMapUrl", () => {
  it("reads @lat,lng and query= links", () => {
    assert.deepEqual(
      extractCoordinatesFromMapUrl("https://www.google.com/maps/place/x/@21.5853,39.2131,17z"),
      { lat: 21.5853, lng: 39.2131 },
    );
    assert.deepEqual(
      extractCoordinatesFromMapUrl("https://www.google.com/maps/search/?api=1&query=21.5,39.2"),
      { lat: 21.5, lng: 39.2 },
    );
  });

  it("returns null for short links it cannot read", () => {
    assert.equal(extractCoordinatesFromMapUrl("https://maps.app.goo.gl/abc123"), null);
  });
});
