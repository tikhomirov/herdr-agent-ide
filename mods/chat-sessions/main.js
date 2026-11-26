// The chat's history list: a popover above the chat's history button (mods/chat) with the agent's saved
// conversations for this folder, newest first, the one open now checked. A click on another one goes back through
// shared "chat.sessionreq" = { pane, at, session }; the chat restarts the agent on it.
// Props: { pane, sessions: [{ id, at, title, turns }], current: id | null, width, height, overlay }

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, props, setShared, closeOverlay } from "herdr";

export const ROW = 44, HEAD = 30, PAD = 5;

function ago(ms) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(ms).toLocaleDateString();
}

export default class Sessions extends View {
  init(_props, _cx) {
    this.p = props() ?? {};
  }

  pick(s) {
    if (s.id !== this.p.current) setShared("chat.sessionreq", { pane: this.p.pane, at: Date.now(), session: s.id });
    closeOverlay(this.p.overlay);
  }

  render() {
    const t = theme();
    const list = this.p.sessions ?? [];
    const W = this.p.width ?? 340, H = this.p.height ?? 400;
    const box = v_flex().id("sessions-menu").w_full().flex_none().p(PAD).rounded(8).bg(t.popover).border_1().border_color(t.border).shadow_md()
      .text_size(12.8).text_color(t.foreground)
      .child(h_flex().h(HEAD).flex_none().px(9).items_center().text_size(11.5).text_color(t.dim).child("Conversations in this folder"))
      .child(list.length === 0
        ? div().h(ROW).px(9).flex().items_center().text_color(t.dim).child("No saved conversations yet.")
        : v_flex().id("sessions-list").max_h(H - HEAD - 2 * PAD - 4).overflow_y_scroll().gap(1)
          .children(list.map((s) => {
            const now = s.id === this.p.current;
            return h_flex().id(`s-${s.id}`).w_full().h(ROW).flex_none().px(9).gap(10).items_center().rounded(7).cursor_pointer()
              .hover((x) => x.bg(t.selected)).when(now, (el) => el.bg(t.selected))
              .on_click((_e, cx) => { cx.stop_propagation(); this.pick(s); cx.notify(); })
              .child(v_flex().flex_1().min_w(0).gap(1)
                .child(div().w_full().truncate().child(s.title || "(no messages yet)"))
                .child(div().text_size(11).text_color(t.dim).child(`${s.turns} message${s.turns === 1 ? "" : "s"} · ${ago(s.at)}`)))
              .when(now, (el) => el.child(svg("mods/chat-sessions/check.svg").size(14).flex_none().text_color(t.muted)));
          })));
    return v_flex().id("sessions-area").w(W).h(H).justify_end()
      .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); closeOverlay(this.p.overlay); } })
      .child(box);
  }
}
