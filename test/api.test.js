import test from 'node:test';
import assert from 'node:assert/strict';
import { paginationParams, RequestError, metersForTransformer, readingsForMeter } from '../src/api.js';

test('pagination validates inputs and caps page size', () => {
  assert.deepEqual(paginationParams(new URLSearchParams('')), { page: 1, limit: 20 });
  assert.deepEqual(paginationParams(new URLSearchParams('page=2&limit=5')), { page: 2, limit: 5 });
  for (const query of ['page=0', 'page=1.5', 'limit=-1', 'limit=101', 'page=xyz']) {
    assert.throws(() => paginationParams(new URLSearchParams(query)), RequestError);
  }
});

test('transformer lookup matches codes case insensitively and paginates', () => {
  const meters = [{ id: 'A', transformerCode: 'DT-001' }, { id: 'B', transformerCode: 'DT-002' }, { id: 'C', transformerCode: 'dt-001' }];
  assert.deepEqual(metersForTransformer(meters, 'dt-001', 1, 1), {
    data: [meters[0]], pagination: { page: 1, limit: 1, total: 2, totalPages: 2 }
  });
  assert.equal(metersForTransformer(meters, 'missing').pagination.total, 0);
});

test('readings response preserves reported values and handles missing readings', () => {
  const reading = { timestamp: '23/06/2026 23:30', kwh: 48438.74, kvah: 52313.84, voltageR: 226 };
  assert.deepEqual(readingsForMeter({ id: 'J100000', consumption: { latest: '30/06/2026 23:30', intervalMinutes: 30, readings: [reading] } }), {
    meterId: 'J100000', latest: '30/06/2026 23:30', intervalMinutes: 30, readings: [reading]
  });
  assert.deepEqual(readingsForMeter({ id: 'X' }).readings, []);
});
