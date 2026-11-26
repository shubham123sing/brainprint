// Graph tests on a TEMPORARY COPY of the committed store (graph/brainprint.rl is never written).
// No API key and no network: LLM_PROVIDER=none, and prediction uses the embeddings already stored in the graph.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brainprint-test-"));
fs.copyFileSync(path.resolve(process.cwd(), "..", "graph", "brainprint.rl"), path.join(tmp, "brainprint.rl"));
process.env.BRAINPRINT_DB = path.join(tmp, "brainprint.rl"); // before lib/relate is imported
process.env.LLM_PROVIDER = "none";

type Row = Record<string, unknown>;
let q: (cypher: string, params?: Record<string, unknown>) => Row[];
let brains: typeof import("@/lib/brains");
let tour: ReturnType<typeof import("@/lib/tour").loadTour>;

before(async () => {
  const { connection } = await import("@/lib/relate");
  brains = await import("@/lib/brains");
  tour = (await import("@/lib/tour")).loadTour();
  q = (c, p = {}) => connection().query(c, p as never).rows as Row[];
});

const one = (name: string) => tour.find((t) => t.name.startsWith(name))!;
const CFO = "brain_skeptical_cfo_6ea5";
const INVESTOR = "brain_cautious_investor";

test("the graph has every node label the README describes, and the vector index", () => {
  for (const label of ["Brain", "Utterance", "Claim", "Concept", "Check", "Idea", "Response", "Synthesis", "WikiEntity", "Scan", "Moment", "Network"]) {
    const n = Number(q(`MATCH (n:${label}) RETURN count(n) AS n`)[0].n);
    assert.ok(n > 0, `no ${label} nodes`);
  }
  const vec = q(`MATCH (k:Claim) SEARCH k IN (VECTOR INDEX claim_embedding FOR $v LIMIT 3) SCORE AS s RETURN k.id AS id`,
    { v: q(`MATCH (c:Claim) WHERE c.embedding IS NOT NULL RETURN c.embedding AS e LIMIT 1`)[0].e });
  assert.equal(vec.length, 3);
});

test("tour Q1: every panel citation is backed by the citing brain's own belief", () => {
  const rows = q(one("Q1").cypher);
  assert.ok(rows.length >= 7);
  for (const r of rows) assert.equal(Number(r.unbacked), 0, `${r.brain} on ${r.question}`);
});

test("tour Q5: the CFO and the student are two hops apart through a shared belief", () => {
  const [r] = q(one("Q5").cypher);
  assert.equal(Number(r.length), 2);
});

test("tour Q6: every belief learned by talking keeps a verbatim quote from what the person said", () => {
  const rows = q(one("Q6").cypher);
  assert.ok(rows.length >= 2);
  for (const r of rows) assert.equal(Number(r.quote_found), Number(r.talk_beliefs), String(r.brain));
});

test("every tour query runs and returns rows", () => {
  for (const t of tour) assert.ok(q(t.cypher).length > 0, t.name);
});

test("sealed Quiz checks are consistent: correct means predicted = actual", () => {
  const rows = q(`MATCH (k:Check) WHERE k.pending = false AND NOT k.abstained RETURN k.predicted AS p, k.actual AS a, k.correct AS c`);
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok([-1, 0, 1].includes(Number(r.a)));
    assert.equal(Boolean(r.c), Number(r.p) === Number(r.a));
  }
});

test("no leakage: the prediction prompt hides held-out answers and never includes the trainer's description", () => {
  const all = q(`MATCH (:Brain {id: $b})-[:STANCE]->(c:Claim) RETURN c.id AS id, c.text AS text ORDER BY c.id`, { b: INVESTOR });
  const target = String(all[0].id), hidden = all.slice(1, 4);
  const built = brains.buildPredictionPrompt(INVESTOR, [target], hidden.map((h) => String(h.id)))!;
  const answersPart = built.prompt.split("PREDICT:")[0];
  assert.ok(!answersPart.includes(String(all[0].text)), "target leaked into the answers");
  for (const h of hidden) assert.ok(!answersPart.includes(String(h.text)), `hidden answer leaked: ${h.text}`);
  const description = String(q(`MATCH (b:Brain {id: $b}) RETURN b.description AS d`, { b: INVESTOR })[0].d);
  assert.ok(description.length > 10);
  assert.ok(!built.prompt.includes(description), "trainer description reached the prompt");
  for (const c of [target, ...hidden.map((h) => String(h.id))]) assert.ok(![...built.aKey.values()].includes(c));
});

test("no leakage: graph retrieval never returns an excluded claim", () => {
  const all = q(`MATCH (:Brain {id: $b})-[:STANCE]->(c:Claim) RETURN c.id AS id ORDER BY c.id`, { b: CFO }).map((r) => String(r.id));
  const { ev, concepts } = brains.retrieve(CFO, all[0], all.slice(1, 6));
  for (const e of ev) assert.ok(!all.slice(0, 6).includes(e.claim));
  assert.ok(Array.isArray(concepts));
});

test("cross-validation is reproducible with a seed, and its baseline uses training answers only", async () => {
  const cvAt = () => q(`MATCH (b:Brain {id: $b}) RETURN b.cv_at AS at`, { b: INVESTOR })[0].at ?? null;
  const before = cvAt();
  const a = await brains.crossValidate(INVESTOR, { seed: 3, store: false });
  const b = await brains.crossValidate(INVESTOR, { seed: 3, store: false });
  assert.deepEqual(a.rows, b.rows);
  assert.equal(a.n, 23);
  const { majority } = await import("@/lib/stats");
  for (const f of new Set(a.rows.map((r) => r.fold))) {
    const train = a.rows.filter((r) => r.fold !== f).map((r) => r.actual);
    for (const r of a.rows.filter((x) => x.fold === f)) assert.equal(r.baseline, majority(train));
  }
  assert.equal(cvAt(), before, "store: false must not write to the brain");
});
