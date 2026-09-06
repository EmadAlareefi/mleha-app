# Customer invoice audit — 6 September 2026

The customer PDF generator had an incomplete destination lookup and several
independent information/display defects. Fixes are implemented locally; no
deployment, customer messages, or database updates were performed.

## Findings and corrections

| Field | Previous behavior | Corrected behavior |
| --- | --- | --- |
| City/address | Ignored `shipments[].ship_to`, `shipping.ship_to`, and legacy destination shapes; could use the profile city instead. Object-valued cities were discarded. | Uses the shared destination resolver, including named city objects. Return shipments are excluded. |
| Partial addresses | Commercial invoices could concatenate street details from several destinations or borrow unrelated profile location fields. | Takes street details from one destination; missing destination location fields are not supplied from the profile. |
| Recipient/contact | Customer PDF always used the profile name and mobile, even when the order had a separate receiver. Dialing codes were omitted. | Uses recipient details when available, with customer contact fallback; avoids duplicating a dialing code. |
| Invoice date | Date-only values such as `2025-08-17` became the current date and time. | Preserves the actual date, leaves unavailable time blank, and does not invent a date for invalid input. |
| Invoice identification | Official invoice number was in the model/filename but absent from the printed page; invoice date was labeled order date. | Prints the invoice number separately from the order number and labels the invoice date correctly. |
| Tax/amounts | Explicit zero values could fall through to other values, including a 15% tax rate. Partial official records could turn missing amounts into zero. | Preserves explicit zeros; falls back to order amounts only for missing fields. |
| Discounts | A discount without coupon metadata had no visible totals row. | Prints a generic discount row when the amount is positive. |
| Currency | Derived only from the first item, defaulting to SAR for empty item lists. | Prefers official invoice/order currency. |
| Invoice selection | Falling back to the first record could select a sales refund. | Excludes refund/credit records and records explicitly belonging to another order. |
| Total verification | Only the public endpoint checked totals, and skipped zero-value orders. | Both PDF endpoints check agreement with the order total, including zero, with the existing 0.02 tolerance. |

## Evidence

Read-only database inspection covered the latest 200 stored orders, placed
between `2026-09-04T22:15:04Z` and `2026-09-06T10:45:32Z`. All contained items
and shipment destinations. The prior city string differed from the destination
resolver in 198 records; frequent examples were `الرياض`/`Riyadh` and
`جدة`/`Jeddah`. This is **not a count of geographically incorrect cities**.
No confirmed count of previously delivered wrong-city PDFs was established.

There were 14 stored invoice records: nine sales invoices and five sales refund
invoices. All 14 had date-only values. Nine had associated order snapshots;
the old renderer produced the wrong date for all nine in the baseline run.

After the fixes, the same sample had:

- No missing rendered city, street address, or phone in the 200 order models.
- No city differences between the customer model and shared destination resolver
  (an internal consistency check, not independent geographic verification).
- No hidden positive discounts or lost explicit zero tax rates.
- No invoice-date or order-total differences in the nine invoice/order pairs.

## Validation and limits

Regression suites for invoice data, commercial addresses, and customer journey
notifications passed, including multi-page PDF generation. New cases cover
conflicting destinations, return shipments, named city objects, partial
addresses, phone prefixes, dates, zeros, discounts, currency, invoice selection,
and total reconciliation. Targeted ESLint and repository TypeScript checks
passed.

The audit used stored snapshots and synthetic regression cases. It did not
retrieve previously delivered PDFs, verify live Salla responses, visually
inspect rendered pages, or independently verify seller registration/address
configuration. Seller details remain sourced from the existing environment
settings/defaults. Stored data was not changed; already downloaded or printed
PDFs will retain their original contents. Multiple outbound destinations still
use the first supplied outbound shipment, so this is not a per-package invoice
implementation.

Rerun the aggregate-only, read-only check with:

```bash
npx tsx scripts/audit-customer-invoices.ts
```

Run the focused regression suites with:

```bash
node --test --import tsx app/lib/__tests__/salla-invoice-pdf.test.ts app/lib/__tests__/commercial-invoice-address.test.ts app/lib/__tests__/customer-journey-notifications.test.ts
```
