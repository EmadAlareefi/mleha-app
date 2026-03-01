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
  MSEGAT_API_URL: process.env.MSEGAT_API_URL || "https://www.msegat.com/gw/sendsms.php",
  MSEGAT_USERNAME: process.env.MSEGAT_USERNAME,
  MSEGAT_API_KEY: process.env.MSEGAT_API_KEY,
  MSEGAT_SENDER_ID: process.env.MSEGAT_SENDER_ID,
  MSEGAT_DEBUG_RECIPIENT: process.env.MSEGAT_DEBUG_RECIPIENT,
  DATABASE_URL: process.env.DATABASE_URL!,
};
