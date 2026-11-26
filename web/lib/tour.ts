// Parses graph/tour.cypher (the judge tour) into named queries. Pure: used by scripts/tour.ts and the tests.
import fs from "node:fs";
import path from "node:path";

export type TourQuery = { name: string; hops: string; expect: string; cypher: string };

export const TOUR_FILE = path.resolve(process.cwd(), "..", "graph", "tour.cypher");

export function parseTour(text: string): TourQuery[] {
  return text.split(/^\/\/ name:/m).slice(1).map((block) => {
    const lines = block.split(/\r?\n/);
    const name = lines[0].trim();
    const meta = (k: string) => lines.find((l) => l.startsWith(`// ${k}:`))?.slice(k.length + 4).trim() ?? "";
    const cypher = lines.slice(1).filter((l) => !l.startsWith("//")).join("\n").trim().replace(/;\s*$/, "");
    return { name, hops: meta("hops"), expect: meta("expect"), cypher };
  });
}

export function loadTour(file = TOUR_FILE): TourQuery[] {
  return parseTour(fs.readFileSync(file, "utf8"));
}
