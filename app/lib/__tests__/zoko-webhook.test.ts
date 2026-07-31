import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeZokoEvent } from "../zoko-webhook";
import { buildAvailabilityDeliveryUpdate } from "../availability-delivery";

describe("normalizeZokoEvent", () => {
  it("normalizes outgoing store messages", () => {
    const payload = {
      agentEmail: "reemebenhade@gmail.com",
      appType: "webapp",
      chatType: "individual",
      customer: {
        id: "4f23d4b2-2d54-11f1-9f01-19a634716d2e",
        name: "Suha",
      },
      customerName: "Suha",
      deliveryStatus: "sent",
      direction: "FROM_STORE",
      event: "message:store:out",
      id: "173e2c30-2dbf-11f1-8796-217de01e13fd",
      platform: "WHATSAPP",
      platformSenderId: "+966501362227",
      platformTimestamp: "2026-04-01T11:36:57Z",
      senderName: "Suha",
      text: "hello",
      type: "text",
    };

    const normalized = normalizeZokoEvent(payload);
    assert.ok(normalized && normalized.kind === "message");
    assert.equal(normalized.chatId, payload.customer.id);
    assert.equal(normalized.messageId, payload.id);
    assert.equal(normalized.chatSnapshot.customerName, payload.customer.name);
    assert.equal(normalized.direction, "FROM_STORE");
    assert.equal(normalized.agentEmail, payload.agentEmail);
    assert.ok(normalized.platformTimestamp);
  });

  it("normalizes chat assignment events", () => {
    const payload = {
      customerId: "dd32d196-2dbe-11f1-a021-19a634716d2e",
      event: "zoko:chat:assigned",
      eventAt: "2026-04-01T11:35:21Z",
      status: "assigned",
      agent: {
        id: "d27d5f64-10f2-11f1-970d-19a634716d2e",
        email: "saada-29@hotmail.com",
        name: "نورة سعيد ",
      },
    };

    const normalized = normalizeZokoEvent(payload);
    assert.ok(normalized && normalized.kind === "assignment");
    assert.equal(normalized.chatId, payload.customerId);
    assert.equal(normalized.status, "assigned");
    assert.equal(normalized.agent?.id, payload.agent.id);
    assert.ok(normalized.eventAt instanceof Date);
  });

  it("normalizes chat closure events", () => {
    const payload = {
      customerId: "666750cb-0754-11f1-bf9f-19a634716d2e",
      event: "zoko:chat:closed",
      eventAt: "2026-04-01T11:36:51Z",
      status: "closed",
      agent: {
        id: "c3738dce-80c7-11f0-9ffe-42010a020911",
        email: "mo7amed23111@gmail.com",
        name: "محمد ",
      },
    };

    const normalized = normalizeZokoEvent(payload);
    assert.ok(normalized && normalized.kind === "closure");
    assert.equal(normalized.chatId, payload.customerId);
    assert.equal(normalized.status, "closed");
    assert.equal(normalized.agent?.email, payload.agent.email);
    assert.ok(normalized.eventAt instanceof Date);
  });

  it("returns null for unsupported events", () => {
    const normalized = normalizeZokoEvent({ event: "unknown", id: "1" });
    assert.equal(normalized, null);
  });

  it("normalizes message delivery updates for later reconciliation", () => {
    const normalized = normalizeZokoEvent({
      event: "message:status:update",
      id: "provider-message-1",
      customerId: "chat-1",
      direction: "FROM_STORE",
      deliveryStatus: "delivered",
      platformTimestamp: "2026-07-31T12:00:00Z",
    });

    assert.ok(normalized && normalized.kind === "message");
    assert.equal(normalized.messageId, "provider-message-1");
    assert.equal(normalized.deliveryStatus, "delivered");
  });
});

describe("buildAvailabilityDeliveryUpdate", () => {
  it("records delivery and read states as delivered", () => {
    const eventAt = new Date("2026-07-31T12:00:00Z");
    assert.deepEqual(buildAvailabilityDeliveryUpdate("delivered", eventAt), {
      deliveryStatus: "delivered",
      deliveredAt: eventAt,
      deliveryFailedAt: null,
      notifyError: null,
    });
    assert.equal(buildAvailabilityDeliveryUpdate("read", eventAt)?.deliveredAt, eventAt);
  });

  it("records terminal provider failures separately from API acceptance", () => {
    const eventAt = new Date("2026-07-31T12:00:00Z");
    assert.deepEqual(buildAvailabilityDeliveryUpdate("undelivered", eventAt), {
      deliveryStatus: "failed",
      deliveryFailedAt: eventAt,
      notifyError: "Zoko delivery undelivered",
    });
  });
});
