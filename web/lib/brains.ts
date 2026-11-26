// Brain Library: "brains" are models of a mindset, trained by YOUR answers, stored as a subgraph in Relate.
//
//   (:Brain)-[:STANCE {value: 1 agree | 0 neutral | -1 disagree, note, source, at}]->(:Claim)-[:MENTIONS]->(:Concept)
//   (:Check {pending, predicted, actual, correct, confidence, abstained, by, because[], at})-[:OF]->(:Brain), -[:ON]->(:Claim)
//   (:Idea)-[:HAS_CLAIM]->(:Claim)      (:Brain)-[:PREDICTS {stance, confidence, by, at}]->(:Claim)
//
// Predicting a brain's stance on a claim = link prediction (Brain)-[:STANCE]->(Claim), done as GraphRAG:
//   1. the graph retrieves evidence: the brain's answered claims most similar to the target (Relate VECTOR INDEX
//      claim_embedding) and concept paths (target)-[:MENTIONS]->(concept)<-[:MENTIONS]-(answered)<-[:STANCE]-(brain);
//   2. a free LLM (Groq / Ollama) reads that evidence and predicts agree / neutral / disagree, citing the answers it used.
//   Without an LLM, a graph-only predictor (similarity vote + concept mean + base rate) is used.
//   Measured accuracy (seeded 4-fold CV, held-out baselines, confidence intervals): see eval/results.md (npm run eval).
// Self-test: the prediction for a training question is stored as a pending Check BEFORE the question is shown,
// so every brain carries an honest, held-out accuracy.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { checkpoint, connection, type Row } from "@/lib/relate";
import { EMBED_DIMS, embed } from "@/lib/embed";
import { activeProvider, chatComplete } from "@/lib/llm";
import { majority, shuffle } from "@/lib/stats";

const q = (cypher: string, params: Record<string, unknown> = {}) => connection().query(cypher, params as never).rows as Row[];
const DATA = path.join(process.cwd(), "data");
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
const now = () => new Date().toISOString();
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const newId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export type Stance = 1 | 0 | -1;
export const STANCE_LABEL: Record<string, string> = { "1": "agree", "0": "neutral", "-1": "disagree" };

// ---------------------------------------------------------------------------------------------
// seeding (first run): probe bank + example brains + vector index

const g = globalThis as unknown as { __bpSeed?: Promise<void> };

export function ensureSeeded(): Promise<void> {
  g.__bpSeed ??= seed().catch((e) => {
    g.__bpSeed = undefined;
    throw e;
  });
  return g.__bpSeed;
}

async function seed() {
  q(`CREATE CONSTRAINT brain_id IF NOT EXISTS FOR (n:Brain) REQUIRE n.id IS UNIQUE`);
  q(`CREATE CONSTRAINT claim_id IF NOT EXISTS FOR (n:Claim) REQUIRE n.id IS UNIQUE`);
  q(`CREATE CONSTRAINT concept_id IF NOT EXISTS FOR (n:Concept) REQUIRE n.id IS UNIQUE`);
  q(`CREATE CONSTRAINT idea_id IF NOT EXISTS FOR (n:Idea) REQUIRE n.id IS UNIQUE`);
  q(`CREATE CONSTRAINT check_id IF NOT EXISTS FOR (n:Check) REQUIRE n.id IS UNIQUE`);
  q(`CREATE VECTOR INDEX claim_embedding IF NOT EXISTS FOR (c:Claim) ON c.embedding
     OPTIONS {indexConfig: {\`vector.dimensions\`: ${EMBED_DIMS}, \`vector.similarity_function\`: 'cosine'}}`);

  const have = Number(q(`MATCH (c:Claim {source: 'probe'}) RETURN count(c) AS n`)[0]?.n ?? 0);
  if (have > 0) return;

  const probes = JSON.parse(fs.readFileSync(path.join(DATA, "probe_claims.json"), "utf8")).claims as {
    id: string; text: string; concepts: string[];
  }[];
  await upsertClaims(probes.map((p) => ({ ...p, source: "probe" })));

  const ex = JSON.parse(fs.readFileSync(path.join(DATA, "example_brains.json"), "utf8")).brains as {
    id: string; name: string; description: string; stances: Record<string, Stance>;
  }[];
  for (const b of ex) {
    q(`MERGE (b:Brain {id: $id}) SET b.name = $name, b.description = $description, b.example = true,
         b.created_at = $at, b.checks = coalesce(b.checks, 0), b.correct = coalesce(b.correct, 0)`,
      { id: b.id, name: b.name, description: b.description, at: now() });
    q(`MATCH (b:Brain {id: $id}) UNWIND $rows AS r MATCH (c:Claim {id: r.claim})
       MERGE (b)-[s:STANCE]->(c) SET s.value = r.value, s.source = 'example', s.at = $at`,
      { id: b.id, at: now(), rows: Object.entries(b.stances).map(([claim, value]) => ({ claim, value })) });
  }
  checkpoint();
}

/** Create/update claims with embeddings and concept links. */
export async function upsertClaims(claims: { id: string; text: string; concepts: string[]; source: string }[]) {
  const vecs = await embed(claims.map((c) => c.text));
  q(
    `UNWIND $rows AS r
     MERGE (c:Claim {id: r.id})
     SET c.text = r.text, c.source = r.source, c.embedding = r.embedding, c.created_at = coalesce(c.created_at, $at)
     WITH c, r UNWIND r.concepts AS cn
     MERGE (x:Concept {id: cn.id}) SET x.name = cn.name
     MERGE (c)-[:MENTIONS]->(x)`,
    {
      at: now(),
      rows: claims.map((c, i) => ({
        id: c.id, text: c.text, source: c.source, embedding: vecs[i],
        concepts: c.concepts.filter(Boolean).slice(0, 4).map((n) => ({ id: slug(n), name: n.toLowerCase().trim() })),
      })),
    }
  );
}

// ---------------------------------------------------------------------------------------------
// prediction

export type Evidence = { claim: string; text: string; stance: number; note: string | null; similarity: number };
export type ConceptSignal = { concept: string; name: string; mean: number; n: number };
export type Prediction = {
  brain: string; claim: string; stance: Stance | null; label: string; confidence: number; score: number;
  evidence: Evidence[]; concepts: ConceptSignal[]; by: string; because: string[];
};

/** Graph retrieval for one target claim: similar answered claims (vector index) + concept paths. */
export function retrieve(brain: string, claim: string, exclude: string[] = []) {
  const ev: Evidence[] = q(
    `MATCH (c:Claim {id: $claim})
     CALL (c) {
       MATCH (k:Claim) SEARCH k IN (VECTOR INDEX claim_embedding FOR c.embedding LIMIT 150) SCORE AS sim
       RETURN k, sim
     }
     WITH c, k, sim WHERE k.id <> c.id AND NOT k.id IN $exclude
     MATCH (:Brain {id: $brain})-[s:STANCE]->(k)
     RETURN k.id AS claim, k.text AS text, s.value AS stance, s.note AS note, sim
     ORDER BY sim DESC LIMIT 6`,
    { claim, brain, exclude }
  ).map((r) => ({
    claim: String(r.claim), text: String(r.text), stance: Number(r.stance), note: (r.note as string) ?? null,
    similarity: r3(2 * Number(r.sim) - 1), // Relate rebounds cosine to [0,1]; report raw cosine
  }));
  const concepts: ConceptSignal[] = q(
    `MATCH (:Claim {id: $claim})-[:MENTIONS]->(x:Concept)<-[:MENTIONS]-(k:Claim)<-[s:STANCE]-(:Brain {id: $brain})
     WHERE k.id <> $claim AND NOT k.id IN $exclude
     RETURN x.id AS concept, x.name AS name, avg(s.value) AS mean, count(*) AS n ORDER BY n DESC`,
    { claim, brain, exclude }
  ).map((r) => ({ concept: String(r.concept), name: String(r.name), mean: r3(Number(r.mean)), n: Number(r.n) }));
  return { ev, concepts };
}

/** Graph-only predictor (no LLM). Tuned by leave-one-out on the example brains; roughly matches the majority baseline. */
function graphPredict(brain: string, claim: string, exclude: string[] = []): Prediction {
  const { ev, concepts } = retrieve(brain, claim, exclude);
  const all = q(
    `MATCH (:Brain {id: $brain})-[s:STANCE]->(k:Claim) WHERE k.id <> $claim AND NOT k.id IN $exclude
     RETURN avg(s.value) AS m, count(s) AS n`, { brain, claim, exclude })[0];
  if (!Number(all?.n))
    return { brain, claim, stance: null, label: "unsure (no answers yet)", confidence: 0, score: 0, evidence: ev, concepts, by: "graph", because: [] };
  const prior = Number(all.m);
  let wSum = 0, eScore = 0;
  for (const e of ev.slice(0, 3)) { const w = Math.max(0, e.similarity - 0.25) ** 2; wSum += w; eScore += w * e.stance; }
  const E = wSum > 0 ? eScore / (wSum + 0.02) : 0;
  const nC = concepts.reduce((s, c) => s + c.n, 0);
  const C = nC > 0 ? concepts.reduce((s, c) => s + c.mean * c.n, 0) / (nC + 1) : 0;
  const score = 0.5 * prior + 0.5 * (0.5 * E + 0.5 * C);
  const stance: Stance = score > 0.1 ? 1 : score < -0.1 ? -1 : 0;
  return {
    brain, claim, stance, label: STANCE_LABEL[String(stance)], confidence: r3(Math.min(0.6, 0.3 + Math.abs(score) * 0.4)),
    score: r3(score), evidence: ev, concepts, by: "graph", because: ev.slice(0, 2).map((e) => e.claim),
  };
}

const PERSONA_SYSTEM = `You model ONE mindset ("brain") from the answers its trainer gave: statements marked agree / neutral / disagree,
sometimes with a note. Predict how this brain would answer new statements. Use only this evidence.
If evidence is weak, answer "neutral" with low confidence. Similar-sounding statements can carry the OPPOSITE stance (e.g. "AI
makes me interested" vs "AI is hype"); reason about what this mindset values, not about word overlap. Targets that are points from a pitch or idea: "agree" means the point LANDS with this brain (convincing or
appealing), "disagree" means it PUTS THEM OFF (unconvincing, a red flag, or unappealing), "neutral" means indifferent.
Return JSON only:
{"predictions":[{"claim":"T1","stance":"agree|neutral|disagree","confidence":0.0-1.0,"because":["A3","A7"]}]}
One entry per target (T1, T2, ...). "because" lists 1-3 answer keys (A1, A2, ...) that support the prediction.`;

const INV: Record<string, Stance> = { agree: 1, neutral: 0, disagree: -1 };

async function llmJson(system: string, user: string) {
  const provider = activeProvider();
  if (provider !== "groq" && provider !== "ollama") return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await chatComplete(provider, [{ role: "system", content: system }, { role: "user", content: user }], { json: true, maxTokens: 1800, temperature: 0.2 });
      return { model: r.model, json: JSON.parse(r.text.replace(/^```(json)?|```$/g, "").trim()) };
    } catch (e) {
      const err = e as Error & { status?: number; retryAfter?: string | null };
      if (err.status === 429 && attempt < 2) {
        await new Promise((res) => setTimeout(res, (Number(err.retryAfter) || 10) * 1000 + 500));
        continue;
      }
      // JSON that failed to parse, or an API error: retry once, then fall back to the graph-only predictor
      console.warn(`[brains] ${provider} prediction call failed (attempt ${attempt + 1}): ${err.message.slice(0, 200)}`);
      if (attempt === 0 && err.status !== 401) continue;
      return null;
    }
  }
  return null;
}

/**
 * Predict a brain's stance on several claims in ONE LLM call (GraphRAG). `exclude` hides answers (cross-validation).
 * Falls back to the graph-only predictor per claim if no LLM is configured or the call fails.
 */
export async function predictMany(brain: string, claims: string[], exclude: string[] = []): Promise<Prediction[]> {
  if (!claims.length) return [];
  const built = buildPredictionPrompt(brain, claims, exclude);
  if (!built) return claims.map((c) => graphPredict(brain, c, exclude));
  const { prompt, graph, aKey } = built;
  const res = await llmJson(PERSONA_SYSTEM, prompt);
  const preds = (res?.json?.predictions ?? []) as { claim: string; stance: string; confidence: number; because?: string[] }[];
  const key = (s: unknown) => String(s ?? "").replace(/[\[\]\s]/g, "").toUpperCase();
  return graph.map((x, i) => {
    const p = preds.find((y) => key(y.claim) === `T${i + 1}`) ?? (preds.length === graph.length ? preds[i] : undefined);
    if (!p || !(String(p.stance).toLowerCase() in INV)) {
      if (res) console.warn(`[brains] no usable prediction for T${i + 1} (${x.claim}) in the model reply; using graph fallback`);
      return graphPredict(brain, x.claim, exclude);
    }
    p.stance = String(p.stance).toLowerCase();
    const stance = INV[p.stance];
    const confidence = r3(Math.max(0, Math.min(1, Number(p.confidence) || 0.5)));
    return {
      brain, claim: x.claim, stance, label: STANCE_LABEL[String(stance)], confidence, score: r3(stance * confidence),
      evidence: x.ev, concepts: x.concepts, by: res!.model,
      because: (p.because ?? []).map((k) => aKey.get(key(k))).filter((id): id is string => Boolean(id)).slice(0, 3), // only real answers count
    };
  });
}

/**
 * The exact prompt the LLM sees for a prediction (exported so tests can check what is and is not in it).
 * Returns null when the brain has no visible answers. `exclude` and the targets themselves are hidden.
 */
export function buildPredictionPrompt(brain: string, claims: string[], exclude: string[] = []) {
  const b = q(`MATCH (b:Brain {id: $brain}) RETURN b.name AS name`, { brain })[0];
  // The trainer's description ("skeptical of hype, wants evidence…") is deliberately NOT given to the predictor: it can
  // encode the very stances being tested. Predictions come from the brain's answers only (a test pins this).
  const hidden = [...exclude, ...claims];
  const answers = q(
    `MATCH (:Brain {id: $brain})-[s:STANCE]->(k:Claim) WHERE NOT k.id IN $hidden
     RETURN k.id AS id, k.text AS text, s.value AS v, s.note AS note`, { brain, hidden });
  if (!answers.length) return null;
  const graph = claims.map((c) => ({ claim: c, ...retrieve(brain, c, hidden) }));
  const texts = new Map(q(`MATCH (k:Claim) WHERE k.id IN $ids RETURN k.id AS id, k.text AS t`, { ids: claims }).map((r) => [String(r.id), String(r.t)]));
  const lab = (v: unknown) => STANCE_LABEL[String(v)];
  // The graph decides WHICH answers the model sees and in what order: answers retrieved for the targets (vector index +
  // concept paths) first, then the rest, capped at 60. We deliberately do NOT attach per-target "similar answer -> stance"
  // hints: measured by cross-validation, those hints anchor the model on similar-sounding statements that often carry the
  // opposite stance (CV dropped from 68-82% to 41-50%).
  const rank = new Map<string, number>();
  graph.forEach((x) => x.ev.forEach((e, i) => rank.set(e.claim, Math.min(rank.get(e.claim) ?? 99, i))));
  const ordered = [...answers].sort((a, c) => (rank.get(String(a.id)) ?? 99) - (rank.get(String(c.id)) ?? 99)).slice(0, 60);
  // Short keys (A1.., T1..) instead of long graph ids: models copy them reliably; we map them back to graph ids.
  const aKey = new Map(ordered.map((a, i) => [`A${i + 1}`, String(a.id)]));
  const prompt =
    `BRAIN: ${b?.name ?? brain}\n` +
    `ANSWERS (${ordered.length}${answers.length > ordered.length ? ` most relevant of ${answers.length}` : ""}):\n` +
    ordered.map((a, i) => `- [A${i + 1}] "${a.text}" -> ${lab(a.v)}${a.note ? ` (note: ${a.note})` : ""}`).join("\n") +
    `\n\nPREDICT:\n` +
    graph.map((x, i) => `- [T${i + 1}] "${texts.get(x.claim)}"`).join("\n");
  return { prompt, graph, aKey };
}

export async function predict(brain: string, claim: string): Promise<Prediction> {
  return (await predictMany(brain, [claim]))[0];
}

// ---------------------------------------------------------------------------------------------
// training loop

export function createBrain(name: string, description: string) {
  const id = `brain_${slug(name) || "unnamed"}_${Date.now().toString(36).slice(-4)}`;
  q(`CREATE (b:Brain {id: $id, name: $name, description: $description, example: false, created_at: $at, checks: 0, correct: 0})`,
    { id, name: name.slice(0, 80), description: description.slice(0, 400), at: now() });
  checkpoint();
  return { id };
}

function createPendingCheck(brain: string, claim: string, p: Prediction) {
  const id = newId("chk");
  q(`MATCH (b:Brain {id: $brain}), (c:Claim {id: $claim})
     CREATE (k:Check {id: $id, pending: true, predicted: $predicted, confidence: $confidence, abstained: $abstained,
                      by: $by, because: $because, at: $at})
     CREATE (k)-[:OF]->(b) CREATE (k)-[:ON]->(c)`,
    { brain, claim, id, predicted: p.stance ?? -9, confidence: p.confidence, abstained: p.stance === null, by: p.by, because: p.because, at: now() });
  return id;
}

/**
 * Next training question. The candidate is chosen cheaply from the graph (active learning: the unanswered claim with the
 * least related evidence, optionally limited to one idea's claims). The brain then COMMITS to a prediction, stored as a
 * pending Check, before the question is shown.
 */
export async function nextQuestion(brain: string, prefer?: string) {
  const pending = q(
    `MATCH (k:Check {pending: true})-[:OF]->(:Brain {id: $brain}), (k)-[:ON]->(c:Claim)
     WHERE NOT EXISTS { MATCH (:Brain {id: $brain})-[:STANCE]->(c) }
     ${prefer ? "AND EXISTS { MATCH (:Idea {id: $prefer})-[:HAS_CLAIM]->(c) }" : ""}
     RETURN c.id AS claim, c.text AS text, c.source AS source, k.id AS check ORDER BY k.at DESC LIMIT 1`,
    { brain, prefer: prefer ?? "" })[0];
  let pick: Row | undefined = pending;
  if (!pick) {
    const cands = q(
      `MATCH (c:Claim) WHERE NOT EXISTS { MATCH (:Brain {id: $brain})-[:STANCE]->(c) }
       ${prefer ? "AND EXISTS { MATCH (:Idea {id: $prefer})-[:HAS_CLAIM]->(c) }" : ""}
       OPTIONAL MATCH (c)-[:MENTIONS]->(:Concept)<-[:MENTIONS]-(k:Claim)<-[:STANCE]-(:Brain {id: $brain})
       RETURN c.id AS claim, c.text AS text, c.source AS source, count(k) AS support`, { brain, prefer: prefer ?? "" });
    if (!cands.length) return null;
    const minSupport = Math.min(...cands.map((c) => Number(c.support)));
    const pool = cands.filter((c) => Number(c.support) <= minSupport + 1);
    pick = pool[Math.floor(Math.random() * pool.length)];
  }
  let check = pending ? String(pending.check) : "";
  if (!check) {
    check = createPendingCheck(brain, String(pick.claim), await predict(brain, String(pick.claim)));
    checkpoint();
  }
  const concepts = q(`MATCH (:Claim {id: $id})-[:MENTIONS]->(x:Concept) RETURN x.name AS name`, { id: pick.claim }).map((r) => String(r.name));
  const remaining = Number(q(`MATCH (c:Claim) WHERE NOT EXISTS { MATCH (:Brain {id: $brain})-[:STANCE]->(c) } RETURN count(c) AS n`, { brain })[0]?.n ?? 0);
  return { claim: String(pick.claim), text: String(pick.text), source: String(pick.source), concepts, remaining, check };
}

/** Record an answer and resolve the pending Check made before the question was shown (or predict now if none). */
export async function answer(brain: string, claim: string, value: Stance, note?: string) {
  // Changing an earlier answer is allowed, but it is not a held-out test any more: update the stance, record no check.
  const prev = q(`MATCH (:Brain {id: $brain})-[s:STANCE]->(:Claim {id: $claim}) RETURN s.value AS v, s.source AS src`, { brain, claim })[0];
  if (prev) {
    q(`MATCH (b:Brain {id: $brain})-[s:STANCE]->(:Claim {id: $claim})
       SET s.value = $value, s.note = coalesce($note, s.note), s.source = 'answer', s.at = $at, b.updated_at = $at`,
      { brain, claim, value, note: (note ?? "").slice(0, 300) || null, at: now() });
    checkpoint();
    return {
      prediction: { stance: null, label: "not re-tested", confidence: 0, by: "n/a (answer updated)", because: [] },
      actual: value, correct: false, abstained: true, updated: true, previous: Number(prev.v), accuracy: brainStats(brain),
    };
  }
  const find = () => q(
    `MATCH (k:Check {pending: true})-[:OF]->(:Brain {id: $brain}), (k)-[:ON]->(:Claim {id: $claim})
     RETURN k.id AS id, k.predicted AS predicted, k.confidence AS confidence, k.abstained AS abstained, k.by AS by, k.because AS because
     ORDER BY k.at DESC LIMIT 1`, { brain, claim })[0];
  let chk = find();
  if (!chk) {
    createPendingCheck(brain, claim, await predict(brain, claim));
    chk = find();
  }
  const abstained = Boolean(chk.abstained);
  const correct = !abstained && Number(chk.predicted) === value;
  const conn = connection();
  conn.begin();
  try {
    q(`MATCH (b:Brain {id: $brain}), (c:Claim {id: $claim}), (k:Check {id: $check})
       SET k.pending = false, k.actual = $value, k.correct = $correct, k.answered_at = $at
       MERGE (b)-[s:STANCE]->(c) SET s.value = $value, s.note = $note, s.source = 'answer', s.at = $at
       SET b.checks = b.checks + CASE WHEN $abstained THEN 0 ELSE 1 END,
           b.correct = b.correct + CASE WHEN $correct THEN 1 ELSE 0 END, b.updated_at = $at`,
      { brain, claim, check: chk.id, value, correct, abstained, note: (note ?? "").slice(0, 300) || null, at: now() });
    conn.commit();
  } catch (e) {
    conn.rollback();
    throw e;
  }
  checkpoint();
  const because = q(
    `MATCH (k:Claim) WHERE k.id IN $ids OPTIONAL MATCH (:Brain {id: $brain})-[s:STANCE]->(k)
     RETURN k.id AS claim, k.text AS text, s.value AS stance`, { ids: (chk.because as string[]) ?? [], brain });
  return {
    prediction: {
      stance: abstained ? null : Number(chk.predicted), label: abstained ? "unsure" : STANCE_LABEL[String(chk.predicted)],
      confidence: Number(chk.confidence), by: String(chk.by), because,
    },
    actual: value, correct, abstained, accuracy: brainStats(brain),
  };
}

export function brainStats(brain: string) {
  const r = q(
    `MATCH (b:Brain {id: $brain})
     OPTIONAL MATCH (b)-[s:STANCE]->(:Claim)
     WITH b, count(s) AS answers
     OPTIONAL MATCH (k:Check)-[:OF]->(b) WHERE k.pending = false AND NOT k.abstained
     WITH b, answers, k ORDER BY k.answered_at DESC
     WITH b, answers, collect(k.correct) AS hist
     RETURN b.checks AS checks, b.correct AS correct, answers, b.cv_accuracy AS cv_accuracy, b.cv_n AS cv_n,
            b.cv_baseline AS cv_baseline, b.cv_by AS cv_by, b.cv_at AS cv_at,
            size([x IN hist[0..10] WHERE x]) AS last10_correct, size(hist[0..10]) AS last10`,
    { brain }
  )[0];
  const checks = Number(r?.checks ?? 0), correct = Number(r?.correct ?? 0);
  return {
    answers: Number(r?.answers ?? 0), checks, correct,
    accuracy: checks ? r3(correct / checks) : null,
    last10: Number(r?.last10 ?? 0) ? r3(Number(r?.last10_correct) / Number(r?.last10)) : null,
    cv: r?.cv_accuracy == null ? null
      : { accuracy: Number(r.cv_accuracy), n: Number(r.cv_n), baseline: Number(r.cv_baseline), by: String(r.cv_by), at: String(r.cv_at) },
  };
}

export type CvRow = { claim: string; actual: number; predicted: number | null; by: string; baseline: number; fold: number };

/**
 * k-fold cross-validation (default 4): hide one fold of the brain's answers, predict it from the rest, repeat.
 * - The split is a seeded Fisher-Yates shuffle, so a run can be repeated exactly (`seed`, default 1).
 * - The baseline is honest: for each fold it predicts the most common answer of the TRAINING folds only.
 * - Returns every prediction (`rows`) so scripts can compute confidence intervals and kappa.
 * Stored on the Brain node (cv_accuracy, cv_n, cv_baseline, cv_seed) unless `store: false`.
 */
export async function crossValidate(brain: string, opts: { seed?: number; folds?: number; store?: boolean } = {}) {
  const seed = opts.seed ?? 1, k = opts.folds ?? 4;
  const answers = q(`MATCH (:Brain {id: $brain})-[s:STANCE]->(c:Claim) RETURN c.id AS id, s.value AS v ORDER BY c.id`, { brain })
    .map((a) => ({ id: String(a.id), v: Number(a.v) }));
  if (answers.length < 8) throw new Error("Need at least 8 answers before cross-validation is meaningful.");
  const truth = new Map(answers.map((a) => [a.id, a.v]));
  const ids = shuffle(answers.map((a) => a.id), seed);
  const folds = Array.from({ length: k }, (_, f) => ids.filter((_, i) => i % k === f));
  const rows: CvRow[] = [];
  for (const [f, fold] of folds.entries()) {
    const base = majority(ids.filter((id) => !fold.includes(id)).map((id) => truth.get(id)!));
    for (const p of await predictMany(brain, fold, fold))
      rows.push({ claim: p.claim, actual: truth.get(p.claim)!, predicted: p.stance, by: p.by, baseline: base, fold: f });
  }
  const n = rows.length;
  const ok = rows.filter((r) => r.predicted === r.actual).length;
  const baseOk = rows.filter((r) => r.baseline === r.actual).length;
  const llmRows = rows.filter((r) => r.by !== "graph");
  const by = llmRows[0]?.by ?? "graph";
  console.info(`[brains] CV ${brain} (seed ${seed}): ${ok}/${n} correct, baseline ${baseOk}/${n}; ${llmRows.length} by LLM, ${n - llmRows.length} by graph`);
  const result = {
    accuracy: r3(ok / n), n, baseline: r3(baseOk / n), by, seed,
    llm_predictions: llmRows.length, graph_fallbacks: n - llmRows.length, rows,
  };
  if (opts.store !== false) {
    q(`MATCH (b:Brain {id: $brain}) SET b.cv_accuracy = $acc, b.cv_n = $n, b.cv_baseline = $baseline, b.cv_by = $by,
         b.cv_seed = $seed, b.cv_at = $at`,
      { brain, acc: result.accuracy, n, baseline: result.baseline, by, seed, at: now() });
    checkpoint();
  }
  return result;
}

/** Delete a brain and everything that belongs only to it (stances, utterances, checks, responses). Claims stay: other brains may share them. */
export function deleteBrain(brain: string) {
  const conn = connection();
  conn.begin();
  try {
    q(`MATCH (b:Brain {id: $brain}) OPTIONAL MATCH (b)-[:SAID]->(u:Utterance) DETACH DELETE u`, { brain });
    q(`MATCH (k:Check)-[:OF]->(:Brain {id: $brain}) DETACH DELETE k`, { brain });
    q(`MATCH (r:Response)-[:BY]->(:Brain {id: $brain}) DETACH DELETE r`, { brain });
    q(`MATCH (b:Brain {id: $brain}) DETACH DELETE b`, { brain });
    // talk-created claims nobody holds any more
    q(`MATCH (c:Claim {source: 'talk'}) WHERE NOT EXISTS { MATCH (c)<-[:STANCE]-(:Brain) } AND NOT EXISTS { MATCH (c)<-[:HAS_CLAIM]-(:Idea) }
       DETACH DELETE c`);
    conn.commit();
  } catch (e) {
    conn.rollback();
    throw e;
  }
  checkpoint();
  return { deleted: brain };
}
