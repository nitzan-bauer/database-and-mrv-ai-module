import test from "node:test";
import assert from "node:assert/strict";
import { allocateLeakage } from "../src/lib/ghg/leakageAllocation.ts";

test("allocateLeakage: displaced-production leakage (LK_disp) is part of the pooled sum (Correction 3)", () => {
  const a = allocateLeakage({ er: 100, cr: 0, leOa: 2, lkDisp: 5, leBr: 1 });
  assert.equal(a.total, 8);
  assert.equal(a.lkEr, 8);
  assert.equal(a.lkCr, 0);
});

test("allocateLeakage: with removals present, all three sources split by ER/(ER+CR)", () => {
  const a = allocateLeakage({ er: 60, cr: 40, leOa: 4, lkDisp: 4, leBr: 2 });
  assert.equal(a.total, 10);
  assert.equal(a.lkEr, 6);
  assert.equal(a.lkCr, 4);
  assert.equal(a.lkEr + a.lkCr, a.total);
});

test("allocateLeakage: no reductions and no removals charges everything to reductions", () => {
  const a = allocateLeakage({ er: 0, cr: 0, leOa: 1, lkDisp: 1, leBr: 1 });
  assert.deepEqual(a, { total: 3, lkEr: 3, lkCr: 0 });
});
