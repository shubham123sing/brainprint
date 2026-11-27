# Devpost submission text (copy into the form)

## About the project (Markdown)

````markdown
## Inspiration
Every idea eventually meets a room full of different people: a skeptical CFO, a cautious investor, a busy freelancer, a student counting every rupee. They all react differently, and you usually find out too late. We wanted to **ask that room before we ask the world**: build a "brain" for each kind of person, put a problem or a pitch in front of all of them at once, and see where they agree, where they clash, and what would work for everyone.

BrainPrint started as a pitch timeline built on Meta's TRIBE v2 brain-response model. We learned that a single "average brain" can't tell you how *different* people react, so we rebuilt it around persona brains, and brought TRIBE back as a second view of the same pitch.

## What it does
- **Build a brain by talking.** You chat as the person. Each message becomes beliefs, and every belief keeps the **exact words** that support it. If the model can't quote it, the belief is dropped. The brain also learns how the person talks (tone, vocabulary, signature phrases).
- **Sealed predictions.** In Quiz mode the brain **commits to a prediction before you answer**. The prediction is stored in the graph first, then scored when your answer comes in, so it cannot cheat. It does not classify what someone already wrote: it predicts what they will say.
- **Ask the panel.** One question goes to every brain. Each answers **in its own voice**, lists concerns and what it would do, and cites the beliefs it relied on. A synthesis then shows **where they agree, where they clash, and a joint solution**.
- **Test a pitch point by point.** A matrix predicts whether each sentence lands with each brain. Click a cell to see why, and teach the brain if it's wrong. In our Ledgerly example, version 1's jargon and funding ask put off the CFO and the investor. Version 2 names one real result ("our first 200 freelancers saved four hours a month"), and that point lands with all four brains.
- **Average brain response (TRIBE v2).** Meta's TRIBE v2 predicts, second by second, how an average brain responds to hearing the pitch. BrainPrint links each sentence to the same point the personas reacted to, so one graph holds both views.
- **World knowledge.** Concepts are linked to Wikidata and Wikipedia, so questions connect to each other through shared classes.

## Measured, not claimed
`npm run eval` runs seeded cross-validation (3 seeds × 4 folds). The app's **hybrid** predictor starts from the brain's role ("Skeptical CFO") and lets the brain's own answers, retrieved from the graph, override it. It is compared with baselines that never see the held-out answers: the training **majority**, the **crowd** (what the other brains said), and the same LLM told only the **role name**.

| brain | hybrid (app) | 95% CI | majority | crowd | evidence only | role name only | answers |
|---|---|---|---|---|---|---|---|
| Skeptical CFO | **91%** | 62–98% | 73% | 73% | 97% | 82% | 11 |
| Cautious investor | **80%** | 58–90% | 61% | 70% | 67% | 83% | 23 |
| Busy freelancer | **67%** | 47–84% | 64% | 68% | 65% | 82% | 22 |
| Budget-conscious student | **59%** | 37–76% | 33% | 48% | 52% | 62% | 21 |
| **all 77 answers** | **72%** | | 56% | 64% | 67% | 77% | 77 |

- Every brain beats always guessing its most common answer, and three of four beat the crowd. The hybrid beat our first, evidence-only design by 5 points.
- **The honest part:** on these brains the role name alone does as well (77%). Our investor and freelancer brains were scripted from the stereotype, so a stereotype predicts them. A brain earns its keep only where a person differs from their stereotype, so the next step is brains of real people. We publish all of it, with every prediction in `eval/results.json`.
- **Citation audit:** all 44 panel citations are backed by the citing brain's own belief (0 unbacked).
- **15 key-free tests** (no leakage, verbatim quotes, citation audit, seeded cross-validation) run in CI on Ubuntu and Windows.

## For judges: try it in 60 seconds
No API key needed. Every command runs on a temporary copy of the graph.
```
git clone https://github.com/shubham123sing/brainprint && cd brainprint/web
npm install
npm run tour    # 6 multi-hop Cypher questions with their real answers
npm test        # 15 tests
npm run dev     # the app at http://localhost:3000
```

## How we built it
**Relate is the whole memory.** A brain *is* a graph and a panel *is* a query across graphs, so everything lives in one embedded, single-file Relate store (`graph/brainprint.rl`), opened in-process from the Next.js server with `@relate/relate`.

- **Beliefs:** `(:Brain)-[:STANCE {value, quote}]->(:Claim)-[:MENTIONS]->(:Concept)`. A **vector index** (`claim_embedding`, 384-d local MiniLM embeddings) lets a new belief reuse an existing claim when it means the same thing. That is how different brains connect through shared beliefs.
- **GraphRAG answers:** `SEARCH … VECTOR INDEX … SCORE AS` finds the claims closest to a question. We keep only those *this* brain holds a stance on, add its quotes, concept profile and style, and let the LLM speak from that evidence only.
- **Predictions:** link prediction on `(:Brain)-[:STANCE]->(:Claim)` from the vector index plus concept paths. The predictor sees only the brain's answers, never the trainer's description of it.
- **TRIBE v2:** runs on a Colab T4. Its 20,484-vertex predictions are grouped into 7 networks with the Destrieux atlas and z-scored within each text. Each sentence is aligned to its seconds and linked to the idea's points: `(:Idea)-[:SCANNED_AS]->(:Scan)-[:HAS_MOMENT]->(:Moment)-[:ABOUT]->(:Claim)<-[:PREDICTS]-(:Brain)`.
- **Judge tour:** `graph/tour.cypher` holds 6 multi-hop questions, for example the shortest belief path between two brains (`SHORTEST 1`), and which pitch sentence lights up an average brain while putting off which personas.
- **Cypher used:** `MERGE`/`UNWIND` batch upserts, `CALL (x) {…}` subqueries, `COUNT {…}`, `EXISTS {…}`, `SHORTEST`, quantified paths, constraints and explicit transactions.
- **MCP:** the Relate CLI's read-only MCP server exposes the same file to any MCP host.
- **Stack:** Next.js 15, React 19, TypeScript, Groq `gpt-oss-120b` (falls back to `gpt-oss-20b` when the free daily quota runs out), MiniLM embeddings run locally, Wikidata, and TRIBE v2 (PyTorch, nilearn) on Colab. Tests use `node:test`. The demo video was recorded with Playwright, narrated with a local Piper voice, and edited with ffmpeg, all scripted in the repo.

## Challenges we ran into
- **One writer per file.** A Relate `.rl` store allows one writer, and the Node client has no `close()`. We keep a single handle per server process; tests, the eval and the tour each work on a temporary copy.
- **Stance polarity.** At first every concept scored +1, because the model phrased beliefs in the person's own direction. We made it phrase every belief *favourably* and store the person's direction separately.
- **Honest accuracy.** Our first numbers came from one unseeded run with a baseline computed on all answers. We rebuilt the evaluation: seeded splits, baselines from the training folds only, a crowd baseline, confidence intervals, and tests that pin "no leakage". Then we added the hardest baseline we could think of, the role name alone, and it matched us on our scripted brains. That pushed us to a hybrid predictor (+5 points) and to say plainly what still needs real people. Some numbers went down, and we kept them.
- **Similar is not the same.** Sentences that sound alike often carry opposite stances ("AI makes me interested" vs "AI is hype"). Similarity-only prediction was worse than guessing, so the graph chooses *which* answers the LLM sees, without stance hints.
- **TRIBE v2 access and setup.** It needs gated Llama 3.2 3B weights, and our first access request was denied. On Colab, installing TRIBE changed torch and broke torchaudio, so the notebook now reinstalls the matching version.
- **Free tier limits.** Groq's daily and per-minute quotas are handled by an automatic model fallback and retries, and every answer shows which model wrote it.

## Accomplishments that we're proud of
- Brains you can **build in a minute just by talking**, where every belief is backed by a verbatim quote.
- **Sealed predictions** and a published evaluation that includes a baseline that matches us.
- One Relate graph joins **persona reactions, an average-brain response and world knowledge** for the same sentence, and anyone can query it with the tour.

## What we learned
- Graphs make AI answers checkable: every answer cites beliefs, and every belief cites the person's own words.
- A model of a mindset is only useful if you measure it against a baseline that is hard to beat. The crowd is one; a stereotype (the role name alone) is a harder one, and it showed us that scripted brains prove little.
- An "average brain" and a "kind of person" answer different questions. Showing both side by side is more useful than either alone.

## What's next
- Build brains from real people, with consent, and report talk-to-quiz accuracy on many more answers.
- Run TRIBE on audio and video pitches, not only text.
- Compare pitch versions automatically: which edit made which persona switch sides?

**Honest scope:** brains are models of the words they were given, not real people or a market. The example brains were built from scripted answers. TRIBE v2 predicts an average subject's fMRI-like response, and the 7-network grouping is ours.
````

## Built with (tags)
relate, neo4j, cypher, graphrag, vector-search, next.js, react, typescript, node.js, groq, gpt-oss, hugging-face, transformers.js, minilm, tribe-v2, pytorch, python, google-colab, nilearn, wikidata, wikipedia, mcp, d3.js, playwright, ffmpeg

## "Try it out" links
- Code: https://github.com/shubham123sing/brainprint
- Showcase: https://shubham123sing.github.io/brainprint/

## Image gallery (in this order)
`video/out/gallery/`: 01_thumbnail.png, 02_panel_answers.png, 03_synthesis.png, 04_talk_beliefs.png, 05_quiz_reveal.png, 06_point_matrix.png, 07_tribe_heatmap.png, 08_tribe_sentences.png, 09_graph.png

## Video demo link
Upload `video/out/brainprint_demo_v3.mp4` (1:39) to YouTube as Public and paste the link; title and description are in docs/SUBMISSION_REFRESH.md. Devpost only embeds YouTube, Vimeo or Youku links.
