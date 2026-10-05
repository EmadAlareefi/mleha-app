# Expense automation

The Expenses page has three tabs: expenses, subscriptions, and advertising invoices. Administrators configure expense automation; users with the existing `expenses` service permission can view it. Staff assigned the `settings` service permission can maintain provider app credentials on the Settings page. Other system-setting controls remain administrator-only. New automatic expenses are approved, with system attribution and the configuring administrator recorded. No payment is initiated.

## Database and deployment

1. Review and apply `prisma/migrations/20261005120000_expense_automation/migration.sql` through the normal database deployment process (`prisma migrate deploy` where migration history is managed). It is additive and does not rewrite existing expenses. Do not replay unrelated pending migrations without checking the deployment's migration history.
2. Generate Prisma and build with Node 20.9+ (`npm run vercel-build`).
3. Set `CRON_SECRET` in the server deployment. Credentials are encrypted using `EXPENSE_CREDENTIAL_KEY` if configured (32 bytes as hex), otherwise a domain-separated key derived from the existing `NEXTAUTH_SECRET`. Keep encryption material stable. Ciphertext records identify the key source, so adding a dedicated key does not break records encrypted with the session-secret-derived key. Rotating either underlying key requires re-saving/reconnecting credentials encrypted with it. Neither key is staff-editable or browser-exposed.
4. Set `NEXTAUTH_URL` to the canonical application origin. Enter provider app credentials in **Settings → بيانات ربط فواتير الإعلانات**, and allow the listed callback URLs in each provider's developer console.
5. Deploy. The middleware exempts only the two scheduler routes from session authentication; each route independently requires the exact cron bearer secret and rejects requests if it is missing.

Vercel calls `/api/expenses/process-subscriptions` hourly. It creates at most 100 due occurrences per invocation, catching up oldest first. `/api/expenses/sync-invoices` runs every 15 minutes as a dispatcher, processes up to two due connections concurrently, and imports one page per connection. A completed connection is scheduled again 24 hours later. Partial pages and retries therefore progress without waiting another day. Neither job requires the Expenses page to be open.

## Subscriptions

Create monthly or yearly subscriptions with a first due date of today or later. Dates use Asia/Riyadh. January 31 clamps to the final February day and returns to March 31. Yearly February 29 returns to February 29 in leap years.

The start date/frequency are fixed after creation; archive and create a replacement to change the schedule. Amount, currency, category, title, notes, and end date affect future occurrences. An edit with unprocessed due expenses returns a conflict; use **تشغيل الاستحقاقات** first. Pausing skips paused periods; resuming uses the next date strictly after today. Ending or archiving never deletes historical expenses. Durable occurrence records remain when an expense is deleted, preventing recreation.

## Staff credential entry

An administrator can assign **الإعدادات** (Settings) in staff service permissions. The staff member then opens `/settings` and enters the Client ID/App ID and Client Secret for each provider. Callback URLs are displayed for copying into the provider developer console. No deployment is needed when saved credentials change.

The dedicated `/api/settings/ad-credentials` endpoint requires the Settings permission. It returns client IDs and secret-presence flags, never secrets or ciphertext. Empty secret inputs preserve the saved secret; changing the application ID requires a replacement secret. Provider secrets are encrypted in the existing Settings table under a reserved namespace. The general settings API cannot read/write those entries, and generic settings listings exclude them. Saves record the staff identifier and update timestamp.

Saved database credentials take precedence as a complete app-ID/secret pair. The environment variables listed below remain a fallback when no credentials have been saved in Settings. Access tokens are still obtained when an administrator links a billing account on the Expenses page.

## Provider connections

Create a billing account in **فواتير الإعلانات**, then select **ربط / إعادة الربط**. The import cutoff is the local calendar date the account record was first created, and survives disconnect/reconnect. Each provider/billing-owner pair can be registered once. The current app uses its existing shared expense ledger (`merchantId = default`); these endpoints do not create a separate tenant-access model.

| Provider | Billing owner entered in the UI | Server configuration |
| --- | --- | --- |
| Meta / Instagram | Business ID | `EXPENSE_META_CLIENT_ID`, `EXPENSE_META_CLIENT_SECRET`; optional `EXPENSE_META_API_VERSION` (default `v25.0`) |
| TikTok | Business Center ID | `EXPENSE_TIKTOK_CLIENT_ID`, `EXPENSE_TIKTOK_CLIENT_SECRET` |
| Snapchat | Ad Account ID | `EXPENSE_SNAPCHAT_CLIENT_ID`, `EXPENSE_SNAPCHAT_CLIENT_SECRET` |

Callbacks: `${NEXTAUTH_URL}/api/expenses/ad-connections/callback/meta`, `/tiktok`, or `/snapchat` respectively. Meta authorization requests `business_management,ads_read`; Snap requests `snapchat-marketing-api`. Enable invoice/finance access in TikTok's app configuration. Required app review and billing-role eligibility are controlled by each provider. API access to advertising reports alone does not guarantee invoice access.

An advanced password field accepts a provider-issued access token; it is checked against the invoice endpoint before storage. Tokens and saved application secrets are encrypted with AES-256-GCM and omitted from responses and logs. Snapchat OAuth refresh tokens renew expiring access tokens. Other expired tokens require reconnection. A failed invoice capability probe never marks a new connection active.

Provider implementation references:

- Meta business invoice edge: https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json ; invoice fields: https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/OmegaCustomerTrx.json
- TikTok BC invoice endpoint: https://www.postman.com/tiktok/tiktok-api-for-business/request/9pqrxu6/bc-invoice-get
- Snapchat invoice list, detail and PDF: https://developers.snap.com/marketing-api/Ads-API/invoices

The adapters must be smoke-tested against the actual authorized billing accounts before production activation. Tests use synthetic provider responses, not captured customer invoices. TikTok's public request collection does not supply a response example: its mapper accepts explicit invoice totals (`total_amount`/`invoice_amount`), issue dates (`invoice_date`/`create_time`), and paginated invoice lists (`invoice_list`/`list`), and rejects incomplete or incompatible responses. It never falls back to spend or balances. If an account's contract differs, capture a redacted response and update its adapter/fixtures before activation.

## Invoice behavior and documents

Imports use total amount including supplied tax, original currency, issue date, document number, and billing period. Currency totals remain separate. The existing ledger supports two decimal places; incompatible monetary values are rejected instead of rounded silently. Each cycle scans from the original cutoff to catch late invoices and amendments. IDs and fingerprints prevent duplicate expenses. A changed invoice or credit/cancelled/draft document is flagged for review without overwriting an approved expense. Review flags remain visible; an administrator resolves accounting corrections through the normal expense workflow.

PDFs are stored privately as database bytes (maximum 5 MiB) and downloaded through a session/service-protected endpoint. Snap downloads invoice content through the detail API; Meta/TikTok download an available signed document URL. Unsupported hosts, failed document retrieval, or absent URLs require manual PDF attachment; invoice amounts can still import when a PDF is unavailable. Downloads never forward credentials to document URLs or follow arbitrary redirects.

Use **استخدام الرفع اليدوي** when official invoice access is unavailable. Manual uploads require the platform's stable invoice ID, invoice number, date, amount, currency, and PDF. For Meta, use its Graph invoice object ID as the stable ID, not only the printed invoice number. The same deduplication record is used if API access is enabled later. To attach a missing PDF to an existing invoice, use that invoice's attachment form.

## Verification and operations

- `npm run test:expenses`: deterministic calendar, validation, crypto, authorization, provider, scheduler, import, and retry tests. No live database or provider is contacted.
- `npx eslint app/lib/expenses app/api/expenses app/expenses`
- `npx prisma validate`
- `npm run vercel-build`

After migration, create a small staging subscription due today, run due processing twice, and verify exactly one approved expense. Delete that expense and rerun: it must remain deleted. Test pause/resume and an end date. In each provider's test billing account, connect, import an issued invoice, rerun, download its PDF, and verify the amount/currency against the document. Verify anonymous and non-expense users cannot download documents. Confirm existing manual expenses, filters, approvals, and export still work.

Connection cards show last completed sync, errors, pagination progress, and the last five runs. Authentication failures require reconnect; transient failures back off from 15 minutes up to 24 hours. Sync leases prevent concurrent runs; interrupted runs become available after six minutes. Record-level uniqueness and transactional creation protect against replay after interruption.
