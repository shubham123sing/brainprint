// Judge tour: runs every query in graph/tour.cypher on a temporary copy of graph/brainprint.rl and prints the rows.
//   cd web && npm run tour             (no API key, no network, the committed graph is not touched)
//   npm run tour -- --markdown         (Markdown tables, used for the CI run summary)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MD = process.argv.includes("--markdown");
const ROOT = path.resolve(process.cwd(), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brainprint-tour-"));
const COPY = path.join(tmp, "brainprint.rl");
fs.copyFileSync(path.join(ROOT, "graph", "brainprint.rl"), COPY);
process.env.BRAINPRINT_DB = COPY; // must be set before lib/relate is imported

const show = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(show).join(", ")}]` : typeof v === "number" ? String(Math.round(v * 100) / 100) : v == null ? "–" : String(v);

async function main() {
  const { connection } = await import("@/lib/relate");
  const { loadTour } = await import("@/lib/tour");
  const conn = connection();
  for (const t of loadTour()) {
    const rows = conn.query(t.cypher).rows as Record<string, unknown>[];
    const cols = rows.length ? Object.keys(rows[0]) : [];
    if (MD) {
      console.log(`\n#### ${t.name}\n`);
      if (t.hops) console.log(`_${t.hops}_\n`);
      console.log(`| ${cols.join(" | ")} |\n|${cols.map(() => "---").join("|")}|`);
      for (const r of rows) console.log(`| ${cols.map((c) => show(r[c]).replace(/\|/g, "\\|")).join(" | ")} |`);
    } else {
      console.log(`\n== ${t.name}${t.hops ? `\n   (${t.hops})` : ""}`);
      for (const r of rows) console.log("   " + cols.map((c) => `${c}: ${show(r[c])}`).join("  ·  "));
      if (!rows.length) console.log("   (no rows)");
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0); // the Relate handle has no close()
}

main().catch((e) => { console.error(e); process.exit(1); });
