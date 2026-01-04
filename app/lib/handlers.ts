import { normalizeKSA } from "@/app/lib/phone";
import { sendWhatsAppTemplate, sendWhatsAppText } from "@/app/lib/zoko";
import { env } from "@/app/lib/env";
import { log } from "@/app/lib/logger";
import { storeSallaTokens } from "@/app/lib/salla-oauth";
import { upsertSallaOrderFromPayload } from "@/app/lib/salla-sync";
import { sendPrintJob, PRINTNODE_LABEL_PAPER_NAME, PRINTNODE_DEFAULT_DPI } from "@/app/lib/printnode";
import { prisma } from "@/lib/prisma";
import { linkExchangeOrderFromWebhook } from "@/app/lib/returns/exchange-order";

type AnyObj = Record<string, any>;

interface WebhookMeta {
  orderId?: string | null;
  status?: string | null;
  isDuplicateStatus?: boolean;
  event?: string | null;
  merchantId?: string | null;
}

type TemplateName = keyof typeof TPL;

interface TemplateContext {
  customerName: string;
  orderNumber: string;
  reviewLink: string;
  shipment: {
    carrier: string;
    trackingNumber: string;
    trackingLink: string;
  };
}

interface StatusTemplateConfig {
  templateKey?: TemplateName;
  buildArgs?: (ctx: TemplateContext) => (string | number)[];
}

function normalizeStatusValue(value: any): string | null {
  if (!value) return null;
  if (typeof value === "string" || typeof value === "number") {
    return value.toString().toLowerCase();
  }
  if (typeof value === "object") {
    const candidate =
      value.slug ?? value.code ?? value.status ?? value.name ?? value.id ?? null;
    return candidate ? String(candidate).toLowerCase() : null;
  }
  return null;
}

function extractOrderStatus(order: AnyObj): string | null {
  if (!order) return null;
  const candidates = [
    order.status,
    order.order_status,
    order.state,
    order.orderStatus,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeStatusValue(candidate);
    if (normalized) return normalized;
  }
  return null;
}

const DEBUG_WHATSAPP_RECIPIENT =
  process.env.ZOKO_DEBUG_PHONE || process.env.ZOKO_TEST_PHONE || "+966501466365";

const TPL = {
  ORDER_CONFIRMATION:
    process.env.ZOKO_TPL_ORDER_CONFIRMATION || "order_confirmation_ar",
  ORDER_PROCESSING:
    process.env.ZOKO_TPL_ORDER_PROCESSING || "order_processing_ar",
  ORDER_SHIPPED:
    process.env.ZOKO_TPL_ORDER_SHIPPED || "order_shipped_ar",
  ORDER_DELIVERED:
    process.env.ZOKO_TPL_ORDER_DELIVERED || "order_delivered_ar",
  PRODUCTS_UPDATED:
    process.env.ZOKO_TPL_PRODUCTS_UPDATED || "order_products_updated",
  CUSTOMER_LOGIN: process.env.ZOKO_TPL_CUSTOMER_LOGIN || "customer_login",
  ABANDONED_CART:
    process.env.ZOKO_TPL_ABANDONED_CART || "abandoned_cart_reminder",
  ABANDONED_CART_PURCHASED:
    process.env.ZOKO_TPL_ABANDONED_CART_PURCHASED ||
    "abandoned_cart_purchased",
  ABANDONED_CART_STATUS_CHANGED:
    process.env.ZOKO_TPL_ABANDONED_CART_STATUS_CHANGED ||
    "abandoned_cart_status_changed",
  ABANDONED_CART_UPDATE:
    process.env.ZOKO_TPL_ABANDONED_CART_UPDATE || "abandoned_cart_update",
};

function getCustomerName(customer: AnyObj): string {
  return (
    customer?.first_name ||
    customer?.firstName ||
    customer?.name ||
    customer?.full_name ||
    customer?.customer_name ||
    "عميلنا"
  );
}

function getOrderNumber(order: AnyObj): string {
  return (
    order?.order_number?.toString?.() ||
    order?.orderNumber?.toString?.() ||
    order?.reference_id?.toString?.() ||
    order?.referenceId?.toString?.() ||
    order?.reference?.toString?.() ||
    order?.id?.toString?.() ||
    order?.order_id?.toString?.() ||
    ""
  );
}

function getShipmentDetails(order: AnyObj, data?: AnyObj) {
  const shipment = order?.shipment || data?.shipment || {};
  return {
    carrier:
      shipment?.company ||
      shipment?.carrier ||
      order?.shipping_company ||
      "",
    trackingNumber:
      shipment?.tracking_number ||
      shipment?.tracking ||
      order?.tracking_number ||
      "",
    trackingLink:
      shipment?.tracking_link ||
      shipment?.tracking_url ||
      shipment?.tracking_page ||
      shipment?.tracking_web_url ||
      order?.tracking_link ||
      "",
  };
}

function collectRecipients(to?: string | null): string[] {
  const recipients = new Set<string>();
  const primary = to?.replace?.(/\s/g, "");
  if (primary) recipients.add(primary);
  const debug = DEBUG_WHATSAPP_RECIPIENT?.replace?.(/\s/g, "");
  if (debug) recipients.add(debug);
  return Array.from(recipients);
}

async function maybePrintShipmentLabelFromStatus(
  order: AnyObj,
  data: AnyObj,
  meta?: WebhookMeta
) {
  if (meta?.event !== "order.updated") {
    return;
  }

  const merchantId =
    meta?.merchantId ||
    data?.merchant?.toString?.() ||
    data?.store?.id?.toString?.() ||
    order?.merchant_id?.toString?.() ||
    null;

  if (!merchantId) {
    return;
  }

  const shipmentsArray = Array.isArray(order?.shipments)
    ? order.shipments
    : Array.isArray(data?.shipments)
      ? data.shipments
      : [];
  const shipping = order?.shipping || data?.shipping || {};
  const fallbackShipment =
    shipmentsArray.find((shipment: AnyObj) => shipment?.label?.url) ||
    shipmentsArray[0] ||
    {};
  const shipmentInfo = shipping?.shipment || fallbackShipment || {};
  const receiver = shipping?.receiver || shipmentInfo.receiver || shipmentInfo.ship_to || {};
  const shippingCompany =
    shipping?.company ||
    shipmentInfo.courier_name ||
    shipmentInfo.courier ||
    shipmentInfo.courierName ||
    "";
  const trackingLink =
    shipmentInfo.tracking_link ||
    shipmentInfo.trackingLink ||
    shipmentInfo.tracking_url ||
    "";
  const shipmentReference =
    (
      shipping?.shipment_reference ||
      shipmentInfo.shipment_reference ||
      shipmentInfo.reference ||
      shipmentInfo.reference_id ||
      ""
    )?.toString() || "";
  const status =
    shipmentInfo.status ||
    shipping?.status ||
    order?.status?.slug ||
    order?.status?.name ||
    data?.status?.slug ||
    data?.status?.name ||
    "created";

  const shipmentUrl =
    shipmentInfo.label?.url ||
    shipmentInfo.label_url ||
    shipmentInfo.labelUrl ||
    (typeof shipmentInfo.label === "string" ? shipmentInfo.label : null);

  if (!shipmentUrl) {
    return;
  }

  const orderIdFromPayload =
    order?.id?.toString?.() ||
    order?.order_id?.toString?.() ||
    data?.id?.toString?.() ||
    data?.order_id?.toString?.() ||
    null;

  const referenceId =
    order?.reference_id?.toString?.() ||
    order?.referenceId?.toString?.() ||
    order?.order_number?.toString?.() ||
    data?.reference_id?.toString?.() ||
    data?.referenceId?.toString?.() ||
    orderIdFromPayload ||
    "";

  const trackingNumberValue = (
    shipmentInfo.tracking_number ||
    shipmentInfo.trackingNumber ||
    shipmentInfo.shipping_number ||
    shipmentInfo.tracking_no ||
    shipmentInfo.id ||
    shipmentReference ||
    trackingLink ||
    ""
  ).toString();

  const resolvedOrderId =
    orderIdFromPayload ||
    referenceId ||
    shipmentReference ||
    shipmentInfo.order_number?.toString?.() ||
    shipmentInfo.order_id?.toString?.() ||
    trackingNumberValue ||
    shipmentInfo.id?.toString?.() ||
    "";

  if (!resolvedOrderId) {
    log.warn("order.updated webhook missing orderId for printing", {
      referenceId,
      merchantId,
    });
    return;
  }

  let storedShipment: AnyObj | null = null;
  let alreadyPrinted = false;

  try {
    storedShipment = await prisma.sallaShipment.upsert({
      where: {
        merchantId_orderId: {
          merchantId,
          orderId: resolvedOrderId,
        },
      },
      create: {
        merchantId,
        orderId: resolvedOrderId,
        orderNumber: referenceId || resolvedOrderId,
        trackingNumber: trackingNumberValue,
        courierName: shippingCompany || "Unknown",
        courierCode: (shippingCompany || "").toString().toLowerCase().replace(/\s+/g, "_"),
        status,
        labelUrl: shipmentUrl || undefined,
        shipmentData: {
          shipment_id: shipmentInfo.id,
          tracking_link: trackingLink,
          tracking_number: trackingNumberValue,
          label_url: shipmentUrl,
          receiver_name: receiver?.name,
          receiver_phone: receiver?.phone,
          city: shipping?.address?.city || shipmentInfo.ship_to?.city || "",
          shipment_reference: shipmentReference,
          raw_payload: data,
        } as any,
      },
      update: {
        trackingNumber: trackingNumberValue,
        courierName: shippingCompany || "Unknown",
        courierCode: (shippingCompany || "").toString().toLowerCase().replace(/\s+/g, "_"),
        status,
        labelUrl: shipmentUrl || undefined,
        shipmentData: {
          shipment_id: shipmentInfo.id,
          tracking_link: trackingLink,
          tracking_number: trackingNumberValue,
          label_url: shipmentUrl,
          receiver_name: receiver?.name,
          receiver_phone: receiver?.phone,
          city: shipping?.address?.city || shipmentInfo.ship_to?.city || "",
          shipment_reference: shipmentReference,
          raw_payload: data,
        } as any,
      },
    });

    alreadyPrinted =
      storedShipment.labelPrinted ||
      (storedShipment.printCount ?? 0) > 0 ||
      Boolean((storedShipment.shipmentData as any)?.labelPrinted);
  } catch (error) {
    log.error("Failed to upsert shipment from order.updated webhook", {
      error,
      merchantId,
      orderId: resolvedOrderId,
    });
  }

  if (alreadyPrinted) {
    log.info("Shipment already printed for order.updated webhook", {
      merchantId,
      orderId: resolvedOrderId,
    });
    return;
  }

  try {
    const printResult = await sendPrintJob({
      title: `Shipment Label - Order ${referenceId || resolvedOrderId}`,
      contentType: "pdf_uri",
      content: shipmentUrl,
      copies: 1,
      paperName: PRINTNODE_LABEL_PAPER_NAME,
      fitToPage: false,
      dpi: PRINTNODE_DEFAULT_DPI,
      rotate: 0,
    });

    if (printResult.success) {
      if (storedShipment?.id) {
        await prisma.sallaShipment.update({
          where: { id: storedShipment.id },
          data: {
            labelPrinted: true,
            labelPrintedAt: new Date(),
            labelPrintedBy: "system",
            labelPrintedByName: "Salla order.updated webhook",
            labelUrl: shipmentUrl,
            printJobId: printResult.jobId ? String(printResult.jobId) : storedShipment.printJobId,
            printCount: (storedShipment.printCount ?? 0) + 1,
          },
        });
      }

      log.info("Label sent to PrintNode from order.updated webhook", {
        merchantId,
        orderId: resolvedOrderId,
        jobId: printResult.jobId,
      });
    } else {
      log.error("PrintNode error while handling order.updated webhook", {
        merchantId,
        orderId: resolvedOrderId,
        error: printResult.error,
      });
    }
  } catch (error) {
    log.error("Failed to send PrintNode job from order.updated webhook", {
      merchantId,
      orderId: resolvedOrderId,
      error,
    });
  }
}

const STATUS_TEMPLATE_MAP: Record<string, StatusTemplateConfig> = {
  payment_pending: {
    templateKey: "ORDER_CONFIRMATION",
    buildArgs: (ctx) => [ctx.customerName, ctx.orderNumber],
  },
  under_review: {
    templateKey: "ORDER_CONFIRMATION",
    buildArgs: (ctx) => [ctx.customerName, ctx.orderNumber],
  },
  processing: {
    templateKey: "ORDER_PROCESSING",
    buildArgs: (ctx) => [ctx.customerName, ctx.orderNumber],
  },
  in_progress: {
    templateKey: "ORDER_PROCESSING",
    buildArgs: (ctx) => [ctx.customerName, ctx.orderNumber],
  },
  ready_for_pickup: {
    templateKey: "ORDER_PROCESSING",
    buildArgs: (ctx) => [ctx.customerName, ctx.orderNumber],
  },
  shipped: {
    templateKey: "ORDER_SHIPPED",
    buildArgs: (ctx) => [
      ctx.customerName,
      ctx.orderNumber,
      ctx.shipment.carrier,
      ctx.shipment.trackingNumber,
      ctx.shipment.trackingLink,
    ],
  },
  delivering: {
    templateKey: "ORDER_SHIPPED",
    buildArgs: (ctx) => [
      ctx.customerName,
      ctx.orderNumber,
      ctx.shipment.carrier,
      ctx.shipment.trackingNumber,
      ctx.shipment.trackingLink,
    ],
  },
  delivered: {
    templateKey: "ORDER_DELIVERED",
    buildArgs: (ctx) => [ctx.customerName, ctx.orderNumber, ctx.reviewLink],
  },
  completed: {
    templateKey: "ORDER_DELIVERED",
    buildArgs: (ctx) => [ctx.customerName, ctx.orderNumber, ctx.reviewLink],
  },
  canceled: {
    // No template linked yet; configure when ready
  },
  restored: {
    // Shared slug for full/partial restored statuses
  },
  restoring: {
    // No template linked yet
  },
  request_quote: {
    // Quote requests handled manually; no template by default
  },
};

// Common safe sender
async function sendTpl(
  to?: string | null,
  templateId?: string,
  args: (string | number)[] = [],
  lang: string = env.WHATSAPP_DEFAULT_LANG || "ar"
) {
  const recipients = collectRecipients(to);
  if (recipients.length === 0) {
    log.warn("No WhatsApp recipient available for sendTpl");
    return { skipped: "no_recipient" };
  }

  const responses: any[] = [];
  for (const recipient of recipients) {
    if (!templateId) {
      const fallback = `إشعار: ${args.map(String).join(" - ")}`;
      responses.push(await sendWhatsAppText(recipient, fallback));
      continue;
    }
    responses.push(
      await sendWhatsAppTemplate({
        to: recipient,
        templateId,
        lang,
        args,
      })
    );
  }

  return responses.length === 1 ? responses[0] : responses;
}

export async function processSallaWebhook(payload: AnyObj, meta?: WebhookMeta) {
  const event = payload?.event || payload?.topic || payload?.type;
  const data = payload?.data ?? payload?.order ?? payload;

  switch (event) {
    case "app.store.authorize":
      return process_app_store_authorize(payload);
    case "order.created":
      return process_salla_order_created(data, meta);
    case "order.updated":
      return process_salla_order_updated(data, meta);
    case "order.status.updated":
      return process_salla_order_status_updated(data, meta);
    case "order.products.updated":
      return update_refunded_quantity(data);
    case "customer.login":
      return process_customer_login(data);
    case "order.shipment.created":
      return process_salla_shipment_created(data);
    case "abandoned.cart":
      return process_abandoned_cart(data);
    case "abandoned.cart.purchased":
      return process_abandoned_cart_purchased(data);
    case "abandoned.cart.status.changed":
      return process_abandoned_cart_status_changed(data);
    case "abandoned.cart.update":
      return process_abandoned_cart_update(data);
    default:
      return { success: true, ignored: event };
  }
}

// ---- Specific handlers (each with its own template) ----

/**
 * Handles Salla app authorization webhook
 * Stores OAuth tokens for future API requests
 */
export async function process_app_store_authorize(payload: AnyObj) {
  const merchantId = String(payload?.merchant ?? "");
  const data = payload?.data ?? {};
  const accessToken = data?.access_token ?? "";
  const refreshToken = data?.refresh_token ?? "";
  // Support both 'expires' (timestamp) and 'expires_in' (seconds) from Salla
  const expiresIn = data?.expires
    ? Math.max(0, Math.floor((Number(data.expires) * 1000 - Date.now()) / 1000))
    : Number(data?.expires_in ?? 0);
  const scope = data?.scope ?? "";

  if (!merchantId || !accessToken || !refreshToken || !expiresIn) {
    log.error("Invalid app.store.authorize payload", { payload });
    return { success: false, error: "missing_required_fields" };
  }

  try {
    await storeSallaTokens(merchantId, accessToken, refreshToken, expiresIn, scope);
    log.info("Salla app authorized successfully", { merchantId });
    return { success: true, message: "tokens_stored", merchantId };
  } catch (error) {
    log.error("Failed to store Salla tokens", { merchantId, error });
    return { success: false, error: "failed_to_store_tokens" };
  }
}

export async function process_salla_order_updated(data: AnyObj, meta?: WebhookMeta) {
  // Salla sends most status changes via order.updated, so reuse the same flow
  return process_salla_order_status_updated(data, meta);
}


export async function process_salla_order_status_updated(
  data: AnyObj,
  meta?: WebhookMeta
) {
  const order: AnyObj = data?.order ?? data ?? {};
  const orderId = String(order?.id ?? order?.order_id ?? "");
  const status = extractOrderStatus(order);
  if (!status) {
    log.warn("No status found on order payload", { orderId });
    return { success: true, skipped: "no_status" };
  }
  const customer = order?.customer ?? order?.customer_info ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  const orderNumber = getOrderNumber(order) || orderId;
  const customerName = getCustomerName(customer);
  const reviewLink =
    process.env.ZOKO_REVIEW_LINK ||
    order?.review_link ||
    order?.survey_link ||
    "";

  const { carrier, trackingNumber, trackingLink } = getShipmentDetails(order, data);

  await upsertSallaOrderFromPayload(data);
  await maybePrintShipmentLabelFromStatus(order, data, meta);
  await linkExchangeOrderFromWebhook(order, {
    merchantId: meta?.merchantId,
    orderId,
  });

  if (
    meta?.isDuplicateStatus &&
    meta?.orderId === orderId &&
    meta?.status === status
  ) {
    log.info("Skipping duplicate order status notification", { orderId, status });
    return { success: true, skipped: "duplicate_status" };
  }
  const templateCtx: TemplateContext = {
    customerName,
    orderNumber,
    reviewLink,
    shipment: { carrier, trackingNumber, trackingLink },
  };

  const statusConfig = STATUS_TEMPLATE_MAP[status];
  if (!statusConfig || !statusConfig.templateKey) {
    log.info("Status not linked to a template", { orderId, status });
    return { success: true, skipped: "status_not_linked" };
  }

  const templateId = TPL[statusConfig.templateKey];
  const args =
    statusConfig.buildArgs?.(templateCtx) ?? [customerName, orderNumber];

  const resp = await sendTpl(phone, templateId, args);
  return { success: true, message: "sent", zoko: resp };
}

export async function process_salla_order_created(
  data: AnyObj,
  meta?: WebhookMeta
) {
  const order: AnyObj = data?.order ?? data ?? {};
  const customer = order?.customer ?? order?.customer_info ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  const customerName = getCustomerName(customer);
  const orderNumber =
    getOrderNumber(order) || String(order?.id ?? order?.order_id ?? "");
  await linkExchangeOrderFromWebhook(order, {
    merchantId: meta?.merchantId,
    orderId: meta?.orderId ?? order?.id?.toString?.() ?? null,
  });

  const resp = await sendTpl(phone, TPL.ORDER_CONFIRMATION, [
    customerName,
    orderNumber,
  ]);
  return { success: true, message: "sent", zoko: resp };
}

export async function update_refunded_quantity(data: AnyObj) {
  const order: AnyObj = data?.order ?? data ?? {};
  const orderId = String(order?.id ?? order?.order_id ?? "");
  const customer = order?.customer ?? order?.customer_info ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  if (!phone) return { success: true, skipped: "no_phone" };

  // Minimal args (customize to your template's placeholders)
  const resp = await sendTpl(phone, TPL.PRODUCTS_UPDATED, [orderId]);
  return { success: true, message: "sent", zoko: resp };
}

export async function process_customer_login(data: AnyObj) {
  const customer = data?.customer ?? data ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  const firstName =
    customer?.first_name || customer?.firstName || customer?.name || "";
  if (!phone) return { success: true, skipped: "no_phone" };

  // Example: {{1}}=firstName
  const resp = await sendTpl(phone, TPL.CUSTOMER_LOGIN, [firstName || "عميلنا"]);
  return { success: true, message: "sent", zoko: resp };
}

export async function process_salla_shipment_created(data: AnyObj) {
  const order: AnyObj = data?.order ?? data ?? {};
  const orderId = String(order?.id ?? order?.order_id ?? "");
  const customer = order?.customer ?? order?.customer_info ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  const customerName = getCustomerName(customer);
  const orderNumber = getOrderNumber(order) || orderId;
  const { carrier, trackingNumber, trackingLink } = getShipmentDetails(order, data);

  await upsertSallaOrderFromPayload(data);

  const resp = await sendTpl(phone, TPL.ORDER_SHIPPED, [
    customerName,
    orderNumber,
    carrier,
    trackingNumber,
    trackingLink,
  ]);
  return { success: true, message: "sent", zoko: resp };
}

export async function process_abandoned_cart(data: AnyObj) {
  const cart = data?.cart ?? data ?? {};
  const customer = cart?.customer ?? data?.customer ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  const firstName =
    customer?.first_name || customer?.firstName || customer?.name || "";
  const link = cart?.url || cart?.link || data?.link || "";

  if (!phone) return { success: true, skipped: "no_phone" };

  // Example: {{1}}=firstName, {{2}}=link
  const resp = await sendTpl(phone, TPL.ABANDONED_CART, [firstName || "ضيفنا", link || ""]);
  return { success: true, message: "sent", zoko: resp };
}

export async function process_abandoned_cart_purchased(data: AnyObj) {
  const cart = data?.cart ?? data ?? {};
  const customer = cart?.customer ?? data?.customer ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  const firstName =
    customer?.first_name || customer?.firstName || customer?.name || "";

  if (!phone) return { success: true, skipped: "no_phone" };

  // Example: {{1}}=firstName
  const resp = await sendTpl(phone, TPL.ABANDONED_CART_PURCHASED, [firstName || "عميلنا"]);
  return { success: true, message: "sent", zoko: resp };
}

export async function process_abandoned_cart_status_changed(data: AnyObj) {
  const cart = data?.cart ?? data ?? {};
  const customer = cart?.customer ?? data?.customer ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  const status = String(cart?.status || data?.status || "");
  if (!phone) return { success: true, skipped: "no_phone" };

  // Example: {{1}}=status
  const resp = await sendTpl(phone, TPL.ABANDONED_CART_STATUS_CHANGED, [status || ""]);
  return { success: true, message: "sent", zoko: resp };
}

export async function process_abandoned_cart_update(data: AnyObj) {
  const cart = data?.cart ?? data ?? {};
  const customer = cart?.customer ?? data?.customer ?? {};
  const phone = normalizeKSA(customer?.mobile ?? customer?.phone ?? "");
  const itemsCount =
    (Array.isArray(cart?.items) && cart.items.length) || data?.items_count || 0;

  if (!phone) return { success: true, skipped: "no_phone" };

  // Example: {{1}}=itemsCount
  const resp = await sendTpl(phone, TPL.ABANDONED_CART_UPDATE, [String(itemsCount)]);
  return { success: true, message: "sent", zoko: resp };
}
