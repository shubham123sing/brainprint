# Devpost submission text (copy into the form)

## About the project (Markdown)

```markdown
## Inspiration
Every idea eventually meets a room full of different people: a skeptical CFO, a cautious investor, a busy freelancer, a student counting every rupee. They all react differently, and you usually find out too late. We wanted to **ask that room before we ask the world**: build a "brain" for each kind of person, put a problem or a pitch in front of all of them at once, and see where they agree, where they clash, and what would work for everyone.

BrainPrint started as a pitch timeline built on Meta's TRIBE v2 brain-response model. We learned that a single "average brain" can't tell you how *different* people react, so we rebuilt it around persona brains, and brought TRIBE back as a second view of the same pitch.

## What it does
- **Build a brain by talking.** You chat as the person. Each message becomes beliefs, and every belief keeps the **exact words** that support it. If the model can't quote it, the belief is dropped. The brain also learns how the person talks (tone, vocabulary, signature phrases).
- **Test it before you trust it.** In Quiz mode the brain **locks in a prediction before you answer**, so accuracy is measured honestly. `npm run eval` runs seeded cross-validation (3 seeds × 4 folds) against two baselines that never see the held-out answers: the training majority and the "crowd" (what the other brains said):

| brain | cross-validation | 95% CI | majority | crowd | answers |
|---|---|---|---|---|---|
| Skeptical CFO | 97% | 74–100% | 73% | 73% | 11 |
| Cautious investor | 67% | 45–81% | 61% | 70% | 23 |
| Busy freelancer | 65% | 43–80% | 64% | 68% | 22 |
| Budget-conscious student | 52% | 32–72% | 33% | 48% | 21 |

  Samples are small, so the intervals are wide, and we say so. All predictions are committed in `eval/results.json`, and 15 key-free tests (no leakage, verbatim quotes, citation audit) run in CI.

- **Ask the panel.** One question goes to every brain. Each answers **in its own voice**, lists concerns and what it would do, and shows the beliefs it relied on. A synthesis then shows **where they agree, where they clash, and a joint solution**.
- **Test a pitch point by point.** A matrix predicts whether each sentence of a pitch lands with each brain. Click a cell to see why, and teach the brain if it's wrong.
- **Average brain response (TRIBE v2).** Meta's TRIBE v2 predicts, second by second, how an average brain responds to hearing the pitch. BrainPrint lines it up sentence by sentence with the persona reactions. In our revised Ledgerly pitch, "our first 200 freelancers saved four hours a month" lifts attention and language above the pitch's own average, and every persona agrees with it. The funding line raises the default-mode network and puts off two brains.
- **World knowledge.** Concepts are linked to Wikidata and Wikipedia, so questions connect to each other through shared classes.

## How we built it
**Relate is the whole memory.** A brain *is* a graph and a panel *is* a query across graphs, so everything lives in one embedded, single-file Relate store (`graph/brainprint.rl`), opened in-process from the Next.js server with `@relate/relate`.

- **Beliefs:** `(:Brain)-[:STANCE {value, quote}]->(:Claim)-[:MENTIONS]->(:Concept)`. A **vector index** (`claim_embedding`, 384-d local MiniLM embeddings) lets a new belief reuse an existing claim when it means the same thing. That is how different brains connect through shared beliefs.
- **GraphRAG answers:** `SEARCH … VECTOR INDEX … SCORE AS` finds the claims closest to a question. We keep only those *this* brain holds a stance on, add its quotes, concept profile and style, and let the LLM speak from that evidence only.
- **Predictions:** link prediction on `(:Brain)-[:STANCE]->(:Claim)` from the vector index plus concept paths.
- **TRIBE v2:** runs on a Colab T4. Its 20,484-vertex predictions are grouped into 7 networks with the Destrieux atlas and z-scored within each text. Each sentence is aligned to its seconds and linked to the idea's points, giving `(:Idea)-[:SCANNED_AS]->(:Scan)-[:HAS_MOMENT]->(:Moment)-[:ABOUT]->(:Claim)<-[:PREDICTS]-(:Brain)`. One query joins the average-brain response with what each persona thinks.
- **Cypher used:** `MERGE`/`UNWIND` batch upserts, `CALL (x) {…}` subqueries, `COUNT {…}`, `EXISTS {…}`, `UNION ALL` projections, constraints and explicit transactions.
- **MCP:** the Relate CLI's read-only MCP server exposes the same file to any MCP host.
- **Stack:** Next.js 15, React 19, TypeScript, Groq `gpt-oss-120b` (falls back to `gpt-oss-20b` when the free daily quota runs out), MiniLM embeddings run locally, Wikidata, and TRIBE v2 (PyTorch, nilearn) on Colab. The demo video was recorded with Playwright, narrated with a local Piper voice, and edited with ffmpeg, all scripted in the repo.

## Challenges we ran into
- **One writer per file.** A Relate `.rl` store allows one writer, and the Node client has no `close()`. We keep a single handle per server process and made the MCP server opt-in, because it also takes a lock.
- **Stance polarity.** At first every concept scored +1, because the model phrased beliefs in the person's own direction. We made it phrase every belief *favourably* and store the person's direction separately.
- **Honest accuracy.** Giving the predictor per-target hints *lowered* cross-validation accuracy, so we removed them. Long claim IDs were mangled by the LLM, so we switched to short keys.
- **TRIBE v2 access and setup.** It needs gated Llama 3.2 3B weights, and our first access request was denied. On Colab, installing TRIBE changed torch and broke torchaudio, so the notebook now reinstalls the matching version.
- **Linking sentences to points.** One point was linked to two sentences, so we switched to best-first, one-to-one matching.
- **Free tier limits.** Groq's daily quota is handled by an automatic model fallback, and every answer shows which model wrote it.

## Accomplishments that we're proud of
- Brains you can **build in a minute just by talking**, where every belief is backed by a verbatim quote.
- **Measured, not claimed:** every brain shows its accuracy against a baseline, including the ones that don't beat it.
- One Relate graph joins **persona reactions, an average-brain response and world knowledge** for the same sentence.

## What we learned
- Graphs make AI answers checkable: every answer cites beliefs, and every belief cites the person's own words.
- A small model of a mindset is only useful if you measure it, so we measure every brain against a baseline.
- An "average brain" and a "kind of person" answer different questions. Showing both side by side is more useful than either alone.

## What's next
- Build brains from real interviews and surveys, with consent, and track their accuracy over time.
- Run TRIBE on audio and video pitches, not only text.
- Compare pitch versions automatically: which edit made which persona switch sides?

**Honest scope:** brains are models of the words they were given, not real people or a market. TRIBE v2 predicts an average subject's fMRI-like response, and the 7-network grouping is ours.
```

## Built with (tags)
relate, neo4j, cypher, graphrag, vector-search, next.js, react, typescript, node.js, groq, gpt-oss, hugging-face, transformers.js, minilm, tribe-v2, pytorch, python, google-colab, nilearn, wikidata, wikipedia, mcp, d3.js, playwright, ffmpeg

## "Try it out" links
- Code: https://github.com/shubham123sing/brainprint

## Image gallery (in this order)
`video/out/gallery/`: 01_thumbnail.png, 02_panel_answers.png, 03_synthesis.png, 04_talk_beliefs.png, 05_quiz_reveal.png, 06_point_matrix.png, 07_tribe_heatmap.png, 08_tribe_sentences.png, 09_graph.png

## Video demo link
Upload `video/out/brainprint_demo.mp4` to YouTube (Unlisted or Public) or Vimeo and paste the link. Devpost only embeds YouTube, Vimeo or Youku links.
