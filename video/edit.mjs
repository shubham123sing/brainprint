// Edits the recorded scenes into out/brainprint_demo.mp4 (1920x1080, 30 fps, H.264 + AAC).
//   1. title/outro cards are rendered from HTML with Playwright
//   2. each recorded scene is rebuilt from its screencast frames, its waiting parts sped up (SPANS below)
//   3. each scene gets its narration, padded so the picture never ends before the voice, with short fades
//   4. scenes are joined and the subtitles (from script.json, timed to the voice) are burned in
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const OUT = path.resolve("out");
const TMP = path.join(OUT, "edit");
fs.mkdirSync(TMP, { recursive: true });
const script = JSON.parse(fs.readFileSync("script.json", "utf8"));
const voice = JSON.parse(fs.readFileSync(path.join(OUT, "voice", "durations.json"), "utf8"));
const ff = (args) => execFileSync(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });

const VOICE_DELAY = 0.45; // seconds of picture before the voice starts in each scene
const TAIL = 0.7;         // seconds of picture after the voice ends

// [start, end, speed] in seconds of each raw recording (see out/scenes/<scene>/marks.json)
const SPANS = {
  home: [[0, 10.9, 1.1]],
  build: [[0, 15, 3], [15, 24, 3], [24, 28.9, 5], [28.9, 35, 1.2], [35, 43.6, 4], [43.6, 49.6, 1.5], [49.6, 65.2, 1.6]],
  quiz: [[0, 9, 2.5], [9, 15.9, 2], [15.9, 24.4, 1]],
  live: [[0, 17.3, 3], [17.3, 31.9, 2.5], [31.9, 73, 1.5]],
  earlier: [[0, 19.9, 1.8]],
  matrix: [[0, 4.3, 2], [4.3, 18.2, 1]],
  knowledge: [[0, 4, 2], [4, 13.6, 1.9], [13.6, 18.5, 0.75]],
  brainwave: [[0, 4.3, 2], [4.3, 15.8, 1.2], [15.8, 27.4, 1]],
};
const CARD_MIN = { title: 6, outro: 8.5 };

const CARD_CSS = `body{margin:0;width:1920px;height:1080px;display:flex;flex-direction:column;justify-content:center;align-items:center;
  background:radial-gradient(circle at 30% 20%,#2a2560 0,#111114 55%);color:#f2f2f5;font-family:'Segoe UI',Arial,sans-serif;text-align:center}
  h1{font-size:150px;margin:0;letter-spacing:-3px} h1 span{color:#8b83ff}
  p{font-size:48px;margin:24px 0 0;color:#c9c8d6} .s{font-size:32px;color:#8e8da0;margin-top:70px}`;
const CARDS = {
  title: `<h1>Brain<span>Print</span></h1><p>Ask many minds at once.</p><p class="s">Persona brains built by talking · one Relate graph</p>`,
  outro: `<h1>Brain<span>Print</span></h1><p>Build brains by talking. Test them. Ask them all at once.</p>
    <p class="s">Brains are models of the words you give them, not real people.<br/>Built with Relate · Groq · TRIBE v2 · Wikidata</p>`,
};

async function renderCards() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [id, html] of Object.entries(CARDS)) {
    await page.setContent(`<html><head><style>${CARD_CSS}</style></head><body>${html}</body></html>`);
    await page.screenshot({ path: path.join(TMP, `${id}.png`) });
  }
  await browser.close();
}

/** Raw frames -> constant-rate 30 fps 1080p video with the given spans, sped up. Returns its duration. */
function buildRecorded(rec, out) {
  const dir = path.join(OUT, "scenes", rec);
  const { frames, end } = JSON.parse(fs.readFileSync(path.join(dir, "frames.json"), "utf8"));
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    const next = i + 1 < frames.length ? frames[i + 1].t : end;
    const start = i === 0 ? 0 : frames[i].t; // first frame also covers the time before it
    lines.push(`file '${path.join(dir, frames[i].f).replace(/\\/g, "/")}'`, `duration ${Math.max(0.001, next - start).toFixed(3)}`);
  }
  lines.push(`file '${path.join(dir, frames[frames.length - 1].f).replace(/\\/g, "/")}'`);
  const list = path.join(TMP, `${rec}.txt`);
  fs.writeFileSync(list, lines.join("\n"));
  const spans = SPANS[rec];
  const parts = spans.map(([a, b, s], i) => `[v${i}]trim=start=${a}:end=${b},setpts=(PTS-STARTPTS)/${s}[p${i}]`);
  const filter = `[0:v]fps=60,scale=1920:1080:flags=lanczos,setsar=1,split=${spans.length}${spans.map((_, i) => `[v${i}]`).join("")};` +
    parts.join(";") + ";" + spans.map((_, i) => `[p${i}]`).join("") + `concat=n=${spans.length}:v=1:a=0,fps=30[out]`;
  ff(["-f", "concat", "-safe", "0", "-i", list, "-filter_complex", filter, "-map", "[out]", "-c:v", "libx264", "-crf", "16",
    "-preset", "medium", "-pix_fmt", "yuv420p", out]);
  return spans.reduce((t, [a, b, s]) => t + (b - a) / s, 0);
}

/** Picture + voice -> one finished scene clip of length T with fades. */
function finishScene(id, picture, picDur, isCard) {
  const T = Math.max(isCard ? CARD_MIN[id] : picDur, voice[id] + VOICE_DELAY + TAIL);
  const out = path.join(TMP, `scene_${id}.mp4`);
  const vin = isCard ? ["-loop", "1", "-framerate", "30", "-t", String(T), "-i", picture] : ["-i", picture];
  const pad = isCard ? "" : `tpad=stop_mode=clone:stop_duration=${Math.max(0, T - picDur + 0.1).toFixed(2)},`;
  ff([...vin, "-i", path.join(OUT, "voice", `${id}.wav`), "-filter_complex",
    `[0:v]${pad}trim=duration=${T.toFixed(3)},fade=in:st=0:d=0.3,fade=out:st=${(T - 0.3).toFixed(3)}:d=0.3,format=yuv420p[v];` +
    `[1:a]aresample=48000,adelay=${Math.round(VOICE_DELAY * 1000)}:all=1,apad,atrim=duration=${T.toFixed(3)},afade=out:st=${(T - 0.25).toFixed(3)}:d=0.25[a]`,
    "-map", "[v]", "-map", "[a]", "-r", "30", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-c:a", "aac", "-b:a", "192k", out]);
  return { out, T };
}

const ts = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = (s % 60).toFixed(2).padStart(5, "0"); return `${h}:${String(m).padStart(2, "0")}:${x}`; };

/** Subtitles: each scene's narration split into sentences, timed by length over the voice duration. Plus a scene label. */
function subtitles(timeline) {
  const ev = [];
  for (const { s, start } of timeline) {
    if (s.label) ev.push(`Dialogue: 1,${ts(start + 0.2)},${ts(start + 3.6)},Label,,0,0,0,,${s.label}`);
    const sentences = s.say.match(/[^.?!]+[.?!]+/g).map((x) => x.trim());
    // short sentences are merged so a subtitle stays on screen long enough to read
    const chunks = [];
    for (const x of sentences) { if (chunks.length && chunks[chunks.length - 1].length < 45) chunks[chunks.length - 1] += " " + x; else chunks.push(x); }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    let t = start + VOICE_DELAY;
    for (const c of chunks) {
      const d = (voice[s.id] * c.length) / total;
      ev.push(`Dialogue: 0,${ts(t)},${ts(t + d)},Sub,,0,0,0,,${c}`);
      t += d;
    }
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Segoe UI,46,&H00FFFFFF,&H00FFFFFF,&H00000000,&HB0000000,1,0,0,0,100,100,0,0,3,14,0,2,220,220,46,1
Style: Label,Segoe UI,40,&H00FFFFFF,&H00FFFFFF,&H00FF8383,&H00FF5A6B,1,0,0,0,100,100,0,0,3,16,0,7,40,40,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev.join("\n")}
`;
}

await renderCards();
const timeline = [];
let t = 0;
for (const s of script.scenes) {
  let res;
  if (s.card) res = finishScene(s.id, path.join(TMP, `${s.card}.png`), 0, true);
  else {
    const pic = path.join(TMP, `pic_${s.id}.mp4`);
    const dur = buildRecorded(s.rec, pic);
    res = finishScene(s.id, pic, dur, false);
  }
  timeline.push({ s, start: t, file: res.out });
  console.log(`${s.id.padEnd(10)} ${t.toFixed(1).padStart(6)}s +${res.T.toFixed(1)}s`);
  t += res.T;
}
fs.writeFileSync(path.join(TMP, "concat.txt"), timeline.map((x) => `file '${x.file.replace(/\\/g, "/")}'`).join("\n"));
fs.writeFileSync(path.join(TMP, "subs.ass"), subtitles(timeline));
fs.writeFileSync(path.join(OUT, "brainprint_demo.srt"), timeline.flatMap(({ s, start }, i) => [`${i + 1}`,
  `${ts(start + VOICE_DELAY).replace(".", ",")}0 --> ${ts(start + VOICE_DELAY + voice[s.id]).replace(".", ",")}0`, s.say, ""]).join("\n").replace(/^0:/gm, "00:").replace(/--> 0:/g, "--> 00:"));
// burn subtitles; run from TMP so the subtitles path needs no Windows drive-letter escaping
execFileSync(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "concat.txt",
  "-vf", "subtitles=subs.ass", "-c:v", "libx264", "-crf", "18", "-preset", "medium",
  "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
  path.join(OUT, "brainprint_demo.mp4")], { cwd: TMP, stdio: "inherit" });
console.log(`done: out/brainprint_demo.mp4, ${t.toFixed(1)}s`);
