import { tr } from "./i18n.js";
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { closeOverlay, layouts, props, run, shared, theme } from "herdr";

// Names people see; any other layout shows its file name, capitalised.
const labels = new Map([["main", "Herdr"], ["ide", "Agent IDE (agent + browser + files)"], ["terminals", "Terminals"]]);
const pretty = (name) => labels.get(name) ?? name.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());

export default class LayoutSwitcher extends View {
  init(_props, cx) {
    this.cursor = null;
    this.focus = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.focus.focus();
  }

  choose(name) {
    if (!name) return;
    closeOverlay(props().overlay);
    if (name !== shared("layout")) run("layout.switch", { name });
  }

  render() {
    const t = theme();
    const names = layouts();
    const current = shared("layout");
    const cursor = [this.cursor, current].find(name => names.includes(name));

    return v_flex().id("layout-switcher").role("dialog").accessibility_label(tr("Layouts"))
      .track_focus(this.focus).size_full().min_h(0).p(14).gap(10).bg(t.popover)
      .on_key_down((event, cx) => {
        if (event.key === "escape") closeOverlay(props().overlay);
        else if (event.key === "enter") this.choose(cursor ?? names[0]);
        else if (names.length && (event.key === "up" || event.key === "down")) {
          const from = names.indexOf(cursor);
          const step = event.key === "up" ? -1 : 1;
          const index = from < 0 ? 0 : (from + step + names.length) % names.length;
          this.cursor = names[index];
          this.scroll.scroll_to_item(index);
          cx.notify();
        } else return;
        cx.stop_propagation();
      })
      .child(h_flex().h(28).flex_none().gap(8).items_center()
        .child(svg("mods/layout-switcher/layout.svg").size(17).text_color(t.muted))
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(tr("Layouts")))
        .child(div().id("layout-switcher-close").size(26).flex().items_center().justify_center().rounded(6)
          .role("button").accessibility_label(tr("Close")).tooltip(tr("Close · Esc")).cursor_pointer()
          .text_size(17).text_color(t.muted).hover(el => el.bg(t.hover).text_color(t.foreground))
          .on_click(() => closeOverlay(props().overlay)).child("×")))
      .child(v_flex().id("layout-switcher-list").role("list_box").accessibility_label(tr("Available layouts"))
        .flex_1().min_h(0).gap(4).overflow_y_scrollbar().track_scroll(this.scroll)
        .when(names.length === 0, el => el.child(div().p(8).text_size(13).text_color(t.muted).child(tr("No layouts"))))
        .children(names.map((name) => {
          const active = name === current;
          const focused = name === this.cursor;
          return h_flex().id(`layout-choice-${name}`).role("list_box_option").aria_selected(active)
            .h(38).px(10).flex_none().gap(8).items_center().rounded(7).border_1()
            .bg(active ? t.selected : t.popover).border_color(focused ? t.accent : active ? t.border : t.popover)
            .text_size(13).text_color(t.foreground).cursor_pointer()
            .hover(el => active ? el.border_color(t.accent) : el.bg(t.hover))
            .on_click(() => this.choose(name))
            .child(div().flex_1().min_w(0).truncate().child(pretty(name)))
            .when(active, el => el.child(div().flex_none().text_size(11).font_semibold().text_color(t.foreground).child("✓ Active")));
        })));
  }
}
