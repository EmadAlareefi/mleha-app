# Full shadcn/ui Project Migration Plan

Date: 2026-05-19

## Summary

Migrate every `app/**/page.tsx` to shadcn/ui patterns while preserving current workflows, data flow, permissions, public routes, and print behavior.

Decisions:

- Use the shadcn dashboard shell/sidebar for authenticated operator/admin pages.
- Keep public pages like `/login` outside the sidebar shell. `/returns` is explicitly excluded from this migration.
- Preserve page behavior and business workflows; replace UI primitives/layouts first.
- Use `NativeSelect` for simple HTML select controls and Radix `Select` only for richer custom dropdown behavior.

References:

- Components: https://ui.shadcn.com/docs/components
- Blocks: https://ui.shadcn.com/blocks
- Native Select: https://ui.shadcn.com/docs/components/native-select
- Field: https://ui.shadcn.com/docs/components/field
- Data Table: https://ui.shadcn.com/docs/components/data-table
- Empty: https://ui.shadcn.com/docs/components/empty

## Key Changes

- Status as of 2026-05-19:
  - Completed foundation primitives and shared shells.
  - Migrated `/`, `/login`, `/agents/live`, `/agents/reports`, `/order-prep`, `/order-shortages`, `/smsa-webhook`, `/my-recognition`, `/erp-settings`, `/my-profile`, `/settings`, `/barcode-labels`, `/warehouse-management`, `/cancel-shipment`, `/affiliate-stats`, `/printer-settings`, `/order-history`, `/delivery-agent-wallets`, `/delivery-agent-tasks`, `/user-recognition`, `/expenses`, `/invoice-refunds`, `/settlements`, `/order-invoice-search`, `/shipment-assignments`, `/salla/products`, `/salla/notify`, `/salla/requests`, `/local-shipping`, `/order-shipping/manual-smsa`, `/cod-tracker`, `/returns-gifts`, `/warehouse`, `/warehouse-locations`, `/returns-priority`, `/invoices`, `/returns-analytics`, `/returns-inspection`, `/returns-management`, `/returns-management/[id]`, `/warehouse/search-update-stock`, `/admin/order-prep`, `/order-monitor`, `/order-shipping`, `/affiliate-management`, `/my-deliveries`, `/order-users-management`, `/order-reports`, `/invoices-and-refund-invoices`, and `/invoices/[id]`.
  - Reviewed `/erp-sync` and `/warehouse-location`; both are route-only indirections with no page UI to migrate.
  - Excluded `/returns` by request.
  - Updated shared `AppNavbar` to use shadcn `Avatar`, `Badge`, `Button`, and `Separator`, improving all pages that still depend on it.
  - Verified targeted lint and `npm run build`.
  - Remaining work is route-by-route migration of the page groups below.

- Standardize authenticated pages around the existing `components/dashboard` shell:
  - `SidebarProvider`
  - `AppSidebar`
  - `SiteHeader`
  - `SidebarInset`
- Add reusable layout helpers:
  - `AppPageShell` for authenticated feature pages.
  - `PublicPageShell` for login and public customer flows.
  - `PageHeader`, `StatCard`, `DataToolbar`, `EmptyState`, and `LoadingState`.
- Expand `components/ui` with shadcn primitives for page-wide use:
  - Forms: `field`, `label`, `textarea`, `native-select`, `checkbox`, `radio-group`, `switch`, `tabs`.
  - Feedback: `alert`, `alert-dialog`, `dialog`, `empty`, `spinner`, `progress`.
  - Data/navigation: `pagination`, `dropdown-menu`, `command`, `popover`, `calendar`, `scroll-area`.
  - Display: `badge`, `avatar`, `separator`, `tooltip`, `accordion`, `button-group`, `input-group`, `item`, `kbd`.
- Do not blindly overwrite existing local wrappers:
  - Keep current `button`, `card`, `input`, `table`, `select`, `toaster`, `ErrorDialog`, and `ConfirmationDialog` compatible.
  - Introduce `NativeSelect` and migrate native `<select>` usages to it.
  - Rebuild custom dialogs on shadcn `AlertDialog`/`Dialog` later without changing caller APIs.

## Page Migration Order

1. Foundation:
   - Shared shells and UI primitives.
   - Token-based colors and RTL-safe layout utilities.
   - Middleware public route exceptions remain intact for auth, manifest, webhooks, and assets.
2. Table-heavy admin pages:
   - User management, invoices, invoice refunds, ERP sync, settlements, affiliate management, delivery wallets, reports, Salla products/requests/notify.
3. Operations pages:
   - Order prep, admin order prep, order shipping, manual SMSA, order monitor, shortages, warehouse, shipment assignments, local shipping, stock update, warehouse locations/management.
4. Returns and support pages:
   - Returns management/detail, inspection, analytics, priority, gifts, cancel shipment, COD tracker, order history/search.
5. Public/profile/utility pages:
   - Login, public returns form, profile, recognition, SMSA webhook, ERP settings, barcode labels.

## Implementation Rules

- Replace raw controls with shadcn components:
  - `<button>` -> `Button`
  - `<input>` -> `Input`
  - `<select>` -> `NativeSelect` unless custom dropdown behavior is needed
  - `<textarea>` -> `Textarea`
  - `<table>` -> `Table` or `DataTable`
  - status spans -> `Badge`
  - warning/error panels -> `Alert`
  - loading indicators -> `Skeleton` or `Spinner`
  - no-results panels -> `Empty`
- Replace repeated `AppNavbar` usage page by page with `AppPageShell`.
- Keep feature-specific actions in page headers or card toolbars, not the global sidebar.
- Convert hardcoded gray/blue backgrounds to tokens:
  - `bg-background`
  - `bg-card`
  - `text-foreground`
  - `text-muted-foreground`
  - `border-border`
  - `bg-muted`
  - `bg-primary`
- Use semantic color only for status intent: destructive, warning, success, info.
- Preserve all existing APIs, server actions, route handlers, Prisma calls, form payloads, and print layouts.

## Test Plan

- After each migration batch:
  - Run targeted `npx eslint` on changed files.
  - Run `npm run build`.
  - Verify `/api/auth/session`, `/api/auth/providers`, and `/manifest.webmanifest` return `200`.
- Manual smoke tests:
  - Admin dashboard and all service links.
  - Non-admin service visibility.
  - Login/logout.
  - Public returns flow.
  - Order prep and shipping workflows.
  - Warehouse scan/handover workflows.
  - Returns management and inspection.
  - Invoice/ERP sync.
  - Affiliate, wallet, COD, settlements.
  - Print flows for labels, invoices, shipping, and commercial invoices.
- Responsive checks:
  - Mobile sidebar opens/closes.
  - Tables scroll without layout breakage.
  - RTL alignment is correct at mobile, tablet, and desktop widths.

## Assumptions

- Business behavior is not redesigned during this UI migration.
- `NativeSelect` is the default migration target for current native select workflows.
- Existing custom dialogs remain source-compatible until their internals are replaced.
- Existing repo-wide lint issues outside touched files are documented but not fixed unless they block build or changed-file lint.
