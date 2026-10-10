import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { paginationParams, RequestError, metersForTransformer, readingsForMeter } from "./api.js";
import { Portal, filterMeters, paginate } from "./portal.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const baseUrl = process.env.PORTAL_BASE_URL ?? "https://urja-ops.flockenergy.tech";
const username = process.env.PORTAL_USERNAME;
const password = process.env.PORTAL_PASSWORD;
const cacheTtl = Number(process.env.CACHE_TTL_SECONDS ?? 30) * 1000;
const cache = new Map();
const openapi = await readFile(new URL("../openapi.json", import.meta.url), "utf8");

if (!username || !password) {
  console.error("Set PORTAL_USERNAME and PORTAL_PASSWORD before starting the service.");
  process.exit(1);
}

const portal = new Portal({ baseUrl, username, password, headless: process.env.HEADLESS !== "false" });
await portal.start();

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body, null, 2));
}

async function cached(key, load) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < cacheTtl) return entry.value;
  const value = await load();
  cache.set(key, { value, time: Date.now() });
  return value;
}

// INSERTING TO CLEAR PLAYWRIGHT Time-Out Root cause: malformed meter ID

async function getKnownMeter(id) {
  const inventory = await cached(
    "inventory:meters",
    () => portal.readCollection("/meters", { page: 1, limit: 1000 })
  );

  const known = inventory.data.some(
    (meter) => meter.id.toLowerCase() === id.toLowerCase()
  );

  if (!known) return null;

  return cached(`meter:${id}`, () => portal.readMeter(id));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  try {
    if (req.method !== "GET") return json(res, 405, { error: { code: "method_not_allowed", message: "Only GET is supported." } });

    // Add this immediately after the req.method !== "GET" check in src/server.js:
    const staticFiles = {
      '/': ['../public/index.html', 'text/html; charset=utf-8'],
      '/styles.css': ['../public/styles.css', 'text/css; charset=utf-8'],
      '/app.js': ['../public/app.js', 'application/javascript; charset=utf-8'],
    };
    if (Object.hasOwn(staticFiles, url.pathname)) {
      const [path, type] = staticFiles[url.pathname];
      const body = await readFile(new URL(path, import.meta.url));
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      return res.end(body);
    }


    if (url.pathname === "/openapi.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      return res.end(openapi);
    }
    // if (url.pathname === "/docs" || url.pathname === "/docs/") {
    //   res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; script-src https://unpkg.com; style-src https://unpkg.com 'unsafe-inline'; img-src data: https:; connect-src 'self'; font-src https://unpkg.com", "cache-control": "no-store" });
    //   return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Urja Meter Ops | API Explorer</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',deepLinking:true,displayRequestDuration:true});</script></body></html>`);
    // }

    if (url.pathname === "/swagger-init.js") {
  const script = readFileSync(
    new URL("../public/swagger-init.js", import.meta.url)
  );

  res.writeHead(200, {
    "content-type": "application/javascript; charset=utf-8",
    "cache-control": "no-store"
  });

  return res.end(script);
}

if (url.pathname === "/docs" || url.pathname === "/docs/") {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy":
      "default-src 'none'; " +
      "script-src 'self' https://unpkg.com; " +
      "style-src https://unpkg.com 'unsafe-inline'; " +
      "img-src data: https:; " +
      "connect-src 'self'; " +
      "font-src https://unpkg.com",
    "cache-control": "no-store"
  });

  return res.end(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Urja Meter Ops | API Explorer</title>
        <link rel="stylesheet"
          href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
      </head>
      <body>
        <div id="swagger-ui"></div>

        <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
        <script src="/swagger-init.js"></script>
      </body>
    </html>
  `);
}
    if (url.pathname === "/health") return json(res, 200, { status: "ok" });
    if (url.pathname === "/api/meters") {
      const { page, limit } = paginationParams(url.searchParams);
      const search = url.searchParams.get("search")?.trim() || undefined;
      const status = url.searchParams.get("status")?.trim() || undefined;
      const inventory = await cached("inventory:meters", () => portal.readCollection("/meters", { page: 1, limit: 1000 }));
      const filtered = filterMeters(inventory.data, { search, status });
      return json(res, 200, paginate(filtered, page, limit));
    }
    if (url.pathname === "/api/transformers") {
      const { page, limit } = paginationParams(url.searchParams);
      const inventory = await cached("inventory:transformers", () => portal.readCollection("/transformers", { page: 1, limit: 1000 }));
      return json(res, 200, paginate(inventory.data, page, limit));
    }
    const transformerMeterMatch = url.pathname.match(/^\/api\/transformers\/([^/]+)\/meters$/);
    if (transformerMeterMatch) {
      const code = decodeURIComponent(transformerMeterMatch[1]);
      const { page, limit } = paginationParams(url.searchParams);
      const transformers = await cached("inventory:transformers", () => portal.readCollection("/transformers", { page: 1, limit: 1000 }));
      if (!transformers.data.some(t => t.code.toLowerCase() === code.toLowerCase())) {
        return json(res, 404, { error: { code: "not_found", message: `Transformer '${code}' was not found.` } });
      }
      const inventory = await cached("inventory:meters", () => portal.readCollection("/meters", { page: 1, limit: 1000 }));
      return json(res, 200, metersForTransformer(inventory.data, code, page, limit));
    }
    const readingsMatch = url.pathname.match(/^\/api\/meters\/([^/]+)\/readings$/);
    if (readingsMatch) {
      const id = decodeURIComponent(readingsMatch[1]);
      //const meter = await cached(`meter:${id}`, () => portal.readMeter(id));

      // UPDATING METER-DETAIL ROUTES

      const meter = await getKnownMeter(id);


      return meter ? json(res, 200, readingsForMeter(meter)) : json(res, 404, { error: { code: "not_found", message: `Meter '${id}' was not found.` } });
    }
    const meterMatch = url.pathname.match(/^\/api\/meters\/([^/]+)$/);
    if (meterMatch) {
      const id = decodeURIComponent(meterMatch[1]);
      //const meter = await cached(`meter:${id}`, () => portal.readMeter(id));

      // UPDATING METER-DETAIL ROUTES

      const meter = await getKnownMeter(id);



      return meter ? json(res, 200, meter) : json(res, 404, { error: { code: "not_found", message: `Meter '${id}' was not found.` } });
    }
    return json(res, 404, { error: { code: "not_found", message: "Route not found." } });
  } catch (error) {
    if (error instanceof RequestError) return json(res, 400, { error: { code: "invalid_request", message: error.message } });
    console.error(error);
    return json(res, 502, { error: { code: "upstream_error", message: "The meter portal could not be read.", detail: error.message } });
  }
});

server.listen(port, host, () => console.log(`Urja API listening on http://localhost:${port}`));

async function shutdown() {
  server.close();
  await portal.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

