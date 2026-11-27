# Submission refresh: tagline, video plan, YouTube text (before Dec 11, 2026)

Every number here comes from the committed repo: [eval/results.md](../eval/results.md) and `npm run tour` ([graph/tour.cypher](../graph/tour.cypher)). Do not round them up.

## 1. Devpost tagline (elevator pitch, max 200 characters)

**Recommended (168 characters):**
> Test your pitch on a panel of persona brains that predict before you answer: 72% of held-out answers right vs 56% baseline, 44 of 44 citations backed, one Relate graph.

Alternatives:
- (169) Build brains of people by talking, make them predict before you answer, then ask them all at once. 72% of held-out answers right vs 56% baseline; 44/44 citations backed.
- (166) Persona brains that predict before you answer. Built from a person's own words, tested against majority, crowd and stereotype baselines, asked all at once, in one Relate graph.

Why: the strongest entries all put one hard number against a baseline in the tagline (Crosswalk 19/20 vs 9/20, Precedent 64% vs 4%). 72% vs 56% is the hybrid predictor over all 77 held-out answers. "44 of 44 backed" is the most robust number: it does not depend on sample size. Do not claim more than the baseline: a role name alone scores 77% on these scripted brains (README Results).

**One line on how we differ from the closest entry (BEZEN on Relate)**, for the Devpost story:
> Not classification of messages someone already wrote: a sealed prediction made before they answer. Not one person: a whole panel, with a synthesis of where they agree and clash.

## 2. Video plan (target 1:50, hard limit 2:00)

Pattern copied from the strongest videos: **hook → one moment where the answer flips → a hard number against a baseline**. TRIBE v2 gets under 10 seconds.

| time | scene | on screen | narration |
|---|---|---|---|
| 0:00–0:07 | **Hook** (title card) | "You pitched. The CFO said no. You could have known." | "You pitch to a CFO and an investor. They say no. What if you could have asked them first?" |
| 0:07–0:24 | **Build** (existing `build` recording) | Talk as the CFO; beliefs appear with their exact quotes | "Build a brain by talking as that person. Every belief keeps the exact words behind it." |
| 0:24–0:38 | **Sealed prediction** (existing `quiz`) | The prediction is locked, then the answer, then ✓ | "Before I answer, the brain locks in a prediction. It is stored in the graph first, so it can't cheat." |
| 0:38–0:56 | **The flip, part 1: Ledgerly v1** (existing `matrix`) | Jargon and "we are raising one million dollars" put off the CFO and the investor | "Here is my first pitch. The jargon and the funding ask put off the CFO and the investor." |
| 0:56–1:12 | **The flip, part 2: Ledgerly v2** (**new recording**: matrix of v2) + 6 s of the TRIBE card | "Our first 200 freelancers saved four hours a month" lands with all four brains | "Version two says what changed for one real user. Now every brain agrees, and Meta's TRIBE v2 shows that line lifting attention." |
| 1:12–1:28 | **Ask them all** (existing `live`) | Four answers in four voices, then the synthesis | "Ask every brain at once. Each answers in its own voice, citing its own beliefs, then a synthesis finds the joint solution." |
| 1:28–1:43 | **The numbers** (new card) | Eval table (hybrid): CFO 91% vs 73%, investor 80% vs 61%, freelancer 67% vs 64%, student 59% vs 33%; "44 of 44 citations backed"; "15 tests · CI green" | "Measured, not claimed. Every brain beats always guessing its most common answer, and every citation is backed by that brain's own belief." |
| 1:43–1:52 | **Outro** (graph + card) | One Relate file · `npm run tour` | "All of it lives in one Relate graph. Clone it and run the tour. BrainPrint: ask the room before you ask the world." |

Honesty notes for the narration:
- Say "beats always guessing its most common answer" (the majority baseline). Do **not** say "beats the crowd": the investor and freelancer brains don't.
- Do not call the example brains real people.

Work needed:
- Reuse 5 existing recordings (`build`, `quiz`, `matrix`, `live`, `brainwave`).
- New: a v2 matrix recording, a hook card and a numbers card (same `edit.mjs` pipeline, new `video/script_v3.json`).

## 3. YouTube title, chapters and description

**Title:** BrainPrint: persona brains that predict before you answer (Relate by Neo4j hackathon)

**Description:**
```
Build "brains" of different people by talking as them. Each brain locks in a prediction before you answer, so its accuracy is measured honestly, then you ask the whole panel your pitch at once.

0:00 The problem: you find out too late
0:06 Relate graph: beliefs with their exact words
0:19 Functionality: sealed predictions
0:29 Usefulness: a pitch that flips from no to yes
0:57 Average brain response (TRIBE v2)
1:03 Ask every brain at once
1:15 Measured: accuracy vs baseline, 44/44 citations backed
1:31 One Relate graph you can clone and query

Numbers: 72% of 77 held-out answers predicted right vs 56% always-guess baseline. On these scripted example brains a role name alone scores 77%, so the real test is brains of real people. Full table: eval/results.md in the repo.
Code: https://github.com/shubham123sing/brainprint
Showcase: https://shubham123sing.github.io/brainprint/
Built with Relate (single-file graph), Groq, MiniLM, Meta TRIBE v2, Wikidata. Example brains are built from scripted answers, not real people.
```
The chapter times match the final cut: `video/out/brainprint_demo_v3.mp4` (1:39), made with `node edit.mjs script_v3.json`.
