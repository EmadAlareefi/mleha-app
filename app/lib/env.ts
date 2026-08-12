export const env = {
  SALLA_WEBHOOK_SECRET: process.env.SALLA_WEBHOOK_SECRET!,
  ZOKO_BASE_URL: process.env.ZOKO_BASE_URL || "https://api.zoko.io",
  ZOKO_API_KEY: process.env.ZOKO_API_KEY!,
  ZOKO_DEFAULT_SENDER: process.env.ZOKO_DEFAULT_SENDER!,
  WHATSAPP_DEFAULT_LANG: process.env.WHATSAPP_DEFAULT_LANG || "ar",
  ZOKO_WEBHOOK_SECRET: process.env.ZOKO_WEBHOOK_SECRET,
  ZOKO_TPL_EXCHANGE_COUPON:
    process.env.ZOKO_TPL_EXCHANGE_COUPON ||
    process.env.ZOKO_TPL_ORDER_CONFIRMED || // fall back to any legacy template if provided
    "exchange_coupon_notification_new",
  ZOKO_TPL_RETURN_ORDER_LABEL_CREATED:
    process.env.ZOKO_TPL_RETURN_ORDER_LABEL_CREATED ||
    "return_order_label_created_ar",
  ZOKO_TPL_ASSIGNED_WELCOME:
    process.env.ZOKO_TPL_ASSIGNED_WELCOME || "assigned_welcome_ar",
  // Back-in-stock template. Positional args: 1 product link.
  // Must exist and be approved in Zoko.
  ZOKO_TPL_PRODUCT_BACK_IN_STOCK:
    process.env.ZOKO_TPL_PRODUCT_BACK_IN_STOCK || "notify_available_v1",
  ZOKO_CUSTOMER_JOURNEY_ENABLED:
    process.env.ZOKO_CUSTOMER_JOURNEY_ENABLED === "true",
  ZOKO_TPL_ORDER_RECEIVED_INVOICE:
    process.env.ZOKO_TPL_ORDER_RECEIVED_INVOICE || "order_received_invoice_ar_v1",
  ZOKO_TPL_ORDER_SHIPPED_LABEL:
    process.env.ZOKO_TPL_ORDER_SHIPPED_LABEL || "order_shipped_label_ar_v1",
  ZOKO_TPL_ORDER_DELIVERED_RATING:
    process.env.ZOKO_TPL_ORDER_DELIVERED_RATING || "order_delivered_rating_ar_v1",
  ZOKO_TPL_ORDER_CANCELLED:
    process.env.ZOKO_TPL_ORDER_CANCELLED || "order_cancelled_ar_v1",
  ZOKO_TPL_ORDER_REFUNDED:
    process.env.ZOKO_TPL_ORDER_REFUNDED || "order_refund_processed_ar_v1",
  CUSTOMER_RATING_DELAY_HOURS:
    Number(process.env.CUSTOMER_RATING_DELAY_HOURS || "24"),
  CUSTOMER_DOCUMENT_SIGNING_SECRET:
    process.env.CUSTOMER_DOCUMENT_SIGNING_SECRET || "",
  CUSTOMER_DOCUMENT_BASE_URL:
    process.env.CUSTOMER_DOCUMENT_BASE_URL || process.env.NEXTAUTH_URL || "",
  ZOKO_DEBUG_PHONE: process.env.ZOKO_DEBUG_PHONE || process.env.ZOKO_TEST_PHONE || "",
  MSEGAT_API_URL: process.env.MSEGAT_API_URL || "https://www.msegat.com/gw/sendsms.php",
  MSEGAT_USERNAME: process.env.MSEGAT_USERNAME,
  MSEGAT_API_KEY: process.env.MSEGAT_API_KEY,
  MSEGAT_SENDER_ID: process.env.MSEGAT_SENDER_ID,
  MSEGAT_DEBUG_RECIPIENT: process.env.MSEGAT_DEBUG_RECIPIENT,
  DATABASE_URL: process.env.DATABASE_URL!,
};
