// Browser-only UI: all data comes from the existing read-only API.
const $ = (id) => document.getElementById(id);
const result = $('result');
const feedback = $('feedback');
const idInput = $('equipment-id');
const submit = $('search-button');
let lookupVersion = 0;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}
function value(v) { return v === null || v === undefined || v === '' ? 'Not available' : String(v); }
async function get(path) {
  const res = await fetch(path, { cache: 'no-store' });
  let data;
  try { data = await res.json(); } catch { throw new Error('The API returned an invalid response.'); }
  if (!res.ok) throw new Error(res.status === 404 ? 'Equipment not found. Check the ID and try again.' : (data.error?.message || 'Unable to read the portal. Try again.'));
  return data;
}
function field(grid, label, val) {
  const wrapper = node('div');
  wrapper.append(node('dt', label), node('dd', value(val)));
  grid.append(wrapper);
}
function addButton(parent, label, action, secondary = true) {
  const button = node('button', label, secondary ? 'secondary small' : 'small');
  button.type = 'button'; button.addEventListener('click', action); parent.append(button);
}
function statusChip(status) {
  const chip = node('span', value(status), 'status ' + String(status || '').toLowerCase().replace(/[^a-z]/g, ''));
  return chip;
}
function heading(kind, id, status) {
  const panel = node('section', null, 'panel');
  const top = node('div', null, 'detail-top');
  const left = node('div');
  left.append(node('p', kind === 'meter' ? 'Meter details' : 'Transformer details', 'muted'), node('h2', id));
  top.append(left);
  if (status) top.append(statusChip(status));
  panel.append(top);
  return panel;
}
function graph(title, subtitle, readings, key, unit) {
  const panel = node('section', null, 'panel chart-card');
  panel.append(node('h3', title), node('p', subtitle, 'muted'));
  // Preserve missing values as gaps. Do not convert cumulative kWh into interval consumption.
  const items = readings.map((r, i) => ({ x: i, y: r[key] === null || r[key] === undefined || r[key] === '' ? null : Number(r[key]), label: String(r.timestamp || '') }));
  const valid = items.filter((p) => p.y !== null && Number.isFinite(p.y));
  if (!valid.length) { panel.append(node('div', 'No readings available.', 'empty')); return panel; }
  const w = 700, h = 170, left = 65, right = 18, top = 16, bottom = 33;
  const low = Math.min(...valid.map((p) => p.y)); const high = Math.max(...valid.map((p) => p.y));
  const delta = high - low || Math.max(Math.abs(high) * .01, 1);
  const min = low - delta * .12, max = high + delta * .12;
  const x = (i) => left + (items.length === 1 ? (w - left - right) / 2 : (i / (items.length - 1)) * (w - left - right));
  const y = (v) => top + (max - v) * (h - top - bottom) / (max - min);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${title} chart`); svg.setAttribute('class', 'chart');
  const el = (tag, attrs = {}, text) => { const e = document.createElementNS(svg.namespaceURI, tag); for (const [k,v] of Object.entries(attrs)) e.setAttribute(k, v); if (text !== undefined) e.textContent = text; svg.append(e); return e; };
  const fmt = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  for (let i = 0; i < 3; i++) { const yy = top + i * (h-top-bottom)/2; el('line', {x1:left,y1:yy,x2:w-right,y2:yy,class:'chart-axis'}); el('text',{x:left-8,y:yy+4,'text-anchor':'end',class:'chart-label'},fmt(max - (max-min)*i/2)); }
  // Respect the order returned by the portal. Separate path segments at missing readings.
  let path = '';
  let drawing = false;
  for (const p of items) { if (p.y === null || !Number.isFinite(p.y)) { drawing = false; continue; } path += `${drawing ? ' L' : ' M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`; drawing = true; }
  el('path', { d:path, class:'chart-line' });
  const first = items[0], last = items[items.length-1];
  el('text', {x:left,y:h-7,class:'chart-label'}, first.label || 'First reading');
  if (items.length > 1) el('text',{x:w-right,y:h-7,'text-anchor':'end',class:'chart-label'},last.label || 'Last reading');
  panel.append(svg);
  panel.append(node('p', `Range: ${fmt(low)}–${fmt(high)} ${unit} · ${valid.length} available reading(s)`, 'muted'));
  return panel;
}
async function openMeter(id, version, inventoryRecord) {
  const detail = await get(`/api/meters/${encodeURIComponent(id)}`);
  if (version !== lookupVersion) return;
  result.replaceChildren(); result.hidden = false;
  const plate = detail.nameplate || {};
  const main = heading('meter', detail.id || id, inventoryRecord?.installationStatus || plate.installationStatus || plate.status);
  const grid = node('dl', null, 'details');
  field(grid, 'Serial number', inventoryRecord?.serialNumber ?? plate.serialNumber ?? plate.serial);
  field(grid, 'Manufacturer', inventoryRecord?.make ?? plate.make ?? plate.manufacturer);
  field(grid, 'Phase', inventoryRecord?.phaseType ?? plate.phaseType ?? plate.phase);
  const transformer = inventoryRecord?.transformerCode ?? plate.transformerCode ?? detail.networkPath?.find?.((p) => /DT-\d+/i.test(p))?.match(/DT-\d+/i)?.[0];
  field(grid, 'Transformer', transformer);
  field(grid, 'Last reported reading', detail.consumption?.latest || detail.consumption?.readings?.at(-1)?.timestamp);
  main.append(grid);
  const actions = node('div', null, 'inline-actions');
  addButton(actions, 'Copy Meter ID', () => copyId(detail.id || id));
  if (transformer) addButton(actions, `View ${transformer} →`, () => lookup('transformer', transformer));
  main.append(actions); result.append(main);
  const readings = detail.consumption?.readings || [];
  if (readings.length) {
    result.append(graph('Energy reading (kWh)', 'Cumulative register — not interval consumption', readings, 'kwh', 'kWh'));
    result.append(graph('Voltage (V)', 'Reported phase-R voltage', readings, 'voltageR', 'V'));
  } else result.append(node('section', 'No historical meter readings available.', 'panel empty'));
}
async function openTransformer(code, version) {
  // The existing backend has no /api/transformers/:code route.
  // Retrieve the paginated collection and locate the matching record.
  const page = await get('/api/transformers?page=1&limit=100');
  const transformer = page.data.find((t) => String(t.code).toUpperCase() === code.toUpperCase());
  if (!transformer) throw new Error('Transformer not found. Check its code and try again.');
  const related = await get(`/api/transformers/${encodeURIComponent(transformer.code)}/meters?page=1&limit=100`);
  if (version !== lookupVersion) return;
  result.replaceChildren(); result.hidden = false;
  const main = heading('transformer', transformer.code);
  const grid = node('dl', null, 'details');
  field(grid, 'Name', transformer.name); field(grid, 'Feeder', transformer.feederCode);
  field(grid, 'Capacity', transformer.capacityKva == null ? null : `${transformer.capacityKva} kVA`);
  field(grid, 'Connected meters', related.pagination?.total ?? related.data.length);
  main.append(grid);
  const actions = node('div', null, 'inline-actions'); addButton(actions, 'Copy Transformer Code', () => copyId(transformer.code)); main.append(actions);
  result.append(main);
  const linked = node('section', null, 'panel'); linked.append(node('h3', 'Connected meters'));
  if (!related.data.length) linked.append(node('p', 'No linked meters found.', 'muted'));
  const list = node('ul', null, 'linked-list');
  for (const m of related.data) {
    const li = node('li'); const jump = node('button', m.meterId || m.id);
    jump.type = 'button'; jump.addEventListener('click', () => lookup('meter', m.id));
    li.append(jump, statusChip(m.installationStatus)); list.append(li);
  }
  linked.append(list); result.append(linked);
}
async function copyId(id) {
  try { await navigator.clipboard.writeText(id); feedback.textContent = `${id} copied.`; feedback.style.color = '#146b3a'; }
  catch { feedback.textContent = `Unable to copy automatically. ID: ${id}`; feedback.style.color = '#68778c'; }
}
async function lookup(kind, id) {
  const version = ++lookupVersion;
  const requested = id.trim().toUpperCase();
  if (!requested) return;
  document.querySelector(`input[name="kind"][value="${kind}"]`).checked = true;
  idInput.value = requested; submit.disabled = true;
  feedback.textContent = 'Loading equipment…'; feedback.style.color = '#68778c';
  result.hidden = true;
  try {
    if (kind === 'transformer') await openTransformer(requested, version);
    else {
      // The detail route does not include list-level installation status.
      const inventory = await get(`/api/meters?page=1&limit=20&search=${encodeURIComponent(requested)}`);
      const record = inventory.data.find((m) => String(m.id).toUpperCase() === requested);
      if (!record) throw new Error('Meter not found. Check its ID and try again.');
      await openMeter(record.id, version, record);
    }
    if (version === lookupVersion) feedback.textContent = '';
  } catch (err) { if (version === lookupVersion) { result.replaceChildren(); result.hidden = true; feedback.textContent = err.message || 'Unable to load equipment.'; feedback.style.color = '#a32323'; } }
  finally { if (version === lookupVersion) submit.disabled = false; }
}
$('lookup-form').addEventListener('submit', (event) => { event.preventDefault(); lookup(document.querySelector('input[name="kind"]:checked').value, idInput.value); });
document.querySelectorAll('input[name="kind"]').forEach((radio) => radio.addEventListener('change', () => { idInput.placeholder = radio.value === 'meter' ? 'e.g. J100004' : 'e.g. DT-005'; feedback.textContent = ''; }));
async function overview() {
  try { const health = await get('/health'); $('api-status').textContent = health.status === 'ok' ? 'API Online' : 'API Unavailable'; $('api-status').className = 'pill ' + (health.status === 'ok' ? 'ok' : 'bad'); }
  catch { $('api-status').textContent = 'API Unavailable'; $('api-status').className = 'pill bad'; }
  const [meters, transformers] = await Promise.allSettled([get('/api/meters?page=1&limit=1'),get('/api/transformers?page=1&limit=1')]);
  if (meters.status === 'fulfilled') $('meter-total').textContent = meters.value.pagination.total;
  if (transformers.status === 'fulfilled') $('transformer-total').textContent = transformers.value.pagination.total;
}
overview();
