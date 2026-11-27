"use client";
import { useCallback, useEffect, useState } from "react";
import GraphView from "@/components/GraphView";
import KnowledgePanel, { type Knowledge } from "@/components/KnowledgePanel";
import PointMatrix, { type Evaluation } from "@/components/PointMatrix";
import BrainResponse, { type Brainwave } from "@/components/BrainResponse";
import type { Triple } from "@/lib/types";
import examples from "@/data/examples.json";

type Cv = { accuracy: number; n: number; baseline: number } | null;
type Stats = { answers: number; checks: number; accuracy: number | null; cv: Cv };
type BrainRow = { id: string; name: string; description: string; example: boolean } & Stats;
type Cited = { claim: string; text: string; stance: number; quote: string | null };
type Resp = {
  id: string; brain: string; name: string; reaction: string; says: string; concerns: string[]; would_do: string; by: string;
  cited: Cited[]; stats: Stats;
};
type Synthesis = {
  consensus: string[]; conflicts: { topic: string; sides: { brain: string; position: string }[] }[];
  joint_solution: string; next_questions: string[]; by: string;
};
type Ask = { id: string; title: string; kind: string; claims: number; responses: number };

const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const STANCE: Record<string, string> = { "1": "agrees", "0": "neutral on", "-1": "disagrees" };
const REACT_ICON: Record<string, string> = { enthusiastic: "🤩", positive: "🙂", neutral: "😐", skeptical: "🤨", opposed: "🙅" };

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as T;
}

function accuracyText(s: Stats) {
  if (s.cv) return `CV ${pct(s.cv.accuracy)} vs ${pct(s.cv.baseline)} baseline`;
  if (s.checks >= 5) return `self-test ${pct(s.accuracy)} (${s.checks})`;
  return `${s.answers} beliefs · accuracy not measured`;
}

export default function PanelPage() {
  const [brains, setBrains] = useState<BrainRow[] | null>(null); // null until the first load, so "No brains yet" never flashes
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [asks, setAsks] = useState<Ask[]>([]);
  const [kind, setKind] = useState<"problem" | "idea">("problem");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [selAsk, setSelAsk] = useState<{ title: string; text: string; kind: string } | null>(null);
  const [responses, setResponses] = useState<Resp[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [syn, setSyn] = useState<Synthesis | null>(null);
  const [triples, setTriples] = useState<Triple[]>([]);
  const [matrix, setMatrix] = useState<Evaluation | null>(null);
  const [know, setKnow] = useState<Knowledge | null>(null);
  const [bw, setBw] = useState<(Brainwave & { triples: Triple[] }) | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLists = useCallback(async () => {
    const [b, i] = await Promise.all([api<{ brains: BrainRow[] }>("/api/brains"), api<{ ideas: Ask[] }>("/api/ideas")]);
    setBrains(b.brains);
    setPicked((p) => (p.size ? p : new Set(b.brains.map((x) => x.id))));
    setAsks(i.ideas);
  }, []);
  useEffect(() => { loadLists().catch((e) => setError(String(e.message ?? e))); }, [loadLists]);

  const loadState = useCallback(async (id: string) => {
    const s = await api<{ idea: { title: string; text: string; kind: string } | null; responses: Resp[]; synthesis: Synthesis | null; triples: Triple[] }>(
      `/api/panel?idea=${encodeURIComponent(id)}`);
    if (s.idea) setSelAsk(s.idea);
    setResponses(s.responses); setSyn(s.synthesis); setTriples(s.triples);
    setBw(await api<Brainwave & { triples: Triple[] }>(`/api/brainwave?idea=${encodeURIComponent(id)}`).catch(() => null));
  }, []);

  const open = async (a: Ask) => {
    setSel(a.id); setMatrix(null); setKnow(null); setFailed({}); setPending([]); setSelAsk({ title: a.title, text: "", kind: a.kind });
    await loadState(a.id).catch((e) => setError(String(e.message ?? e)));
  };

  const runPanel = async (id: string, ids: string[]) => {
    setResponses([]); setSyn(null); setFailed({}); setPending(ids);
    for (const brain of ids) {
      try {
        const r = await api<Resp>("/api/panel", { action: "respond", idea: id, brain });
        setResponses((rs) => [...rs.filter((x) => x.brain !== brain), r]);
      } catch (e) {
        setFailed((f) => ({ ...f, [brain]: String((e as Error).message ?? e) }));
      }
      setPending((p) => p.filter((x) => x !== brain));
    }
    if (ids.length >= 2) {
      setBusy("Synthesising the panel…");
      try { setSyn(await api<Synthesis>("/api/panel", { action: "synthesize", idea: id })); }
      catch (e) { setError(String((e as Error).message ?? e)); }
      finally { setBusy(null); }
    }
    await loadState(id).catch(() => null);
    await loadLists().catch(() => null);
  };

  const ask = async () => {
    const ids = [...picked];
    if (!ids.length) { setError("Pick at least one brain."); return; }
    setBusy("Reading your question and splitting it into points…");
    try {
      const r = await api<{ id: string }>("/api/panel", { action: "ask", title, text, kind });
      setSel(r.id); setSelAsk({ title, text, kind }); setMatrix(null); setKnow(null); setBusy(null);
      await runPanel(r.id, ids);
    } catch (e) { setError(String((e as Error).message ?? e)); setBusy(null); }
  };

  const showMatrix = async () => {
    if (!sel) return;
    setBusy("Predicting each brain's reaction to each point (one call per brain)…");
    try { setMatrix(await api<Evaluation>(`/api/ideas?id=${encodeURIComponent(sel)}`)); }
    catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(null); }
  };
  const showKnowledge = async () => {
    if (!sel) return;
    setBusy("Loading world knowledge…");
    try { setKnow(await api<Knowledge>(`/api/knowledge?idea=${encodeURIComponent(sel)}`)); }
    catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(null); }
  };
  const linkNow = async () => {
    if (!sel) return;
    setBusy("Linking concepts to Wikidata (rate-limited, about a minute)…");
    try { await api("/api/knowledge", { action: "link", idea: sel }); setKnow(await api<Knowledge>(`/api/knowledge?idea=${encodeURIComponent(sel)}`)); }
    catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(null); }
  };
  const importBrainwave = async () => {
    setBusy("Importing TRIBE v2 results into the graph…");
    try {
      const r = await api<{ imported: unknown[]; skipped: { file: string; reason: string }[] }>("/api/brainwave", { action: "import" });
      if (r.skipped.length) setError(`Skipped: ${r.skipped.map((x) => x.reason).join("; ")}`);
      if (sel) await loadState(sel);
    } catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(null); }
  };
  const teach = async (brain: string, claim: string, value: 1 | 0 | -1) => {
    setBusy("Teaching the brain…");
    try { await api("/api/brains", { brain, claim, value }); if (sel) setMatrix(await api<Evaluation>(`/api/ideas?id=${encodeURIComponent(sel)}`)); }
    catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setBusy(null); }
  };

  const nameOf = (id: string) => (brains ?? []).find((b) => b.id === id)?.name ?? id;
  const running = pending.length > 0;

  return (
    <main className="wrap">
      <header className="top"><h1>Brain Panel</h1></header>
      <p className="sub">
        Put a problem or an idea in front of every brain you built. Each one answers <b>in its own voice</b>, says how it
        would solve it, and shows the beliefs from its graph that it relied on. Brains are models of <i>the answers and words
        their trainer gave</i>, shown with their measured accuracy. They are not real people or a market.
      </p>
      {error && <p className="banner err" onClick={() => setError(null)}>{error} <span className="muted small">(click to dismiss)</span></p>}

      <div className="grid brains">
        <section className="card">
          <h2>Ask the panel</h2>
          <div className="seg" role="group" aria-label="Kind">
            <button aria-pressed={kind === "problem"} onClick={() => setKind("problem")}>Problem / question</button>
            <button aria-pressed={kind === "idea"} onClick={() => setKind("idea")}>Idea / pitch</button>
          </div>
          <div className="chips" style={{ margin: "8px 0" }}>
            <span className="muted small">Examples:</span>
            {examples.examples.map((x) => (
              <button key={x.title} className="chip-btn"
                onClick={() => { setTitle(x.title.replace(/^Problem: /, "")); setText(x.text); setKind(x.kind as "problem" | "idea"); }}>
                {x.title}
              </button>
            ))}
          </div>
          <div className="form">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short title" maxLength={120} />
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} maxLength={6000}
              placeholder={kind === "problem" ? "Describe the problem or ask a question…" : "Paste your idea or pitch…"} />
          </div>
          <h4>Brains on the panel</h4>
          <div className="picklist">
            {(brains ?? []).map((b) => (
              <label key={b.id} className="pick">
                <input type="checkbox" checked={picked.has(b.id)}
                  onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(b.id); else n.delete(b.id); return n; })} />
                <span><b>{b.name}</b><span className="muted small"> · {accuracyText(b)}</span></span>
              </label>
            ))}
            {brains === null && <p className="muted small">Loading brains…</p>}
            {brains?.length === 0 && <p className="empty">No brains yet. Build one in the <a href="/brains">Brain Library</a>.</p>}
          </div>
          <button className="primary" disabled={!title.trim() || text.trim().length < 15 || !!busy || running} onClick={ask}>
            Ask {picked.size} brain{picked.size === 1 ? "" : "s"}
          </button>

          {asks.length > 0 && (
            <>
              <h4>Earlier questions</h4>
              <div className="blist">
                {asks.map((a) => (
                  <button key={a.id} className="pitch" aria-pressed={a.id === sel} onClick={() => open(a)}>
                    <div className="p">{a.kind}</div>
                    <div className="t">{a.title}</div>
                    <div className="stats"><span><b>{a.responses}</b> responses</span><span><b>{a.claims}</b> points</span></div>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <div className="col">
          {busy && <p className="banner">{busy}</p>}
          {!sel && !busy && (
            <section className="card">
              <p className="empty">Ask a question on the left, or open an earlier one. Each brain answers in turn (free Groq plan), then the panel is synthesised.</p>
            </section>
          )}

          {sel && selAsk && (
            <section className="card">
              <h2>{selAsk.title} <span className="r">{selAsk.kind}</span></h2>
              {selAsk.text && <p className="small muted asktext">{selAsk.text}</p>}
            </section>
          )}

          {sel && (
            <div className="responses">
              {responses.map((r) => (
                <section key={r.brain} className={`card resp r-${r.reaction}`}>
                  <div className="rhead">
                    <span className="rname">{r.name}</span>
                    <span className={`reaction r-${r.reaction}`}>{REACT_ICON[r.reaction] ?? ""} {r.reaction}</span>
                  </div>
                  <div className="muted small">{accuracyText(r.stats)}</div>
                  <blockquote>“{r.says}”</blockquote>
                  {r.concerns?.length > 0 && (<><b className="small">Concerns</b><ul className="small">{r.concerns.map((c) => <li key={c}>{c}</li>)}</ul></>)}
                  {r.would_do && <p className="small"><b>Would do:</b> {r.would_do}</p>}
                  {r.cited?.length > 0 && (
                    <details className="small">
                      <summary>Beliefs it relied on ({r.cited.length})</summary>
                      <ul>
                        {r.cited.map((c) => (
                          <li key={c.claim}>{STANCE[String(c.stance)] ?? ""} “{c.text}”{c.quote ? <span className="muted">, in their words: “{c.quote}”</span> : null}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="muted small">by {r.by}</div>
                </section>
              ))}
              {pending.map((b) => (
                <section key={b} className="card resp pending"><div className="rname">{nameOf(b)}</div><p className="muted">thinking with its graph…</p></section>
              ))}
              {Object.entries(failed).map(([b, msg]) => (
                <section key={b} className="card resp"><div className="rname">{nameOf(b)}</div><p className="err small">{msg}</p></section>
              ))}
            </div>
          )}

          {syn && (
            <section className="card">
              <h2>Panel synthesis <span className="r">by {syn.by}</span></h2>
              {syn.consensus.length > 0 && (<><h4>Where they agree</h4><ul>{syn.consensus.map((c) => <li key={c}>{c}</li>)}</ul></>)}
              {syn.conflicts.length > 0 && (
                <>
                  <h4>Where they clash</h4>
                  {syn.conflicts.map((c) => (
                    <div key={c.topic} className="conflict">
                      <b>{c.topic}</b>
                      <ul className="small">{c.sides.map((s) => <li key={s.brain}><b>{nameOf(s.brain)}</b>: {s.position}</li>)}</ul>
                    </div>
                  ))}
                </>
              )}
              {syn.joint_solution && (<><h4>Joint solution</h4><p>{syn.joint_solution}</p></>)}
              {syn.next_questions.length > 0 && (<><h4>Ask next</h4><ul className="small">{syn.next_questions.map((x) => <li key={x}>{x}</li>)}</ul></>)}
            </section>
          )}

          {sel && !running && (
            <section className="card">
              <h2>Go deeper</h2>
              <div className="chips">
                <button className="chip-btn" disabled={!!busy} onClick={() => sel && runPanel(sel, [...picked])}>Ask again</button>
                <button className="chip-btn" disabled={!!busy} onClick={showMatrix}>Point-by-point reactions</button>
                <button className="chip-btn" disabled={!!busy} onClick={showKnowledge}>World knowledge</button>
              </div>
            </section>
          )}

          {matrix && (
            <section className="card">
              <h2>Point by point <span className="r">does each point land with each brain?</span></h2>
              <PointMatrix ev={matrix} busy={!!busy} onTeach={teach} />
            </section>
          )}

          {sel && bw && (bw.scan || bw.pending.length > 0) && (
            <section className="card">
              <h2>Average brain response <span className="r">TRIBE v2 · predicted, not measured</span></h2>
              <BrainResponse bw={bw} busy={!!busy} onImport={importBrainwave} />
            </section>
          )}

          {know && (
            <section className="card">
              <h2>World knowledge <span className="r">Wikidata · Wikipedia</span></h2>
              <KnowledgePanel k={know} busy={!!busy} onLink={linkNow} claimText={(id) => matrix?.claims.find((c) => c.claim === id)?.text ?? id} />
            </section>
          )}

          {(triples.length > 0 || (bw?.triples.length ?? 0) > 0) && (
            <section className="card">
              <h2>Panel as a graph <span className="r">(:Brain)-[:BELIEVES]-&gt;(:Claim)-[:MENTIONS]-&gt;(:Concept)</span></h2>
              <GraphView triples={[...triples, ...(bw?.triples ?? [])]} onSegment={() => null} onInsight={() => null} />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
