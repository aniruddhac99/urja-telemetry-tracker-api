# Urja Meter Ops protocol notes

## Access and navigation

- Portal observed: `https://urja-ops.flockenergy.tech`.
- Sign-in is an email and password form at `/login`; successful sign-in opens `/meters` and shows an Ops Desk session with a sign-out control.
- Navigation exposes **Meters** (`/meters`) and **Transformers** (`/transformers`). Meter IDs link to `/meters/{meterId}`.
- The API service uses a regular browser session and reads rendered pages. The UI investigation did not establish a stable, supported JSON API contract; the service therefore does not depend on guessed internal endpoint names.

## Data observed

### Meter inventory

The portal reported **403 total** meters and showed 20 rows per page (21 pages). The list columns were meter ID, serial, make, phase, installation status, and distribution-transformer code. The first visible records included `J100000` / `SE33962` / HPL / single / Decommissioned / `DT-001`.

### Meter detail

`/meters/J100000` showed:

- Nameplate: meter ID, serial number, make, phase type, installation status, and installation type.
- A network breadcrumb: zone → circle → division → subdivision → substation → feeder → distribution transformer.
- Latitude and longitude.
- Consumption readings at 30-minute intervals. The visible columns were timestamp, kWh, kVAh, and phase-R voltage (`V(R)`). The page displayed a latest-reading timestamp; one inspected meter showed `30/06/2026 23:30`.

The readings are cumulative register values in the portal table; this service preserves them and does not reinterpret them as interval energy. Timestamp timezone is not stated in the UI.

### Transformers and bulk export

The transformer list showed code, name, feeder, and capacity in kVA. The page had 20 rows per page and 2 pages. An **Export all meters** action reported “Exported 403 meters.” That confirms a bulk path exists, but this first implementation reads the paginated inventory rather than inferring a CSV schema from the export.

## Quirks and operational notes

- The transformer table initially appeared empty while the page was settling; after the page action completed, the first 20 records appeared. Consumers should wait for the table and pagination controls before reading it.
- The meter detail consumption table is long and scrollable, with a half-hour cadence.
- The service serializes browser operations because its authenticated context has one shared page. It applies a short process-local cache to avoid re-reading every portal page on each API call.
- The portal was treated as read-only. The bulk export was used only to observe the visible export behavior and reported count.

## What remains to verify

The portal's underlying network calls and exact bulk-export file schema were not confirmed in this investigation. Before production use, validate whether the owner supports an authenticated HTTP integration, capture and test the export format, and confirm pagination and reading semantics against additional records.

## API enhancements and data semantics

The API offers a dedicated readings view at `/api/meters/{meterId}/readings` based on the **same observed meter-detail consumption table**; it does not discover a separate upstream telemetry API. kWh/kVAh values are treated as displayed register readings, not presumed interval deltas, and timestamp timezone remains unknown.

The API also links meters to transformers by matching the observed `transformerCode` meter-list field to transformer `code`, returning only matches found in the portal data. It does not claim that every network relationship is complete or authoritative beyond those observed attributes.
