// Records the BrainPrint demo scenes from the running app (npm run dev in web/, port 3000).
// Frames come from the Chrome DevTools screencast (sharp JPEGs with arrival times), not Playwright's low-bitrate video.
//
//   node record.mjs <scene> [<scene> ...]      scenes: home build quiz live earlier matrix knowledge
//
// Output per scene: out/scenes/<scene>/{00000.jpg..., frames.json, marks.json}
// The quiz scene pauses for a human answer: it writes out/quiz_question.txt and waits for out/quiz_answer.txt (1 | 0 | -1).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const OUT = path.resolve("out");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CURSOR = `(() => {
  const add = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div'); c.id = '__cur';
    c.style.cssText = 'position:fixed;left:640px;top:360px;width:20px;height:20px;border-radius:50%;' +
      'background:rgba(255,196,60,.95);box-shadow:0 0 0 5px rgba(255,196,60,.35);z-index:2147483647;pointer-events:none;' +
      'transform:translate(-50%,-50%);transition:left .55s ease,top .55s ease,transform .12s';
    document.documentElement.appendChild(c);
    const st = document.createElement('style'); st.textContent = 'nextjs-portal{display:none!important}';
    document.documentElement.appendChild(st);
  };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
})();`;

async function scene(name, fn) {
  const dir = path.join(OUT, "scenes", name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, colorScheme: "dark" });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  const marks = [];
  let n = 0;
  const t0 = Date.now();
  cdp.on("Page.screencastFrame", async ({ data, sessionId }) => {
    const f = `${String(n++).padStart(5, "0")}.jpg`;
    frames.push({ f, t: (Date.now() - t0) / 1000 });
    fs.writeFileSync(path.join(dir, f), Buffer.from(data, "base64"));
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => null);
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  const mark = (label) => { const t = (Date.now() - t0) / 1000; marks.push({ label, t }); console.log(`[${name}] ${t.toFixed(1)}s ${label}`); };
  // Keep the screencast alive while nothing changes on screen (it only sends frames on change).
  const keepAlive = setInterval(() => page.evaluate(() => {
    const c = document.getElementById("__cur"); if (c) c.style.opacity = c.style.opacity === "0.99" ? "1" : "0.99";
  }).catch(() => null), 250);

  const h = {
    page, mark,
    async move(loc) {
      await loc.scrollIntoViewIfNeeded().catch(() => null);
      const b = await loc.boundingBox();
      if (!b) return;
      await page.evaluate(([x, y]) => { const c = document.getElementById("__cur"); if (c) { c.style.left = x + "px"; c.style.top = y + "px"; } },
        [b.x + Math.min(b.width / 2, 60), b.y + b.height / 2]);
      await sleep(650);
    },
    async click(loc) {
      await h.move(loc);
      await page.evaluate(() => { const c = document.getElementById("__cur"); if (c) c.style.transform = "translate(-50%,-50%) scale(.6)"; });
      await sleep(130);
      await page.evaluate(() => { const c = document.getElementById("__cur"); if (c) c.style.transform = "translate(-50%,-50%)"; });
      await loc.click();
    },
    async type(loc, text, delay = 30) { await h.click(loc); await loc.pressSequentially(text, { delay }); },
    async show(loc, ms = 2500, block = "center") {
      await loc.evaluate((el, block) => el.scrollIntoView({ behavior: "smooth", block }), block).catch(() => null);
      await sleep(ms);
    },
    async top(ms = 1500) { await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" })); await sleep(ms); },
    async idle(ms) { await sleep(ms); },
  };

  try {
    mark("start");
    await fn(h);
    mark("end");
  } finally {
    clearInterval(keepAlive);
    await sleep(300);
    await cdp.send("Page.stopScreencast").catch(() => null);
    fs.writeFileSync(path.join(dir, "frames.json"), JSON.stringify({ frames, end: (Date.now() - t0) / 1000 }, null, 1));
    fs.writeFileSync(path.join(dir, "marks.json"), JSON.stringify(marks, null, 1));
    await browser.close();
    console.log(`[${name}] ${frames.length} frames, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}

const notBusy = (page, text, timeout = 180000) =>
  page.waitForFunction((t) => !document.body.innerText.includes(t), text, { timeout });

const STUDENT = "Budget-conscious student";
const TUTOR_TITLE = "AI tutor subscription for every student";
const TUTOR_TEXT = "Our university wants to replace printed textbooks with an AI tutor app. Every student would pay 499 rupees a month, " +
  "and the app records study habits to personalise lessons. Should we do it, and what would make it work for you?";

const SCENES = {
  async home({ page, move, show, idle }) {
    await page.goto(BASE + "/"); await page.waitForSelector(".picklist .pick");
    await idle(2500);
    await move(page.locator(".picklist .pick").first()); await idle(1200);
    await move(page.locator(".picklist .pick").last()); await idle(1500);
    await show(page.locator(".blist").first(), 2500);
  },

  async build({ page, mark, click, type, show, top, idle }) {
    await page.goto(BASE + "/brains"); await page.waitForSelector(".blist .pitch");
    await idle(1500);
    await type(page.locator('input[placeholder^="Name"]'), STUDENT, 55);
    await type(page.locator('textarea[placeholder^="One line"]'),
      "College student on a tight budget who uses AI tools to study but is careful with money and privacy.", 18);
    await click(page.getByRole("button", { name: "Create brain" }));
    await page.waitForSelector(`h2:has-text("${STUDENT}")`); mark("created");
    await idle(1500);
    const box = page.locator('textarea[placeholder^="Say something as"]');
    const msgs = [
      "I'm a college student and every rupee matters. I'd rather use a free app with ads than pay for one, but I hate it when my data gets sold. If my friends already use something, I'll try it.",
      "AI tools help me study, but I don't fully trust their answers, so I always double check. I'd only pay for something if the university gives a student discount and I can cancel any time.",
    ];
    for (let i = 0; i < msgs.length; i++) {
      await type(box, msgs[i], 14);
      mark(`talk${i + 1}_send`);
      await box.press("Enter");
      await page.waitForFunction((n) => document.querySelectorAll(".msg.assistant .followup, .msg.assistant .learned").length >= n &&
        !document.body.innerText.includes("Reading and updating"), i + 1, { timeout: 180000 });
      mark(`talk${i + 1}_done`);
      await show(page.locator(".msg.assistant").last(), 6000, "start");
    }
    await show(page.locator("h2", { hasText: "talks" }), 5000);
    await show(page.locator("h2", { hasText: "What this brain cares about" }), 5000, "start");
    await show(page.locator("h2", { hasText: "Brain as a graph" }), 4000, "start");
    await top(1500);
  },

  async quiz({ page, mark, click, show, idle }) {
    await page.goto(BASE + "/brains"); await page.waitForSelector(".blist .pitch");
    await click(page.locator(".blist .pitch", { hasText: "Cautious investor" }));
    await page.waitForSelector('h2:has-text("Cautious investor")'); await idle(3500);
    await click(page.getByRole("button", { name: /Quiz/ }));
    mark("quiz_wait");
    await page.waitForSelector(".qtext, .empty", { timeout: 180000 });
    mark("quiz_ready");
    const q = await page.locator(".qtext").textContent().catch(() => null);
    if (!q) throw new Error("no quiz question available");
    fs.rmSync(path.join(OUT, "quiz_answer.txt"), { force: true });
    fs.writeFileSync(path.join(OUT, "quiz_question.txt"), q);
    console.log(`QUESTION: ${q}`);
    await show(page.locator(".question"), 3000);
    let ans = null;
    while (ans == null) { await idle(1000); try { ans = fs.readFileSync(path.join(OUT, "quiz_answer.txt"), "utf8").trim(); } catch { /* wait */ } }
    mark("answer_given");
    const label = { "1": /Agree|Lands/, "0": /Neutral/, "-1": /Disagree|Puts me off/ }[ans];
    await click(page.locator(".answers button", { hasText: label }));
    await page.waitForSelector(".reveal", { timeout: 60000 }); mark("revealed");
    await show(page.locator(".reveal"), 7000);
  },

  async live({ page, mark, click, type, show, idle }) {
    await page.goto(BASE + "/"); await page.waitForSelector(".picklist .pick");
    await idle(1000);
    await click(page.getByRole("button", { name: "Problem / question" }));
    await type(page.locator('input[placeholder="Short title"]'), TUTOR_TITLE, 40);
    await type(page.locator(".form textarea"), TUTOR_TEXT, 8);
    await show(page.locator(".picklist"), 1500);
    await click(page.locator("button.primary", { hasText: /^Ask \d+ brain/ }));
    mark("asked");
    await page.waitForSelector(".resp", { timeout: 180000 });
    const total = await page.locator(".picklist .pick").count();
    for (let k = 1; k <= total; k++) {
      await page.waitForFunction((k) => document.querySelectorAll(".resp:not(.pending)").length >= k, k, { timeout: 240000 });
      mark(`resp${k}`);
    }
    await page.waitForSelector('h2:has-text("Panel synthesis")', { timeout: 240000 }); mark("synthesis");
    await idle(800);
    const cards = page.locator(".resp:not(.pending)");
    const n = await cards.count();
    for (let i = 0; i < n; i++) { await show(cards.nth(i), 4500, "start"); }
    const student = page.locator(".resp", { hasText: STUDENT });
    if (await student.count()) {
      await click(student.locator("summary"));
      await show(student.locator("details"), 5000);
    }
    await show(page.locator("h2", { hasText: "Panel synthesis" }), 9000, "start");
    await show(page.locator("h4", { hasText: "Joint solution" }), 7000, "start");
  },

  async earlier({ page, click, show, idle }) {
    await page.goto(BASE + "/"); await page.waitForSelector(".blist .pitch");
    await click(page.locator(".blist .pitch", { hasText: "Freelancers hate bookkeeping" }));
    await page.waitForSelector(".resp"); await idle(800);
    await show(page.locator(".responses"), 4000, "start");
    const cfo = page.locator(".resp", { hasText: "Skeptical CFO" });
    await click(cfo.locator("summary"));
    await show(cfo.locator("details"), 5000);
    await show(page.locator("h2", { hasText: "Panel synthesis" }), 6000, "start");
  },

  async matrix({ page, mark, click, show, idle }) {
    await page.goto(BASE + "/"); await page.waitForSelector(".blist .pitch");
    await click(page.locator(".blist .pitch", { hasText: "Ledgerly v1" }));
    await idle(1500);
    await click(page.getByRole("button", { name: "Point-by-point reactions" }));
    mark("matrix_wait");
    await page.waitForSelector("table.matrix", { timeout: 120000 }); mark("matrix_ready");
    await show(page.locator("table.matrix"), 6000, "start");
    await click(page.locator("table.matrix td.cell").nth(1));
    await show(page.locator(".why"), 7000);
  },

  async knowledge({ page, mark, click, show, idle }) {
    await page.goto(BASE + "/"); await page.waitForSelector(".blist .pitch");
    await click(page.locator(".blist .pitch", { hasText: TUTOR_TITLE }));
    await idle(1500);
    await click(page.getByRole("button", { name: "World knowledge" }));
    await page.waitForSelector('h2:has-text("World knowledge")', { timeout: 120000 });
    const link = page.locator("button", { hasText: /to Wikidata/ });
    if (await link.count()) {
      await click(link.first()); mark("link_wait");
      await notBusy(page, "Linking concepts to Wikidata", 300000); mark("link_done");
    }
    await show(page.locator("h2", { hasText: "World knowledge" }), 8000, "start");
    await show(page.locator("h2", { hasText: "Panel as a graph" }), 3000, "start");
    const svg = page.locator("svg").last();
    const b = await svg.boundingBox();
    if (b) {
      for (const [fx, fy] of [[0.3, 0.4], [0.55, 0.5], [0.75, 0.35]]) {
        await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy);
        await page.evaluate(([x, y]) => { const c = document.getElementById("__cur"); c.style.left = x + "px"; c.style.top = y + "px"; },
          [b.x + b.width * fx, b.y + b.height * fy]);
        await idle(1800);
      }
    }
    await idle(2000);
  },

  // TRIBE v2 average-brain response for the revised Ledgerly pitch, next to the persona reactions
  async brainwave({ page, mark, move, show, idle }) {
    await page.goto(BASE + "/"); await page.waitForSelector(".blist .pitch");
    await page.locator(".blist .pitch", { hasText: "Ledgerly v2" }).click();
    await page.waitForSelector('h2:has-text("Average brain response")', { timeout: 60000 });
    await idle(800);
    await show(page.locator("h2", { hasText: "Average brain response" }), 2500, "start");
    mark("heatmap");
    const hover = async (loc, ms) => { await move(loc); await loc.hover(); await idle(ms); };
    const cells = page.locator(".bwcell"); // first row = language, one cell per second
    for (const k of [4, 12, 20, 29, 36, 42]) await hover(cells.nth(k), 1100);
    mark("table");
    const rows = page.locator(".bwtable tbody tr");
    await show(rows.nth(6), 800);
    await hover(rows.nth(6), 4500);
    await hover(rows.nth(7), 4500);
  },
};

for (const name of process.argv.slice(2)) {
  if (!SCENES[name]) throw new Error(`unknown scene ${name}`);
  await scene(name, SCENES[name]);
}
