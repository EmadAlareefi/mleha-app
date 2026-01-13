# Search & Update Stock – Next.js Porting Notes

This document reverse-engineers the existing Django + jQuery implementation so a feature-equivalent Next.js page can be built. References point to the current source for clarity.

## High-level Behavior

- `core/views.py:8217-8221` exposes the `/searchAndUpdateStock/` page that simply renders `core/templates/core/stock/searchAndUpdateStock.html`.
- The page lets warehouse staff scan or type a SKU/barcode, review Salla + Trendyol inventory numbers for every variant, type the physical count, optionally update the warehouse location tag, and push reconciled quantities back to Salla in bulk.
- Trendyol quantities are fetched asynchronously per variant, and users can mark items for removal. Marks persist in `localStorage` and are surfaced again inside the Trendyol removal requests view (`core/templates/core/stock/trendyolRemovalRequests.html:11`).

## UI & Layout (Template Reference)

- Sticky search panel with barcode input, primary search button, and quick links to history/removal pages (`core/templates/core/stock/searchAndUpdateStock.html:237-256`). A fixed “تحديث المخزون” button sits at the bottom (`:264-270`) but stays hidden until a product loads.
- Dynamic containers display:
  - Search disambiguation suggestions (`#searchResults`) when the backend returns `search` matches (`:415-438` legacy block).
  - Product summary, main image, optional warehouse location pill, editable location input, and rendered variant cards (`:878-905`).
- Loading feedback includes an overlay (`:226-235`), inline button spinners, and inline Trendyol placeholders inside each variant card.

## Client-Side Flow

1. **Trendyol removal queue helpers** (`core/templates/core/stock/searchAndUpdateStock.html:541-631`):
   - Uses the constant `TRENDYOL_REMOVAL_STORAGE_KEY` to read/write a JSON object in `localStorage`.
   - `markSkuForRemoval` stores `{sku, qty, variantInfo, markedAt}` and immediately calls `updateRemovalStatusDisplay` so badges show when the card re-renders.
   - `.trendyol-remove-btn` buttons trigger the mark routine and show a Toastify confirmation.

2. **Trendyol stock polling** (`:633-716`):
   - `fetchTrendyolStock(barcode)` posts to `/trendyol/get-stock-by-barcode/` with CSRF headers.
   - Includes exponential backoff (1s, 2s, 4s) and updates the card UI while retrying.
   - Eventually resolves with `{ success, found, quantity }` and updates `.trendyol-stock` plus the `data-trendyol-stock` attribute on the matching input.

3. **Variant rendering** (`:675-742`):
   - `renderVariants` creates `.line` cards that show variant SKU, option labels (`related_option_values_details`), Salla stock, pending quantity, Trendyol placeholder, and the editable input (`class="variation_input"`).
   - Each input stores data attributes for `variant-id`, `sku`, `pending-stock`, and `stock-quantity` so later calculations stay client-side.
   - After DOM insertion a `Promise.all` over `fetchTrendyolStock` updates every card’s Trendyol section and removal buttons (`:744-823`).

4. **Search lifecycle** (`:843-947`):
   - `searchProduct` validates the input, toggles loading states on the button + field, and POSTs to `/getProductWithVariations/`.
   - Expects `{ data: [{ product, variations }, ...] }` from the backend (`core/views.py:8318-8439`).
   - On success it renders the product title, first image, optional warehouse location badge, an input for updating the location, and calls `renderVariants`.
   - Errors show Toastify alerts and re-enable controls in `complete`.

5. **Bulk Salla update** (`:960-1033`):
   - `#update` click handler iterates `.variation_input` nodes, converts the physical count into a Salla stock number via `sallaStock = max(0, actualCount - pendingStock - trendyolStock)` (lines `968-974`), and builds `{ variant_id, quantity, sku }` entries.
   - Sends `POST /salla/update_salla_variants_bulk/` with `application/json` payload `{ variants: [...] }`.
   - Shows button + overlay spinners while disabled, and upon success it clears the form, hides the button, and focuses the search field again.

6. **Warehouse location update** (`:1058-1095`):
   - A second `#update` click handler only handles the location field, posting `{ wh_location, parent_sku }` to `/update_product_warehouse_location/`.
   - Runs in parallel with the main bulk update handler, so the Next.js version should ensure both payloads are submitted (either sequentially or in a combined mutation).

## Server/API Contracts

| Endpoint | View & Lines | Request | Response | Notes |
| --- | --- | --- | --- | --- |
| `POST /getProductWithVariations/` | `core/views.py:8318-8439` | `sku` form field; code also retries with a trailing `-` version of the SKU. | `{ data: [{ product, variations }, ...] }` | `product` mirrors Salla fields and injects `wh_location` from `ProductLocation`. Each `variation` includes Salla data plus `pending_quantity` and `related_option_values_details`. |
| `POST /trendyol/get-stock-by-barcode/` | `trendyol/views.py:938-988` | `barcode` form field. | `{ success, found, quantity, productCode, title, ... }` or `{ success: True, found: False }` | Wraps `trendyol_client.get_products` and only returns the first match’s `quantity`. |
| `POST /salla/update_salla_variants_bulk/` | `salla/views.py:7392-7454` | JSON `{"variants":[{variant_id?, product_id?, is_parent?, quantity, sku}]}` | `{ success: True, message, response }` on success; validation errors produce `{error: ...}` with HTTP 400. | View builds `products_payload` for Salla’s `products/quantities/bulk` API and logs every change in `VariantStockHistory`. |
| `POST /update_product_warehouse_location/` | `core/views.py:8443-8470` | Form `{ wh_location, parent_sku }`. | `{ success: True }` or `{ error }`. | Persists warehouse slots in `ProductLocation`. The Django template currently triggers this whenever the bulk update button is pressed and the input is filled. |

### Derived Data in `getProductWithVariations`

- **Pending quantities**: computed by aggregating `SallaItemPackaging` rows where `status='pending'` and parent order status in `['طلب جديد','جاري التجهيز']` (`core/views.py:8358-8366`).
- **Option labels**: fetches `products/options/values/{value_id}` via `salla_api_request` and caches each label for one hour (`:8374-8416`).
- **Warehouse location**: looked up once per SKU from `ProductLocation` (`:8346-8351`), defaulting to `"-"` if missing.

## Data & State to Model in Next.js

- Global page state: `searchQuery`, `isSearching`, `productResults` (array), `variants`, `whLocation`, `removalQueue`, and `isUpdating`.
- Variant view model should include:
  - `sallaStock` (server), `pendingQty`, `trendyolQty`, and `countInput`.
  - `derivedSallaQty = max(0, countInput - pendingQty - trendyolQty)`.
  - `trendyolRemovalStatus` (look up from localStorage on mount).
- Error/success messaging currently uses Toastify; replicate with a Next.js-friendly toast/snackbar system.
- Loading overlay pattern: block input during update and show spinner text (“جاري التحميل...”) similar to `#loadingOverlay` (`core/templates/core/stock/searchAndUpdateStock.html:226-235`).

## Next.js Implementation Suggestions

1. **Componentization**
   - `SearchBar` handles SKU input, button, and linking to other reports.
   - `ProductSummary` displays name, image, and warehouse location editing.
   - `VariantGrid` renders `VariantCard` components that encapsulate Trendyol state, removal action, and count input.
   - `UpdateFooter` replicates the fixed button with dual responsibilities (bulk stock + location update).

2. **Data fetching**
   - Replace jQuery AJAX with `fetch`/`axios` using Next.js route handlers or direct calls to the Django backend, depending on deployment.
   - Consider server-side proxying so credentials (Salla/Trendyol tokens) remain on the server (mirroring the current Django approach).

3. **State management**
   - Use React state/hooks or something like Zustand for variant collections.
   - Keep the Trendyol removal queue in a dedicated hook that wraps `localStorage` read/write and exposes helper methods (mirrors `getTrendyolRemovalQueue`, `saveTrendyolRemovalQueue`, `markSkuForRemoval` from `core/templates/core/stock/searchAndUpdateStock.html:545-605`).

4. **Concurrency & UX parity**
   - Trendyol requests can stay as `Promise.all` to keep the per-card UI responsive.
   - Maintain the retry/backoff logic so sporadic Trendyol failures don’t block the operator.
   - Preserve the requirement that Trendyol and pending quantities are deducted before sending Salla numbers.
   - Submit the warehouse location either immediately when the field blurs or together with the bulk stock payload so the operator still clicks a single button.

5. **Testing hooks**
   - Mock the API responses listed above to validate calculations (especially the `max(0, …)` guard and Trendyol failure states).
   - Verify the removal queue persists after refresh and is surfaced wherever Trendyol removals are reviewed.

By mirroring these flows and contracts, a Next.js implementation can stay feature-compatible with the current Django/jQuery page while improving maintainability and user experience.
