// Chat for Pi, then any ACP agent. The transcript comes from a background bridge
// (`hc run --bg`) that speaks Agent Client Protocol. API keys go through herdr-secret.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { appHome, checking, exec, hc, home, notify, panes, props, readTextFile, run, shared, spaces, terminals, theme, writeTextFile } from "herdr";
import { dropKeys, holdKeys, keepKeys, KEY_HOLDER } from "./keyholder.js";
import { tr } from "./i18n.js";
import { APIS, BUILTIN, enableModels, fastSibling, mergeModels, publicProvider, secretName, slug } from "./providers.js";
import { optionGroups } from "./acp.js";

const COLUMN = 760;
const ROUND = 28;
const LEVEL = { off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
const ROOT = () => `${home()}/.local/state/herdr-ide/chat-acp`;
const CATALOG = () => `${ROOT()}/providers.json`;
const secretBin = () => `${appHome()}/bin/herdr-secret`;

const empty = () => ({
  items: [], commands: [], config: [], modes: [], modeId: null, models: [], modelId: null,
  usage: null, permissions: [], queue: [], status: "idle", sessionId: null, error: null, access: "ask", cwd: "",
});

function ownPane() {
  const list = panes().filter((pane) => pane.mod === "chat-acp");
  const key = props()?.key;
  if (key) {
    const hit = list.find((pane) => pane.pane === key || pane.tab === key);
    if (hit) return hit;
  }
  return list.find((pane) => pane.focused) || list[0] || null;
}

function spaceOf(pane) {
  if (!pane) return null;
  return spaces().find((space) => space.tabs?.some((tab) => tab.id === pane.tab)) || null;
}

async function readJson(path, fallback) {
  const text = await readTextFile(path).catch(() => null);
  if (!text) return { text: null, data: fallback };
  try { return { text, data: JSON.parse(text) }; } catch { return { text, data: fallback }; }
}

async function catalog() {
  const { data } = await readJson(CATALOG(), { providers: [] });
  const custom = Array.isArray(data.providers) ? data.providers : [];
  const ids = new Set(custom.map((provider) => provider.id));
  return [...BUILTIN.filter((provider) => !ids.has(provider.id)), ...custom.map(publicProvider)];
}

export default class ChatAcp extends View {
  init(_props, cx) {
    this.screen = "chat";
    this.transcript = empty();
    this.box = TextareaState.new({ placeholder: props()?.role === "coordinator" ? tr("Message the Coordinator") : tr("Message Pi"), rows: 2 });
    this.box.on("submit", (_event, cx) => this.send(cx));
    this.box.on("change", (_event, cx) => cx.notify());
    this.box.on("focus", () => holdKeys(this.holder()));
    this.box.on("blur", () => { if (shared(KEY_HOLDER)?.who === this.holder()) dropKeys(this.holder()); });
    this.search = InputState.new({ placeholder: tr("Search models"), value: "" });
    this.search.on("change", (_event, cx) => cx.notify());
    this.nameBox = InputState.new({ placeholder: tr("Provider name"), value: "" });
    this.urlBox = InputState.new({ placeholder: tr("Base URL"), value: "" });
    this.nameBox.on("change", (_event, cx) => { if (this.draft) this.draft.name = this.nameBox.value(); cx.notify(); });
    this.urlBox.on("change", (_event, cx) => { if (this.draft) this.draft.baseUrl = this.urlBox.value(); cx.notify(); });
    this.keyBox = InputState.new({ placeholder: tr("API key"), value: "" });
    this.keyBox.set_masked(true);
    this.draft = null;
    this.names = [];
    this.menu = null;
    this.permOpen = false;
    this.files = [];
    this.attached = [];
    this.thoughts = new Set();
    this.banners = new Set();
    this.hover = null;
    this.busy = false;
    this.seen = "";
    if (!checking()) {
      cx.timer.every(400, (cx) => cx.spawn(async (cx) => { if (await this.poll()) cx.notify(); }));
      cx.spawn(async (cx) => { await this.ensure(); cx.notify(); });
    }
  }

  holder() { return `chat-acp:${ownPane()?.pane || "chat"}`; }

  dir() {
    const pane = ownPane();
    return `${ROOT()}/${(pane?.tab || props()?.key || "default").replace(/[^\w.-]+/g, "_")}`;
  }

  async poll() {
    const before = this.transcript.error;
    await this.ensure();
    let changed = this.transcript.error !== before;
    const { data } = await readJson(`${this.dir()}/state.json`, null);
    if (data) {
      const next = JSON.stringify(data);
      if (next !== this.seen) { this.seen = next; this.transcript = data; changed = true; }
    }
    // The box takes the keyboard when it is focused. A timer must not grab it back: this pane
    // stays focused while the person types in the Tasks panel.
    if (this.menu) keepKeys(`dialog:chat-acp-${this.menu}`);
    return changed;
  }

  async ensure() {
    if (checking() || this.busy) return;
    if (this.failAt && Date.now() - this.failAt < 5000) return;
    const pane = ownPane();
    if (!pane) return;
    const dir = this.dir();
    const { data: meta } = await readJson(`${dir}/meta.json`, {});
    const live = terminals().find((terminal) => terminal.address === meta.address && terminal.state === "live");
    if (live) return;
    await this.spawn(pane);
  }

  async agentSpec() {
    const local = `${home()}/.local/share/zed/external_agents/registry/npx/pi-acp/node_modules/pi-acp/dist/index.js`;
    const probe = await exec("test", ["-f", local]).catch(() => ({ code: 1 }));
    const which = await exec("sh", ["-c", "command -v pi-acp || true"]).catch(() => ({ stdout: "" }));
    const bin = (which.stdout || "").trim();
    if (props()?.command) return { command: "sh", args: ["-c", props().command], pi: props()?.pi !== false };
    if (bin) return { command: bin, args: [], pi: true };
    if (probe.code === 0) return { command: "node", args: [local], pi: true };
    return { command: "npx", args: ["-y", "pi-acp"], pi: true };
  }

  async spawn(pane) {
    this.busy = true;
    try {
      const dir = this.dir();
      await exec("mkdir", ["-p", `${dir}/inbox`]);
      const spec = await this.agentSpec();
      const agentFile = `${dir}/agent.json`;
      await writeTextFile(agentFile, JSON.stringify(spec), null);
      const space = spaceOf(pane);
      const cwd = props()?.cwd || pane?.cwd || space?.folder || home();
      const names = await this.secretNames();
      const bridge = `${appHome()}/mods/chat-acp/bridge.mjs`;
      const role = props()?.role === "coordinator" ? "coordinator" : "";
      const launch = ["run", "--bg", "--keep", "--no-parent", "--json", "--cwd", cwd,
        "--label", `herdr.chat=${pane.pane}`,
        "--label", `herdr.chat-acp=${pane.tab}`,
        "--label", `herdr.space=${space?.id || ""}`,
        "--label", `herdr.tab=${pane.tab}`,
        ...(role ? ["--label", "herdr.role=coordinator"] : []),
        "--",
      ];
      const nodeArgs = ["node", bridge, "serve", "--dir", dir, "--cwd", cwd, "--agent-json", agentFile, "--access", this.transcript.access || "ask", "--role", role];
      const argv = names.length ? [secretBin(), "run", names.join(","), "--", ...nodeArgs] : nodeArgs;
      const result = await hc([...launch, ...argv]);
      const started = JSON.parse(result.stdout || "{}");
      if (!started.address) throw new Error(result.stderr || "could not start the agent");
      await writeTextFile(`${dir}/meta.json`, JSON.stringify({ address: started.address, cwd }), null);
    } catch (error) {
      this.failAt = Date.now();
      const message = String(error.message || error);
      this.transcript = { ...this.transcript, error: message };
      notify({ message });
    } finally { this.busy = false; }
  }

  async secretNames() {
    const result = await exec(secretBin(), ["names", "--json"]).catch(() => null);
    let rows = [];
    try { rows = JSON.parse(result?.stdout || "[]"); } catch { rows = []; }
    this.names = rows.map((row) => row.name);
    const want = (await catalog()).map((provider) => provider.secret);
    return [...new Set(want.filter((name) => this.names.includes(name)))];
  }

  async ctl(op) {
    const folder = `${this.dir()}/inbox`;
    await exec("mkdir", ["-p", folder]);
    await writeTextFile(`${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.json`, JSON.stringify(op), null);
  }

  async send(cx) {
    const text = this.box.value().trim();
    if (!text && !this.attached.length) return;
    const files = this.attached.map((path) => ({ path, name: path.split("/").pop() }));
    this.box.set_value("");
    this.attached = [];
    this.menu = null;
    await this.ensure();
    await this.ctl({ op: "prompt", text, files });
    cx.notify();
  }

  async restart(cx) {
    const { data: meta } = await readJson(`${this.dir()}/meta.json`, {});
    if (meta.address) run("terminal.kill", { terminal: meta.address });
    await exec("sleep", ["0.2"]);
    const pane = ownPane();
    if (pane) await this.spawn(pane);
    cx.notify();
  }

  groups() { return optionGroups(this.transcript); }

  chip(id, label, on, onClick) {
    const t = theme();
    return div().id(id).h(26).max_w(220).px(8).flex().items_center().rounded(6).text_size(12).border_1().border_color(on ? t.accent : t.border)
      .bg(on ? t.selected : t.background).text_color(t.foreground).cursor_pointer()
      .hover((style) => style.bg(t.hover))
      .on_click((_event, cx) => { onClick(cx); cx.notify(); }).child(div().truncate().child(label));
  }

  async copy(text) {
    const result = await exec("wl-copy", ["--", text]).catch(() => null);
    if (!result || result.code !== 0) await exec("xclip", ["-selection", "clipboard", text]).catch(() => {});
  }

  async attach(cx) {
    const result = await exec("zenity", ["--file-selection", "--title", tr("Attach")]).catch(() => null);
    const path = (result?.stdout || "").trim();
    if (path) this.attached.push(path);
    cx.notify();
  }

  renderChat(t, cx) {
    const state = this.transcript;
    const talking = state.items.some((item) => item.kind === "user" || item.kind === "tool" || (item.kind === "assistant" && item.text && !isBanner(item.text)));
    const rows = state.items.flatMap((item, index) => (!talking && item.kind === "assistant" && isBanner(item.text) ? [] : [this.row(t, item, index)]));
    const perms = (state.permissions || []).map((permission) => this.permission(t, permission));
    const queued = (state.queue || []).map((message, index) => div().id(`q-${index}`).w_full().max_w(COLUMN).mx_auto().px(16).text_size(12).text_color(t.muted).child(`${tr("Queued")}: ${message.text}`));
    return v_flex().id("chat-acp").size_full().min_h(0).bg(t.background)
      .child(v_flex().id("chat-log").flex_1().min_h(0).py(12).gap(10).overflow_y_scrollbar()
        .when(!talking && !perms.length, (el) => el.child(this.empty(t, state)))
        .children(rows).children(perms).children(queued))
      .when(state.status === "working" || state.status === "blocked", (el) => el.child(this.statusLine(t, state)))
      .child(this.composer(t, state, cx));
  }

  empty(t, state) {
    const coord = props()?.role === "coordinator";
    const title = state.error ? tr("Connection failed") : coord ? tr("What should the Coordinator do?") : tr("What should Pi do?");
    const body = state.error || (coord
      ? tr("It plans the work, starts a task for each part and keeps you posted.")
      : tr("It reads this folder, edits files and runs commands."));
    return v_flex().flex_1().w_full().items_center().justify_center().px(24).gap(8)
      .child(div().text_size(16).font_medium().text_color(t.foreground).child(title))
      .child(div().max_w(420).text_size(13).text_color(t.muted).text_center().child(body));
  }

  statusLine(t, state) {
    const blocked = state.status === "blocked";
    return h_flex().id("chat-status").flex_none().w_full().max_w(COLUMN).mx_auto().h(30).px(16).gap(8).items_center().text_size(12).text_color(t.muted)
      .when(!blocked, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(blocked, (el) => el.child(div().size(8).rounded(4).bg(t.blocked)))
      .child(div().flex_1().truncate().child(blocked ? tr("Needs you") : tr("Working…")))
      .when(!blocked, (el) => el.child(h_flex().id("chat-stop").h(22).px(8).gap(6).items_center().rounded(6).border_1().border_color(t.input).cursor_pointer()
        .hover((style) => style.bg(t.hover))
        .on_click((_event, cx) => { this.ctl({ op: "cancel" }); cx.notify(); })
        .child(svg("mods/chat/stop-chip.svg").size(8)).child(tr("Stop"))));
  }

  row(t, item, index) {
    if (item.kind === "user") {
      const hot = this.hover === index;
      return v_flex().id(`m-${index}`).w_full().max_w(COLUMN).mx_auto().px(16).gap(4).items_end()
        .on_hover((on, cx) => { this.hover = on ? index : (this.hover === index ? null : this.hover); cx.notify(); })
        .child(div().max_w(520).px(12).py(8).rounded(12).bg(t.selected).text_size(13).whitespace_normal().child(item.text || ""))
        .when(hot, (el) => el.child(h_flex().gap(10)
          .child(this.link(`copy-${index}`, tr("Copy"), () => this.copy(item.text)))
          .child(this.link(`retry-${index}`, tr("Retry"), () => this.ctl({ op: "prompt", text: item.text, files: item.files || [] })))
          .child(this.link(`fork-${index}`, tr("Fork"), () => this.ctl({ op: "fork" })))));
    }
    if (item.kind === "tool") {
      const title = item.title || item.command || item.path || tr("Tool");
      const open = this.thoughts.has(item.id);
      return v_flex().id(`tool-${item.id}`).w_full().max_w(COLUMN).mx_auto().px(16).gap(4)
        .child(h_flex().id(`tool-h-${item.id}`).h(28).px(8).gap(8).items_center().rounded(8).bg(t.popover).cursor_pointer()
          .on_click((_event, cx) => { open ? this.thoughts.delete(item.id) : this.thoughts.add(item.id); cx.notify(); })
          .child(div().flex_1().min_w(0).truncate().text_size(12).child(title))
          .child(div().text_size(11).text_color(t.muted).child(item.status || "")))
        .when(open && Boolean(item.command || item.diff), (el) => el.child(div().px(8).py(6).rounded(8).bg(t.popover).text_size(12).whitespace_normal()
          .child(item.diff ? `${item.path || ""}\n- ${item.diff.oldText}\n+ ${item.diff.newText}` : item.command)));
    }
    if (isBanner(item.text)) {
      const open = this.banners.has(item.id);
      const version = (item.text.match(/pi v[\d.]+/i) || ["Pi"])[0];
      return v_flex().id(`ban-${index}`).w_full().max_w(COLUMN).mx_auto().px(16).gap(4)
        .child(div().id(`ban-h-${index}`).h(28).px(8).flex().items_center().rounded(8).text_size(12).text_color(t.muted).cursor_pointer()
          .hover((style) => style.bg(t.hover))
          .on_click((_event, cx) => { open ? this.banners.delete(item.id) : this.banners.add(item.id); cx.notify(); })
          .child(`${version} · ${open ? tr("Hide thought") : tr("Show thought")}`))
        .when(open, (el) => el.child(div().px(8).py(6).rounded(8).bg(t.popover).text_size(12).text_color(t.muted).whitespace_normal().child(item.text)));
    }
    const open = this.thoughts.has(item.id);
    return v_flex().id(`a-${index}`).w_full().max_w(COLUMN).mx_auto().px(16).gap(4)
      .when(Boolean(item.thought), (el) => el.child(this.link(`th-${index}`, open ? tr("Hide thought") : tr("Show thought"), () => { open ? this.thoughts.delete(item.id) : this.thoughts.add(item.id); })))
      .when(open, (el) => el.child(div().px(8).py(6).rounded(8).bg(t.popover).text_size(12).text_color(t.muted).whitespace_normal().child(item.thought)))
      .child(div().text_size(13).whitespace_normal().child(item.text || (this.transcript.status === "working" ? tr("Working…") : "")));
  }

  permission(t, permission) {
    return v_flex().id(`perm-${permission.requestId}`).gap(6).p(10).rounded(8).border_1().border_color(t.border)
      .child(div().text_size(13).font_medium().child(permission.title || tr("Needs you")))
      .child(h_flex().gap(6).children((permission.options || []).map((option) => this.chip(`opt-${permission.requestId}-${option.id}`, option.name || option.kind, false, (cx) => {
        this.ctl({ op: "permission", requestId: permission.requestId, optionId: option.id });
        cx.notify();
      }))));
  }

  link(id, label, onClick) {
    const t = theme();
    return div().id(id).text_size(11).text_color(t.muted).cursor_pointer()
      .hover((style) => style.text_color(t.foreground))
      .on_click((_event, cx) => { onClick(cx); cx.notify(); }).child(label);
  }

  round(id, icon, t, fill, fn) {
    const el = div().id(id).size(ROUND).flex_none().flex().items_center().justify_center().rounded(ROUND / 2)
      .when(fill === "solid", (node) => node.bg(t.solid).text_color(t.solid_foreground))
      .when(fill === "off", (node) => node.bg(t.raised).text_color(t.dim))
      .when(fill === "ghost", (node) => node.text_color(t.dim).hover((style) => style.bg(t.hover).text_color(t.foreground)))
      .child(svg(icon).size(14));
    if (!fn) return el;
    return el.cursor_pointer().when(fill === "solid", (node) => node.hover((style) => style.opacity(0.85)))
      .on_click((_event, cx) => { cx.stop_propagation(); fn(cx); cx.notify(); });
  }

  composer(t, state, _cx) {
    const groups = this.groups();
    const thinking = groups.thinking.find((item) => item.id === groups.thinkingId);
    const model = groups.models.find((item) => item.id === groups.modelId);
    const label = [shortModel(model?.name || groups.modelId), shortThink(thinking?.name, groups.thinkingId)].filter((part) => part && part !== "Model" && part !== "Thinking").join(" · ") || tr("Model");
    const value = this.box.value();
    const canSend = Boolean(value.trim() || this.attached.length);
    const slash = value.startsWith("/") ? (state.commands || []).filter((command) => `/${command.name}`.startsWith(value.split(/\s/)[0])).slice(0, 8) : [];
    return v_flex().id("composer").flex_none().w_full().max_w(COLUMN).mx_auto().px(16).pb(12).gap(8)
      .when(this.menu === "picker", (el) => el.child(h_flex().w_full().justify_end().child(this.picker(t, groups))))
      .when(slash.length > 0, (el) => el.child(this.choiceMenu(t, "slash", slash.map((command) => ({ id: command.name, name: `/${command.name}` })), (id) => { this.box.set_value(`/${id} `); this.box.focus(); })))
      .when(this.attached.length > 0, (el) => el.child(h_flex().w_full().gap(6).children(this.attached.map((path, index) => div().id(`file-${index}`).h(22).px(8).flex().items_center().rounded(6).bg(t.popover).text_size(11).text_color(t.muted).child(path.split("/").pop())))))
      .child(v_flex().id("box").w_full().rounded(10).border_1().border_color(t.input).bg(t.background)
        .child(div().w_full().px(12).pt(9).pb(2).child(Textarea.new(this.box).w_full().h(44).text_size(13).text_color(t.foreground)))
        .child(h_flex().h(36).pl(6).pr(6).gap(4).items_center()
          .child(this.round("chat-attach", "mods/chat/plus.svg", t, "ghost", (cx) => this.attach(cx)))
          .child(div().flex_1())
          .child(h_flex().id("chat-agent-pick").h(ROUND).pl(8).pr(5).gap(4).items_center().rounded(6).text_size(12).font_medium().text_color(t.muted).cursor_pointer()
            .hover((style) => style.bg(t.hover).text_color(t.foreground))
            .on_click((_event, cx) => { this.menu = this.menu === "picker" ? null : "picker"; this.permOpen = false; cx.notify(); })
            .child(div().whitespace_nowrap().child(label))
            .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none()))
          .child(this.round("chat-send", "mods/chat/send.svg", t, canSend ? "solid" : "off", canSend ? (cx) => this.send(cx) : null))));
  }

  picker(t, groups) {
    const query = (this.search.value() || "").toLowerCase();
    const models = groups.models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query)).slice(0, 40);
    const speed = groups.speed || fastSibling(groups.models, groups.modelId);
    const access = this.transcript.access || "ask";
    const accessLabel = access === "read" ? tr("Read only") : access === "full" ? tr("Full access") : tr("Ask");
    const levels = groups.thinking.length ? groups.thinking : [
      { id: "off", name: "Off" }, { id: "low", name: "Low" }, { id: "medium", name: "Medium" }, { id: "high", name: "High" }, { id: "xhigh", name: "Extra high" },
    ];
    const row = (id, label, on, fn) => h_flex().id(id).h(31).px(9).gap(8).items_center().rounded(7)
      .cursor_pointer().hover((style) => style.bg(t.selected))
      .on_click((_event, cx) => { fn(); cx.notify(); })
      .child(div().flex_1().min_w(0).truncate().text_size(13).child(label))
      .when(on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).text_color(t.foreground)));
    return v_flex().id("model-menu").w(340).p(6).gap(2).rounded(12).bg(t.popover).border_1().border_color(t.border)
      .child(div().h(32).mx(4).px(8).flex().items_center().rounded(8).border_1().border_color(t.input).bg(t.background)
        .child(Input.new(this.search).w_full()))
      .child(div().h(22).px(9).pt(6).text_size(11).text_color(t.dim).child(tr("Models")))
      .child(v_flex().id("model-list").max_h(248).overflow_y_scrollbar().children(models.map((model) => row(
        `model-${String(model.id).replace(/[^\w.-]+/g, "_")}`,
        `${shortModel(model.name || model.id)}${/vision|image/i.test(`${model.id} ${model.name} ${model.description || ""}`) ? " · " + tr("Vision") : ""}`,
        model.id === groups.modelId,
        () => this.ctl({ op: "config", configId: "model", value: model.id }),
      ))))
      .child(div().h(22).px(9).pt(8).text_size(11).text_color(t.dim).child(tr("Reasoning")))
      .child(h_flex().h(34).px(4).items_center().child(h_flex().w_full().h(28).p(2).gap(2).rounded(7).bg(t.raised)
        .children(levels.map((level) => h_flex().id(`level-${level.id}`).flex_1().min_w(0).h_full().justify_center().items_center().rounded(5).text_size(11.5)
          .when(groups.thinkingId === level.id, (el) => el.bg(t.background).text_color(t.foreground).font_medium())
          .when(groups.thinkingId !== level.id, (el) => el.text_color(t.muted).cursor_pointer().hover((style) => style.text_color(t.foreground))
            .on_click((_event, cx) => { this.ctl({ op: "config", configId: "thought_level", value: level.id }); cx.notify(); }))
          .child(div().truncate().child(tr(LEVEL[level.id] || shortThink(level.name, level.id)))))))
      .when(Boolean(speed), (el) => el.child(h_flex().h(31).px(9).items_center()
        .child(div().flex_1().text_size(13).child(tr("Fast")))
        .child(div().id("fast-switch").relative().w(28).h(16).rounded(8).bg(speed.on ? t.accent : t.input).cursor_pointer()
          .on_click((_event, cx) => {
            if (groups.speed) this.ctl({ op: "config", configId: groups.speed.id, value: speed.on ? "off" : "fast" });
            else this.ctl({ op: "config", configId: "model", value: speed.id });
            cx.notify();
          })
          .child(div().absolute().top(2).left(speed.on ? 14 : 2).size(12).rounded(6).bg(t.background)))))
      .child(h_flex().id("perm-row").h(31).px(9).gap(8).items_center().rounded(7).cursor_pointer()
        .hover((style) => style.bg(t.hover))
        .on_click((_event, cx) => { this.permOpen = !this.permOpen; cx.notify(); })
        .child(svg("mods/chat-models/shield.svg").size(14).text_color(t.dim))
        .child(div().flex_1().text_size(13).child(tr("Permissions")))
        .child(div().text_size(12).text_color(t.muted).child(accessLabel))
        .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).text_color(t.dim)))
      .when(this.permOpen, (el) => el.child(v_flex().id("perm-menu").gap(2).px(4).pb(4).children(["read", "ask", "full"].map((id) => row(
        `perm-${id}`,
        id === "read" ? tr("Read only") : id === "full" ? tr("Full access") : tr("Ask"),
        access === id,
        () => { this.setAccess(id); this.permOpen = false; },
      )))))
      .child(div().h(31).px(9).flex().items_center().text_size(12).text_color(t.muted).cursor_pointer()
        .hover((style) => style.text_color(t.foreground))
        .on_click((_event, cx) => {
          this.menu = null;
          this.screen = "models";
          if (!this.draft) this.draft = blankProvider();
          cx.spawn(async (inner) => this.openDraft(inner));
        }).child(tr("Providers"))));
  }

  choiceMenu(t, id, choices, onPick) {
    return v_flex().id(`${id}-menu`).w_full().max_h(220).gap(2).p(6).rounded(10).bg(t.popover).border_1().border_color(t.border).overflow_y_scrollbar()
      .children(choices.map((choice) => this.link(`${id}-${String(choice.id).replace(/[^\w.-]+/g, "_")}`, choice.name || choice.id, (cx) => { onPick(choice.id); this.menu = null; cx.notify(); })));
  }

  async setAccess(id) {
    const previous = this.transcript.access || "ask";
    await this.ctl({ op: "access", access: id });
    if (previous === "read" || id === "read") {
      const pane = ownPane();
      const { data: meta } = await readJson(`${this.dir()}/meta.json`, {});
      if (meta.address) run("terminal.kill", { terminal: meta.address });
      if (pane) await this.spawn(pane);
    }
  }

  async openDraft(cx) {
    const providers = await catalog();
    this.providers = providers;
    this.draft = this.draft || { ...(providers.find((provider) => !provider.builtin) || blankProvider()), models: [] };
    if (!this.draft.models) this.draft.models = [];
    this.nameBox.set_value(this.draft.name || "");
    this.urlBox.set_value(this.draft.baseUrl || "");
    cx.notify();
  }

  renderModels(t, cx) {
    const providers = this.providers || [];
    const draft = this.draft || blankProvider();
    const kept = this.names.includes(draft.secret);
    return v_flex().id("providers").size_full().min_h(0).bg(t.background).p(12).gap(8)
      .child(h_flex().gap(8).items_center()
        .child(this.chip("back-chat", tr("Back"), false, () => { this.screen = "chat"; }))
        .child(div().text_size(15).font_medium().child(tr("Providers")))
        .child(this.chip("add-provider", tr("Add provider"), false, (cx) => {
          this.draft = blankProvider();
          this.nameBox.set_value("");
          this.urlBox.set_value("https://");
          cx.notify();
        })))
      .child(h_flex().flex_1().min_h(0).gap(12)
        .child(v_flex().id("provider-list").w(220).gap(4).overflow_y_scrollbar().children(providers.map((provider) => this.chip(`prov-${provider.id}`, provider.name, draft.id === provider.id, (cx) => {
          this.draft = { ...provider, models: [...(provider.models || [])] };
          this.nameBox.set_value(this.draft.name || "");
          this.urlBox.set_value(this.draft.baseUrl || "");
          cx.notify();
        }))))
        .child(this.editor(t, draft, kept, cx)));
  }

  editor(t, draft, kept, _cx) {
    const builtin = draft.builtin;
    return v_flex().id("provider-editor").flex_1().min_h(0).gap(8).overflow_y_scrollbar()
      .child(div().text_size(12).text_color(t.muted).child(builtin ? tr("Built-in") : tr("Custom provider")))
      .when(!builtin, (el) => el.child(labeled(t, tr("Provider name"), boxInput(t, this.nameBox))))
      .when(!builtin, (el) => el.child(labeled(t, tr("Base URL"), boxInput(t, this.urlBox))))
      .child(h_flex().gap(6).children(APIS.map((api) => this.chip(`api-${api.id}`, api.label, draft.api === api.id, (cx) => { if (!builtin) this.draft.api = api.id; cx.notify(); }))))
      .child(div().text_size(12).child(`${tr("API key")}: ${kept ? tr("Key kept") : tr("No key")} (${draft.secret})`))
      .child(boxInput(t, this.keyBox))
      .child(h_flex().gap(6)
        .child(this.chip("set-key", tr("Set key"), false, (cx) => cx.spawn(async (cx) => { await this.keepKey(draft); cx.notify(); })))
        .child(this.chip("test-key", tr("Test"), false, (cx) => cx.spawn(async (cx) => { await this.testProvider(draft); cx.notify(); })))
        .child(this.chip("refresh-models", tr("Refresh models"), false, (cx) => cx.spawn(async (cx) => { await this.refreshModels(draft); cx.notify(); })))
        .when(!builtin, (el) => el.child(this.chip("save-provider", tr("Save"), true, (cx) => cx.spawn(async (cx) => { await this.saveProvider(); cx.notify(); }))))
        .when(!builtin, (el) => el.child(this.chip("delete-provider", tr("Delete"), false, (cx) => cx.spawn(async (cx) => { await this.deleteProvider(draft.id); cx.notify(); })))))
      .child(div().text_size(12).text_color(t.muted).child(this.note || ""))
      .children((draft.models || []).map((model, index) => h_flex().id(`mdl-${index}`).gap(8).items_center()
        .child(this.chip(`en-${index}`, model.enabled === false ? "○" : "●", model.enabled !== false, (cx) => { model.enabled = model.enabled === false; cx.notify(); }))
        .child(div().flex_1().text_size(12).child(`${model.name} · ${model.contextWindow || "?"} ${tr("Context")}`))
        .when(model.vision, (el) => el.child(div().text_size(11).text_color(t.muted).child(tr("Vision"))))
        .when(model.reasoning, (el) => el.child(div().text_size(11).text_color(t.muted).child(tr("Reasoning"))))))
      .when(!builtin, (el) => el.child(this.chip("add-model", tr("Add model"), false, (cx) => {
        this.draft.models.push({ id: "model", name: "Model", contextWindow: 128000, maxTokens: 8192, vision: false, reasoning: false, enabled: true });
        cx.notify();
      })));
  }

  async keepKey(draft) {
    const value = this.keyBox.value();
    if (!draft.builtin && draft.name) {
      if (!draft.id || String(draft.id).startsWith("new-")) draft.id = slug(draft.name);
      draft.secret = secretName(draft.id);
    }
    if (!value) { this.note = tr("No key"); return; }
    const drop = `${ROOT()}/secret-drop`;
    await exec("mkdir", ["-p", drop]);
    await exec("chmod", ["700", drop]);
    const file = `${drop}/set-${Date.now()}`;
    await writeTextFile(file, value, null);
    this.keyBox.set_value("");
    const result = await exec(secretBin(), ["set", draft.secret, "--value-file", file]);
    await exec("rm", ["-f", file]);
    this.note = result.code === 0 ? tr("Key kept") : (result.stderr || tr("Connection failed")).split("\n").pop();
    await this.secretNames();
  }

  async testProvider(draft) {
    const result = await this.remoteModels(draft);
    this.note = result.ok ? `${tr("Connected")} (${result.models.length})` : (result.error || tr("Connection failed"));
  }

  async refreshModels(draft) {
    const result = await this.remoteModels(draft);
    if (!result.ok) { this.note = result.error || tr("Connection failed"); return; }
    const have = new Set((draft.models || []).map((model) => model.id));
    for (const id of result.models) {
      if (!have.has(id)) draft.models.push({ id, name: id, contextWindow: 128000, maxTokens: 8192, vision: false, reasoning: false, enabled: true });
    }
    this.note = tr("Connected");
  }

  async remoteModels(draft) {
    if (!draft.baseUrl) return { ok: false, error: tr("Base URL"), models: [] };
    const bridge = `${appHome()}/mods/chat-acp/bridge.mjs`;
    const result = await exec(secretBin(), ["run", draft.secret, "--", "node", bridge, "test", "--base", draft.baseUrl, "--api", draft.api, "--env", draft.secret]);
    try { return JSON.parse((result.stdout || "").trim().split("\n").pop()); } catch { return { ok: false, error: tr("Connection failed"), models: [] }; }
  }

  async saveProvider() {
    const draft = this.draft;
    if (!draft.name) return;
    if (!draft.id || draft.id.startsWith("new-")) draft.id = slug(draft.name);
    draft.secret = draft.secret || secretName(draft.id);
    draft.builtin = false;
    const { text, data } = await readJson(CATALOG(), { providers: [] });
    const providers = (data.providers || []).filter((provider) => provider.id !== draft.id);
    providers.push(publicProvider(draft));
    await writeTextFile(CATALOG(), JSON.stringify({ providers }, null, 1), text);
    await this.writePi(providers.map(publicProvider));
    this.providers = await catalog();
    this.note = tr("Save");
    const pane = ownPane();
    const { data: meta } = await readJson(`${this.dir()}/meta.json`, {});
    if (meta.address) run("terminal.kill", { terminal: meta.address });
    if (pane) await this.spawn(pane);
  }

  async deleteProvider(id) {
    const { text, data } = await readJson(CATALOG(), { providers: [] });
    const providers = (data.providers || []).filter((provider) => provider.id !== id);
    await writeTextFile(CATALOG(), JSON.stringify({ providers }, null, 1), text);
    await this.writePi(providers);
    this.providers = await catalog();
    this.draft = blankProvider();
  }

  async writePi(providers) {
    const modelsPath = `${home()}/.pi/agent/models.json`;
    const settingsPath = `${home()}/.pi/agent/settings.json`;
    const models = await readJson(modelsPath, { providers: {} });
    const settings = await readJson(settingsPath, {});
    await writeTextFile(modelsPath, JSON.stringify(mergeModels(models.data, providers), null, 2), models.text);
    if (Array.isArray(settings.data.enabledModels)) {
      await writeTextFile(settingsPath, JSON.stringify(enableModels(settings.data, providers), null, 2), settings.text);
    }
  }

  render(cx) {
    const t = theme();
    if (this.screen === "models") return this.renderModels(t, cx);
    if (this.box.value().includes("@") && !this.files.length && !this.listing) {
      this.listing = true;
      const cwd = this.transcript.cwd || home();
      cx.spawn(async (cx) => {
        const result = await exec("git", ["-C", cwd, "ls-files"]).catch(() => ({ stdout: "" }));
        this.files = (result.stdout || "").split("\n").filter(Boolean).slice(0, 400);
        this.listing = false;
        cx.notify();
      });
    }
    return this.renderChat(t, cx);
  }
}

function blankProvider() {
  const id = `new-${Date.now()}`;
  return { id, name: "", baseUrl: "https://", api: "openai-completions", secret: "CHAT_ACP_NEW", builtin: false, models: [] };
}

function labeled(t, label, child) {
  return v_flex().gap(4).child(div().text_size(12).text_color(t.muted).child(label)).child(child);
}

function boxInput(t, state) {
  return div().h(34).px(10).flex().items_center().rounded(8).border_1().border_color(t.input).bg(t.background)
    .child(Input.new(state).w_full());
}

function shortModel(value) {
  const raw = String(value || "").trim();
  const leaf = raw.includes("/") ? raw.split("/").pop() : raw;
  return leaf.length > 32 ? `${leaf.slice(0, 30)}…` : (leaf || "Model");
}

function shortThink(name, id) {
  const raw = String(name || id || "").replace(/^Thinking:\s*/i, "").trim();
  return raw || "Thinking";
}

function isBanner(text) {
  return /^pi v\d/i.test(String(text || "").trim()) && /##\s*(Skills|Context|Extensions)/.test(text);
}
