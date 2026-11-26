// Toolbar of the Browser tab, in the app's own style: back, forward, reload, address, Select, device mode,
// screenshot and a "…" menu. In device mode a second row sets the page's size (preset, width × height, rotate).
// It drives the viewer (mods/ide-browser/viewer.js) through two files in ~/.local/state/herdr-ide:
// <project>.state.json (the viewer writes: url, select, device, note) and <project>.ctl (this mod appends commands).
// <project> is shared("ide-browser").task, which the ide-browser mod keeps current: one browser per project.
import { tr } from "./i18n.js";
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { exec, readTextFile, home, theme, shared, run, openOverlay } from "herdr";

const DIR = () => `${home()}/.local/state/herdr-ide`;
const task = () => shared("ide-browser")?.task ?? null;
const ROW = 44, DEVICE_ROW = 40;

// Device presets, also used by the menu. Responsive is whatever size is typed.
const PRESETS = [
  ["iPhone SE", 375, 667], ["iPhone 15", 393, 852], ["Pixel 7", 412, 915],
  ["iPad mini", 768, 1024], ["iPad Pro 11", 834, 1194], ["Laptop", 1280, 800], ["Desktop", 1920, 1080],
];

export default class IdeBrowserBar extends View {
  init(_props, cx) {
    this.st = null; this.task = null; this.focused = false; this.seenFocus = 0; this.height = null;
    this.input = InputState.new({ placeholder: tr("Enter an address or a search") });
    this.input.on("submit", (_e, cx) => {
      const v = this.input.value().trim();
      if (v) this.ctl(`nav ${v}`);
      cx.notify();
    });
    this.input.on("focus", (_e, cx) => { this.focused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.focused = false; cx.notify(); });
    this.wIn = InputState.new({ placeholder: "w" });
    this.hIn = InputState.new({ placeholder: "h" });
    this.sizeFocus = 0;
    for (const i of [this.wIn, this.hIn]) {
      i.on("submit", (_e, cx) => { this.applySize(); cx.notify(); });
      i.on("focus", (_e, cx) => { this.sizeFocus++; cx.notify(); });
      i.on("blur", (_e, cx) => { this.sizeFocus = Math.max(0, this.sizeFocus - 1); cx.notify(); });
    }
    cx.timer.every(500, (cx) => this.poll(cx));
    this.poll(cx);
  }

  ctl(line) {
    const t = task();
    if (!t) return;
    exec("sh", ["-c", `mkdir -p "${DIR()}" && printf '%s\\n' "$1" >> "${DIR()}/${t}.ctl"`, "ctl", line]).catch(() => {});
  }

  applySize() {
    const w = parseInt(this.wIn.value(), 10), h = parseInt(this.hIn.value(), 10);
    if (w > 0 && h > 0) this.ctl(`device ${w} ${h}`);
  }

  poll(cx) {
    cx.spawn(async (cx) => {
      const t = task();
      if (t !== this.task) { this.task = t; this.st = null; this.height = null; }
      let st = null;
      if (t) {
        try { st = JSON.parse((await readTextFile(`${DIR()}/${t}.state.json`)) ?? "null"); } catch {}
        if (st && Date.now() - st.at > 8000) st = null;
      }
      const before = JSON.stringify(this.st);
      this.st = st;
      if (st) {
        const shown = /start\.html/.test(st.url || "") || st.url === "about:blank" ? "" : (st.url || "");
        if (!this.focused && this.input.value() !== shown) this.input.set_value(shown);
        if (st.focusAddr && st.focusAddr !== this.seenFocus) {
          this.seenFocus = st.focusAddr;
          this.input.focus();
          this.input.set_selected_range({ start: 0, end: this.input.value().length });
        }
        if (st.device && !this.sizeFocus) {
          if (this.wIn.value() !== String(st.device.w)) this.wIn.set_value(String(st.device.w));
          if (this.hIn.value() !== String(st.device.h)) this.hIn.set_value(String(st.device.h));
        }
        // The bar is one layout block: tall enough for the device row while device mode is on.
        const want = st.device ? ROW + DEVICE_ROW : ROW;
        if (this.height !== want) { this.height = want; run("layout.resize", { id: "browser-bar", px: want }); }
      }
      if (before !== JSON.stringify(this.st)) cx.notify();
    });
  }

  menu(kind, width, height) { openOverlay({ mod: "ide-browser-menu", kind: "popup", width, height, props: { menu: kind, task: task() } }); }

  render() {
    const t = theme(), st = this.st, live = Boolean(st?.live), device = st?.device ?? null;
    const note = st && st.note && Date.now() - st.noteAt < 6000 ? st.note : null;
    const btn = (id, icon, tip, onClick, opts = {}) => div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(opts.on ? t.foreground : live ? t.muted : t.dim).bg(opts.on ? t.selected : t.chrome).tooltip(tr(tip))
      .when(live, el => el.cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground)).on_click(onClick))
      .child(svg(`mods/ide-browser-bar/${icon}.svg`).size(15));
    const cmd = (c) => () => this.ctl(c);
    const row1 = h_flex().w_full().h(ROW).flex_none().px(10).gap(4).items_center()
      .child(btn("bb-back", "back", "Back · Alt+←", cmd("back")))
      .child(btn("bb-forward", "forward", "Forward · Alt+→", cmd("forward")))
      .child(btn("bb-reload", "reload", "Reload · Ctrl+R", cmd("reload")))
      .child(h_flex().id("bb-address").flex_1().min_w(0).h(28).mx(4).px(10).gap(8).items_center().rounded(8).border_1()
        .border_color(this.focused ? t.accent : t.input).bg(t.background)
        .child(svg("mods/ide-browser-bar/globe.svg").size(14).flex_none().text_color(t.dim))
        .child(note
          ? div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.done).child(tr(note))
          : Input.new(this.input).flex_1().min_w(0).h_full().text_size(12.5).text_color(t.foreground)))
      .child(h_flex().id("bb-select").h(28).px(10).gap(6).flex_none().items_center().rounded(6).text_size(12)
        .bg(st?.select ? t.selected : t.chrome).text_color(st?.select ? t.foreground : live ? t.muted : t.dim)
        .border_1().border_color(st?.select ? t.accent : t.chrome)
        .tooltip(tr("Point an element or a region out to the agent: click an element or drag a frame"))
        .when(live, el => el.cursor_pointer().hover(s => s.bg(t.hover)).on_click(cmd("select")))
        .child(svg("mods/ide-browser-bar/select.svg").size(14)).child(st?.select ? tr("Pick on the page") : tr("Select")))
      .child(btn("bb-device", "device", "Device mode: responsive sizes, phones and tablets", cmd(device ? "device off" : "device 390 844"), { on: Boolean(device) }))
      .child(btn("bb-shot", "camera", "Take screenshot (saved and copied)", cmd("screenshot")))
      .child(btn("bb-more", "more", "More", () => this.menu("more", 236, 262)));

    const preset = device && PRESETS.find(([, w, h]) => w === device.w && h === device.h);
    const field = (state) => div().w(54).h(24).flex_none().px(6).rounded(5).border_1().border_color(t.input).bg(t.background)
      .child(Input.new(state).size_full().text_size(12).text_color(t.foreground));
    const row2 = device && h_flex().w_full().h(DEVICE_ROW).flex_none().px(10).gap(8).items_center().border_t(1).border_color(t.border)
      .child(h_flex().id("bb-preset").h(26).px(8).gap(6).flex_none().items_center().rounded(6).text_size(12).bg(t.chrome).text_color(t.muted)
        .border_1().border_color(t.input).cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => this.menu("presets", 250, PRESETS.length * 30 + 44))
        .child(preset ? preset[0] : tr("Responsive")).child(svg("mods/ide-browser-bar/chevron.svg").size(12)))
      .child(field(this.wIn))
      .child(div().text_size(12).text_color(t.dim).child("×"))
      .child(field(this.hIn))
      .child(btn("bb-rotate", "rotate", "Rotate", () => this.ctl(`device ${device.h} ${device.w}`)))
      .child(div().flex_1())
      .child(div().text_size(11.5).text_color(t.dim).child(tr("Fit")));

    return v_flex().size_full().min_w(0).bg(t.chrome).border_b(1).border_color(t.border).child(tr(row1)).when(Boolean(row2), el => el.child(tr(row2)));
  }
}
