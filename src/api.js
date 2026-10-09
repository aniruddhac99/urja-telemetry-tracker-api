import { paginate } from './portal.js';

export function paginationParams(searchParams) {
  function read(name, fallback, max) {
    const value = searchParams.get(name);
    if (value === null) return fallback;
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || (max && Number(value) > max)) {
      throw new RequestError(`${name} must be a positive integer${max ? ` no greater than ${max}` : ''}.`);
    }
    return Number(value);
  }
  return { page: read('page', 1), limit: read('limit', 20, 100) };
}

export class RequestError extends Error {
  constructor(message) { super(message); this.name = 'RequestError'; }
}

export function metersForTransformer(meters, transformerCode, page = 1, limit = 20) {
  return paginate(meters.filter(m => String(m.transformerCode ?? '').toLowerCase() === transformerCode.toLowerCase()), page, limit);
}

export function readingsForMeter(meter) {
  return { meterId: meter.id, latest: meter.consumption?.latest ?? null,
    intervalMinutes: meter.consumption?.intervalMinutes ?? null,
    readings: meter.consumption?.readings ?? [] };
}
