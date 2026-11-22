// Brainwave: Meta's TRIBE v2 prediction of how an AVERAGE brain responds to a question or pitch, joined in the graph
// with what each persona brain thinks of the same point.
//
//   (:Idea)-[:SCANNED_AS]->(:Scan {source, duration, series_json})-[:HAS_MOMENT {order}]->(:Moment {text, start, end, z_json})
//   (:Moment)-[:ABOUT {sim}]->(:Claim)<-[:PREDICTS {stance}]-(:Brain)      the same point, as the persona brains see it
//   (:Moment)-[:ACTIVATES {z}]->(:Network {name})                          networks well above their own average here
//
// TRIBE runs on a GPU in Colab (brainwave/colab_brainwave.ipynb) and writes one `brainprint.tribe/v1` JSON per idea into
// brainwave/results/. importResults() splits the idea text into sentences, finds each sentence's seconds through the
// transcribed words, z-scores every network over the whole text (so values mean "above / below this text's own average"),
// and links each sentence to the idea's closest point with the local embedding model.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { checkpoint, connection, type Row } from "@/lib/relate";
import { embed } from "@/lib/embed";
import type { Triple } from "@/lib/types";

const q = (cypher: string, params: Record<string, unknown> = {}) => connection().query(cypher, params as never).rows as Row[];
export const RESULTS_DIR = process.env.BRAINWAVE_RESULTS ?? path.resolve(process.cwd(), "..", "brainwave", "results");
const NETWORKS = ["visual", "auditory", "language", "attention", "default_mode", "motor", "other"];
const SCHEMA = "brainprint.tribe/v1";
const ACTIVE_Z = 0.5; // a moment ACTIVATES a network when its mean z-score is at least this (top 2 per moment)
const LINK_SIM = 0.6;  // minimum cosine to link a sentence to an idea point

type TribeDoc = {
  schema: string; stimulus_id: string; title: string; source: string; warning: string | null;
  model: Record<string, unknown>; networks: string[]; duration_s: number;
  seconds: { t: number; text: string; networks: Record<string, number> }[];
};

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (s: string) => norm(s).split(" ").filter(Boolean);
const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0); // embeddings are normalised

/** Result files on disk, and whether each one is already in the graph. */
export function resultFiles() {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  const imported = new Set(q(`MATCH (i:Idea)-[:SCANNED_AS]->(s:Scan) RETURN i.id AS id, s.file_mtime AS m`)
    .map((r) => `${r.id}@${r.m}`));
  return fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json")).map((f) => {
    const id = f.replace(/\.json$/, "");
    const mtime = Math.round(fs.statSync(path.join(RESULTS_DIR, f)).mtimeMs);
    return { file: f, idea: id, imported: imported.has(`${id}@${mtime}`), mtime };
  });
}

function validate(doc: TribeDoc, file: string) {
  if (doc?.schema !== SCHEMA) throw new Error(`${file}: not a ${SCHEMA} file`);
  if (!Array.isArray(doc.seconds) || doc.seconds.length === 0) throw new Error(`${file}: no seconds`);
  if (NETWORKS.some((n) => !doc.networks.includes(n))) throw new Error(`${file}: unexpected networks ${doc.networks}`);
  if (doc.source !== "tribe-v2" && process.env.BRAINWAVE_ALLOW_SYNTHETIC !== "1")
    throw new Error(`${file}: source is "${doc.source}", not "tribe-v2" (synthetic data is refused)`);
}

/** Split into sentences and give each one its [start, end] seconds via the transcribed words. */
function moments(text: string, doc: TribeDoc) {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => words(s).length >= 3);
  const T = doc.seconds.length;
  const wordSec: number[] = [];
  doc.seconds.forEach((s, i) => words(s.text ?? "").forEach(() => wordSec.push(i)));
  const S = sentences.reduce((n, s) => n + words(s).length, 0) || 1;
  const W = wordSec.length;
  let a = 0;
  return sentences.map((text) => {
    const b = a + words(text).length;
    // proportional word alignment: robust to small transcription differences (numbers, contractions)
    const start = W ? wordSec[Math.min(W - 1, Math.floor((a * W) / S))] : Math.floor((a / S) * T);
    const end = W ? wordSec[Math.min(W - 1, Math.max(0, Math.ceil((b * W) / S) - 1))] : Math.max(start, Math.ceil((b / S) * T) - 1);
    a = b;
    return { text, start, end: Math.max(start, end) };
  });
}

export async function importResults() {
  const imported: { idea: string; title: string; duration: number; moments: number; linked: number; source: string }[] = [];
  const skipped: { file: string; reason: string }[] = [];
  for (const f of resultFiles()) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f.file), "utf8")) as TribeDoc;
      validate(doc, f.file);
      const ideaId = doc.stimulus_id;
      const idea = q(`MATCH (i:Idea {id: $id}) RETURN i.text AS text, i.title AS title`, { id: ideaId })[0];
      if (!idea) throw new Error(`${f.file}: no idea ${ideaId} in the graph`);

      // z-score each network over the whole text
      const stats = NETWORKS.map((n) => {
        const xs = doc.seconds.map((s) => Number(s.networks[n]));
        const m = xs.reduce((s, x) => s + x, 0) / xs.length;
        const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length) || 1;
        return { m, sd };
      });
      const zAt = (i: number) => NETWORKS.map((n, k) => (Number(doc.seconds[i].networks[n]) - stats[k].m) / stats[k].sd);
      const series = doc.seconds.map((s, i) => ({ t: s.t, text: s.text ?? "", z: zAt(i).map((x) => round(x, 2)) }));

      const ms = moments(String(idea.text), doc).map((m, i) => {
        const zs = NETWORKS.map((_, k) => {
          let sum = 0; for (let t = m.start; t <= m.end; t++) sum += series[t].z[k];
          return round(sum / (m.end - m.start + 1), 2);
        });
        return { ...m, id: `${ideaId}:m${i + 1}`, order: i + 1, z: Object.fromEntries(NETWORKS.map((n, k) => [n, zs[k]])) };
      });

      // link each sentence to the idea point it says: best pairs first, each point and each sentence used at most once
      const claims = q(`MATCH (:Idea {id: $id})-[:HAS_CLAIM]->(c:Claim) RETURN c.id AS id, c.text AS text`, { id: ideaId });
      const links: { m: string; c: string; sim: number }[] = [];
      if (claims.length && ms.length) {
        const vecs = await embed([...ms.map((m) => m.text), ...claims.map((c) => String(c.text))]);
        const pairs = ms.flatMap((_, i) => claims.map((_, j) => ({ i, j, s: cos(vecs[i], vecs[ms.length + j]) })))
          .filter((p) => p.s >= LINK_SIM).sort((a, b) => b.s - a.s);
        const usedM = new Set<number>(), usedC = new Set<number>();
        for (const p of pairs) {
          if (usedM.has(p.i) || usedC.has(p.j)) continue;
          usedM.add(p.i); usedC.add(p.j);
          links.push({ m: ms[p.i].id, c: String(claims[p.j].id), sim: round(p.s) });
        }
      }
      const acts = ms.flatMap((m) => Object.entries(m.z).filter(([n, z]) => n !== "other" && z >= ACTIVE_Z)
        .sort((x, y) => y[1] - x[1]).slice(0, 2).map(([n, z]) => ({ m: m.id, n, z })));

      const sid = `scan_${ideaId}`;
      q(`MATCH (:Idea {id: $id})-[:SCANNED_AS]->(:Scan)-[:HAS_MOMENT]->(m:Moment) DETACH DELETE m`, { id: ideaId });
      q(`MATCH (:Idea {id: $id})-[:SCANNED_AS]->(s:Scan) DETACH DELETE s`, { id: ideaId });
      q(`MATCH (i:Idea {id: $id})
         CREATE (i)-[:SCANNED_AS]->(:Scan {id: $sid, source: $source, warning: $warning, duration: $duration,
                 model_json: $model, series_json: $series, file_mtime: $mtime, imported_at: $at})`,
        { id: ideaId, sid, source: doc.source, warning: doc.warning ?? null, duration: doc.seconds.length,
          model: JSON.stringify(doc.model ?? {}), series: JSON.stringify(series), mtime: f.mtime, at: new Date().toISOString() });
      q(`MATCH (s:Scan {id: $sid}) UNWIND $rows AS r
         CREATE (s)-[:HAS_MOMENT {order: r.order}]->(:Moment {id: r.id, text: r.text, start: r.start, end: r.end, z_json: r.z})`,
        { sid, rows: ms.map((m) => ({ id: m.id, order: m.order, text: m.text, start: m.start, end: m.end, z: JSON.stringify(m.z) })) });
      if (links.length) q(`UNWIND $links AS l MATCH (m:Moment {id: l.m}), (c:Claim {id: l.c}) MERGE (m)-[a:ABOUT]->(c) SET a.sim = l.sim`, { links });
      q(`UNWIND $nets AS n MERGE (:Network {name: n})`, { nets: NETWORKS });
      if (acts.length) q(`UNWIND $acts AS a MATCH (m:Moment {id: a.m}), (n:Network {name: a.n}) MERGE (m)-[r:ACTIVATES]->(n) SET r.z = a.z`, { acts });
      imported.push({ idea: ideaId, title: String(idea.title), duration: doc.seconds.length, moments: ms.length, linked: links.length, source: doc.source });
    } catch (e) {
      skipped.push({ file: f.file, reason: String((e as Error).message ?? e) });
    }
  }
  checkpoint();
  return { imported, skipped };
}

export type Reaction = { brain: string; name: string; stance: number };
export function brainwaveState(ideaId: string) {
  const files = resultFiles();
  const scan = q(`MATCH (:Idea {id: $id})-[:SCANNED_AS]->(s:Scan)
                  RETURN s.source AS source, s.warning AS warning, s.duration AS duration, s.series_json AS series,
                         s.model_json AS model, s.imported_at AS imported_at`, { id: ideaId })[0];
  const pending = files.filter((f) => !f.imported).map((f) => f.idea);
  if (!scan) return { scan: null, moments: [], triples: [] as Triple[], networks: NETWORKS, pending, hasFile: files.some((f) => f.idea === ideaId) };

  const moments = q(
    `MATCH (:Idea {id: $id})-[:SCANNED_AS]->(:Scan)-[h:HAS_MOMENT]->(m:Moment)
     OPTIONAL MATCH (m)-[a:ABOUT]->(c:Claim)
     OPTIONAL MATCH (b:Brain)-[p:PREDICTS]->(c)
     RETURN m.id AS id, m.text AS text, m.start AS start, m.end AS end, m.z_json AS z, h.order AS ord,
            c.id AS claim, c.text AS claim_text, a.sim AS sim,
            [x IN collect({brain: b.id, name: b.name, stance: p.stance}) WHERE x.brain IS NOT NULL AND x.stance IS NOT NULL] AS reactions
     ORDER BY ord`, { id: ideaId }).map((r) => ({
    id: String(r.id), text: String(r.text), start: Number(r.start), end: Number(r.end), z: JSON.parse(String(r.z)) as Record<string, number>,
    claim: r.claim ? { id: String(r.claim), text: String(r.claim_text), sim: Number(r.sim) } : null,
    reactions: (r.reactions as Reaction[]).map((x) => ({ ...x, stance: Number(x.stance) })),
  }));
  const triples = q(
    `MATCH (:Idea {id: $id})-[:SCANNED_AS]->(:Scan)-[:HAS_MOMENT]->(m:Moment)-[r:ACTIVATES]->(n:Network)
     RETURN m.id AS a, 'Moment' AS a_label, left(m.text, 40) AS a_name, 'ACTIVATES' AS rel, 'net_' + n.name AS b, 'Network' AS b_label, n.name AS b_name, r.z AS w
     UNION ALL
     MATCH (:Idea {id: $id})-[:SCANNED_AS]->(:Scan)-[:HAS_MOMENT]->(m:Moment)-[r:ABOUT]->(c:Claim)
     RETURN m.id AS a, 'Moment' AS a_label, left(m.text, 40) AS a_name, 'ABOUT' AS rel, c.id AS b, 'Claim' AS b_label, left(c.text, 40) AS b_name, r.sim AS w`,
    { id: ideaId }) as Triple[];
  return {
    scan: { source: String(scan.source), warning: (scan.warning as string) ?? null, duration: Number(scan.duration),
      series: JSON.parse(String(scan.series)) as { t: number; text: string; z: number[] }[], model: JSON.parse(String(scan.model ?? "{}")),
      imported_at: String(scan.imported_at) },
    moments, triples, networks: NETWORKS, pending, hasFile: true,
  };
}
