// Pi's provider and model page, kept in this mod. Nothing in the window
// opens it right now: Pi is chosen from the chat menu.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, closeOverlay, props } from "herdr";
import { bindPi } from "./page.js";

export default class PiSettings extends View {
  init(_props, cx) {
    this.pi = { providers: [], models: [], provider: "", model: "", note: "" };
    cx.spawn(async (cx) => { await this.loadPi(); cx.notify(); });
  }

  heading(t, text) {
    return div().pt(6).pb(8).text_size(12).font_semibold().text_color(t.dim).child(text.toUpperCase());
  }

  row(t, title, about, control) {
    return h_flex().w_full().gap(16).py(12).items_center().border_b(1).border_color(t.border)
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().text_size(14).text_color(t.foreground).child(title))
        .when(Boolean(about), (el) => el.child(div().text_size(12.5).line_height("18px").text_color(t.dim).child(about))))
      .child(div().flex_none().child(control));
  }

  button(t, id, label, onClick) {
    return div().id(id).px(12).py(5).rounded(7).border_1().border_color(t.border).bg(t.raised).cursor_pointer()
      .text_size(13).text_color(t.foreground).hover((s) => s.bg(t.hover)).on_click(onClick).child(label);
  }

  render() {
    const t = theme();
    return v_flex().id("pi-settings").size_full().bg(t.background).px(28).py(22).overflow_y_scroll()
      .child(h_flex().pb(8).items_center()
        .child(div().flex_1().text_size(16).font_semibold().text_color(t.foreground).child("Pi"))
        .child(this.button(t, "pi-close", "Close", () => closeOverlay(props()?.overlay))))
      .child(this.piPage(t));
  }
}

bindPi(PiSettings);
