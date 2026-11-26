// Pure helpers: no graph, no LLM, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kappa, majority, mcnemar, shuffle, wilson } from "@/lib/stats";
import { loadTour, parseTour } from "@/lib/tour";

test("seeded shuffle is a deterministic permutation", () => {
  const xs = Array.from({ length: 30 }, (_, i) => i);
  const a = shuffle(xs, 7), b = shuffle(xs, 7), c = shuffle(xs, 8);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual([...a].sort((x, y) => x - y), xs);
  assert.deepEqual(xs, Array.from({ length: 30 }, (_, i) => i), "input is not mutated");
});

test("majority picks the most common answer, ties in agree > neutral > disagree order", () => {
  assert.equal(majority([1, -1, -1]), -1);
  assert.equal(majority([0, 0, 1]), 0);
  assert.equal(majority([1, -1]), 1);
});

test("Wilson interval matches known values", () => {
  const [lo, hi] = wilson(7, 14);
  assert.ok(Math.abs(lo - 0.268) < 0.002 && Math.abs(hi - 0.732) < 0.002, `${lo} ${hi}`);
  assert.deepEqual(wilson(0, 0), [0, 1]);
});

test("kappa: 1 for perfect agreement, 0 for always predicting one answer", () => {
  assert.equal(kappa([1, 0, -1, 1], [1, 0, -1, 1]), 1);
  assert.equal(kappa([1, 1, 1, 1], [1, 1, -1, 0]), 0);
});

test("McNemar: no disagreement gives p = 1; a lopsided split is significant", () => {
  assert.equal(mcnemar([true, false], [true, false]), 1);
  const a = Array(12).fill(true), b = Array(12).fill(false);
  assert.ok(mcnemar(a, b) < 0.001);
});

test("the judge tour file parses into named queries with expectations", () => {
  const tour = loadTour();
  assert.equal(tour.length, 6);
  for (const t of tour) {
    assert.match(t.name, /^Q\d /);
    assert.match(t.cypher, /^MATCH/);
    assert.ok(!t.cypher.includes("// "), "comments are stripped");
  }
  assert.equal(tour.filter((t) => t.expect).length, 3);
  assert.equal(parseTour("// name: X\nMATCH (n) RETURN n;\n")[0].cypher, "MATCH (n) RETURN n");
});
