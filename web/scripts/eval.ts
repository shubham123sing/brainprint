// Reproducible evaluation of every brain in graph/brainprint.rl. Writes eval/results.json and eval/results.md.
//
//   npm run eval                    # LLM (Groq/Ollama from .env.local) + graph-only, 3 seeds
//   npm run eval -- --seeds 5
//   npm run eval -- --graph-only    # no key, no network
//   npm run eval -- --md-only       # rewrite results.md from results.json
//   npm run eval -- --write-back    # store the summary on each Brain node of the real graph (the app shows it)
//
// It runs on a TEMPORARY COPY of the store, so the committed graph is never changed (and the dev server may keep running
// only if it is stopped: Relate allows one writer per file, and copying needs a consistent file).
//
// What is measured, per brain:
//   1. Seeded k-fold cross-validation (lib/brains.ts crossValidate): hide one fold of the brain's answers, predict it from
//      the rest. Compared with two baselines computed WITHOUT the held-out answers:
//        - majority: always predict the most common answer of the training folds;
//        - crowd: predict what the OTHER brains answered for that statement (majority of their stances), else majority.
//      Reported with a Wilson 95% interval, Cohen's kappa and an exact McNemar test against the majority baseline.
//   2. Talk -> Quiz transfer (brains built by talking AND quizzed): learn only from the Talk beliefs, predict every Quiz
//      answer. This is the product's main claim: "built from what someone said, predicts how they answer".
//   3. Sealed predictions: Quiz Checks, where the prediction was stored BEFORE the question was shown.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, dflt: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const SEEDS = Number(opt("seeds", "3"));
const GRAPH_ONLY = flag("graph-only");

const WEB = process.cwd();
const ROOT = path.resolve(WEB, "..");
const SRC = path.join(ROOT, "graph", "brainprint.rl");
const OUT = path.resolve(ROOT, opt("out", "eval"));

// .env.local (same file the app reads), unless graph-only
if (!GRAPH_ONLY && fs.existsSync(path.join(WEB, ".env.local"))) {
  for (const line of fs.readFileSync(path.join(WEB, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (GRAPH_ONLY) process.env.LLM_PROVIDER = "none";

// Work on a copy: BRAINPRINT_DB must be set before lib/relate is imported (it reads the path at load time).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brainprint-eval-"));
const COPY = path.join(tmp, "brainprint.rl");
fs.copyFileSync(SRC, COPY);
process.env.BRAINPRINT_DB = COPY;

type Row = Record<string, unknown>;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const pct = (x: number) => `${Math.round(x * 100)}%`;

async function main() {
  const { connection } = await import("@/lib/relate");
  const { crossValidate, predictMany } = await import("@/lib/brains");
  const { activeProvider } = await import("@/lib/llm");
  const { kappa, majority, mcnemar, wilson } = await import("@/lib/stats");
  const q = (c: string, p: Record<string, unknown> = {}) => connection().query(c, p as never).rows as Row[];

  const provider = activeProvider();
  const llmOn = provider !== "none";
  console.log(`Evaluating a copy of graph/brainprint.rl (${provider === "none" ? "graph-only" : provider}, ${SEEDS} seed(s))`);

  const brains = q(`MATCH (b:Brain) OPTIONAL MATCH (b)-[s:STANCE]->()
                    RETURN b.id AS id, b.name AS name, b.example AS example, collect(s.source) AS sources ORDER BY b.name`);
  // Other brains' stances per claim, for the crowd baseline.
  const stanceRows = q(`MATCH (b:Brain)-[s:STANCE]->(c:Claim) RETURN b.id AS brain, c.id AS claim, s.value AS v`);
  const crowd = (brain: string, claim: string, fallback: number) => {
    const vs = stanceRows.filter((r) => r.claim === claim && r.brain !== brain).map((r) => Number(r.v));
    return vs.length ? majority(vs) : fallback;
  };

  const results: Row[] = [];
  for (const b of brains) {
    const id = String(b.id), name = String(b.name);
    const sources = (b.sources as string[]).reduce<Record<string, number>>((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {});
    const n = Object.values(sources).reduce((a, c) => a + c, 0);
    const entry: Row = { brain: id, name, example: Boolean(b.example), answers: n, sources };
    if (n < 8) { results.push({ ...entry, skipped: "fewer than 8 answers" }); continue; }

    // 1. cross-validation, LLM arm (if a provider is configured) and graph-only arm
    const arm = async (useLlm: boolean) => {
      process.env.LLM_PROVIDER = useLlm ? (provider as string) : "none";
      const runs = [];
      for (let seed = 1; seed <= SEEDS; seed++) runs.push(await crossValidate(id, { seed, store: false }));
      const accs = runs.map((r) => r.accuracy);
      const mean = accs.reduce((a, c) => a + c, 0) / accs.length;
      const all = runs.flatMap((r) => r.rows);
      const first = runs[0].rows;
      const hits = first.map((r) => r.predicted === r.actual), baseHits = first.map((r) => r.baseline === r.actual);
      return {
        by: runs.find((r) => r.by !== "graph")?.by ?? "graph",
        llm_share: r3(runs.reduce((a, r) => a + r.llm_predictions, 0) / all.length),
        accuracy_mean: r3(mean), accuracy_min: Math.min(...accs), accuracy_max: Math.max(...accs),
        ci95: wilson(Math.round(mean * first.length), first.length).map(r3),
        kappa: r3(kappa(all.map((r) => r.predicted ?? 9), all.map((r) => r.actual))),
        mcnemar_p_vs_majority: r3(mcnemar(hits, baseHits)),
        rows: runs.map((r) => ({ seed: r.seed, accuracy: r.accuracy, rows: r.rows })),
        majority_baseline: r3(baseHits.filter(Boolean).length / first.length),
        crowd_baseline: r3(first.filter((r) => crowd(id, r.claim, r.baseline) === r.actual).length / first.length),
      };
    };
    const llm = llmOn ? await arm(true) : null;
    const graph = await arm(false);
    process.env.LLM_PROVIDER = provider;
    Object.assign(entry, { n: graph.rows[0].rows.length, majority_baseline: graph.majority_baseline, crowd_baseline: graph.crowd_baseline, llm, graph });

    // 2. talk -> quiz transfer
    if ((sources.talk ?? 0) >= 3 && (sources.answer ?? 0) >= 3) {
      const st = q(`MATCH (:Brain {id: $id})-[s:STANCE]->(c:Claim) RETURN c.id AS claim, s.value AS v, s.source AS src`, { id });
      const test = st.filter((r) => r.src === "answer").map((r) => String(r.claim));
      const hide = st.filter((r) => r.src !== "talk").map((r) => String(r.claim));
      const truth = new Map(st.map((r) => [String(r.claim), Number(r.v)]));
      const base = majority(st.filter((r) => r.src === "talk").map((r) => Number(r.v)));
      const preds = await predictMany(id, test, hide);
      const ok = preds.filter((p) => p.stance === truth.get(p.claim)).length;
      entry.talk_to_quiz = {
        train_talk_beliefs: sources.talk, test_quiz_answers: test.length, correct: ok, accuracy: r3(ok / test.length),
        ci95: wilson(ok, test.length).map(r3),
        majority_baseline: r3(test.filter((c) => truth.get(c) === base).length / test.length),
        crowd_baseline: r3(test.filter((c) => crowd(id, c, base) === truth.get(c)).length / test.length),
        by: preds.find((p) => p.by !== "graph")?.by ?? "graph",
      };
    }

    // 3. sealed predictions (Quiz checks made before the question was shown)
    const checks = q(`MATCH (k:Check)-[:OF]->(:Brain {id: $id}) WHERE k.pending = false AND NOT k.abstained
                      RETURN count(k) AS n, sum(CASE WHEN k.correct THEN 1 ELSE 0 END) AS ok`, { id })[0];
    const cn = Number(checks?.n ?? 0), cok = Number(checks?.ok ?? 0);
    if (cn) entry.sealed = { checks: cn, correct: cok, accuracy: r3(cok / cn), ci95: wilson(cok, cn).map(r3) };

    results.push(entry);
    console.log(`  ${name}: n=${entry.n}  LLM ${llm ? pct(llm.accuracy_mean) : "-"}  graph ${pct(graph.accuracy_mean)}  majority ${pct(graph.majority_baseline)}  crowd ${pct(graph.crowd_baseline)}`);
  }

  const meta = {
    generated_at: new Date().toISOString(), seeds: SEEDS, folds: 4, provider,
    model: llmOn ? (process.env.GROQ_MODEL ?? (provider === "groq" ? "openai/gpt-oss-120b" : process.env.OLLAMA_MODEL)) : null,
    note: "Run on a copy of graph/brainprint.rl. Baselines never see the held-out answers. Example brains were built from scripted answers.",
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ meta, results }, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT, "results.md"), markdown(meta, results));
  console.log(`Wrote ${path.relative(ROOT, path.join(OUT, "results.md"))} and results.json`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0); // the Relate handle has no close(); exit explicitly
}

function markdown(meta: Row, results: Row[]) {
  type Arm = { accuracy_mean: number; accuracy_min: number; accuracy_max: number; ci95: number[]; kappa: number; mcnemar_p_vs_majority: number; by: string; llm_share: number };
  const cell = (a: Arm | null) => a == null ? "–"
    : `**${pct(a.accuracy_mean)}**${a.accuracy_min !== a.accuracy_max ? ` (${pct(a.accuracy_min)}–${pct(a.accuracy_max)})` : ""} · CI ${pct(a.ci95[0])}–${pct(a.ci95[1])} · κ ${a.kappa} · p ${a.mcnemar_p_vs_majority}` +
      (a.by !== "graph" && a.llm_share < 1 ? ` · ${pct(a.llm_share)} by LLM (rest: graph fallback after rate limits)` : "");
  const L: string[] = [];
  L.push(`# BrainPrint evaluation results`, ``);
  L.push(`Generated ${String(meta.generated_at).slice(0, 10)} by \`npm run eval\` (web/scripts/eval.ts) on a copy of \`graph/brainprint.rl\`. ` +
    `${meta.seeds} seed(s) of 4-fold cross-validation; LLM: ${meta.model ?? "none (graph-only run)"}.`, ``);
  L.push(`- **Accuracy** = share of held-out answers predicted exactly (agree / neutral / disagree). Range over seeds in brackets.`);
  L.push(`- **CI** = Wilson 95% interval. **κ** = Cohen's kappa (0 = no better than chance agreement). **p** = exact McNemar test against the majority baseline (seed 1).`);
  L.push(`- **Majority baseline** = always predict the most common answer of the training folds. **Crowd baseline** = predict what the other brains answered.`);
  L.push(`- The trainer's description of a brain is not shown to the predictor; it sees only the brain's answers (pinned by a test).`, ``);
  L.push(`## Cross-validation`, ``);
  L.push(`| Brain | Built from | n | LLM + graph retrieval | Graph only (no LLM) | Majority | Crowd |`);
  L.push(`|---|---|---|---|---|---|---|`);
  for (const r of results) {
    const src = Object.entries(r.sources as Record<string, number>).map(([s, c]) => `${c} ${s}`).join(", ");
    if (r.skipped) { L.push(`| ${r.name} | ${src} | ${r.answers} | skipped: ${r.skipped} | | | |`); continue; }
    L.push(`| ${r.name} | ${src} | ${r.n} | ${cell(r.llm as Arm | null)} | ${cell(r.graph as Arm)} | ${pct(Number(r.majority_baseline))} | ${pct(Number(r.crowd_baseline))} |`);
  }
  const tq = results.filter((r) => r.talk_to_quiz);
  if (tq.length) {
    L.push(``, `## Talk → Quiz transfer`, ``, `Learn only from what the person said in Talk mode, then predict every answer they later gave in Quiz mode.`, ``);
    L.push(`| Brain | Talk beliefs | Quiz answers predicted | Accuracy | CI | Majority | Crowd | By |`, `|---|---|---|---|---|---|---|---|`);
    for (const r of tq) {
      const t = r.talk_to_quiz as Record<string, number | number[] | string>;
      const ci = t.ci95 as number[];
      L.push(`| ${r.name} | ${t.train_talk_beliefs} | ${t.test_quiz_answers} | **${t.correct}/${t.test_quiz_answers} (${pct(Number(t.accuracy))})** | ${pct(ci[0])}–${pct(ci[1])} | ${pct(Number(t.majority_baseline))} | ${pct(Number(t.crowd_baseline))} | ${t.by} |`);
    }
  }
  const sealed = results.filter((r) => r.sealed);
  if (sealed.length) {
    L.push(``, `## Sealed predictions (Quiz)`, ``, `Each prediction was stored in the graph as a pending Check before the question was shown, then scored when the answer came in.`, ``);
    L.push(`| Brain | Checks | Correct | CI |`, `|---|---|---|---|`);
    for (const r of sealed) {
      const s = r.sealed as { checks: number; correct: number; accuracy: number; ci95: number[] };
      L.push(`| ${r.name} | ${s.checks} | ${s.correct} (${pct(s.accuracy)}) | ${pct(s.ci95[0])}–${pct(s.ci95[1])} |`);
    }
  }
  L.push(``, `## Honest reading`, ``);
  L.push(`- Samples are small (11–23 answers per brain), so the intervals are wide: a difference of 10 points is not significant here.`);
  L.push(`- The investor and freelancer brains were built from answers scripted by the authors, not from real people.`);
  L.push(`- Per-claim predictions are in \`results.json\`, so every number above can be recomputed.`, ``);
  return L.join("\n");
}

if (flag("write-back")) {
  // Store the summary from results.json on each Brain node of the REAL graph, so the app shows the same numbers as
  // eval/results.md. This is the only mode that writes to graph/brainprint.rl; stop `npm run dev` first.
  fs.rmSync(tmp, { recursive: true, force: true });
  process.env.BRAINPRINT_DB = SRC;
  (async () => {
    const { connection, checkpoint } = await import("@/lib/relate");
    const { meta, results } = JSON.parse(fs.readFileSync(path.join(OUT, "results.json"), "utf8"));
    for (const r of results as Row[]) {
      const arm = (r.llm ?? r.graph) as { accuracy_mean: number; by: string } | undefined;
      if (!arm) continue;
      connection().query(
        `MATCH (b:Brain {id: $id}) SET b.cv_accuracy = $acc, b.cv_n = $n, b.cv_baseline = $base, b.cv_by = $by,
           b.cv_seed = $seeds, b.cv_at = $at`,
        { id: r.brain, acc: arm.accuracy_mean, n: r.n, base: r.majority_baseline, by: arm.by, seeds: `1-${meta.seeds} (mean)`, at: meta.generated_at } as never);
      console.log(`  ${r.name}: cv ${arm.accuracy_mean} vs baseline ${r.majority_baseline}`);
    }
    checkpoint();
    console.log("Wrote the eval summary to graph/brainprint.rl");
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
} else if (flag("md-only")) {
  // Rebuild results.md from an existing results.json (no graph, no LLM).
  const { meta, results } = JSON.parse(fs.readFileSync(path.join(OUT, "results.json"), "utf8"));
  fs.writeFileSync(path.join(OUT, "results.md"), markdown(meta, results));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("Rewrote eval/results.md from results.json");
} else {
  main().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
}
