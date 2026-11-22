# BrainPrint demo video plan (under 3 minutes)

**Goal:** show every feature on real use cases, recorded from the running app. The narration is generated locally (Piper TTS) and burned-in subtitles match it.

**Story:** you have an idea, and you want to know how different kinds of people would react before you ask them. BrainPrint lets you build their brains by talking, test the brains honestly, and ask them all at once. Everything lives in one Relate graph.

| # | scene | what is shown | feature |
|---|---|---|---|
| 0 | Title card | "BrainPrint: ask many minds at once" | – |
| 1 | Brain Panel home | the brains on the panel, each with its measured accuracy | panel overview |
| 2 | **Use case: education.** Build a new brain | Brain Library → New brain "Budget-conscious student" → two Talk messages → beliefs with verbatim quotes, "shared" claims, style card, concept bars | Talk mode, quote check, claim reuse (vector index) |
| 3 | Test a brain | Quiz on the Cautious investor: the prediction is locked first, then answered, then revealed with the beliefs it used. CV vs baseline is shown. | Quiz, honest accuracy |
| 4 | Ask the panel live | New problem: a university AI tutor costing ₹499 a month that records study habits. Every brain answers in its own voice, then the synthesis: agree, clash, joint solution. | Brain Panel, GraphRAG, synthesis |
| 5 | **Use case: startup.** An earlier question | "Freelancers hate bookkeeping": answers and "Beliefs it relied on" | stored panel results |
| 6 | **Use case: pitch testing.** Point by point | The jargon-heavy Ledgerly v1 pitch: does each point land with each brain? Click a cell to see why. | point matrix, teaching |
| 6b | **Use case: average brain response.** TRIBE v2 on Ledgerly v2 | Per-second network heatmap, then the sentence table: the "200 freelancers saved four hours" line lifts attention and language and every persona agrees; the funding line puts off two brains | TRIBE v2 + Relate join |
| 7 | World knowledge | Wikidata-linked concepts and bridges for the AI tutor question | Wikidata / Wikipedia |
| 8 | The graph | "Panel as a graph": brains → beliefs → concepts in one Relate file | Relate |
| 9 | Outro card | the honest note: brains are models of the words they were given | – |

**How it is made (reproducible):** `video/record.mjs` drives the app in Edge with Playwright and captures sharp frames through the Chrome DevTools screencast. `video/narrate.py` makes the voice with Piper. `video/edit.mjs` speeds up the waiting, adds the voice and subtitles, and joins the scenes with ffmpeg. Output: `video/out/brainprint_demo.mp4`.
