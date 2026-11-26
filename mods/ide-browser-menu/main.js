// Popup menus of the Browser toolbar: props().menu is "more" (the "…" menu) or "presets" (device sizes).
// A choice appends a command to the project's control file, which the viewer reads (see ide-browser-bar).
import { tr } from "./i18n.js";
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, exec, home, props, theme } from "herdr";

const PRESETS = [
  ["iPhone SE", 375, 667], ["iPhone 15", 393, 852], ["Pixel 7", 412, 915],
  ["iPad mini", 768, 1024], ["iPad Pro 11", 834, 1194], ["Laptop", 1280, 800], ["Desktop", 1920, 1080],
];

const MORE = [
  { label: tr("Take Screenshot"), hint: "saved and copied", cmd: "screenshot" },
  { label: tr("Screenshot to Agent"), hint: "sends the file's path", cmd: "screenshot agent" },
  null,
  { label: tr("Hard Reload"), hint: "ignores the cache", cmd: "hardreload" },
  { label: tr("Copy Current URL"), cmd: "copyurl" },
  { label: tr("Open in Chrome Window"), cmd: "window" },
  null,
  { label: tr("Clear Cookies"), cmd: "clearcookies" },
  { label: tr("Clear Cache"), cmd: "clearcache" },
  { label: tr("Clear Site Data"), hint: "this site", cmd: "clearsite" },
];

export default class IdeBrowserMenu extends View {
  pick(cmd) {
    const { task, overlay } = props();
    closeOverlay(overlay);
    if (!task) return;
    const dir = `${home()}/.local/state/herdr-ide`;
    exec("sh", ["-c", `mkdir -p "${dir}" && printf '%s\\n' "$1" >> "${dir}/${task}.ctl"`, "ctl", cmd]).catch(() => {});
  }

  render() {
    const t = theme();
    const presets = props()?.menu === "presets";
    const items = presets
      ? PRESETS.map(([label, w, h]) => ({ label, hint: `${w} × ${h}`, cmd: `device ${w} ${h}` }))
      : MORE;
    return v_flex().id("ide-browser-menu").size_full().min_h(0).p(6).gap(1).bg(t.popover)
      .children(items.map((it, i) => it === null
        ? div().h(1).my(4).mx(4).bg(t.border)
        : h_flex().id(`bm-${i}`).h(28).px(10).gap(8).flex_none().items_center().rounded(6).text_size(12.5).text_color(t.foreground)
          .cursor_pointer().hover(s => s.bg(t.hover)).on_click(() => this.pick(it.cmd))
          .child(div().flex_1().min_w(0).truncate().child(tr(it.label)))
          .when(Boolean(it.hint), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(tr(it.hint))))));
  }
}
