# Repository Guidelines

## Project Structure & Module Organization
This Next.js App Router repo keeps product logic scoped per route folder in `app/` (for example `app/salla`, `app/returns`, `app/local-shipping`). Each feature owns its `page.tsx`, localized server actions, and styles; keep data-fetch helpers in the nearest `app/lib` subfolder. Cross-cutting UI or hooks belong in `components/`, backend-safe utilities in root `lib/`, and Prisma schemas plus generated clients in `prisma/`. Static files live in `public/`, while runtime config stays in `next.config.ts`, `middleware.ts`, and `vercel.json`.

## Build, Test, and Development Commands
- `npm run dev`: Start Turbopack dev server on `localhost:3000`.
- `npm run build`: Produce the production bundle; run after updating Prisma migrations.
- `npm run start`: Serve the compiled build for staging-style verification.
- `npm run lint`: Run ESLint with the Next.js/type-safe presets.
- `npm run vercel-build`: Execute `prisma generate` followed by `next build`, mirroring CI.

## Coding Style & Naming Conventions
Favor TypeScript, React Server Components, and `"use client"` only when browser APIs or hooks are needed. Use 2-space indentation, kebab-case directory names (`app/local-shipping`), and PascalCase component files (`components/BarcodeCard.tsx`). Tailwind utilities (configured via `app/globals.css`) power styling; extract repeated combinations with `class-variance-authority` or helper functions. Run `npm run lint -- --fix` before commits to align imports, accessibility rules, and hooks ordering.

## Testing Guidelines
A dedicated test runner is not committed yet, so new features should introduce colocated suites (e.g., `feature/__tests__/page.test.tsx`) using React Testing Library or Playwright as appropriate. Until automated coverage exists, manually verify authentication (see `AUTH_SETUP.md`), order-creation, returns, barcode printing, and warehouse flows after each change. Mock Prisma and external carriers in tests to keep them deterministic, and document any new fixtures in `RETURNS_SETUP.md`.

## Commit & Pull Request Guidelines
Write small, imperative commits such as `returns: add barcode preview modal`. Reference related issues inline and call out schema or env changes in the body. Pull requests must include: a what/why summary, testing checklist, screenshots or terminal captures for UI/API shifts, and links to supporting docs. Request at least one reviewer familiar with the touched feature area.

## Security & Configuration Tips
Store API keys and SMSA credentials in `.env.local`; never commit secrets. Follow `AUTH_SETUP.md` for NextAuth providers and rotate tokens when regenerating credentials. When debugging, strip customer identifiers from logs and prefer temporary mock data seeded via `prisma db seed`.
