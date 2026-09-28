import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAddressSearchQuery,
  extractCoordinatesFromMapUrl,
  extractShipToLocation,
  isRedundantAddressNote,
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

describe("distanceKm / formatDistance", () => {
  it("measures straight-line distance between two Jeddah pins", async () => {
    const { distanceKm, formatDistance } = await import("../../my-deliveries/delivery-helpers");
    // Al Safa → Al Manarat, about 29 km apart.
    const km = distanceKm({ lat: 21.58530926333, lng: 39.213156230096 }, { lat: 21.8442574, lng: 39.10315782 });
    assert.ok(km > 28 && km < 31, `got ${km}`);
    assert.equal(formatDistance(km), `${Math.round(km)} كم`);
    assert.equal(formatDistance(3.456), "3.5 كم");
    assert.equal(formatDistance(0.42), "400 م");
    assert.equal(formatDistance(0.01), "50 م");
  });
});

describe("isRedundantAddressNote", () => {
  const known = ["الصالحية 134", "الصالحية", "جدة", "7739", "JGAD7739", "23764"];

  it("drops Salla's reformatted national address", () => {
    assert.equal(
      isRedundantAddressNote("JGAD7739, Building 7739, الصالحية 134, 4727, الصالحية, جدة, منطقة مكة المكرمة", known),
      true,
    );
    assert.equal(
      isRedundantAddressNote("JDSD6629، 6629 هند بنت عمرو، 4170، الصفا، جدة 23455، السعودية", [
        "هند بنت عمرو", "الصفا", "جدة", "6629", "JDSD6629", "23455",
      ]),
      true,
    );
  });

  it("keeps notes that tell the courier something new", () => {
    assert.equal(isRedundantAddressNote("الباب أخضر فلا دوبلكس رقم ١٢", known), false);
    assert.equal(isRedundantAddressNote("جده منصور النمري رقم العماره 8948 الدور الأرضي شقه يسار", known), false);
  });
});

describe("street cleanup", () => {
  it("strips a building number Salla put before the street name", () => {
    const location = extractShipToLocation({
      shipping: { address: { city: "جدة", street_number: "4997,يوسف البنقالي", building_number: "4997" } },
    });
    assert.equal(location?.street, "يوسف البنقالي");
  });
});
