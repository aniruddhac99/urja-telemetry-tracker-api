import test from "node:test";
import assert from "node:assert/strict";
import { filterMeters, paginate } from "../src/portal.js";

const records = [
  { id: "J100000", make: "HPL", installationStatus: "Decommissioned" },
  { id: "J100001", make: "L&T", installationStatus: "Installed" },
  { id: "J100002", make: "HPL", installationStatus: "Installed" },
];

test("meter filters are case-insensitive and combine search with status", () => {
  assert.deepEqual(filterMeters(records, { search: "hpl", status: "installed" }), [records[2]]);
  assert.equal(filterMeters(records, { search: "missing" }).length, 0);
});

test("pagination reports total before slicing", () => {
  assert.deepEqual(paginate(records, 2, 2), {
    data: [records[2]],
    pagination: { page: 2, limit: 2, total: 3, totalPages: 2 },
  });
});
