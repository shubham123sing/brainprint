# BrainPrint evaluation results

Generated 2026-11-26 by `npm run eval` (web/scripts/eval.ts) on a copy of `graph/brainprint.rl`. 3 seed(s) of 4-fold cross-validation; LLM: openai/gpt-oss-120b.

- **Accuracy** = share of held-out answers predicted exactly (agree / neutral / disagree). Range over seeds in brackets.
- **CI** = Wilson 95% interval. **κ** = Cohen's kappa (0 = no better than chance agreement). **p** = exact McNemar test against the majority baseline (seed 1).
- **Majority baseline** = always predict the most common answer of the training folds. **Crowd baseline** = predict what the other brains answered.
- The trainer's description of a brain is not shown to the predictor; it sees only the brain's answers (pinned by a test).

## Cross-validation

| Brain | Built from | n | LLM + graph retrieval | Graph only (no LLM) | Majority | Crowd |
|---|---|---|---|---|---|---|
| Budget-conscious student | 14 answer, 7 talk | 21 | **52%** (43%–57%) · CI 32%–72% · κ 0.266 · p 0.688 | **29%** · CI 14%–50% · κ -0.094 · p 1 | 33% | 48% |
| Busy freelancer (example) | 22 example | 22 | **65%** (59%–73%) · CI 43%–80% · κ 0.417 · p 1 | **56%** (46%–68%) · CI 35%–73% · κ -0.067 · p 1 | 64% | 68% |
| Cautious investor (example) | 1 answer, 22 example | 23 | **67%** (52%–74%) · CI 45%–81% · κ 0.451 · p 0.754 · 91% by LLM (rest: graph fallback after rate limits) | **55%** (44%–65%) · CI 37%–74% · κ 0.048 · p 1 | 61% | 70% |
| Skeptical CFO (example) | 11 talk | 11 | **97%** (91%–100%) · CI 74%–100% · κ 0.921 · p 0.5 · 94% by LLM (rest: graph fallback after rate limits) | **61%** (46%–73%) · CI 35%–85% · κ -0.117 · p 1 | 73% | 73% |

## Talk → Quiz transfer

Learn only from what the person said in Talk mode, then predict every answer they later gave in Quiz mode.

| Brain | Talk beliefs | Quiz answers predicted | Accuracy | CI | Majority | Crowd | By |
|---|---|---|---|---|---|---|---|
| Budget-conscious student | 7 | 14 | **7/14 (50%)** | 27%–73% | 36% | 57% | groq:openai/gpt-oss-120b |

## Sealed predictions (Quiz)

Each prediction was stored in the graph as a pending Check before the question was shown, then scored when the answer came in.

| Brain | Checks | Correct | CI |
|---|---|---|---|
| Budget-conscious student | 14 | 7 (50%) | 27%–73% |
| Cautious investor (example) | 1 | 1 (100%) | 21%–100% |

## Honest reading

- Samples are small (11–23 answers per brain), so the intervals are wide: a difference of 10 points is not significant here.
- The investor and freelancer brains were built from answers scripted by the authors, not from real people.
- Per-claim predictions are in `results.json`, so every number above can be recomputed.
