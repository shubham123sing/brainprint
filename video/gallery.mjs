// Devpost gallery images (3:2, 1500x1000 PNG) from the running app (npm run dev in web/, port 3000).
//   node gallery.mjs   -> out/gallery_v3/*.png
// Read-only: it only opens pages and clicks views that read the graph (no Quiz, no answers, no new questions).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const OUT = path.resolve("out", "gallery_v3");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1500, H = 1000;

const CARD_CSS = `body{margin:0;width:${W}px;height:${H}px;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;color:#f2f2f5;
  background:radial-gradient(circle at 18% 12%,#3a3285 0,#1a1830 38%,#0f0f13 75%);display:flex;flex-direction:column;align-items:center;justify-content:center}
  h1{font-size:120px;margin:0;letter-spacing:-4px;line-height:1} h1 span{color:#8f8fff}
  h2{font-size:72px;margin:0 0 8px;letter-spacing:-1px} h2 em{color:#8f8fff;font-style:normal}
  .sub{font-size:30px;color:#a9a8bd;margin:0 0 10px}
  table{border-collapse:collapse;font-size:36px;margin-top:26px} th{font-size:24px;color:#8e8da0;font-weight:600;padding:8px 30px}
  td{padding:12px 30px;border-top:1px solid #33324a} td.n{font-weight:700;color:#7ee0a0} .l{text-align:left}
  .row{display:flex;gap:50px;margin-top:40px;font-size:32px;color:#c9c8d6} .row b{color:#f2f2f5}
  .foot{font-size:22px;color:#8e8da0;margin-top:34px}
  pre{font-family:Consolas,monospace;font-size:21px;line-height:1.45;background:#0b0b10;border:2px solid #33324a;border-radius:14px;
    padding:24px 30px;margin:24px 0 0;color:#d8d7e6;white-space:pre-wrap;width:1300px} pre b{color:#7ee0a0} pre i{color:#8f8fff;font-style:normal}`;

async function card(page, file, html) {
  await page.setContent(`<html><head><style>${CARD_CSS}</style></head><body>${html}</body></html>`);
  await page.screenshot({ path: path.join(OUT, file) });
  console.log("card", file);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: "dark" });
await ctx.addInitScript(() => {
  const st = document.createElement("style"); st.textContent = "nextjs-portal{display:none!important}";
  document.addEventListener("DOMContentLoaded", () => document.documentElement.appendChild(st));
});
const page = await ctx.newPage();
const shot = async (file) => { await sleep(700); await page.screenshot({ path: path.join(OUT, file) }); console.log("shot", file); };
const scrollTo = async (loc, block = "start", offset = -16) => {
  await loc.evaluate((el, [block, offset]) => { el.scrollIntoView({ block }); window.scrollBy(0, offset); }, [block, offset]);
  await sleep(500);
};
const open = async (title) => {
  await page.goto(BASE + "/"); await page.waitForSelector(".blist .pitch");
  await page.locator(".blist .pitch", { hasText: title }).first().click();
  await sleep(1500);
};

// panel answers (AI tutor question) + synthesis
await open("AI tutor subscription for every student");
await page.waitForSelector(".resp");
await scrollTo(page.locator(".responses"));
await shot("03_panel_answers.png");
const panelShot = path.join(OUT, "03_panel_answers.png");
await scrollTo(page.locator("h2", { hasText: "Panel synthesis" }));
await shot("04_synthesis.png");

// Ledgerly v1 and v2, point by point
for (const [title, file] of [["Ledgerly v1", "06_pitch_v1.png"], ["Ledgerly v2", "05_pitch_v2_flip.png"]]) {
  await open(title);
  await page.getByRole("button", { name: "Point-by-point reactions" }).click();
  await page.waitForSelector("table.matrix", { timeout: 120000 });
  await scrollTo(page.locator("table.matrix"), "start", -70);
  await shot(file);
}
// TRIBE v2 card for Ledgerly v2
await scrollTo(page.locator("h2", { hasText: "Average brain response" }));
await shot("09_tribe_v2.png");

// graph view
await open("AI tutor subscription for every student");
const g = page.locator("h2", { hasText: "Panel as a graph" });
let graphData = null;
if (await g.count()) {
  // the graph card sits at the bottom of the page, so take the card itself and frame it on a card below
  await scrollTo(g); await sleep(2500);
  const box = g.locator("xpath=ancestor::section[1]");
  graphData = "data:image/png;base64," + (await box.screenshot()).toString("base64");
}

// Brain Library: student brain (talk, style, concepts)
await page.goto(BASE + "/brains"); await page.waitForSelector(".blist .pitch"); await sleep(1500);
await scrollTo(page.locator("h2", { hasText: "builds beliefs and style" }), "start", -260);
await shot("07_talk_beliefs.png");
const cares = page.locator("text=What this brain cares about").first();
if (await cares.count()) { await scrollTo(cares, "start", -40); await shot("08_concepts_checks.png"); }

// cards
const panelData = "data:image/png;base64," + fs.readFileSync(panelShot).toString("base64");
await card(page, "01_thumbnail.png", `
  <div style="position:absolute;left:80px;top:70px"><h1>Brain<span>Print</span></h1>
  <div style="font-size:42px;margin-top:16px;color:#d9d8e6">Persona brains that predict before you answer.</div>
  <div style="margin-top:26px;display:flex;gap:14px;font-size:24px">
    <span style="padding:8px 18px;border-radius:999px;border:2px solid #4b4a66;background:#17161f">✅ CFO brain 97% vs 73% baseline</span>
    <span style="padding:8px 18px;border-radius:999px;border:2px solid #4b4a66;background:#17161f">🔗 28/28 citations backed</span>
    <span style="padding:8px 18px;border-radius:999px;border:2px solid #4b4a66;background:#17161f">🕸️ One Relate graph</span></div></div>
  <div style="position:absolute;right:70px;top:84px;font-size:26px;color:#9d9cb3;text-align:right;line-height:1.5">Relate by Neo4j Hackathon<br/><b style="color:#e5604f">Context, connected</b></div>
  <div style="position:absolute;left:90px;top:420px;width:1320px;height:540px;border-radius:16px;border:2px solid #3a3a48;
    box-shadow:0 30px 80px rgba(0,0,0,.6);background:url('${panelData}') 0 0/1320px 880px no-repeat;transform:rotate(-1.2deg)"></div>`);
await card(page, "02_measured.png", `
  <h2>Measured, <em>not claimed</em></h2>
  <p class="sub">Seeded 4-fold cross-validation, 3 seeds. Baselines never see the held-out answers.</p>
  <table><tr><th class="l">brain</th><th>predicts held-out answers</th><th>95% CI</th><th>always-guess</th><th>crowd</th></tr>
  <tr><td class="l">Skeptical CFO</td><td class="n">97%</td><td>74–100%</td><td>73%</td><td>73%</td></tr>
  <tr><td class="l">Cautious investor</td><td class="n">67%</td><td>45–81%</td><td>61%</td><td>70%</td></tr>
  <tr><td class="l">Busy freelancer</td><td class="n">65%</td><td>43–80%</td><td>64%</td><td>68%</td></tr>
  <tr><td class="l">Budget student</td><td class="n">52%</td><td>32–72%</td><td>33%</td><td>48%</td></tr></table>
  <div class="row"><span><b>28 / 28</b> citations backed</span><span><b>15</b> tests · CI green</span><span><b>sealed</b> predictions</span></div>
  <div class="foot">Small samples, wide intervals. Every prediction is in eval/results.json. Example brains are built from scripted answers.</div>`);
if (graphData) await card(page, "10_graph.png", `
  <h2 style="font-size:52px">One <em>Relate</em> graph</h2>
  <p class="sub">(:Brain)-[:STANCE]->(:Claim)-[:MENTIONS]->(:Concept) · shared claims connect the brains</p>
  <img src="${graphData}" style="max-width:1380px;max-height:800px;border-radius:14px;border:2px solid #3a3a48;margin-top:14px"/>`);
await card(page, "11_judge_tour.png", `
  <h2>Judge tour: <em>npm run tour</em></h2>
  <p class="sub">6 multi-hop Cypher questions on graph/tour.cypher. No API key.</p>
<pre><i>Q1 Citation audit</i>   28 citations, <b>0 unbacked</b>
<i>Q2 TRIBE × personas</i>  "We are raising one million dollars."  default-mode z = 1.79
                      puts off: Skeptical CFO, Cautious investor
<i>Q3 Shared beliefs</i>   freelancer × investor share 10 beliefs, clash on 1:
                      "I trust AI to handle my money-related paperwork."
<i>Q4 Split points</i>     automatic tax categories: lands with 3 brains, puts off the CFO
<i>Q5 Shortest path</i>    Skeptical CFO → "I trust SaaS tools to deliver value." → student   (<b>2 hops</b>)
<i>Q6 Exact words</i>      talk beliefs with a verbatim quote: <b>11/11</b> (CFO), <b>7/7</b> (student)</pre>`);

await browser.close();
console.log("done:", fs.readdirSync(OUT).join(", "));
