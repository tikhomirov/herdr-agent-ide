#!/usr/bin/env node
// Agent IDE browser viewer: a real Chrome (an agent-browser session) drawn in a Herdr terminal with Kitty graphics.
//   node viewer.js --task <project name>
//
// One browser per project: session `herdr-ide-<task>`, its own Chrome profile (cookies stay with the project).
// The toolbar is a native Herdr mod (ide-browser-bar); it talks to this viewer through two files in
// ~/.local/state/herdr-ide: <task>.state.json (written here) and <task>.ctl (the mod appends one command a line).
// The page is laid out at exactly the pane's pixel size (viewport override), or at a device size in device mode.
"use strict";
const { execFile, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { StringDecoder } = require("string_decoder");

const FPS = 12;
const IDLE_DRIVE_MS = 20000;

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const HOME = process.env.HOME;
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 24).replace(/-$/, "") || "default";
const task = slug(opt("--task"));
const START_URL = opt("--url") || "";

const STATE_DIR = path.join(HOME, ".local", "state", "herdr-ide");
const file = (ext) => path.join(STATE_DIR, task + ext);
const STATE_FILE = file(".state.json"), CTL_FILE = file(".ctl"), YOU_FILE = file(".you");
const PROFILE = path.join(STATE_DIR, "profiles", task);
const SESSION = `herdr-ide-${task}`;
const ANNOT_DIR = path.join(STATE_DIR, "annotations");
const SHOT_DIR = path.join(HOME, "Pictures", "herdr-screenshots");
const START_PAGE = "file://" + path.join(__dirname, "start.html");

// agent-browser: $HERDR_IDE_AGENT_BROWSER, else the PATH's, else Shepherdr's own copy.
function findAgentBrowser() {
  if (process.env.HERDR_IDE_AGENT_BROWSER) return process.env.HERDR_IDE_AGENT_BROWSER;
  for (const d of (process.env.PATH || "").split(path.delimiter)) {
    const p = path.join(d, "agent-browser");
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  const base = path.join(HOME, ".local", "share", "shepherdr", "agent-browser");
  try {
    for (const v of fs.readdirSync(base).sort().reverse()) {
      const p = path.join(base, v, "agent-browser");
      try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
    }
  } catch {}
  return null;
}
const AB = findAgentBrowser();
process.env.AGENT_BROWSER_ARGS = process.env.AGENT_BROWSER_ARGS || "--force-prefers-reduced-motion";

// ---- helpers ----

function run(cmd, argv, input) {
  return new Promise((resolve) => {
    const p = execFile(cmd, argv, { timeout: 30000, maxBuffer: 16 << 20 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
    p.stdin?.on("error", () => {});
    if (input != null) p.stdin.end(input);
  });
}
const ab = (...a) => AB ? run(AB, ["--session", SESSION, "--profile", PROFILE, ...a])
  : Promise.resolve({ code: 127, stdout: "", stderr: "agent-browser is not installed. Run: npm i -g agent-browser && agent-browser install" });
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
const touch = (f) => { const t = new Date(); fs.utimes(f, t, t, (e) => { if (e) fs.writeFile(f, "", () => {}); }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = process.stdout;
const w = (s) => out.write(s);
const dbg = (m) => { if (process.env.HERDR_IDE_DEBUG) fs.appendFileSync("/tmp/herdr-ide-viewer.log", `${new Date().toISOString()} ${m}\n`); };

// The desktop clipboard: text or a PNG, whichever tool this machine has. These tools stay in the background to serve
// the clipboard (wl-copy, xclip), so they are started with no pipes but stdin and waited for only until they let go
// of the foreground: waiting on their output would hold us for the whole timeout and then kill the clipboard.
function pipeTo(cmd, a, data) {
  return new Promise((resolve) => {
    let p;
    try { p = spawn(cmd, a, { stdio: ["pipe", "ignore", "ignore"] }); } catch { return resolve(false); }
    const timer = setTimeout(() => resolve(true), 1500);
    p.on("error", () => { clearTimeout(timer); resolve(false); });
    p.on("exit", (code) => { clearTimeout(timer); resolve(code === 0); });
    p.stdin.on("error", () => {});
    p.stdin.end(data);
  });
}
async function clip(data, type) {
  const tools = type === "image/png"
    ? [["wl-copy", ["-t", "image/png"]], ["xclip", ["-selection", "clipboard", "-t", "image/png"]]]
    : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["pbcopy", []]];
  for (const [cmd, a] of tools) if (await pipeTo(cmd, a, data)) return true;
  return false;
}
async function clipText() {
  for (const [cmd, a] of [["wl-paste", ["-n", "-t", "text"]], ["xclip", ["-selection", "clipboard", "-o"]], ["pbpaste", []]]) {
    const r = await run(cmd, a);
    if (r.code === 0) return r.stdout;
  }
  return "";
}

// ---- state ----

const S = {
  state: "checking",   // checking | closed | opening | live | error
  why: "",
  cols: out.columns || 80, rows: out.rows || 24,
  cellW: 0, cellH: 0, pixelMouse: false,
  url: "", title: "", target: null,
  page: null, rect: null, imgCells: null,
  driving: false, lastInput: 0,
  buttons: [], down: null, lastClick: { at: 0, x: 0, y: 0, n: 0 },
  drawn: false, frames: 0,
  select: false,       // Select mode on
  drag: null,          // { x, y } page start of a drag in Select mode
  note: "", noteAt: 0, // a short message for the toolbar
  device: null,        // { w, h } in device mode (a fixed page size, drawn centered), else null
  autoOpened: 0,
};

// ---- terminal ----

function setup() {
  w("\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J");
  w("\x1b[?1003h\x1b[?1006h\x1b[?1004h\x1b[?2004h\x1b[>1u");
  w("\x1b[?1016h\x1b[?1016$p");
  w("\x1b[16t");
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
}
let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  try { out.write("\x1b_Ga=d,d=A,q=2\x1b\\\x1b[<u\x1b[?2004l\x1b[?1004l\x1b[?1016l\x1b[?1006l\x1b[?1003l\x1b[?7h\x1b[?25h\x1b[?1049l"); } catch {}
}
async function quit(code = 0) {
  stopDriving();
  restore();
  try { await Promise.race([cdp.clearView(), sleep(800)]); } catch {}
  process.exit(code);
}
process.on("SIGTERM", () => quit(0));
process.on("SIGHUP", () => quit(0));
process.on("SIGINT", () => quit(0));
process.on("exit", restore);
process.on("SIGWINCH", () => { S.cols = out.columns; S.rows = out.rows; w("\x1b[16t"); applyView(true); });

const areaPx = () => ({ w: S.cols * S.cellW, h: Math.max(1, S.rows) * S.cellH });

// The picture: 1:1 when the page is laid out at the pane's size; in device mode a smaller page is drawn at its
// size, centered, and a bigger one shrinks to fit.
function layoutPicture(force) {
  if (!S.cellW || !S.cellH) return;
  const areaW = S.cols * S.cellW, areaH = S.rows * S.cellH;
  const prev = JSON.stringify(S.imgCells);
  if (!S.page) { S.imgCells = null; S.rect = null; }
  else {
    const s = Math.min(1, areaW / S.page.w, areaH / S.page.h);
    const cols = Math.max(1, Math.min(S.cols, Math.round((S.page.w * s) / S.cellW)));
    const rows = Math.max(1, Math.min(S.rows, Math.round((S.page.h * s) / S.cellH)));
    const col = S.device ? Math.floor((S.cols - cols) / 2) : 0;
    S.imgCells = { col, row: 0, cols, rows };
    S.rect = { x: col * S.cellW, y: 0, w: cols * S.cellW, h: rows * S.cellH };
  }
  if (force || JSON.stringify(S.imgCells) !== prev) {
    w("\x1b_Ga=d,d=A,q=2\x1b\\\x1b[2J");
    S.drawn = false;
    paint();
  }
}

async function applyView(force) {
  if (!S.cellW) return;
  await cdp.setView();
  layoutPicture(force);
  cdp.restartCast();
}

function drawFrame(b64, done) {
  const c = S.imgCells;
  if (!c) return done();
  let s = `\x1b7\x1b[${c.row + 1};${c.col + 1}H`;
  const CH = 4096;
  for (let i = 0; i < b64.length; i += CH) {
    const chunk = b64.slice(i, i + CH), more = i + CH < b64.length ? 1 : 0;
    s += i === 0
      ? `\x1b_Ga=T,f=100,t=d,i=1,p=1,q=2,C=1,z=-1,c=${c.cols},r=${c.rows},m=${more};${chunk}\x1b\\`
      : `\x1b_Gm=${more};${chunk}\x1b\\`;
  }
  s += "\x1b8";
  S.drawn = true; S.frames++;
  if (out.write(s)) done(); else out.once("drain", done);
}

// ---- drawing: messages while there's no picture ----

const ESC = (c) => `\x1b[${c}m`;

function paint() {
  S.buttons = [];
  if (S.state !== "live") {
    w("\x1b_Ga=d,d=A,q=2\x1b\\\x1b[2J");
    S.drawn = false;
    const lines = {
      checking: ["Looking for the browser…"],
      opening: ["Opening the browser…"],
      closed: ["The browser isn't open yet."],
      error: wrap(S.why || "The browser doesn't answer.", Math.max(20, S.cols - 4)),
    }[S.state] ?? [];
    const top = Math.max(0, Math.floor(S.rows / 2) - lines.length);
    lines.forEach((l, i) => { l = l.slice(0, S.cols - 2); w(`\x1b[${top + i + 1};${Math.max(1, Math.floor((S.cols - l.length) / 2) + 1)}H${ESC(2)}${l}${ESC(0)}`); });
    if (S.state === "closed" || S.state === "error") {
      const label = " Open the browser ", x = Math.max(0, Math.floor((S.cols - label.length) / 2)), row = top + lines.length + 1;
      w(`\x1b[${row + 1};${x + 1}H${ESC(7)}${label}${ESC(0)}`);
      S.buttons.push({ row, x0: x, x1: x + label.length, fn: () => openBrowser() });
    }
  }
  publish();
}

function wrap(text, width) {
  const o = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) { o.push(line); line = ""; }
      line = line ? `${line} ${word}` : word;
      while (line.length > width) { o.push(line.slice(0, width)); line = line.slice(width); }
    }
    if (line) o.push(line);
  }
  return o;
}

function note(msg) { S.note = msg; S.noteAt = Date.now(); publish(); }

let pubTimer = null;
function publish() {
  if (pubTimer) return;
  pubTimer = setTimeout(() => {
    pubTimer = null;
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify({ at: Date.now(), task, live: S.state === "live", state: S.state, url: S.url, title: S.title,
        select: S.select, device: S.device, note: S.note, noteAt: S.noteAt, focusAddr: S.focusAddr || 0 }));
    } catch {}
  }, 30);
}

// Commands from the toolbar mod, one per line.
setInterval(() => {
  let text;
  try { text = fs.readFileSync(CTL_FILE, "utf8"); fs.unlinkSync(CTL_FILE); } catch { return; }
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [cmd, ...rest] = line.split(" "), arg = rest.join(" ");
    if (cmd === "nav") { const u = normalizeUrl(arg); if (u) { S.url = u; cdp.navigate(u); publish(); } }
    else if (cmd === "back") cdp.back();
    else if (cmd === "forward") cdp.forward();
    else if (cmd === "reload") cdp.reload();
    else if (cmd === "hardreload") { cdp.call("Page.reload", { ignoreCache: true }); note("Hard reload"); }
    else if (cmd === "select") toggleSelect();
    else if (cmd === "window") openBrowser(true);
    else if (cmd === "open") openBrowser();
    else if (cmd === "device") setDevice(rest);
    else if (cmd === "screenshot") screenshot(arg === "agent");
    else if (cmd === "copyurl") clip(S.url).then((ok) => note(ok ? "URL copied" : "No clipboard tool (wl-copy, xclip)"));
    else if (cmd === "clearcookies") cdp.call("Network.clearBrowserCookies").then(() => note("Cookies cleared"));
    else if (cmd === "clearcache") cdp.call("Network.clearBrowserCache").then(() => note("Cache cleared"));
    else if (cmd === "clearsite") clearSite();
  }
}, 150);

function setState(st, why = "") {
  dbg(`state ${st} ${why}`);
  if (S.state === st && S.why === why) return;
  S.state = st; S.why = why;
  if (st !== "live") { stopDriving(); S.page = null; S.imgCells = null; S.rect = null; }
  paint();
}

// ---- agent-browser: is it open, its CDP ----

async function check() {
  for (;;) {
    if (S.state !== "live" && S.state !== "opening") {
      const l = await ab("session", "list", "--json");
      const sessions = json(l.stdout)?.data?.sessions;
      if (l.code !== 0 || !Array.isArray(sessions)) setState("error", (l.stderr || l.stdout).trim() || "agent-browser doesn't answer.");
      else if (!sessions.includes(SESSION)) {
        setState("closed");
        if (Date.now() - S.autoOpened > 15000) { S.autoOpened = Date.now(); openBrowser(); }
      } else await connect();
    }
    await sleep(S.state === "live" ? 3000 : 2000);
  }
}

async function connect() {
  const cdpUrl = (await ab("get", "cdp-url")).stdout.trim();
  if (!/^ws:\/\/127\.0\.0\.1:/.test(cdpUrl)) { setState("error", "The browser has no CDP address."); return; }
  const preferUrl = (await ab("get", "url")).stdout.trim();
  await new Promise((resolve) => {
    cdp.open(cdpUrl, () => { setState("live"); applyView(true); resolve(); }, () => { if (S.state === "live") setState("checking"); resolve(); }, preferUrl);
  });
}

async function openBrowser(headed) {
  if (S.state === "opening") return;
  const wasLive = S.state === "live";
  if (!wasLive) setState("opening");
  const target = headed ? (S.url || START_URL || START_PAGE) : (START_URL || START_PAGE);
  const r = await ab(...(headed ? ["--headed"] : []), "open", target);
  if (r.code !== 0) setState("error", (r.stderr || r.stdout).trim() || "The browser didn't start.");
  else if (!wasLive) setState("checking");
}

// ---- CDP ----

const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const cdp = {
  ws: null, id: 0, pend: new Map(), session: null, targets: new Map(), pending: null, drawing: false, lastDraw: 0, timer: null, onClose: null,
  open(url, onOpen, onClose, preferUrl) {
    this.close();
    const ws = new WebSocket(url);
    this.ws = ws; this.onClose = onClose;
    ws.onopen = async () => {
      await this.call("Target.setDiscoverTargets", { discover: true }, null);
      const t = await this.call("Target.getTargets", {}, null);
      for (const i of t.result?.targetInfos ?? []) if (i.type === "page") this.targets.set(i.targetId, i);
      const pages = [...this.targets.values()].filter((i) => !i.url.startsWith("devtools:"));
      // The page agent-browser has in front (a fresh Chrome profile also has a new-tab page of its own).
      const mine = pages.filter((i) => preferUrl && i.url === preferUrl);
      const pick = (mine.length ? mine : pages).slice(-1)[0];
      if (pick) await this.attach(pick.targetId);
      onOpen();
    };
    ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.session = null; this.targets.clear(); onClose?.(); } };
    ws.onerror = () => {};
    ws.onmessage = (e) => {
      const j = json(typeof e.data === "string" ? e.data : "");
      if (!j) return;
      if (j.id) { const f = this.pend.get(j.id); this.pend.delete(j.id); f?.(j); return; }
      const p = j.params || {};
      if (j.method === "Page.screencastFrame" && j.sessionId === this.session) this.frame(p);
      else if (j.method === "Target.targetCreated" && p.targetInfo?.type === "page") {
        this.targets.set(p.targetInfo.targetId, p.targetInfo);
        if (p.targetInfo.openerId || !S.target) this.attach(p.targetInfo.targetId);
      } else if (j.method === "Target.targetInfoChanged" && p.targetInfo?.type === "page") {
        this.targets.set(p.targetInfo.targetId, p.targetInfo);
        if (p.targetInfo.targetId === S.target) { S.url = p.targetInfo.url; S.title = p.targetInfo.title; publish(); }
      } else if (j.method === "Target.targetDestroyed") {
        this.targets.delete(p.targetId);
        if (p.targetId === S.target) { S.target = null; this.session = null; const rest = [...this.targets.keys()]; if (rest.length) this.attach(rest[rest.length - 1]); }
      }
    };
  },
  close() { const ws = this.ws; this.ws = null; this.session = null; this.pend.clear(); try { ws?.close(); } catch {} },
  call(method, params = {}, session = this.session) {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== 1) return resolve({});
      const id = ++this.id;
      this.pend.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
      setTimeout(() => { if (this.pend.delete(id)) resolve({}); }, 15000);
    });
  },
  async attach(targetId) {
    const old = this.session;
    if (old) this.call("Target.detachFromTarget", { sessionId: old }, null);
    this.session = null; S.target = targetId;
    const info = this.targets.get(targetId);
    if (info) { S.url = info.url; S.title = info.title; }
    const a = await this.call("Target.attachToTarget", { targetId, flatten: true }, null);
    if (S.target !== targetId) return;
    this.session = a.result?.sessionId ?? null;
    S.page = null;
    await this.call("Page.bringToFront", {});
    await applyView(true);
    publish();
  },
  // The page's size: the pane's pixels, or the chosen device (phones get touch, a mobile user agent and 2x pixels).
  async setView() {
    if (!this.session || !S.cellW) return;
    const d = S.device;
    if (d) {
      const mobile = d.w < 768;
      await this.call("Emulation.setDeviceMetricsOverride", { width: d.w, height: d.h, deviceScaleFactor: mobile ? 2 : 1, mobile, screenWidth: d.w, screenHeight: d.h });
      await this.call("Emulation.setEmitTouchEventsForMouse", { enabled: mobile, configuration: "mobile" });
      await this.call("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: 5 });
      if (mobile) await this.call("Emulation.setUserAgentOverride", { userAgent: MOBILE_UA });
      else await this.call("Emulation.setUserAgentOverride", { userAgent: "" });
    } else {
      const a = areaPx();
      await this.call("Emulation.setEmitTouchEventsForMouse", { enabled: false });
      await this.call("Emulation.setTouchEmulationEnabled", { enabled: false });
      await this.call("Emulation.setUserAgentOverride", { userAgent: "" });
      await this.call("Emulation.setDeviceMetricsOverride", { width: Math.round(a.w), height: Math.round(a.h), deviceScaleFactor: 1, mobile: false });
    }
  },
  async clearView() {
    if (!this.session) return;
    await this.call("Emulation.setUserAgentOverride", { userAgent: "" });
    await this.call("Emulation.clearDeviceMetricsOverride", {});
  },
  async restartCast() {
    const s = this.session;
    if (!s || !S.cellW) return;
    const a = areaPx();
    await this.call("Page.stopScreencast", {}, s);
    await this.call("Page.startScreencast", { format: "png", maxWidth: Math.round(a.w), maxHeight: Math.round(a.h), everyNthFrame: 1 }, s);
  },
  frame(p) {
    const s = this.session;
    if (this.pending) this.call("Page.screencastFrameAck", { sessionId: this.pending.p.sessionId }, this.pending.s);
    this.pending = { p, s };
    this.pump();
  },
  pump() {
    if (this.drawing || !this.pending) return;
    const wait = this.lastDraw + 1000 / FPS - Date.now();
    if (wait > 0) { if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.pump(); }, wait); return; }
    const { p, s } = this.pending;
    this.pending = null;
    if (s !== this.session) return;
    const m = p.metadata || {}, page = { w: Math.round(m.deviceWidth), h: Math.round(m.deviceHeight) };
    if (!S.page || page.w !== S.page.w || page.h !== S.page.h) { S.page = page; layoutPicture(false); }
    this.drawing = true;
    this.lastDraw = Date.now();
    drawFrame(p.data, () => {
      this.drawing = false;
      if (this.session === s) this.call("Page.screencastFrameAck", { sessionId: p.sessionId }, s);
      this.pump();
    });
  },
  back() { this.call("Runtime.evaluate", { expression: "history.back()" }); },
  forward() { this.call("Runtime.evaluate", { expression: "history.forward()" }); },
  reload() { this.call("Page.reload", {}); },
  navigate(url) { return this.call("Page.navigate", { url }); },
  async eval(expression) {
    const r = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  },
};

// ---- device mode, screenshots, site data ----

// `device <w> <h>` or `device off`.
function setDevice(a) {
  if (a[0] === "off") S.device = null;
  else {
    const dw = Math.max(200, Math.min(4000, parseInt(a[0], 10) || 0)), dh = Math.max(200, Math.min(4000, parseInt(a[1], 10) || 0));
    if (!dw || !dh) return;
    S.device = { w: dw, h: dh };
  }
  S.page = null;
  applyView(true);
  publish();
}

async function takeShot(clipRect) {
  const params = { format: "png", ...(clipRect ? { clip: { x: clipRect.x, y: clipRect.y, width: Math.max(1, clipRect.w), height: Math.max(1, clipRect.h), scale: 1 } } : {}) };
  const r = await cdp.call("Page.captureScreenshot", params);
  return r.result?.data ? Buffer.from(r.result.data, "base64") : null;
}

// Take Screenshot: saved under ~/Pictures/herdr-screenshots and copied to the clipboard; with `toAgent` only its path goes to the agent.
async function screenshot(toAgent) {
  const png = await takeShot();
  if (!png) return note("Screenshot failed");
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const f = path.join(SHOT_DIR, `${task}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
  fs.writeFileSync(f, png);
  if (toAgent) return sendToAgent("browser screenshot", f, `[Browser screenshot of ${S.url} — ${f}] `);
  const copied = await clip(png, "image/png");
  note(copied ? "Screenshot saved and copied" : `Screenshot saved: ${f}`);
}

async function clearSite() {
  let origin = "";
  try { origin = new URL(S.url).origin; } catch {}
  if (!origin || origin === "null") return note("No site to clear");
  await cdp.call("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
  note("Site data cleared");
}

// ---- address ----

function normalizeUrl(t) {
  t = t.trim();
  if (!t) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(about|data|file|chrome):/i.test(t)) return t;
  if (/^[\w.-]+\.localhost(:\d+)?(\/|$)/i.test(t)) return "https://" + t;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(t)) return "http://" + t;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t)) return "https://" + t;
  return "https://www.google.com/search?q=" + encodeURIComponent(t);
}

// ---- Select: point at an element or a region, tell the agent ----

const OV = `(()=>{let o=document.getElementById('__herdr_ov');if(!o){o=document.createElement('div');o.id='__herdr_ov';o.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #3b82f6;background:rgba(59,130,246,.18);box-sizing:border-box;display:none';const l=document.createElement('div');l.style.cssText='position:absolute;left:-2px;top:-22px;background:#3b82f6;color:#fff;font:11px/18px monospace;padding:0 6px;white-space:nowrap;border-radius:3px;max-width:60vw;overflow:hidden';o.appendChild(l);document.documentElement.appendChild(o)}return o})()`;
const hoverJs = (x, y) => `(()=>{const o=${OV};const e=document.elementFromPoint(${x},${y});if(!e||e===o||o.contains(e)){o.style.display='none';return}const r=e.getBoundingClientRect();Object.assign(o.style,{display:'block',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});const c=typeof e.className==='string'?e.className.trim().split(/\\s+/).filter(Boolean).slice(0,2).join('.'):'';o.firstChild.textContent=e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(c?'.'+c:'')+'  '+Math.round(r.width)+'×'+Math.round(r.height);o.firstChild.style.top=r.top<24?'2px':'-22px'})()`;
const regionJs = (x0, y0, x1, y1) => `(()=>{const o=${OV};const l=Math.min(${x0},${x1}),t=Math.min(${y0},${y1}),w=Math.abs(${x1}-${x0}),h=Math.abs(${y1}-${y0});Object.assign(o.style,{display:'block',left:l+'px',top:t+'px',width:w+'px',height:h+'px'});o.firstChild.textContent=w+'×'+h})()`;
const clearJs = `(()=>{const o=document.getElementById('__herdr_ov');if(o)o.remove()})()`;
const pickJs = (x, y) => `(()=>{const o=document.getElementById('__herdr_ov');if(o)o.style.display='none';const e=document.elementFromPoint(${x},${y});if(!e)return null;
const sel=(e)=>{const parts=[];while(e&&e.nodeType===1&&parts.length<6){let s=e.tagName.toLowerCase();if(e.id){parts.unshift(s+'#'+CSS.escape(e.id));break}const c=(typeof e.className==='string'?e.className.trim().split(/\\s+/).filter(x=>x&&!/^[0-9]|[:\\[]/.test(x)).slice(0,2):[]);if(c.length)s+='.'+c.map(CSS.escape).join('.');const p=e.parentElement;if(p){const same=[...p.children].filter(x=>x.tagName===e.tagName);if(same.length>1)s+=':nth-of-type('+(same.indexOf(e)+1)+')'}parts.unshift(s);e=p}return parts.join(' > ')};
const r=e.getBoundingClientRect();const attrs={};for(const a of ['aria-label','href','name','type','placeholder','alt','data-testid','role','value']){const v=e.getAttribute(a);if(v)attrs[a]=v.slice(0,120)}
const clone=e.cloneNode(true);clone.querySelectorAll('*').forEach(n=>{if(n.children.length===0&&n.textContent.length>60)n.textContent=n.textContent.slice(0,60)+'…'});
return{tag:e.tagName.toLowerCase(),selector:sel(e),text:(e.innerText||e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,200),html:clone.outerHTML.replace(/\\s+/g,' ').slice(0,500),rect:{x:Math.max(0,r.left),y:Math.max(0,r.top),w:Math.min(r.width,innerWidth),h:Math.min(r.height,innerHeight)},attrs,url:location.href,title:document.title}})()`;

function toggleSelect() { S.select ? stopSelect() : startSelect(); }
function startSelect() { if (S.state !== "live") return; S.select = true; S.drag = null; publish(); }
function stopSelect() { if (!S.select) return; S.select = false; S.drag = null; cdp.eval(clearJs); publish(); }

let hoverAt = 0;
function selectHover(p) {
  if (Date.now() - hoverAt < 40) return;
  hoverAt = Date.now();
  if (S.drag) cdp.eval(regionJs(S.drag.x, S.drag.y, p.x, p.y)); else cdp.eval(hoverJs(p.x, p.y));
}

async function shot(rect, f) {
  fs.mkdirSync(ANNOT_DIR, { recursive: true });
  const png = await takeShot(rect);
  if (!png) return null;
  fs.writeFileSync(f, png);
  return f;
}

async function selectRelease(p) {
  const d = S.drag; S.drag = null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let text, what, ref;
  if (d && (Math.abs(p.x - d.x) > 8 || Math.abs(p.y - d.y) > 8)) {
    const rect = { x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y) };
    await cdp.eval(clearJs);
    const f = await shot(rect, path.join(ANNOT_DIR, `region-${stamp}.png`));
    const info = await cdp.eval(`({url:location.href,title:document.title})`);
    text = `[Browser region ${Math.round(rect.w)}×${Math.round(rect.h)} at (${Math.round(rect.x)},${Math.round(rect.y)}) on ${info?.url ?? S.url}${f ? ` — screenshot: ${f}` : ""}] `;
    if (f) { what = "browser region screenshot"; ref = f; }
  } else {
    const info = await cdp.eval(pickJs(p.x, p.y));
    await cdp.eval(clearJs);
    if (!info) { note("No element here"); return; }
    const f = info.rect.w > 1 && info.rect.h > 1 ? await shot(info.rect, path.join(ANNOT_DIR, `element-${stamp}.png`)) : null;
    const attrs = Object.entries(info.attrs || {}).map(([k, v]) => `${k}="${v}"`).join(" ");
    text = `[Browser element on ${info.url}]\n- selector: \`${info.selector}\`\n- html: \`${info.html}\`` +
      (info.text ? `\n- text: "${info.text}"` : "") + (attrs ? `\n- attrs: ${attrs}` : "") + (f ? `\n- screenshot: ${f}` : "") + "\n";
    ref = path.join(ANNOT_DIR, `element-${stamp}.md`);
    fs.writeFileSync(ref, text);
    what = "browser element";
  }
  S.select = false; publish();
  if (!ref) { await clip(text); return note("Region copied to the clipboard"); }
  await sendToAgent(what, ref, text);
}

// The agent of the shown tab (else the shown space's): its input gets the text, unsent; it gets the keyboard.
async function pickAgent() {
  const ls = json((await run("herdr-app", ["ls"])).stdout);
  const spaces = ls?.spaces ?? [];
  const agentsOf = (tab) => (tab?.terminals ?? []).filter((t) => t.status);
  const sp = spaces.find((s) => s.active) ?? spaces[0];
  if (!sp) return null;
  const tab = sp.tabs.find((t) => t.active) ?? sp.tabs[0];
  return agentsOf(tab)[0] ?? sp.tabs.flatMap(agentsOf)[0] ?? null;
}
// The agent's input gets a short line pointing at a file that holds the details (selector, HTML, screenshot). It is
// typed key by key with `hc keys`: that needs neither the clipboard nor Herdr's window to have the keyboard, and it
// is left unsent. (Herdr's own paste reads a clipboard that is often stale on Wayland, and only with the window focused.)
const KEY_OK = /^[A-Za-z0-9\/.\-\[\]`'=,;]$/;
function keysFor(line) {
  const keys = [];
  for (const ch of line) keys.push(ch === " " ? "space" : /[A-Z]/.test(ch) ? `shift+${ch.toLowerCase()}` : KEY_OK.test(ch) ? ch : "-");
  return keys;
}
const sdbg = (m) => { try { fs.appendFileSync(path.join(STATE_DIR, "send.log"), `${new Date().toISOString()} ${m}\n`); } catch {} };

// `what` names it ("browser element"), `ref` is the file; `full` is also put on the clipboard for pasting by hand.
async function sendToAgent(what, ref, full) {
  if (full) clip(full).catch(() => {});
  if ([...ref].some((ch) => ch !== " " && !/[A-Z]/.test(ch) && !KEY_OK.test(ch))) return note("Details copied: the file path has characters that can't be typed");
  const agent = await pickAgent();
  sdbg(`agent ${JSON.stringify(agent)} ref=${ref}`);
  if (!agent) return note("No agent in this space: details are on the clipboard");
  const name = agent.app || agent.name || agent.terminal;
  const r = await run("hc", ["keys", agent.terminal, "--", ...keysFor(`${what} ${ref} `)]);
  sdbg(`keys code=${r.code} ${r.stdout.trim().slice(0, 100)} ${r.stderr.trim().slice(0, 100)}`);
  note(r.code === 0 ? `✓ Sent to ${name}` : `Couldn't type into ${name}: ${r.stderr.trim().slice(0, 60) || r.stdout.trim().slice(0, 60)}`);
}

// ---- driving: while the person uses the page, agents holding `hib` wait ----

function startDriving() {
  S.lastInput = Date.now();
  if (S.driving || S.state !== "live") return;
  S.driving = true;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  touch(YOU_FILE);
}
function stopDriving() {
  if (!S.driving) return;
  S.driving = false;
  try { fs.rmSync(YOU_FILE, { force: true }); } catch {}
}

// ---- input: mouse, keys, paste ----

const CDP_MODS = (shift, alt, ctrl, meta) => (alt ? 1 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0);

function toPage(px, py) {
  const r = S.rect;
  if (!r || !S.page || px < r.x || py < r.y || px >= r.x + r.w || py >= r.y + r.h) return null;
  return { x: Math.round(((px - r.x) / r.w) * S.page.w), y: Math.round(((py - r.y) / r.h) * S.page.h) };
}

let lastMove = 0;
function mouse(b, x, y, release) {
  const px = S.pixelMouse ? x - 1 : (x - 0.5) * (S.cellW || 10), py = S.pixelMouse ? y - 1 : (y - 0.5) * (S.cellH || 20);
  const cell = { col: Math.floor(px / (S.cellW || 10)), row: Math.floor(py / (S.cellH || 20)) };
  const mods = CDP_MODS(b & 4, b & 8, b & 16, false);
  const motion = b & 32, wheel = b & 64, btn = b & 3;
  const names = ["left", "middle", "right"];
  if (!motion && !wheel && !release) {
    const hit = S.buttons.find((k) => k.row === cell.row && cell.col >= k.x0 && cell.col < k.x1);
    if (hit) { hit.fn(); return; }
  }
  const p = toPage(px, py);
  if (wheel) {
    if (!p) return;
    startDriving();
    const d = 80, dx = btn === 2 ? -d : btn === 3 ? d : 0, dy = btn === 0 ? -d : btn === 1 ? d : 0;
    return cdp.call("Input.dispatchMouseEvent", { type: "mouseWheel", x: p.x, y: p.y, deltaX: dx, deltaY: dy, modifiers: mods });
  }
  // Select mode: the page gets no clicks; hover shows the element, a click picks it, a drag takes a region.
  if (S.select) {
    if (!p) return;
    if (motion) return selectHover(p);
    if (btn !== 0) return;
    if (!release) { S.drag = { x: p.x, y: p.y }; return; }
    return selectRelease(p);
  }
  if (motion) {
    if (!p || Date.now() - lastMove < 16) return;
    lastMove = Date.now();
    const held = S.down;
    return cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, modifiers: mods,
      button: held ?? "none", buttons: held === "left" ? 1 : held === "right" ? 2 : held === "middle" ? 4 : 0 });
  }
  if (btn === 3 && !release) return;
  if (!p) { if (release && S.down) S.down = null; return; }
  const button = release ? (S.down ?? names[btn] ?? "left") : names[btn] ?? "left";
  if (!release) {
    startDriving();
    const lc = S.lastClick, now = Date.now();
    const n = now - lc.at < 450 && Math.abs(lc.x - p.x) < 6 && Math.abs(lc.y - p.y) < 6 ? Math.min(lc.n + 1, 3) : 1;
    S.lastClick = { at: now, x: p.x, y: p.y, n };
    S.down = button;
  } else { S.lastInput = Date.now(); S.down = null; }
  cdp.call("Input.dispatchMouseEvent", { type: release ? "mouseReleased" : "mousePressed", x: p.x, y: p.y, button,
    buttons: release ? 0 : button === "left" ? 1 : button === "right" ? 2 : 4, clickCount: S.lastClick.n, modifiers: mods });
}

const SPECIAL = {
  Enter: 13, Tab: 9, Backspace: 8, Escape: 27, Delete: 46, Insert: 45, Home: 36, End: 35, PageUp: 33, PageDown: 34,
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117, F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
};
const KITTY_CODE = { 13: "Enter", 9: "Tab", 127: "Backspace", 8: "Backspace", 27: "Escape" };
const CSI_LETTER = { A: "ArrowUp", B: "ArrowDown", C: "ArrowRight", D: "ArrowLeft", H: "Home", F: "End", P: "F1", Q: "F2", R: "F3", S: "F4" };
const CSI_TILDE = { 2: "Insert", 3: "Delete", 5: "PageUp", 6: "PageDown", 7: "Home", 8: "End", 15: "F5", 17: "F6", 18: "F7", 19: "F8", 20: "F9", 21: "F10", 23: "F11", 24: "F12" };
const EDIT_CMD = { a: "selectAll", c: "copy", x: "cut", z: "undo", y: "redo" };

function key(k, m = 1) {
  const bits = m - 1, shift = bits & 1, alt = bits & 2, ctrl = bits & 4, meta = bits & 8;
  if (shift && !ctrl && !alt && !meta && /^[a-z]$/.test(k)) k = k.toUpperCase();
  if (S.select && k === "Escape") return stopSelect();
  if (alt && k === "ArrowLeft") return cdp.back();
  if (alt && k === "ArrowRight") return cdp.forward();
  if ((ctrl && !alt && (k === "r" || k === "R")) || k === "F5") return cdp.reload();
  if (ctrl && !alt && (k === "l" || k === "L")) { S.focusAddr = Date.now(); return publish(); }
  if (ctrl && !alt && !shift && (k === "v" || k === "V")) return pasteClipboard();
  startDriving();
  const mods = CDP_MODS(shift, alt, ctrl, meta);
  let down;
  if (SPECIAL[k]) down = { key: k, code: k, windowsVirtualKeyCode: SPECIAL[k], ...(k === "Enter" && !ctrl && !alt ? { text: "\r" } : {}) };
  else if (ctrl || alt || meta) {
    const ch = k.length === 1 ? k : "";
    down = { key: ch, code: /^[a-z]$/i.test(ch) ? `Key${ch.toUpperCase()}` : /^[0-9]$/.test(ch) ? `Digit${ch}` : "",
      windowsVirtualKeyCode: /^[a-z0-9]$/i.test(ch) ? ch.toUpperCase().charCodeAt(0) : 0 };
    const cmd = ctrl && !alt && !shift && EDIT_CMD[ch.toLowerCase()];
    if (cmd) down.commands = [cmd];
  } else down = { key: k, text: k, ...(/^[a-z]$/i.test(k) ? { code: `Key${k.toUpperCase()}`, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) } : {}) };
  const { text, commands, ...up } = down;
  cdp.call("Input.dispatchKeyEvent", { type: "keyDown", ...down, modifiers: mods });
  cdp.call("Input.dispatchKeyEvent", { type: "keyUp", ...up, modifiers: mods });
  if (ctrl && !alt && /^[cx]$/i.test(k)) setTimeout(syncCopy, 120);
}

// What the page has selected goes to the desktop's clipboard (Chrome's own is another one).
async function syncCopy() {
  const t = await cdp.eval(`(()=>{const a=document.activeElement;if(a&&(a.tagName==='TEXTAREA'||a.tagName==='INPUT')&&a.selectionStart!==a.selectionEnd)return a.value.slice(a.selectionStart,a.selectionEnd);return String(getSelection())})()`);
  if (t) clip(t);
}

function insertText(text) {
  if (!text) return;
  startDriving();
  cdp.call("Input.insertText", { text });
}
async function pasteClipboard() { insertText(await clipText()); }

const dec = new StringDecoder("utf8");
let buf = "", escTimer = null;
process.stdin.on("data", (d) => { buf += dec.write(d); parse(); });

function parse() {
  clearTimeout(escTimer);
  while (buf.length) {
    if (buf[0] !== "\x1b") {
      const ch = String.fromCodePoint(buf.codePointAt(0));
      buf = buf.slice(ch.length);
      if (ch === "\r" || ch === "\n") key("Enter");
      else if (ch === "\t") key("Tab");
      else if (ch === "\x7f" || ch === "\b") key("Backspace");
      else if (ch.charCodeAt(0) < 32) key(String.fromCharCode(ch.charCodeAt(0) + 96), 5);
      else key(ch);
      continue;
    }
    let m;
    if (buf.startsWith("\x1b[200~")) {
      const end = buf.indexOf("\x1b[201~");
      if (end < 0) break;
      insertText(buf.slice(6, end));
      buf = buf.slice(end + 6);
    } else if ((m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(buf))) {
      buf = buf.slice(m[0].length);
      mouse(+m[1], +m[2], +m[3], m[4] === "m");
    } else if ((m = /^\x1b\[\?(\d+);(\d+)\$y/.exec(buf))) {
      buf = buf.slice(m[0].length);
      if (m[1] === "1016") S.pixelMouse = m[2] === "1" || m[2] === "3";
    } else if ((m = /^\x1b\[(\d+);(\d+);(\d+)t/.exec(buf))) {
      buf = buf.slice(m[0].length);
      if (m[1] === "6") {
        const h = +m[2], wd = +m[3], changed = h !== S.cellH || wd !== S.cellW;
        S.cellH = h; S.cellW = wd;
        if (changed) { applyView(true); paint(); }
      }
    } else if ((m = /^\x1b\[([\d;:]*)([A-Za-z~])/.exec(buf))) {
      buf = buf.slice(m[0].length);
      csi(m[1], m[2]);
    } else if ((m = /^\x1bO([A-Z])/.exec(buf))) {
      buf = buf.slice(m[0].length);
      if (CSI_LETTER[m[1]]) key(CSI_LETTER[m[1]]);
    } else if (buf.length >= 2 && buf[1] !== "[" && buf[1] !== "O") {
      const ch = String.fromCodePoint(buf.codePointAt(1));
      buf = buf.slice(1 + ch.length);
      key(ch, 3);
    } else if (buf.length > 64 || (buf.length >= 2 && !/^\x1b[\[O][\x20-\x7e]*$/.test(buf))) {
      buf = buf.slice(1);
    } else {
      escTimer = setTimeout(() => { if (buf === "\x1b") { buf = ""; key("Escape"); } else if (buf) { buf = buf.slice(1); parse(); } }, 40);
      break;
    }
  }
}

function csi(params, fin) {
  const p = params.split(";").map((x) => x.split(":")[0]);
  const m = Number(p[1] || 1);
  if (fin === "I" && !params) return;
  if (fin === "O" && !params) { stopDriving(); return; }
  if (fin === "u") {
    const code = Number(p[0]);
    const k = KITTY_CODE[code] ?? (code >= 32 ? String.fromCodePoint(code) : null);
    if (k) key(k, m);
    return;
  }
  if (fin === "~") { const k = CSI_TILDE[Number(p[0])]; if (k) key(k, m); return; }
  if (CSI_LETTER[fin]) key(CSI_LETTER[fin], m);
}

// ---- beats ----

setInterval(() => {
  if (S.driving) { if (Date.now() - S.lastInput > IDLE_DRIVE_MS) stopDriving(); else touch(YOU_FILE); }
}, 2000);
setInterval(publish, 2000);

setup();
paint();
setTimeout(() => { if (!S.cellW) { S.cellW = 9; S.cellH = 18; applyView(true); paint(); } }, 800);
check();
