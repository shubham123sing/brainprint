// Small, pure statistics helpers for evaluating brains (no graph, no LLM): seeded shuffles, baselines,
// confidence intervals and agreement beyond chance. Used by crossValidate (lib/brains.ts), scripts/eval.ts and the tests.

/** Deterministic PRNG (mulberry32): the same seed always gives the same sequence. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Unbiased Fisher-Yates shuffle with a seed. Returns a new array. */
export function shuffle<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  const r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Most common value; ties go to the first of `order` (default agree, neutral, disagree). */
export function majority(values: readonly number[], order: readonly number[] = [1, 0, -1]): number {
  let best = order[0], bestN = -1;
  for (const v of order) {
    const n = values.filter((x) => x === v).length;
    if (n > bestN) { best = v; bestN = n; }
  }
  return best;
}

/** Wilson score 95% interval for k successes out of n. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n, z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Cohen's kappa between predicted and actual labels: 0 = no better than chance agreement, 1 = perfect. */
export function kappa(pred: readonly number[], actual: readonly number[]): number {
  const n = pred.length;
  if (!n) return 0;
  const labels = [...new Set([...pred, ...actual])];
  const po = pred.filter((p, i) => p === actual[i]).length / n;
  const pe = labels.reduce((s, l) => s + (pred.filter((p) => p === l).length / n) * (actual.filter((a) => a === l).length / n), 0);
  return pe === 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe);
}

/** Exact two-sided McNemar test on paired hits (a vs b). Returns the p-value. */
export function mcnemar(a: readonly boolean[], b: readonly boolean[]): number {
  let onlyA = 0, onlyB = 0;
  a.forEach((x, i) => { if (x && !b[i]) onlyA++; else if (!x && b[i]) onlyB++; });
  const n = onlyA + onlyB;
  if (!n) return 1;
  const k = Math.min(onlyA, onlyB);
  let p = 0;
  for (let i = 0; i <= k; i++) p += binom(n, i) * 0.5 ** n;
  return Math.min(1, 2 * p);
}

function binom(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
