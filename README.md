# Urja Meter API

A small, read-only JSON API in front of the Urja Meter Ops portal. The service signs in with a configured operator account, reads the portal's existing tables and meter detail pages, and returns stable JSON responses for other programs.

## What is included

- `GET /api/meters` — paginated meter inventory, with optional `search` and `status` filters.
- `GET /api/meters/{meterId}` — meter nameplate, network path, coordinates, and half-hourly consumption readings.
- `GET /api/transformers` — paginated distribution-transformer inventory.
- `GET /health` — process health check.
- `openapi.json` — OpenAPI 3.1 contract.
- [`PROTOCOL.md`](./PROTOCOL.md) — portal behavior observed during investigation.

The code is deliberately compact: `src/portal.js` owns the authenticated browser session and portal extraction; `src/server.js` maps HTTP requests to JSON responses. A single browser page is shared and access is serialized to avoid concurrent navigation races.

## Requirements and setup

- Node.js 20 or newer
- npm
- Playwright's Chromium browser (installed once with the command below), or Google Chrome if `BROWSER_CHANNEL=chrome` is set
- A portal login with read access

```sh
npm install
npx playwright install chromium
cp .env.example .env
```

Edit `.env` and set `PORTAL_USERNAME` and `PORTAL_PASSWORD`. The start scripts load `.env` with Node's `--env-file` option. Do not commit `.env` or put credentials in source control. Then run:

```sh
npm start
```

The API binds to `127.0.0.1:3000` by default. `HOST`, `PORT`, `PORTAL_BASE_URL`, `CACHE_TTL_SECONDS`, and `HEADLESS` can be configured as environment variables. Set `HEADLESS=false` to watch the portal session while debugging; set `BROWSER_CHANNEL=chrome` to use installed Google Chrome instead of downloading Playwright's Chromium. Keep the bind address local unless you add API authentication and network controls.

## Example requests

```sh
curl 'http://localhost:3000/api/meters?page=1&limit=5&status=Installed'
curl 'http://localhost:3000/api/meters/J100000'
curl 'http://localhost:3000/api/transformers?page=1&limit=20'
```

Example detail response (values abbreviated):

```json
{
  "id": "J100000",
  "nameplate": {
    "meterId": "J100000",
    "serialNo": "SE33962",
    "make": "HPL",
    "phaseType": "single",
    "installationStatus": "Decommissioned",
    "installationType": "Whole Current"
  },
  "networkPath": ["Jaipur Zone 1 (Z-01)", "Circle 1 (C-01)", "…"],
  "location": { "latitude": 26.938961002479868, "longitude": 75.83095696146852 },
  "consumption": {
    "latest": "30/06/2026 23:30",
    "intervalMinutes": 30,
    "readings": [{ "timestamp": "23/06/2026 23:30", "kwh": 48438.74, "kvah": 52313.84, "voltageR": 226 }]
  }
}
```

## Assumptions and decisions

- The service is read-only. It does not submit portal changes or expose the sign-out action.
- The operator credentials are supplied at runtime. The portal's session remains inside the service process and is not returned to API callers.
- The portal shows 20 rows per page. The API reads every visible page before applying its own `page`/`limit` and filters, so totals describe the complete observed inventory rather than only the current portal page.
- Meter consumption timestamps and units are returned as displayed by the portal. No timezone is appended because the portal does not label one.
- Responses are cached in memory for 30 seconds by default. This reduces repeated portal navigation while keeping the service reasonably fresh. Restarting the process clears the cache.
- Requests are serialized through one browser page. This is a simple correctness choice for a take-home-sized portal; it limits parallel throughput.

## Intentionally skipped

- Persistent storage, scheduled synchronization, background jobs, and multi-user authentication.
- Bulk export ingestion. The portal exposes an “Export all meters” control and confirmed an export of 403 meters, but the first cut reads the same paginated UI used by operators so record interpretation stays consistent.
- Transformer hierarchy traversal, geospatial search, charts, and a frontend.
- Retries beyond the browser's default navigation behavior, metrics, and deployment configuration.

## Improvements with more time

First, inspect the portal's supported data interface or request a stable upstream integration contract, then replace UI automation with authenticated HTTP calls if one exists. Next, add explicit retries and upstream error classification, structured logs, cache invalidation, and tests against captured portal fixtures. For larger inventories, prefer the bulk export or incremental sync and a local indexed store. Add rate limiting and API authentication before exposing this service beyond a trusted local network.

## Reflection

**What assumptions did you make?** I treated the signed-in portal's list and detail pages as the source of truth, assumed the current user has read-only access, and preserved displayed timestamps without inventing a timezone.

**Which part was most difficult, and how did you get unstuck?** The brief gives no API contract. I signed into the portal, followed a meter link, inspected its fields and consumption table, then checked the transformer list and bulk-export control to establish the data shape and inventory size.

**If you had another day, what would you improve?** I would identify and validate the portal's supported upstream data interface, add captured-page tests and retry/health behavior, and compare bulk export against paginated records.

**What mistake did you make while solving this?** I initially assumed the empty transformer table meant there were no rows. Triggering the page's export action finished its load, revealed the 20-row first page, and confirmed two pages of transformer data.

**What would you criticise in this submission?** Browser-driven extraction is coupled to portal markup and one shared page limits concurrency. It is a pragmatic bridge for the observed interface, not a durable integration contract; a supported HTTP interface and fixture-based tests should replace or validate it.

## API documentation

See [`openapi.json`](./openapi.json) for the machine-readable API contract.

## Interactive API explorer (enhancement)

After `npm start`, open **[http://localhost:3000/docs](http://localhost:3000/docs)** to browse the OpenAPI endpoints and use **Try it out** against your own local service. The explorer loads Swagger UI assets from `unpkg.com`, so the browser needs internet access; the API itself does not depend on this CDN. The machine-readable spec is also served at [`/openapi.json`](http://localhost:3000/openapi.json) and is committed as `openapi.json`.

### Endpoint overview

| Area | Endpoint | Purpose |
| --- | --- | --- |
| Meter assets | `GET /api/meters` | Search/filter/paginate meter inventory |
| Meter assets | `GET /api/meters/{meterId}` | Full meter nameplate, network path, coordinates, and readings |
| Consumption telemetry | `GET /api/meters/{meterId}/readings` | Isolate reported half-hour readings for a meter |
| Distribution network | `GET /api/transformers` | Transformer code, name, feeder, and capacity |
| Distribution network | `GET /api/transformers/{code}/meters` | Find meters whose `transformerCode` matches an existing transformer |
| Service | `GET /health` | Local process health; does not verify upstream reachability |

Sample enhanced requests:

```sh
curl 'http://localhost:3000/api/transformers/DT-001/meters?page=1&limit=10'
curl 'http://localhost:3000/api/meters/J100000/readings'
curl 'http://localhost:3000/api/meters?page=1&limit=5'
```

**Telemetry semantics:** `kwh` and `kvah` are *reported cumulative meter registers*; differences between readings may help derive interval energy only after validating meter resets, rollovers and ordering. We intentionally do not label raw values as 30-minute usage. The displayed timestamp has no confirmed timezone, so it is not silently converted to UTC. `voltageR` represents reported phase-R voltage.

**Network semantics:** `feederCode` is a property of a transformer, while `transformerCode` comes from the meter list. The transformer-to-meters endpoint joins these observed attributes; it does not infer unobserved network edges or missing relationships.

**Validation:** page and limit must be positive integers, and limit cannot exceed 100; invalid values return a structured `400 invalid_request` response. Missing meters or transformers return `404 not_found`. Upstream portal extraction failures return `502 upstream_error`. Requests are read-only.

**Freshness & limitations:** cached inventory/detail data expire after `CACHE_TTL_SECONDS` (default: 30 seconds). This is an in-process TTL, not a background sync. Browser extraction depends on the portal's HTML layout and serializes requests through a single authenticated browser page. The `/docs` assets are delivered by a public CDN; for offline documentation, use the checked-in `openapi.json` with a locally installed OpenAPI viewer.

## Security before publishing

Never commit `.env`, cookies, browser storage, or trace files. The service binds to localhost by default and does not authenticate its own downstream API callers. It must not be exposed publicly without suitable authentication and network access controls. `.env.example` must contain placeholders only.
