const DEFAULT_TIMEOUT_MS = 15_000;

export function filterMeters(items, { search, status } = {}) {
  return items.filter((item) => {
    const text = JSON.stringify(item).toLocaleLowerCase();
    return (!search || text.includes(search.toLocaleLowerCase())) &&
      (!status || item.installationStatus?.toLocaleLowerCase() === status.toLocaleLowerCase());
  });
}

export function paginate(items, page = 1, limit = 20) {
  const start = (page - 1) * limit;
  return {
    data: items.slice(start, start + limit),
    pagination: { page, limit, total: items.length, totalPages: Math.ceil(items.length / limit) },
  };
}

/** Serializes browser operations because one authenticated page is shared. */
export class Portal {
  constructor({ baseUrl, username, password, headless = true }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.username = username;
    this.password = password;
    this.headless = headless;
    this.browserChannel = process.env.BROWSER_CHANNEL || undefined;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.queue = Promise.resolve();
  }

  async start() {
    const { chromium } = await import("playwright");
    this.browser = await chromium.launch({ channel: this.browserChannel, headless: this.headless });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
    await this.login();
  }

  async stop() {
    await this.browser?.close();
  }

  async login() {
    await this.page.goto(`${this.baseUrl}/login`, { waitUntil: "domcontentloaded" });
    const email = this.page.locator('input[type="email"], input[name="email"]').first();
    const password = this.page.locator('input[type="password"]').first();
    await email.fill(this.username);
    await password.fill(this.password);
    await this.page.getByRole("button", { name: /sign in/i }).click();
    await this.page.waitForURL(/\/meters(?:\/|$)/, { timeout: DEFAULT_TIMEOUT_MS });
  }

  async withPage(work) {
    const run = this.queue.then(async () => {
      if (!this.page) throw new Error("Portal browser is not started");
      return work(this.page);
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async ensureAuthenticated(page) {
    if (new URL(page.url()).pathname === "/login") await this.login();
  }

  async readCollection(path, { search, status, page: requestedPage = 1, limit = 20 } = {}) {
    return this.withPage(async (page) => {
      await this.ensureAuthenticated(page);
      const all = await this.readAllPages(page, path);
      const filtered = path === "/meters" ? filterMeters(all, { search, status }) : all;
      return paginate(filtered, requestedPage, limit);
    });
  }

  async readAllPages(page, path) {
    await page.goto(`${this.baseUrl}${path}`, { waitUntil: "domcontentloaded" });
    await page.locator("table").waitFor({ state: "visible" });
    await page.locator("tbody tr").first().waitFor({ state: "visible" });
    const result = [];
    let currentPage = 1;
    while (true) {
      result.push(...await this.readTableRows(page));
      const next = page.getByRole("button", { name: /^next$/i });
      if (!(await next.count()) || !(await next.isEnabled())) break;
      const firstRow = normalizeText(await page.locator("tbody tr").first().innerText());
      await next.click();
      await page.waitForFunction((prior) => {
        const current = document.body.innerText.match(/Page\s+(\d+)\s+of\s+\d+/i);
        return current && Number(current[1]) !== prior;
      }, currentPage, { timeout: DEFAULT_TIMEOUT_MS });
      await page.waitForFunction((previousRow) => {
        const first = document.querySelector("tbody tr")?.innerText?.replace(/\s+/g, " ").trim();
        return first && first !== previousRow;
      }, firstRow, { timeout: DEFAULT_TIMEOUT_MS });
      currentPage += 1;
    }
    const seen = new Set();
    return result.filter((item) => {
      if (!item.id) return true;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  async readTableRows(page) {
    const headers = (await page.locator("thead th").allTextContents()).map(normalizeText);
    const rows = await page.locator("tbody tr").all();
    const items = [];
    for (const row of rows) {
      const cells = (await row.locator("td").allTextContents()).map(normalizeText);
      if (!cells.length) continue;
      const links = await row.locator("a").all();
      const href = links.length ? await links[0].getAttribute("href") : null;
      const raw = Object.fromEntries(headers.map((header, i) => [slug(header), cells[i] ?? ""]));
      if (href?.includes("/meters/")) {
        items.push({
          id: href.split("/").pop(),
          meterId: raw.meter ?? href.split("/").pop(),
          serialNumber: raw.serial ?? null,
          make: raw.make ?? null,
          phaseType: raw.phase ?? null,
          installationStatus: raw.status ?? null,
          transformerCode: raw.dt ?? null,
        });
      } else if (raw.code) {
        items.push({ id: raw.code, code: raw.code, name: raw.name ?? null, feederCode: raw.feeder ?? null, capacityKva: number(raw.capacity_kva) });
      } else {
        items.push(raw);
      }
    }
    return items;
  }

  async readMeter(id) {
    return this.withPage(async (page) => {
      await this.ensureAuthenticated(page);
      await page.goto(`${this.baseUrl}/meters/${encodeURIComponent(id)}`, { waitUntil: "domcontentloaded" });
      if (new URL(page.url()).pathname === "/meters") return null;
      await page.getByRole("heading", { name: new RegExp(`Meter\\s+${escapeRegex(id)}`, "i") }).waitFor({ state: "visible" });
      const nameplate = {};
      const terms = await page.locator("dl dt").all();
      for (const term of terms) {
        const label = normalizeText(await term.innerText());
        const value = normalizeText(await term.evaluate((el) => el.nextElementSibling?.textContent ?? ""));
        if (label) nameplate[camel(label)] = value;
      }
      await page.locator("table tbody tr").first().waitFor({ state: "visible" });
      const body = await page.locator("body").innerText();
      const networkPath = body.split(/[›\n]/).map(normalizeText).filter((part) =>
        /\b(?:Zone|Circle|Division|Subdivision|Substation|Feeder)\b|\bDT-\d+\b/i.test(part));
      const coords = body.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
      const rows = await page.locator("table tbody tr").all();
      const consumption = [];
      for (const row of rows) {
        const cells = (await row.locator("td").allTextContents()).map(normalizeText);
        if (cells.length >= 4) consumption.push({ timestamp: cells[0], kwh: number(cells[1]), kvah: number(cells[2]), voltageR: number(cells[3]) });
      }
      const latestText = body.match(/Latest:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
      return {
        id,
        nameplate,
        networkPath,
        location: coords ? { latitude: Number(coords[1]), longitude: Number(coords[2]) } : null,
        consumption: { latest: latestText, intervalMinutes: 30, readings: consumption },
      };
    });
  }
}

function normalizeText(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function slug(value) { return normalizeText(value).toLowerCase().replace(/\(([^)]*)\)/g, "_$1").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }
function camel(value) { return slug(value).replace(/_([a-z])/g, (_, c) => c.toUpperCase()); }
function number(value) { const parsed = Number(String(value).replace(/,/g, "")); return Number.isFinite(parsed) ? parsed : null; }
function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
