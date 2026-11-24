# BrainPrint 🧠

**Build "brains" of different kinds of people by talking to them, then put any problem or idea in front of all of them at once.**

1. **Talk:** chat naturally as a persona (a skeptical CFO, a busy freelancer, yourself) or paste what they wrote. BrainPrint turns each message into **beliefs** (with the exact words that support them) and a profile of **how that person talks**, stored as a subgraph in a Relate knowledge graph.
2. **Quiz:** the brain **predicts your answer before you give it**, so every brain carries an honestly measured accuracy (self-test and cross-validation against a baseline).
3. **Panel:** describe a problem or paste an idea. **Every brain answers in its own voice**: its reaction, what it would say, its concerns, and how it would solve the problem, citing the beliefs it relied on. A synthesis then shows **where the brains agree, where they clash, and a joint solution** that covers everyone's concerns.

Everything (brains, beliefs, quotes, styles, questions, responses, concepts, Wikidata links) lives in **one Relate graph file**, [`graph/brainprint.rl`](graph/brainprint.rl), committed to this repo.

> Built for the **Relate by Neo4j Hackathon**, theme *"Context, connected"*. Demo video script: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

> ⚠️ **What a brain is, and is not:** a model of **the answers and words its trainer gave**, shown with its measured accuracy. It is not a real person, a customer survey, or a market forecast. The three example brains were built from scripted answers and messages, and are labelled as examples everywhere.

---

## Use case
Before you launch an idea, ask a question, or write a pitch, you want to know how *different* people will react: the skeptical CFO, the budget student, the cautious investor. Real panels are slow and expensive, and a generic chatbot persona has no memory, no evidence and no measured accuracy.

BrainPrint builds each persona from that person's own words and checks how well it predicts them. It then asks all the personas at once. The relationships are the product:
- **brain → belief → exact quote:** every opinion can be traced back to the words that support it;
- **beliefs shared across brains:** two brains that hold the same claim point to the same `Claim` node, so agreement and conflict are graph patterns, not text matching;
- **claim → concept → Wikidata:** questions and brains meet through shared concepts and world knowledge;
- **answer → cited beliefs → brain:** every panel answer shows which beliefs it used, so it can be checked;
- **pitch sentence → average brain response (TRIBE v2) → persona predictions:** what a typical brain reacts to, joined with what each persona thinks of the same point.

## How it uses Relate
- **Mode:** single file (`graph/brainprint.rl`), embedded in the Next.js server through `@relate/relate`.
- **Why this mode:**
  - **No database server.** `npm run dev` is the whole setup, so judges and users get the full graph with one clone.
  - **The data ships with the code.** The example brains, their checks, the stored panel answers, Wikidata links and TRIBE v2 results are all in the committed file, so the app is useful without an API key.
  - **Portable.** One file to copy, back up or reset. The same file also opens in the Relate CLI's MCP server, so any MCP host can query it.
  - **Persistent.** In-memory mode would lose every brain on restart. A directory store adds nothing for a single-process app of this size.
  - **Trade-off we accepted:** only one process may write the file at a time (see [docs/RELATE_NOTES.md](docs/RELATE_NOTES.md)).
- **What the graph models:**

  | nodes | key relationships |
  |---|---|
  | `Brain`, `Utterance`, `Claim`, `Concept` | `(:Brain)-[:SAID]->(:Utterance)-[:SUPPORTS]->(:Claim)`, `(:Brain)-[:STANCE {value, note: quote}]->(:Claim)-[:MENTIONS]->(:Concept)` |
  | `Check` | `(:Check)-[:OF]->(:Brain)`, `(:Check)-[:ON]->(:Claim)` (Quiz predictions and answers) |
  | `Idea`, `Response`, `Synthesis` | `(:Idea)-[:HAS_CLAIM]->(:Claim)`, `(:Brain)-[:PREDICTS]->(:Claim)`, `(:Response)-[:BY]->(:Brain)`, `-[:TO]->(:Idea)`, `-[:CITES]->(:Claim)`, `(:Synthesis)-[:OF]->(:Idea)` |
  | `WikiEntity`, `Source` | `(:Concept)-[:SAME_AS]->(:WikiEntity)-[:INSTANCE_OF\|SUBCLASS_OF]->(:WikiEntity)`, `(:Source)-[:EVIDENCE]->(:Claim)` |
  | `Scan`, `Moment`, `Network` | `(:Idea)-[:SCANNED_AS]->(:Scan)-[:HAS_MOMENT]->(:Moment)-[:ABOUT]->(:Claim)`, `(:Moment)-[:ACTIVATES {z}]->(:Network)` |

  A 384-d **vector index** `claim_embedding` on `Claim` finds the beliefs relevant to any question.

## Setup and run
Needs **Node 18+** only; the graph is already in the repo. Prebuilt Relate binaries ship for Windows x64, Linux x64/arm64 and macOS.
```bash
git clone https://github.com/shubham123sing/brainprint && cd brainprint/web
npm install
npm run dev        # → http://localhost:3000  (Brain Panel · Brain Library)
```
- **No key needed to look around:** the example brains, the stored panel answers and everything in the graph show without an API key.
- **To talk to brains and ask new questions:** copy `web/.env.example` to `web/.env.local`, add a **free** `GROQ_API_KEY` (console.groq.com, no card needed), and restart. Without a key, brains answer graph-only: a plain summary of their closest beliefs instead of a voice.
- **First run:** the app downloads a 23 MB sentence-embedding model (MiniLM, runs on the CPU).
- **First result:** open http://localhost:3000, pick a stored question in the Brain Panel, and you see every brain's answer, the synthesis, and the graph view. Then open `/brains` to see each brain's beliefs, quotes and measured accuracy.

## Where the data lives
**[`graph/brainprint.rl`](graph/brainprint.rl)**: one Relate single-file store, committed to this repo. The app opens it on start (path set in [`web/lib/relate.ts`](web/lib/relate.ts)). TRIBE v2 result files are in [`brainwave/results/`](brainwave/results/) and are imported into the same graph.

## Why Relate
A brain *is* a graph, and a panel *is* a query across graphs. Each thing the app does is one connected question:

| what the app does | what it asks the graph |
|---|---|
| **Learn from a message** | Store `(:Brain)-[:SAID]->(:Utterance)-[:SUPPORTS]->(:Claim)` and `(:Brain)-[:STANCE {value, note: quote}]->(:Claim)-[:MENTIONS]->(:Concept)`. If a new belief means the same as an existing claim (vector index, cosine ≥ 0.86), **reuse that claim**. That is how two brains end up connected through the same belief. |
| **Answer as a brain** | Vector-search the question against `claim_embedding`, keep only claims *this* brain holds a `STANCE` on, plus its quotes, concept profile and style. That evidence is what the LLM speaks from (GraphRAG). |
| **Predict a stance** (Quiz, point-by-point) | Link prediction `(:Brain)-[:STANCE]->(:Claim)`: the brain's most relevant answered claims (vector index) and concept paths `(target)-[:MENTIONS]->(:Concept)<-[:MENTIONS]-(answered)<-[:STANCE]-(brain)`. |
| **Synthesise the panel** | `(:Response)-[:BY]->(:Brain)`, `-[:TO]->(:Idea)`, `-[:CITES]->(:Claim)`, compared across brains. |
| **Connect to world knowledge** | `(:Concept)-[:SAME_AS]->(:WikiEntity)-[:INSTANCE_OF\|SUBCLASS_OF]->(:WikiEntity)`. Brains and questions meet through shared Wikidata classes. |

**How BrainPrint uses Relate**
- **Mode:** a **single-file** store, embedded in the Next.js server through `@relate/relate` (Node), with no database server. The file is portable and committed. Optionally, the Relate CLI's **MCP server** exposes the same file to any MCP host ([below](#using-the-graph-from-any-mcp-host)).
- **Cypher features:** `MERGE` / `UNWIND` batch upserts, `CALL (x) { … }` per-row subqueries, `COUNT { … }`, `EXISTS { … }`, `UNION ALL` graph projections, uniqueness constraints, and explicit transactions (`begin` / `commit` / `rollback`) with `checkpoint()`.
- **Vector search:** a **vector index** `claim_embedding` (384-d), queried with the `SEARCH … VECTOR INDEX … SCORE AS` clause, both per row and from a parameter vector.
- **What we learned about Relate 1.2:** documented, with workarounds, in [docs/RELATE_NOTES.md](docs/RELATE_NOTES.md):
  - **Locking:** a `.rl` writer is exclusive.
  - **Node handles:** the Node client has no `close()`.
  - **Vector filters:** `SEARCH … WHERE` allows equality only.
  - **Lock errors in Node** surface as a generic `internal error`.

## How it works
```
 you ── Talk ──► LLM extracts beliefs + verbatim quotes + style ──► (:Brain)-[:STANCE]->(:Claim) ... in Relate
     ── Quiz ──► brain commits to a prediction (pending :Check) ──► you answer ──► accuracy
     ── Panel ─► (:Idea) question ──► per brain: graph retrieval (vector index + stances + quotes + style)
                                     ──► LLM answers in that brain's voice, citing beliefs ──► (:Response)
                                     ──► synthesis: agree / clash / joint solution ──► (:Synthesis)
 free services: Groq gpt-oss (falls back from 120b to 20b when the daily quota runs out) · MiniLM embeddings (local)
                Wikidata + Wikipedia (concept linking)
```

## Brain Library (`/brains`)
- **Create** a brain with a name and a one-line description.
- **Talk mode:** each message (up to 4,000 characters, so you can paste emails or posts) becomes up to 6 beliefs.
  - **Phrasing rule:** each belief is phrased favourably toward its topic, with the person's direction in the stance. So "agree" always means positive about the topic, and the "what this brain cares about" bars mean something.
  - **Verbatim quotes:** every belief needs a quote that literally appears in the message, or it is dropped.
  - **Talking style:** tone, vocabulary, sentence length and signature phrases are kept up to date.
  - **Follow-up questions:** the brain asks one about a topic it knows little about.
- **Quiz mode:** the app picks the statement the brain has the least evidence about, from a 36-statement probe bank and the panel's questions.
  - **Held-out prediction:** the brain **commits to a prediction first**, stored as a pending `(:Check)`. Then you answer, and the reveal shows whether it was right and which earlier answers it used.
  - **Cross-validation:** 4-fold, run from the brain's page, compares accuracy with the always-say-the-most-common-answer baseline.

**Measured accuracy of stance prediction** (4-fold cross-validation, 22 scripted answers per example brain):

| predictor | Cautious investor | Busy freelancer |
|---|---|---|
| majority baseline | 59% | 64% |
| embedding similarity only (first attempt, dropped) | 32% | 36% |
| GraphRAG + LLM **with** per-claim "similar answer → stance" hints | 50–68% | 41–50% |
| **GraphRAG + LLM (final):** the graph picks the evidence, with no stance hints | **64–82%** over 3 runs | **64–68%** over 3 runs |

What we learned, measured rather than assumed:
- Sentences that *sound* alike often carry *opposite* stances ("AI makes me interested" vs "AI is hype"). Similarity-only prediction is therefore worse than guessing, and similarity hints mislead the LLM too.
- The final design beats the baseline for the investor brain and only ties it for the freelancer brain. With 22 answers the numbers are noisy, which is why **every brain shows its own measured accuracy**, including on its panel answers.

## Brain Panel (`/`)
- **Ask** a problem or paste an idea, then choose which brains sit on the panel.
- **Each brain answers in turn** (one LLM call each) with:
  - a reaction (enthusiastic / positive / neutral / skeptical / opposed);
  - what it says, in its own voice;
  - its concerns, and what it **would do** to solve it;
  - the **beliefs it relied on**. The server keeps only citations that point at evidence it actually supplied.
- **Synthesis:** where they agree, where they clash (per brain), a **joint solution**, and what to ask next.
- **Go deeper:**
  - **Point-by-point reactions:** does each point of the idea land with each brain? Click a cell for the evidence, and teach the brain if it got it wrong.
  - **World knowledge:** concepts linked to Wikidata and Wikipedia.

Example from the committed graph, asking *"Freelancers hate bookkeeping, how should we solve it?"*:
- **Busy freelancer (🤩):** "…if it can be set up in under five minutes and works mostly on my phone, I'll actually use it."
- **Cautious investor (🤨):** "I'd need concrete numbers… must be SOC 2 certified."
- **Skeptical CFO (🤨):** "…it has to be auditable… Show me the ROI in numbers or don't bother."
- **Synthesis:** they clash on pricing (cheap monthly vs revenue share vs ROI-justified). The joint solution combines a mobile-first setup, transparent pricing, SOC 2, audit logs and Excel export, and a pilot.

## World knowledge (Wikidata)
Concepts are **entity-linked** to Wikidata:
- **Candidates:** Wikidata search generates them.
- **Disambiguation:** an LLM picks among them **in context** (the claims the concept came from), only from the candidate list, or says "none" and suggests a better search term.
- **Storage:** each link becomes `(:Concept)-[:SAME_AS]->(:WikiEntity)`, with parent classes and a Wikipedia summary.

Our first heuristic linker mapped `ai` to *Anguilla*; in-context disambiguation fixed it. **Bridges** show other statements in the graph that share a Wikidata class with the question. An optional **web check** (Groq `browser_search`) stores only pages the tool actually returned as `(:Source)-[:EVIDENCE]->(:Claim)`, judged in a separate call.

## Average brain response (TRIBE v2)
The persona brains say what a *kind of person* thinks. Meta's [TRIBE v2](https://github.com/facebookresearch/tribev2) adds a second view: how an **average brain** is predicted to respond, second by second, while hearing the same text. The Panel shows both side by side for every question or pitch, sentence by sentence.
- **Flow:**
  1. `node brainwave/export.mjs` writes each panel question to `brainwave/inputs/`.
  2. [`brainwave/colab_brainwave.ipynb`](brainwave/colab_brainwave.ipynb) runs TRIBE on a Colab T4 GPU. It needs Hugging Face access to `meta-llama/Llama-3.2-3B`.
  3. Unzip its JSON files into `brainwave/results/` and click **Import TRIBE results** on the Panel.
- **Graph:** `(:Idea)-[:SCANNED_AS]->(:Scan)-[:HAS_MOMENT]->(:Moment)-[:ABOUT]->(:Claim)<-[:PREDICTS]-(:Brain)`, plus `(:Moment)-[:ACTIVATES {z}]->(:Network)`. One query answers "which sentences raise attention/effort for an average listener, and which personas does the same point put off?"
- **Honest scope:** TRIBE predicts fMRI-like responses for an average subject. The 7 networks are a coarse, hand-made grouping of atlas regions ([legacy/tribe/networks.py](legacy/tribe/networks.py)). Values are z-scored within each text, so they mean "above or below this text's own average", not good or bad. Synthetic or placeholder files are refused on import.

## Free-tier budget
Groq's free plan allows about **200,000 tokens per day per model**. Approximate costs:
- one Talk message ≈ 2k tokens;
- one panel answer ≈ 2–3k;
- a synthesis ≈ 2k;
- cross-validating a brain ≈ 10k.

When `openai/gpt-oss-120b` runs out for the day, the app **automatically switches to `openai/gpt-oss-20b`** (a separate quota; set `GROQ_FALLBACK_MODEL` to change it). Every answer shows which model wrote it. With no LLM at all, brains answer graph-only.

## Using the graph from any MCP host
With the [Relate CLI](https://relatedb.ai) installed, copy [`docs/mcp.example.json`](docs/mcp.example.json) to `.mcp.json` (Claude Code) or into your MCP host's config:
```json
{ "mcpServers": { "brainprint-relate": { "command": "relate",
  "args": ["serve", "--mcp", "stdio", "--database", "graph/brainprint.rl", "--read-only"] } } }
```
The host can then query every brain read-only, for example "which brains distrust AI with money, and in whose words?". This is verified: reads return rows, and writes are rejected. The config is **opt-in** because a running MCP server holds a read lock that stops the web app from writing; use one or the other at a time.

## Repo layout
| path | what it holds |
|---|---|
| `graph/brainprint.rl` | The Relate store: brains, beliefs, quotes, questions, responses, concepts, Wikidata |
| `web/` | Next.js app: [`lib/talk.ts`](web/lib/talk.ts), [`lib/panel.ts`](web/lib/panel.ts), [`lib/brains.ts`](web/lib/brains.ts) (prediction, Quiz, cross-validation), [`lib/ideas.ts`](web/lib/ideas.ts), [`lib/knowledge.ts`](web/lib/knowledge.ts), [`lib/llm.ts`](web/lib/llm.ts) |
| `web/data/` | Probe statements, the example brains' scripted answers, and example questions |
| `docs/` | [`RELATE_NOTES.md`](docs/RELATE_NOTES.md) (verified Relate API and findings), [`DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md), [`mcp.example.json`](docs/mcp.example.json) |
| `brainwave/` | TRIBE v2 for panel questions: export script, Colab notebook, `inputs/`, `results/` ([lib/brainwave.ts](web/lib/brainwave.ts) imports them) |
| `video/` | Scripts that recorded, narrated and edited the demo video ([docs/VIDEO_PLAN.md](docs/VIDEO_PLAN.md)) |
| `legacy/` | The earlier TRIBE v2 "pitch timeline" module. Its runner and network grouping are reused by `brainwave/`. See [legacy/README.md](legacy/README.md). |

## Limitations
- **Brains are small models of what their trainer said.** They are trained on dozens of statements, not thousands, so accuracy is noisy, and a brain is only as good as its training. Every panel answer shows its brain's measured accuracy. Treat brains that don't beat their baseline as weak.
- **LLM-written voices can over-generalise.** The prompt forbids opinions the evidence doesn't support, and answers cite the beliefs they used, but a model can still sound more certain than the evidence. The extractor also occasionally breaks the "phrase favourably" rule. For example, "buzzwords increase my suspicion" is stored as *agree* under the concept *buzzwords*.
- **Privacy:** with Groq, your messages and the brains' beliefs are sent to Groq's API. Use a local Ollama model (`LLM_PROVIDER=ollama`) for private material.
- **Wikidata links and web checks** are model-assisted and can be wrong. Check the QID and source links.
- **One process at a time** may hold `graph/brainprint.rl` for writing (the web server, a script, or an MCP server). This is a Relate single-file constraint ([details](docs/RELATE_NOTES.md)).
- **Platforms:** built and tested on Windows 11 with Node 24. Other platforms rely on Relate's published binaries and haven't been tested by us.

## License
MIT for this project's code. Relate, the MiniLM model, and Llama-based Groq models keep their own licenses.
