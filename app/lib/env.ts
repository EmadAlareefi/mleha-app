export const env = {
  SALLA_WEBHOOK_SECRET: process.env.SALLA_WEBHOOK_SECRET!,
  ZOKO_BASE_URL: process.env.ZOKO_BASE_URL || "https://api.zoko.io",
  ZOKO_API_KEY: process.env.ZOKO_API_KEY!,
  ZOKO_DEFAULT_SENDER: process.env.ZOKO_DEFAULT_SENDER!,
  WHATSAPP_DEFAULT_LANG: process.env.WHATSAPP_DEFAULT_LANG || "ar",
  ZOKO_TPL_EXCHANGE_COUPON:
    process.env.ZOKO_TPL_EXCHANGE_COUPON ||
    process.env.ZOKO_TPL_ORDER_CONFIRMED || // fall back to any legacy template if provided
    "exchange_coupon_notification",
  DATABASE_URL: process.env.DATABASE_URL!,
};
