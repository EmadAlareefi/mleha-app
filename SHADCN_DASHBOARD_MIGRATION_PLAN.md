# Shadcn Dashboard Migration Plan

Date: 2026-05-19

## Goal

Update the current dashboard experience to follow the shadcn/ui dashboard block patterns and use shadcn components wherever they fit, without breaking existing role-based access, Arabic RTL layout, or feature-page workflows.

The recommended target is to keep `/` as the main dashboard route because `app/page.tsx` already renders `components/HomeDashboard.tsx`.

## References

- shadcn Blocks: https://ui.shadcn.com/blocks
- shadcn CLI: https://ui.shadcn.com/docs/cli
- shadcn `components.json`: https://ui.shadcn.com/docs/components-json

Relevant block patterns:

- `dashboard-01`: dashboard with sidebar, section cards, chart, and data table.
- `sidebar-07`: collapsible icon sidebar.
- `sidebar-03`: sidebar with nested/submenu navigation.

## Current Repo Snapshot

Dashboard entry:

- `app/page.tsx` renders `components/HomeDashboard.tsx`.
- `components/HomeDashboard.tsx` is a client component using `useSession`, `AppNavbar`, `Button`, `Card`, and `serviceDefinitions`.
- `components/AppNavbar.tsx` is shared by many feature pages and handles user identity, PWA install, quick links, sign out, and user metadata.

UI foundation:

- Existing shadcn-like primitives live in `components/ui`.
- Current local primitives include `button`, `card`, `input`, `select`, `table`, `toaster`, `use-toast`, `confirmation-dialog`, and `error-dialog`.
- There is no `components.json` in the repo yet.
- Tailwind is v4 through `@tailwindcss/postcss`; there is no `tailwind.config.*`.
- `app/globals.css` defines CSS variables and the app-wide RTL body direction.
- `app/layout.tsx` sets `<html lang="ar" dir="rtl">` and uses the Tajawal Arabic font.

Important constraint:

- `components/ui/select.tsx` is currently a native `<select>` wrapper. The shadcn Select component has a different Radix-based API. Replacing this file directly will break existing pages that use native `<option>` children.

## Scope

In scope:

- Migrate the root dashboard to a shadcn-style application shell.
- Add shadcn component configuration and missing primitives.
- Replace custom dashboard cards/navbar layout with shadcn-derived sidebar, header, cards, data table, and empty/loading states.
- Preserve all session and role-based service visibility behavior.
- Preserve Arabic RTL behavior.
- Keep feature pages accessible from the new dashboard navigation.

Out of scope for the first implementation pass:

- Redesigning every feature page.
- Changing auth, Prisma models, or service authorization rules.
- Inventing analytics that do not have a real data source.
- Replacing all existing custom dialogs/toasts globally unless required by dashboard work.

## Target UX

The dashboard should feel like an operational admin console, not a landing page.

Target layout:

- Right-side collapsible sidebar for RTL users.
- Sticky or fixed-height top header inside the sidebar inset.
- Breadcrumb or page title area in the header.
- User menu with profile and sign-out actions.
- PWA install action where currently available.
- Quick KPI cards at the top.
- Main services area using shadcn Cards and/or a shadcn DataTable.
- Optional chart only when backed by real operational data.

Recommended dashboard composition:

- `SidebarProvider` and `SidebarInset` from `components/ui/sidebar`.
- `AppSidebar` derived from shadcn `dashboard-01` / `sidebar-07`.
- `SiteHeader` derived from shadcn `dashboard-01`.
- `SectionCards` for high-level metrics.
- `ServicesTable` or `DataTable` for service access and quick navigation.
- `ServiceCards` for the most common actions if card navigation remains useful.

## Target File Structure

Add dashboard-specific components under a feature folder to avoid top-level naming conflicts with existing files:

```txt
components/
  dashboard/
    app-sidebar.tsx
    dashboard-client.tsx
    dashboard-shell.tsx
    nav-main.tsx
    nav-secondary.tsx
    nav-user.tsx
    section-cards.tsx
    service-card-grid.tsx
    services-data-table.tsx
    site-header.tsx
```

Add or update shadcn primitives as needed:

```txt
components/ui/
  avatar.tsx
  badge.tsx
  breadcrumb.tsx
  collapsible.tsx
  dropdown-menu.tsx
  separator.tsx
  sheet.tsx
  sidebar.tsx
  skeleton.tsx
  tooltip.tsx
```

Potentially required later, depending on the final dashboard block usage:

```txt
components/ui/
  chart.tsx
  checkbox.tsx
  tabs.tsx
```

Do not overwrite these files without a compatibility check:

```txt
components/ui/button.tsx
components/ui/card.tsx
components/ui/input.tsx
components/ui/select.tsx
components/ui/table.tsx
components/ui/use-toast.tsx
components/ui/toaster.tsx
```

## Phase 1: Baseline And Safety

1. Create a working branch for the migration.
2. Capture current dashboard behavior:
   - Unauthenticated user sees login/access prompt.
   - Admin sees all non-hidden services.
   - Non-admin users see only assigned `serviceKeys`.
   - Affiliate users see the affiliate stats entry.
   - PWA install button appears only when the hook allows it.
3. Run baseline checks:
   - `npm run lint`
   - `npm run build`
4. Record any pre-existing failures before editing.
5. Avoid touching unrelated dirty files.

## Phase 2: Initialize shadcn Config

1. Add `components.json`.
2. Use the `new-york` style because shadcn marks `default` as deprecated.
3. Configure aliases for this repo:
   - `components`: `@/components`
   - `ui`: `@/components/ui`
   - `lib`: `@/lib`
   - `utils`: `@/lib/utils`
   - `hooks`: `@/components/hooks` or `@/hooks` if a hooks folder is introduced.
4. For Tailwind v4, leave `tailwind.config` blank in `components.json`.
5. Set RTL support in config if supported by the current CLI, then run the RTL migration only on new shadcn files or manually verify logical classes.

Suggested starting `components.json` shape:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "rtl": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "utils": "@/lib/utils",
    "lib": "@/lib",
    "hooks": "@/components/hooks"
  },
  "registries": {
    "@shadcn": "https://ui.shadcn.com/r/{name}.json"
  }
}
```

## Phase 3: Add shadcn Components Safely

Use shadcn CLI views and dry-runs before writing:

```bash
npx shadcn@latest view dashboard-01 sidebar-07
npx shadcn@latest view button card input select table
npx shadcn@latest add dashboard-01 --dry-run
npx shadcn@latest add sidebar-07 --dry-run
```

Then add primitives incrementally instead of blindly installing the entire block over the app:

```bash
npx shadcn@latest add sidebar separator breadcrumb dropdown-menu avatar sheet tooltip collapsible badge skeleton
```

Before overwriting existing primitives:

- Compare local `button`, `card`, `input`, `table`, and `select` with the CLI output.
- Keep compatible local files if they already satisfy the dashboard needs.
- For `select`, first migrate existing native select usages to a new `NativeSelect` component if the Radix shadcn Select is needed.

Recommended `select` migration path:

1. Add `components/ui/native-select.tsx` using the current native select implementation.
2. Replace current imports that rely on `<option>` children:
   - `import { Select } from '@/components/ui/select'`
   - with `import { NativeSelect } from '@/components/ui/native-select'`
3. Install or add the real shadcn `select.tsx`.
4. Use shadcn Select only in new dashboard controls.

## Phase 4: Build Dashboard Data Model

Create a dashboard view model layer instead of scattering mapping logic across components.

Recommended file:

```txt
components/dashboard/dashboard-data.ts
```

Responsibilities:

- Accept session-derived user data.
- Read `serviceDefinitions`.
- Return visible services using the exact current rules:
  - Hide `hideFromDashboard`.
  - Admin sees all non-hidden services.
  - Non-admin sees only assigned `serviceKeys`.
- Add presentation metadata:
  - Service category.
  - Lucide icon component.
  - Badge label.
  - Description.
  - Href.
  - Priority or pinned status.

Service grouping proposal:

- Orders: order prep, shipping, monitoring, shortages, invoice search.
- Warehouse: warehouse, local shipping, locations, stock updates, barcode labels, shipment assignments.
- Returns: returns management, returns inspection, returns analytics, priority, gifts.
- Finance: COD, invoices, invoice refunds, settlements, expenses, wallets, affiliate management.
- Admin: users, printers, warehouse management, settings, webhooks.
- Agent tools: deliveries, delivery tasks, personal recognition.

Icon migration:

- Replace emoji-first dashboard icons with Lucide icons in the dashboard UI.
- Keep `serviceDefinitions.icon` for backward compatibility until all consumers are updated.
- Add optional `lucideIcon` or dashboard-only icon mapping in the view model.

## Phase 5: Replace Root Dashboard Shell

Recommended route structure:

- Keep `app/page.tsx` as the root dashboard entry.
- Convert `app/page.tsx` to fetch server session with `getServerSession(authOptions)` where practical.
- Render a client dashboard component only for interactions that need hooks, such as sidebar state, user menu actions, PWA install, and sign out.

Implementation shape:

```txt
app/page.tsx
  -> gets session/server-safe initial data
  -> renders <DashboardShell initialSession={...} />

components/dashboard/dashboard-shell.tsx
  -> uses SidebarProvider
  -> renders AppSidebar, SidebarInset, SiteHeader

components/dashboard/dashboard-client.tsx
  -> handles useSession fallback, signOut, PWA install, and client-only states
```

Replace `components/HomeDashboard.tsx` after the new shell works:

- Option A: Remove it and render the new dashboard directly from `app/page.tsx`.
- Option B: Keep it as a thin wrapper temporarily to reduce routing churn.

Recommended choice:

- Option A for a clean migration, unless many tests or imports depend on `HomeDashboard`.

## Phase 6: Sidebar Navigation

Build `components/dashboard/app-sidebar.tsx` from the shadcn sidebar blocks.

Requirements:

- Sidebar appears on the right for RTL.
- Collapse to icons on desktop.
- Use mobile sheet behavior from shadcn sidebar.
- Navigation items come from visible services, not hardcoded links.
- Admin-only utility links remain available:
  - User management.
  - Printer settings.
  - Settings.
- User-specific links remain available:
  - Home.
  - My profile.
  - Affiliate stats when `affiliateName` exists.
  - Sign out.

Recommended components:

- `NavMain`: grouped service navigation.
- `NavSecondary`: utility/admin links.
- `NavUser`: avatar, user name, role, email, profile, sign out.

## Phase 7: Header

Build `components/dashboard/site-header.tsx` from the shadcn dashboard header pattern.

Header content:

- `SidebarTrigger`.
- `Separator`.
- Breadcrumb or title.
- Optional global search action placeholder if implemented.
- PWA install button.
- User menu shortcut.

Avoid duplicating all `AppNavbar` behavior. Move only dashboard-relevant behavior into the new header.

Keep `components/AppNavbar.tsx` for existing feature pages during the first migration.

## Phase 8: Main Dashboard Content

Section cards:

- Available services count.
- Current primary role.
- Session status.
- Last updated time.
- Optional warehouse assignment count for warehouse users.

Services area:

- Use shadcn Cards for high-priority service shortcuts.
- Use shadcn Table/DataTable for all available services.
- Data table columns:
  - Service.
  - Category.
  - Description.
  - Badge/status.
  - Action link.

Charts:

- Only add `ChartAreaInteractive` if real data is available.
- Candidate data sources:
  - Shipment stats from existing shipment APIs.
  - Order-prep/admin assignment stats.
  - Returns analytics.
  - COD collections.
- If no reliable data source is ready in the first pass, omit the chart or ship an empty state rather than fake analytics.

Loading and empty states:

- Use `Skeleton` for session/data loading.
- Use shadcn `Card` empty state when the user has no services.
- Preserve the unauthenticated prompt, but use shadcn Cards and Buttons.

## Phase 9: Styling And Theme

Keep the repo's existing CSS variable system in `app/globals.css`.

Adjustments:

- Normalize dashboard surface colors to shadcn tokens:
  - `bg-background`
  - `text-foreground`
  - `bg-card`
  - `text-muted-foreground`
  - `border-border`
- Reduce custom gradient-heavy cards from the current dashboard.
- Use semantic accents per category rather than one dominant color family.
- Keep card radii at or below the existing shadcn token unless the component already requires another value.
- Use logical spacing classes where needed for RTL:
  - `ms-*`
  - `me-*`
  - `text-start`
  - `text-end`

Responsive requirements:

- Desktop: collapsible sidebar, dense dashboard content.
- Tablet: sidebar remains usable and content uses 2-column cards.
- Mobile: sidebar sheet, single-column content, no text overlap.

## Phase 10: Feature Page Migration Strategy

Do not migrate every feature page in the first dashboard PR.

Recommended sequence:

1. Root dashboard shell and navigation.
2. Admin-heavy dashboards:
   - `app/admin/order-prep`
   - `app/warehouse`
   - `app/returns-analytics`
   - `app/order-reports`
3. Table-heavy pages:
   - invoices
   - settlements
   - user management
   - shipment assignments
4. Form-heavy pages:
   - settings
   - printer settings
   - warehouse management

For feature pages, introduce a shared layout later:

```txt
components/dashboard/page-shell.tsx
```

This can eventually replace repeated `AppNavbar` usage without forcing all pages to change in the first dashboard migration.

## Phase 11: Verification

Automated checks:

```bash
npm run lint
npm run build
```

Manual verification:

- `/` unauthenticated.
- `/` authenticated as admin.
- `/` authenticated as orders user.
- `/` authenticated as warehouse user.
- `/` authenticated as accountant user.
- `/` authenticated as delivery agent.
- Affiliate user sees affiliate stats link.
- Sidebar collapse/expand works.
- Mobile sidebar opens and closes.
- PWA install button behavior is unchanged.
- Sign out redirects to `/login`.
- All service links preserve `prefetch={false}` where current behavior expects it.
- RTL alignment is correct at 390px, 768px, and desktop widths.

Regression checks:

- Existing feature pages still render with `AppNavbar`.
- Native select pages still work after any Select migration.
- No unauthorized service links appear for restricted users.
- Hidden dashboard services remain hidden from the dashboard.

## Risks And Mitigations

Risk: shadcn CLI overwrites local primitives.

- Mitigation: run `--dry-run`, inspect diffs, and add primitives one by one.

Risk: Radix Select breaks existing native `<option>` usage.

- Mitigation: add `NativeSelect`, migrate existing pages, then add shadcn Select.

Risk: Sidebar direction feels wrong in RTL.

- Mitigation: configure RTL, set sidebar side to right if supported, and verify mobile/desktop manually.

Risk: Dashboard chart encourages fake metrics.

- Mitigation: ship a real-data chart only, otherwise use cards/table/empty state.

Risk: `AppNavbar` is used by many pages.

- Mitigation: leave it in place during root dashboard migration and introduce a shared page shell later.

Risk: Server/client session mismatch.

- Mitigation: use `getServerSession(authOptions)` for initial render where possible and keep `useSession` only where client updates are needed.

## Suggested PR Breakdown

PR 1: shadcn setup and safe primitives

- Add `components.json`.
- Add sidebar-related shadcn primitives.
- Add `NativeSelect` if needed.
- No dashboard behavior change except component availability.

PR 2: root dashboard shell

- Add `components/dashboard/*`.
- Replace `HomeDashboard` root shell with shadcn `SidebarProvider`, sidebar, and header.
- Preserve current service visibility rules.

PR 3: dashboard content polish

- Add section cards.
- Add services table/card grid.
- Add loading/empty states.
- Add real chart only if data source is ready.

PR 4: follow-up feature page layout

- Add shared `PageShell`.
- Start migrating selected high-value pages away from `AppNavbar`.

## Acceptance Criteria

- The root dashboard visually follows shadcn dashboard blocks.
- The root dashboard uses shadcn primitives for shell, sidebar, header, cards, table, buttons, and empty/loading states.
- Current auth and role-based service visibility behavior is unchanged.
- Arabic RTL layout works on desktop and mobile.
- Existing feature pages continue to render and navigate correctly.
- `npm run lint` and `npm run build` pass or any pre-existing failures are documented.
