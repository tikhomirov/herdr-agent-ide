// IDE Browser: the "Browser" tab of the right panel. Each project (space) has its own browser: a real Chrome on an
// agent-browser session `herdr-ide-<project>`. Agents drive it with `hib` (mods/ide-browser/hib); the person sees it
// here and can click, scroll and type in it.
//
// A mod can't draw a terminal, so while the tab is shown the layout's "browser" column holds this mod's block and a
// layout terminal block ("browser-view") running viewer.js, written into the layout's file (as mods/task-browser
// does). The viewer starts when the tab shows and ends when it hides or the space changes; the browser stays open.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { hc, exec, terminals, theme, appHome, home, shared, setShared, layout, readTextFile, writeTextFile, spaces } from "herdr";

const COLUMN = "browser", HOST = "browser-host", VIEW = "browser-view", BAR = "browser-bar";

// The project of a folder: its git root's name (else its own), made safe and short: the name `hib` computes too.
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 24).replace(/-$/, "") || "default";
const tasks = new Map();
async function taskOf(folder) {
  if (tasks.has(folder)) return tasks.get(folder);
  let root = folder;
  try {
    const r = await exec("git", ["-C", folder, "rev-parse", "--show-toplevel"]);
    if (r.code === 0 && r.stdout.trim()) root = r.stdout.trim();
  } catch {}
  const task = slug(root.split("/").filter(Boolean).pop());
  tasks.set(folder, task);
  return task;
}
const folderNow = () => spaces().find((x) => x.active)?.folder || home();

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const hit = find(c, id); if (hit) return hit; }
  return null;
}

// On screen: the panel is open on this tab.
const shown = () => { const l = layout(); return !find(l, "panel")?.hidden && find(l, "panel-body")?.active === COLUMN; };

function arrange(tree, addr) {
  const col = find(tree, COLUMN);
  if (!col) throw new Error("This layout has no browser tab.");
  // Not `hidden`: a hidden block's mod isn't loaded after a restart or a layout switch, and then nothing would start the viewer.
  // While the view is up the host is 0px tall instead.
  const host = { id: HOST, type: "block", content: { mod: "ide-browser" }, ...(addr ? { size: { px: 0 } } : {}) };
  col.type = "column";
  delete col.content;
  const bar = { id: BAR, type: "block", size: { px: 44 }, content: { mod: "ide-browser-bar" } };
  col.children = addr ? [bar, host, { id: VIEW, type: "block", content: { terminal: addr } }] : [bar, host];
}

async function pointView(addr, cx) {
  const path = `${appHome()}/layouts/${shared("layout")}.json`;
  for (let i = 0; ; i++) {
    const text = await readTextFile(path);
    const tree = JSON.parse(text ?? "null");
    const want = addr ?? null, has = find(tree, VIEW)?.content?.terminal ?? null;
    if (has === want && find(tree, COLUMN)?.type === "column" && Boolean(find(tree, HOST)?.size) === Boolean(addr) && !find(tree, HOST)?.hidden) return;
    arrange(tree, addr);
    try { await writeTextFile(path, JSON.stringify(tree, null, 2), text); break; }
    catch (e) { if (i >= 2) throw e; }
  }
  for (let i = 0; i < 30 && (find(layout(), VIEW)?.content?.terminal ?? null) !== (addr ?? null); i++) await new Promise((r) => cx.timer.after(100, () => r()));
}

export default class IdeBrowser extends View {
  init(_props, cx) {
    this.addr = null; this.task = null; this.busy = false; this.why = ""; this.failedAt = 0; this.resolving = false;
    cx.timer.every(2000, (cx) => this.tick(cx));
  }

  async close() { if (this.addr) await hc(["kill", this.addr]).catch(() => {}); }

  tick(cx) {
    if (this.busy) return;
    const folder = folderNow();
    const task = tasks.get(folder);
    if (!task) {
      if (!this.resolving) { this.resolving = true; taskOf(folder).then(() => { this.resolving = false; this.tick(cx); }); }
      return;
    }
    // The toolbar reads which project's browser is current from here.
    if (shared("ide-browser")?.task !== task) setShared("ide-browser", { task });
    const want = shown();
    // The viewer ended (crashed, killed): forget it, so the next tick starts a new one.
    if (this.addr && !terminals().some((k) => k.address === this.addr && k.state === "live")) {
      this.addr = null; this.busy = true;
      cx.spawn(async (cx) => { try { await pointView(null, cx); } catch {} this.busy = false; cx.notify(); });
      return;
    }
    if (this.addr) {
      if (!want || this.task !== task) this.stop(cx);
      return;
    }
    // A viewer block left in the layout by an earlier run (a restart, a crash): clear it away.
    const left = find(layout(), VIEW)?.content?.terminal;
    if (left) {
      this.busy = true;
      cx.spawn(async (cx) => {
        try { await hc(["kill", left]).catch(() => {}); hc(["rm", left]).catch(() => {}); await pointView(null, cx); } catch {}
        this.busy = false; cx.notify();
      });
      return;
    }
    if (want && Date.now() - this.failedAt > 10000) this.start(cx, folder, task);
  }

  start(cx, folder, task) {
    this.busy = true; this.why = "Starting the browser…"; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const viewer = `${appHome()}/mods/ide-browser/viewer.js`;
        const r = await hc(["run", "--bg", "--json", "--cwd", folder, "--label", `herdr.ide-view=${task}`, "--", "node", viewer, "--task", task]);
        const addr = JSON.parse(r.stdout || "{}")?.address;
        if (r.code !== 0 || !addr) throw new Error((r.stderr || r.stdout).trim().split("\n")[0] || "Couldn't start the viewer.");
        this.addr = addr; this.task = task;
        await pointView(addr, cx);
        this.why = "";
      } catch (e) {
        this.why = String(e?.message ?? e); this.failedAt = Date.now();
        if (this.addr) { hc(["kill", this.addr]).catch(() => {}); this.addr = null; }
      } finally { this.busy = false; cx.notify(); }
    });
  }

  stop(cx) {
    const addr = this.addr;
    this.busy = true; this.addr = null; this.task = null;
    cx.spawn(async (cx) => {
      try {
        if (addr) { await hc(["kill", addr]).catch(() => {}); hc(["rm", addr]).catch(() => {}); }
        await pointView(null, cx);
      } catch {}
      this.busy = false; cx.notify();
    });
  }

  render(cx) {
    const t = theme();
    if (shown() && !this.addr && !this.busy && !this.kick) {
      this.kick = true;
      cx.timer.after(0, (cx) => { this.kick = false; this.tick(cx); });
    }
    return v_flex().id("ide-browser").size_full().min_h(0).items_center().justify_center().px(24).gap(10)
      .bg(t.background).text_size(12.5).text_color(t.dim)
      .child(div().text_center().max_w(380).child(this.why || "The browser opens here."));
  }
}
