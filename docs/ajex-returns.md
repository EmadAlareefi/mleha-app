# AJEX direct return shipments

Returns are routed by the courier that delivered the original order:

- **AJEX orders**: the app books the return (reverse pickup) directly with the AJEX API.
- **Every other courier**: Salla issues the waybill through `create_return_policy`, unchanged.

`resolveReturnShipmentProvider` (`lib/returns/return-provider.ts`) decides the
route. It checks the stored `SallaShipment` courier code and name first, then the
courier name on the Salla order (`getShippingCompanyName`), then whether the
tracking number looks like an AJEX one (`AJ…`). If an order is AJEX but the AJEX
API credentials are not configured, it falls back to Salla and logs a warning.

## Flow (AJEX orders)

1. `POST /api/returns/create` validates the order as before, then calls
   `bookAjexReturnShipment` (`app/lib/returns/ajex-return-shipment.ts`). The
   shipment is a reverse pickup: the pickup point is the customer's shipping
   address (`buildConsigneeAddressFromOrder`) and the destination is the
   warehouse (`buildMerchantShipperAddress`, i.e. `SMSA_MERCHANT_*` /
   `NEXT_PUBLIC_MERCHANT_*`). Pieces are the returned quantity, the weight is
   0.5 kg per item, and the declared value is the refund amount.
2. If AJEX fails, the request is not created and the customer sees an error.
3. The AJEX tracking number is stored in `smsaTrackingNumber` / `smsaAwbNumber`
   (legacy names), and `smsaResponse.provider = 'ajex'`.
4. `returnLabelUrl` is AJEX's label URL. If AJEX only returns base64, it is a
   signed 30-day link to `/api/public/order-documents/return-label/<merchant>/<returnRequestId>`,
   which fetches the PDF from AJEX on demand. The WhatsApp label message
   (`maybeNotifyReturnLabelCreated`) is sent right away.
5. The Salla order is still moved to `restoring`.

Salla-only paths skip AJEX requests: `syncReturnShipment` doesn't query Salla for
them. It only retries a pending WhatsApp send, or stores the signed label link.

In returns-management, "إعادة إصدار البوليصة" books a new AJEX pickup, cancels the
old one, and resends the label. Cancelling a return request also cancels its AJEX
pickup (best effort).

Tracking callbacks for these waybills arrive at `/api/webhooks/ajex/tracking`
(see `ajex-webhook.md`). The `referenceId` is `R-<orderReference>-<suffix>`.

## Configuration

The client (`app/lib/ajex-api.ts`) targets AJEX's AONE API, v1.7. That's the same
version as the tracking callback, and the same integration that passed sign-off
in alesaei-app.

| Call | Endpoint (sandbox host `api-aone-mw-stage.aj-ex.com`) |
| --- | --- |
| Token (no auth header; `clientId`/`clientSecret`) | `POST /auth/api/v1/token` |
| Create order | `POST /mwo/api/v1/orders` |
| Waybill PDF | `GET /mwo/api/v1/print/{trackingId}` |
| Cancel | `POST /mwo/api/v1/orders/cancel` (`{ trackingIds: [...] }`) |

A call succeeded only when the body has `code: 200` and `status: "SUCCESS"`.
AJEX can answer HTTP 200 with a failure body.

- **Returns:** product `AJEX RPU`. The customer is `pickupAddress` and the
  warehouse is `deliveryAddress`.
- **Outbound:** product `AJEX DCE`, with `cod`/`codAmount` for cash on delivery.
- **Addresses:** matched to AJEX's region, city and district codes through
  `app/lib/ajex/address-mapper.ts`. That uses `saudi-districts.json`, converted
  from AJEX's `Saudi_Cities_Districts.xlsx`, and accepts English or Arabic names.
  An unmatched district is sent as `FREE_TEXT`, so a return is never blocked on
  our side.
- **Short address:** AJEX requires the Saudi national short address
  (`shortAddress`) from 2026-01-01. It comes from the Salla address `short_code`,
  and from `SMSA_MERCHANT_SHORT_CODE` for the warehouse.

### Warehouse address

Returns go to the Salla main branch (الرئيسي), the same ship-from address that
Salla's outbound shipments carry. It is set in Vercel production:

| Variable | Value |
| --- | --- |
| `SMSA_MERCHANT_CITY` | `Jeddah` |
| `SMSA_MERCHANT_DISTRICT` | `Al Baghdadiyah Al Gharbiyah` (البغدادية الغربية) |
| `SMSA_MERCHANT_SHORT_CODE` | `JABA4130` |
| `SMSA_MERCHANT_POSTAL_CODE` | `22234` |
| `SMSA_MERCHANT_COORDINATES` | `21.5027564,39.1810784` |

With these, the warehouse resolves to AJEX's own mapping (`JED`,
`SAU-WESTERN-JED-AL BAGHDADIYAH AL GHARBIYAH`). Set `SMSA_MERCHANT_CITY`
explicitly: without it the city falls back to `NEXT_PUBLIC_MERCHANT_CITY`, and
then to `Riyadh`. The same values are used as the shipper on manual SMSA
shipments.

The env vars are listed in `.env.example`: `AJEX_ENVIRONMENT`, `AJEX_CLIENT_ID`,
`AJEX_CLIENT_SECRET` and `AJEX_CUSTOMER_ACCOUNT`. Without the credentials,
routing stays on Salla.

The customer's label link is always the app's signed
`/api/public/order-documents/return-label/...` URL, because AJEX's own
`waybillFileUrl` carries a short-lived token. That link needs
`CUSTOMER_DOCUMENT_SIGNING_SECRET` and `CUSTOMER_DOCUMENT_BASE_URL` (or
`NEXTAUTH_URL`).

## Go-live

    npm run ajex:sandbox-labels -- --out /mnt/c/Users/Admin/Downloads/ajex-golive --cod 150

This creates a COD delivery, a prepaid delivery and an RPU return on the sandbox.
The script refuses production. It saves each `<trackingId>.pdf`, the
request/response JSON and `results.json`.

Sandbox run on 2026-09-29 (account `TEST_ACCOUNT_mlehaa.ksa`):

| Case | Waybill |
| --- | --- |
| COD 150 SAR (AJEX DCE) | `AJA900000138745` |
| Prepaid (AJEX DCE) | `AJA900000138746` |
| Return pickup (AJEX RPU) | `AJA900000138747` |

After sign-off, set `AJEX_ENVIRONMENT=production` and the production credentials
in Vercel.

Tests: `npm run test:ajex`.
