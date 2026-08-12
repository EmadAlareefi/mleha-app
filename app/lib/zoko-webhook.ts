import { prisma } from "@/lib/prisma";
import { log } from "@/app/lib/logger";
import { buildAvailabilityDeliveryUpdate } from "@/app/lib/availability-delivery";
import { reconcileCustomerJourneyDelivery } from "@/app/lib/customer-journey-notifications";

type AnyRecord = Record<string, any>;

export type NormalizedZokoEvent =
  | NormalizedZokoMessageEvent
  | NormalizedZokoDeliveryEvent
  | NormalizedZokoAssignmentEvent
  | NormalizedZokoClosureEvent;

export interface NormalizedZokoDeliveryEvent {
  kind: "delivery";
  eventName: string;
  messageId: string;
  deliveryStatus?: string | null;
  platformTimestamp?: Date | null;
  payload: AnyRecord;
}

export interface NormalizedZokoMessageEvent {
  kind: "message";
  eventName: string;
  messageId: string;
  chatId: string;
  chatSnapshot: {
    customerName?: string | null;
    platform?: string | null;
    platformSenderId?: string | null;
    chatType?: string | null;
  };
  text?: string | null;
  direction?: string | null;
  type?: string | null;
  deliveryStatus?: string | null;
  platform?: string | null;
  platformTimestamp?: Date | null;
  senderName?: string | null;
  agentEmail?: string | null;
  payload: AnyRecord;
}

export interface NormalizedZokoAssignmentEvent {
  kind: "assignment";
  eventName: string;
  chatId: string;
  status: string;
  eventAt: Date;
  agent: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
  } | null;
  payload: AnyRecord;
}

export interface NormalizedZokoClosureEvent {
  kind: "closure";
  eventName: string;
  chatId: string;
  status: string;
  eventAt: Date;
  agent: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
  } | null;
  payload: AnyRecord;
}

const MESSAGE_EVENTS = new Set(["message:store:out", "message:user:in"]);
const ASSIGNMENT_EVENTS = new Set(["zoko:chat:assigned"]);
const CLOSURE_EVENTS = new Set(["zoko:chat:closed"]);

const DEFAULT_STATUS_OPEN = "open";

export function normalizeZokoEvent(input: unknown): NormalizedZokoEvent | null {
  if (!input || typeof input !== "object") return null;
  const payload = input as AnyRecord;
  const eventName = typeof payload.event === "string" ? payload.event : "";

  if (!eventName) return null;

  // Delivery updates contain the provider message id but no customer/chat id.
  // Normalize them separately so they can still reconcile the outbox row.
  if (eventName === "message:delivery:update") {
    const messageId = typeof payload.id === "string" ? payload.id : null;
    if (!messageId) return null;
    return {
      kind: "delivery",
      eventName,
      messageId,
      deliveryStatus: payload.deliveryStatus ?? null,
      platformTimestamp: toDate(payload.platformTimestamp),
      payload,
    };
  }

  if (MESSAGE_EVENTS.has(eventName) || eventName.startsWith("message:")) {
    const chatId = getChatId(payload);
    const messageId = typeof payload.id === "string" ? payload.id : null;
    if (!chatId || !messageId) return null;

    const platformTimestamp = toDate(payload.platformTimestamp);

    return {
      kind: "message",
      eventName,
      messageId,
      chatId,
      chatSnapshot: {
        customerName: payload.customer?.name ?? payload.customerName ?? payload.senderName ?? null,
        platform: payload.platform ?? null,
        platformSenderId: payload.platformSenderId ?? null,
        chatType: payload.chatType ?? payload.chat_type ?? null,
      },
      text: typeof payload.text === "string" ? payload.text : payload.text?.body ?? null,
      direction: payload.direction ?? null,
      type: payload.type ?? null,
      deliveryStatus: payload.deliveryStatus ?? null,
      platform: payload.platform ?? null,
      platformTimestamp,
      senderName: payload.senderName ?? payload.customer?.name ?? null,
      agentEmail: payload.agentEmail ?? payload.agent?.email ?? null,
      payload,
    };
  }

  if (ASSIGNMENT_EVENTS.has(eventName)) {
    const chatId = getChatId(payload);
    if (!chatId) return null;

    const eventAt = toDate(payload.eventAt) ?? new Date();
    const status = payload.status ?? "assigned";

    return {
      kind: "assignment",
      eventName,
      chatId,
      status,
      eventAt,
      agent: payload.agent
        ? {
            id: payload.agent.id ?? null,
            email: payload.agent.email ?? null,
            name: payload.agent.name ?? null,
          }
        : null,
      payload,
    };
  }

  if (CLOSURE_EVENTS.has(eventName)) {
    const chatId = getChatId(payload);
    if (!chatId) return null;

    const eventAt = toDate(payload.eventAt) ?? new Date();
    const status = payload.status ?? "closed";

    return {
      kind: "closure",
      eventName,
      chatId,
      status,
      eventAt,
      agent: payload.agent
        ? {
            id: payload.agent.id ?? null,
            email: payload.agent.email ?? null,
            name: payload.agent.name ?? null,
          }
        : null,
      payload,
    };
  }

  return null;
}

function getChatId(payload: AnyRecord): string | null {
  if (typeof payload.customerId === "string" && payload.customerId.trim()) {
    return payload.customerId.trim();
  }
  if (payload.customer && typeof payload.customer.id === "string" && payload.customer.id.trim()) {
    return payload.customer.id.trim();
  }
  return null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  try {
    const date = new Date(value as string);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

export async function processZokoWebhookPayload(rawPayload: unknown) {
  const eventsArray = Array.isArray(rawPayload)
    ? rawPayload
    : Array.isArray((rawPayload as AnyRecord)?.events)
      ? (rawPayload as AnyRecord).events
      : rawPayload
        ? [rawPayload]
        : [];

  let processed = 0;
  let skipped = 0;

  for (const item of eventsArray) {
    const normalized = normalizeZokoEvent(item);
    if (!normalized) {
      skipped += 1;
      continue;
    }

    try {
      await persistNormalizedEvent(normalized);
      processed += 1;
    } catch (error) {
      skipped += 1;
      log.error("Failed to persist Zoko event", { error, event: normalized.eventName });
    }
  }

  return { processed, skipped, total: eventsArray.length };
}

async function persistNormalizedEvent(event: NormalizedZokoEvent) {
  if (event.kind === "delivery") {
    await persistDelivery(event);
    return;
  }
  if (event.kind === "message") {
    await persistMessage(event);
    return;
  }

  if (event.kind === "assignment") {
    await persistAssignment(event);
    return;
  }

  await persistClosure(event);
}

async function persistDelivery(event: NormalizedZokoDeliveryEvent) {
  const timestamp = event.platformTimestamp ?? new Date();
  await prisma.zokoMessage.updateMany({
    where: { id: event.messageId },
    data: {
      deliveryStatus: event.deliveryStatus ?? undefined,
      platformTimestamp: timestamp,
      payload: event.payload,
    },
  });
  await reconcileCustomerJourneyDelivery({
    providerMessageId: event.messageId,
    deliveryStatus: event.deliveryStatus,
    occurredAt: timestamp,
  });

  const deliveryUpdate = buildAvailabilityDeliveryUpdate(
    event.deliveryStatus,
    timestamp
  );
  if (deliveryUpdate) {
    await prisma.sallaProductAvailabilityRequest.updateMany({
      where: { providerMessageId: event.messageId },
      data: deliveryUpdate,
    });
  }
}

async function persistMessage(event: NormalizedZokoMessageEvent) {
  const timestamp = event.platformTimestamp ?? new Date();
  const chatData: Record<string, unknown> = {
    customerName: event.chatSnapshot.customerName ?? undefined,
    platform: event.chatSnapshot.platform ?? undefined,
    platformSenderId: event.chatSnapshot.platformSenderId ?? undefined,
    chatType: event.chatSnapshot.chatType ?? undefined,
    lastMessageAt: timestamp,
    lastDirection: event.direction ?? undefined,
    lastMessageText: event.text ?? undefined,
  };

  if (event.direction !== "FROM_STORE") {
    chatData.status = DEFAULT_STATUS_OPEN;
    chatData.closedAt = null;
  }

  await prisma.zokoChat.upsert({
    where: { id: event.chatId },
    create: {
      id: event.chatId,
      status: DEFAULT_STATUS_OPEN,
      lastMessageAt: timestamp,
      lastDirection: event.direction ?? undefined,
      lastMessageText: event.text ?? undefined,
      openedAt: timestamp,
      ...chatData,
    },
    update: chatData,
  });

  await prisma.zokoMessage.upsert({
    where: { id: event.messageId },
    create: {
      id: event.messageId,
      chatId: event.chatId,
      event: event.eventName,
      direction: event.direction ?? undefined,
      type: event.type ?? undefined,
      text: event.text ?? undefined,
      deliveryStatus: event.deliveryStatus ?? undefined,
      platform: event.platform ?? undefined,
      platformSenderId: event.chatSnapshot.platformSenderId ?? undefined,
      senderName: event.senderName ?? undefined,
      agentEmail: event.agentEmail ?? undefined,
      platformTimestamp: timestamp,
      payload: event.payload,
    },
    update: {
      direction: event.direction ?? undefined,
      type: event.type ?? undefined,
      text: event.text ?? undefined,
      deliveryStatus: event.deliveryStatus ?? undefined,
      platform: event.platform ?? undefined,
      platformSenderId: event.chatSnapshot.platformSenderId ?? undefined,
      senderName: event.senderName ?? undefined,
      agentEmail: event.agentEmail ?? undefined,
      platformTimestamp: timestamp,
      payload: event.payload,
    },
  });

  const deliveryUpdate = buildAvailabilityDeliveryUpdate(
    event.deliveryStatus,
    event.platformTimestamp ?? new Date()
  );
  if (deliveryUpdate) {
    await prisma.sallaProductAvailabilityRequest.updateMany({
      where: { providerMessageId: event.messageId },
      data: deliveryUpdate,
    });
  }
  await reconcileCustomerJourneyDelivery({
    providerMessageId: event.messageId,
    deliveryStatus: event.deliveryStatus,
    occurredAt: timestamp,
  });
}

async function persistAssignment(event: NormalizedZokoAssignmentEvent) {
  if (event.agent?.id) {
    await prisma.zokoAgent.upsert({
      where: { id: event.agent.id },
      create: {
        id: event.agent.id,
        email: event.agent.email ?? undefined,
        name: event.agent.name ?? undefined,
      },
      update: {
        email: event.agent.email ?? undefined,
        name: event.agent.name ?? undefined,
      },
    });
  }

  await prisma.zokoChat.upsert({
    where: { id: event.chatId },
    create: {
      id: event.chatId,
      status: event.status,
      openedAt: event.eventAt,
    },
    update: {
      status: event.status,
      closedAt: null,
    },
  });

  const assignmentId = [
    event.chatId,
    event.agent?.id ?? "unassigned",
    event.status,
    event.eventAt.toISOString(),
  ].join(":");

  await prisma.zokoChatAssignment.upsert({
    where: {
      id: assignmentId,
    },
    create: {
      id: assignmentId,
      chatId: event.chatId,
      agentId: event.agent?.id ?? undefined,
      status: event.status,
      eventAt: event.eventAt,
      rawPayload: event.payload,
    },
    update: {
      rawPayload: event.payload,
    },
  });
  // Assignment welcome messages are temporarily disabled.
}

async function persistClosure(event: NormalizedZokoClosureEvent) {
  if (event.agent?.id) {
    await prisma.zokoAgent.upsert({
      where: { id: event.agent.id },
      create: {
        id: event.agent.id,
        email: event.agent.email ?? undefined,
        name: event.agent.name ?? undefined,
      },
      update: {
        email: event.agent.email ?? undefined,
        name: event.agent.name ?? undefined,
      },
    });
  }

  await prisma.zokoChat.upsert({
    where: { id: event.chatId },
    create: {
      id: event.chatId,
      status: event.status,
      openedAt: event.eventAt,
      closedAt: event.eventAt,
    },
    update: {
      status: event.status,
      closedAt: event.eventAt,
    },
  });

  const closureId = [
    event.chatId,
    event.agent?.id ?? "unassigned",
    event.status,
    event.eventAt.toISOString(),
  ].join(":");

  await prisma.zokoChatClosure.upsert({
    where: {
      id: closureId,
    },
    create: {
      id: closureId,
      chatId: event.chatId,
      agentId: event.agent?.id ?? null,
      status: event.status,
      eventAt: event.eventAt,
      rawPayload: event.payload,
    },
    update: {
      rawPayload: event.payload,
      agentId: event.agent?.id ?? null,
    },
  });
}
