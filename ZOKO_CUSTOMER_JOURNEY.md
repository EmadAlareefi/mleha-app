# Zoko customer-journey setup

The application keeps this flow disabled until every template below is approved
in Zoko/Meta and the matching environment variables are configured. Templates
must use Arabic (`ar`) and the **Utility** category. BODY variables restart at
`{{1}}` inside the Zoko editor; after approval Zoko flattens header, body, and
button parameters into the send order documented below.

## Cost-optimized journey

WhatsApp charges per delivered template message, not per template definition.
The normal order journey therefore sends only three high-value messages:

1. Order received, with the invoice.
2. Order shipped, with carrier details and a tracking button.
3. Order delivered, with the product-rating link, delayed 24 hours by default.

Preparation and out-for-delivery events are deliberately silent. The delivered
confirmation and rating request are combined into one transactional feedback
message. This reduces the normal journey from six delivered templates to three
while retaining every document and required trust milestone.

Cancellation and refund messages remain separate exception notifications. They
are uncommon, may happen at different times, and have materially different
financial meaning. A generic exception template would not reduce the number of
delivered messages and would make Meta approval and customer understanding less
reliable.

Only the invoice template includes a document. The shipping template uses a
dynamic tracking button and does not send the shipment label.

## Templates to create

### `order_received_invoice_ar_v1`

- Category: Utility
- Type: rich template
- Header: document; upload the sample PDF separately
- BODY examples: `سارة`, `100245`
- Flattened send order: document, customer name, order number
- Body:

  ```text
  مرحبًا {{1}} 🤍
  تم استلام طلبك رقم {{2}}

  تم إرفاق فاتورة طلبك للاطلاع عليها.
  وبمجرد شحن طلبك، سنرسل لك رقم التتبع وكافة تفاصيل الشحنة ✨

  شكرًا لاختيارك مليحة 🤍
  ```

### `order_shipped_label_ar_v1`

- Category: Utility
- Type: button template
- No header or document
- BODY examples: `سارة`, `100245`, `سمسا`, `1234567890`
- Dynamic URL button `تتبع الشحنة`: tracking URL
- Flattened send order: customer, order, carrier, tracking number, tracking URL
- Body:

  ```text
  مرحباً {{1}} 📦

  تم شحن طلبك رقم {{2}} وهو الآن في طريقه إليك.
  شركة الشحن: {{3}}
  رقم التتبع: {{4}}

  يمكنك متابعة حالة الشحنة وتفاصيل خروجها للتسليم عبر الزر أدناه.
  ```

### `order_delivered_rating_ar_v1`

- Category: Utility
- Type: button template
- Body variables: customer `{{1}}`, order `{{2}}`
- URL button `قيمي منتجاتك`: `{{3}}`
- Body:

  ```text
  يا هلا {{1}} 🤍

  وصل طلبك رقم {{2}} بالسلامة ✨
  نتمنى إنه نال إعجابك.

  إذا عندك أي ملاحظة، ردي علينا هنا ونسعد بخدمتك.
  ويسعدنا تشاركيننا تقييمك من الزر أدناه 🌷
  ```

Keep this template strictly transactional: do not add discounts, cross-sells,
incentives, or promotional copy. Those additions can cause Meta to classify it
as Marketing instead of Utility.

### `order_cancelled_ar_v1`

- Category: Utility
- Type: regular template
- Variables: customer `{{1}}`, order `{{2}}`
- Body:

  ```text
  مرحبًا {{1}} 🤍

  تم تأكيد إلغاء طلبك رقم {{2}} بنجاح.

  إذا كان الطلب مدفوعًا، فسيتم إرسال إشعار لك بمجرد إصدار الاسترداد.

  لأي استفسار، فقط قومي بالرد على هذه الرسالة ونسعد بخدمتك 🤍
  ```

### `order_refund_processed_ar_v1`

- Category: Utility
- Type: regular template
- Variables: customer `{{1}}`, order `{{2}}`, amount `{{3}}`, currency `{{4}}`
- Body:

  ```text
  مرحبًا {{1}} 🤍

  تم استرداد مبلغ طلبك رقم {{2}} بقيمة {{3}} {{4}} بنجاح ✨

  قد يستغرق ظهور المبلغ في حسابك بعض الوقت، وذلك حسب مدة المعالجة لدى البنك أو وسيلة الدفع.

  شكرًا لثقتك بمليحة 🌷
  ```

Do not use `ast1`, `sh1`, or the zero-variable `refund_processed` templates for
this flow: they cannot carry the required document or order data.

## Additional cost control

Meta does not currently charge for Utility templates sent in response to a user
inside an open 24-hour customer-service window. The application can keep using
the approved Utility template in that window; it does not need a separate
free-form message or another template. Zoko exposes the customer's `contactable`
state if reporting on free-window usage is added later.

Pricing is per delivered message and may change. Review the current official
pricing before changing the journey solely for billing reasons:
https://business.whatsapp.com/products/platform-pricing

## Activation checklist

1. Approve all five templates and run `npm run audit:zoko-journey`.
2. Apply the Prisma migration and configure the document signing secret/base URL.
3. Subscribe Salla to order created/updated/status, shipment created, cancelled,
   and refunded events. Ensure Zoko sends `message:delivery:update` events.
4. Keep `ZOKO_CUSTOMER_JOURNEY_ENABLED=false` during a synthetic order test.
5. Verify the invoice, tracking link, delayed delivery/rating
   message, cancellation, and refund paths.
6. Enable the flag only after the invoice PDF and tracking button open correctly.
7. Do not configure `ZOKO_DEBUG_PHONE` in production for document-bearing flows.

The rollout deliberately does not backfill historical orders.
