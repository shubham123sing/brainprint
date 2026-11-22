// Renders the Devpost thumbnail (3:2, 1500x1000 PNG) from two recorded app frames.
//   node thumbnail.mjs   -> out/thumbnail.png      (run record.mjs live + brainwave first)
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

// embedded as data URIs: a page made with setContent may not load file:// images
const img = (scene, f) => "data:image/jpeg;base64," + fs.readFileSync(path.resolve("out", "scenes", scene, f)).toString("base64");
const PANEL = img("live", "00621.jpg");      // two persona answers in their own voice
const WAVE = img("brainwave", "00140.jpg");  // TRIBE v2 heatmap

// crop = [x, y, w, h] in the 1280x720 frame, shown at width W
const shot = (src, [x, y, w, h], W, extra) => {
  const s = W / w;
  return `<div class="shot" style="width:${W}px;height:${h * s}px;background-image:url('${src}');
    background-size:${1280 * s}px ${720 * s}px;background-position:${-x * s}px ${-y * s}px;${extra}"></div>`;
};

const html = `<html><head><style>
body{margin:0;width:1500px;height:1000px;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;color:#f2f2f5;
  background:radial-gradient(circle at 18% 12%,#3a3285 0,#1a1830 38%,#0f0f13 75%)}
.t{position:absolute;left:80px;top:70px}
h1{font-size:132px;margin:0;letter-spacing:-4px;line-height:1} h1 span{color:#8f8fff}
.tag{font-size:44px;margin-top:18px;color:#d9d8e6}
.chips{margin-top:30px;display:flex;gap:14px}
.chip{font-size:24px;padding:8px 18px;border-radius:999px;border:2px solid #4b4a66;color:#c9c8da;background:#17161f}
.shot{position:absolute;border-radius:16px;border:2px solid #3a3a48;box-shadow:0 30px 80px rgba(0,0,0,.6)}
.theme{position:absolute;right:70px;top:84px;font-size:26px;color:#9d9cb3;text-align:right;line-height:1.5}
.theme b{color:#e5604f}
</style></head><body>
<div class="t"><h1>Brain<span>Print</span></h1>
<div class="tag">Ask many minds at once.</div>
<div class="chips"><span class="chip">🗣️ Persona brains built by talking</span><span class="chip">🧠 TRIBE v2</span><span class="chip">🕸️ One Relate graph</span></div></div>
<div class="theme">Relate by Neo4j Hackathon<br/><b>Context, connected</b></div>
${shot(PANEL, [416, 0, 848, 445], 860, "left:70px;top:430px;transform:rotate(-2deg)")}
${shot(WAVE, [416, 0, 848, 260], 700, "left:740px;top:560px;transform:rotate(2.5deg)")}
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.setContent(html, { waitUntil: "load" });
await page.screenshot({ path: path.resolve("out", "thumbnail.png") });
await browser.close();
console.log("out/thumbnail.png");
