# BrainPrint: 90-second demo video script

**Setup before recording**
- `cd web && npm run dev` with a Groq key in `web/.env.local`. Groq's free plan has a daily token quota, so do a test run a day before. The app falls back to `gpt-oss-20b` automatically, but test anyway.
- **Browser:** 1440 px wide, dark mode. Start on the **Brain Panel** page.
- **Pre-warm:** open the "Freelancers hate bookkeeping" question once so its answers and synthesis load from the graph instantly.

| time | screen | narration |
|---|---|---|
| **0:00–0:08** | Brain Panel home: three brain cards with their accuracy labels. | "What would different kinds of people say about your idea? BrainPrint lets you build their brains, then ask them all at once." |
| **0:08–0:25** | Brain Library → Skeptical CFO → **Talk**. Type: "Honestly, if it doesn't integrate with Xero I'm not interested." The reply lists the learned beliefs, with the quote under each, and asks a follow-up question. Scroll to "How Skeptical CFO talks". | "I build a brain by just talking as that person. Every belief it learns is backed by the exact words I used, and it learns how they talk." |
| **0:25–0:35** | **Quiz** tab: the brain has already committed to a prediction. Answer it, and the reveal reads "✓ correct", with the earlier answers it relied on. Point at the "CV … vs baseline" number. | "Before every question it commits to a prediction, so its accuracy is measured honestly against a baseline." |
| **0:35–0:58** | Brain Panel → "Freelancers hate bookkeeping": the three answer cards (🤩 freelancer, 🤨 investor, 🤨 CFO). Expand "Beliefs it relied on" on the CFO card. | "Now I ask the panel a problem. Each brain answers in its own voice and says how it would solve it, grounded in its own beliefs from the graph." |
| **0:58–1:12** | Panel synthesis: "Where they clash: pricing model", with three positions, then the **joint solution**. | "Then they're combined like a real team: where they agree, where they clash, and a solution that covers everyone's concerns." |
| **1:12–1:22** | **Panel as a graph**: brains → beliefs → concepts. Hover a shared claim ("I trust AI to handle my money…"), which the CFO and the investor disagree with and the freelancer agrees with. | "Every brain is a subgraph in one Relate file. Brains connect through shared beliefs and concepts, and that's what the panel queries." |
| **1:22–1:30** | The README "Why Relate" section. | "Persona brains, one knowledge graph, context connected. BrainPrint." |

**Optional 10-second cut:** with the web app stopped, show Claude Code using `docs/mcp.example.json` and asking "which brains distrust AI with money, and in whose words?". Relate's MCP `read_cypher` answers from the same file.

**Honesty checklist for the narration**
- Brains are "models of the answers and words I gave them", never "real customers" or "the market".
- Show at least one accuracy-vs-baseline number on screen.
- Mention that the three example brains were built from scripted messages.
