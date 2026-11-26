// Rename a tab, with an emoji picker. Opened by tabs-ide on a double click:
//   openOverlay({ mod: "rename-dialog", kind: "dialog", width: 480, height: 410, props: { id: <tab id>, value: <name> } })
// An emoji is the name's first character: picking one puts it there (swapping the one that was there), "No emoji" takes it
// off. Enter saves (`tab.rename`; an empty name goes back to the tab's number), Esc cancels. Recent picks are kept.
import { tr } from "./i18n.js";
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme } from "herdr";
import { keepKeys, dropKeys } from "./keyholder.js";
const HOLDER = "dialog:rename-dialog";

const SETS = [
  ["Work", "🚀 🔧 🛠️ 🐞 ✅ ❌ ⚠️ 📦 🧪 📝 📄 📁 🔥 ⚡ 🔒 🔑 🌐 🗄️ 💾 🧹 🔍 🧠 🤖 📊 📈 🧩 🎯 💡 ⏱️ 🔔 🚧 🏗️ ♻️ 📌 🔗 ☁️ 🐳 ⚙️ 🧰 🛡️ 💬 📣 🔬 🧵 🪄 🧮 🛒 💳 📧 📱 💻 🖥️ 🗂️ 🧭"],
  ["Faces", "😀 😎 🤔 😅 🥳 🤯 😴 🤓 🧐 😡 😱 🙏 👍 👎 👀 💪 🙌 🫡 😈 🤝 ✨ ❤️ 💀 🎉 🍕 ☕ 🤌 🫠 😬 🥲 😇 🤪 🙈 👋 ✌️ 🫶"],
  ["Nature", "🌱 🌳 🌸 🌞 🌙 ⭐ ⛅ 🌈 ❄️ 🌊 🐱 🐶 🦊 🐼 🦄 🐙 🦉 🐝 🦋 🐢 🐧 🦁 🐸 🍎 🍋 🍇 🥑 🍔 🌮 🍩 🍺 🌵 🍄 🌻 🪴"],
  ["Symbols", "🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 ▶️ ⏸️ ⏹️ 🔼 🔽 ➕ ➖ ✔️ ❗ ❓ 💯 🆕 🆗 🔜 ♾️ 🏁 🚩 ⛔ 🚫 🔰 ⭕ 🔶 🔷 🟥 🟧 🟨 🟩 🟦 🟪"],
].map(([name, list]) => [name, list.split(" ")]);

// A leading emoji (with its variation selector and joined parts) and the spaces after it.
const LEAD = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}\uFE0F?)*|[\u{1F1E6}-\u{1F1FF}]{2})\s*/u;

export default class Rename extends View {
  init(_props, cx) {
    this.text = props()?.value ?? "";
    this.recent = (() => { try { return JSON.parse(localStorage.getItem("recent") ?? "[]").slice(0, 24); } catch { return []; } })();
    this.cat = 0; // the Recent tab when there are any, else Work
    this.input = InputState.new({ value: this.text, placeholder: tr("Tab name") });
    if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", () => this.submit());
    this.focused = true;
    this.input.on("focus", (_e, cx) => { this.focused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.focused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    // The keyboard is this dialog's while it is open: the chat behind it takes nothing back.
    keepKeys(HOLDER);
    cx.timer.every(2000, () => keepKeys(HOLDER));
    this.handle = cx.focus_handle();
  }

  close() { dropKeys(HOLDER); }

  lead() { return this.text.match(LEAD)?.[1] ?? null; }

  // Puts `emoji` first in the name (null: takes the first one off) and keeps typing where it was.
  setEmoji(emoji, cx) {
    const rest = this.text.replace(LEAD, "");
    this.text = emoji ? (rest ? `${emoji} ${rest}` : `${emoji} `) : rest;
    this.input.set_value(this.text);
    if (emoji) {
      this.recent = [emoji, ...this.recent.filter((x) => x !== emoji)].slice(0, 24);
      try { localStorage.setItem("recent", JSON.stringify(this.recent)); } catch {}
    }
    this.input.focus();
    cx.notify();
  }

  submit() {
    const p = props();
    dropKeys(HOLDER); closeOverlay(p.overlay);
    run("tab.rename", { id: p.id, name: this.text.trim() });
  }

  key(e, cx) {
    if (e.key === "escape") { dropKeys(HOLDER); closeOverlay(props().overlay); cx.stop_propagation(); }
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const lead = this.lead();
    const names = [...(this.recent.length ? [["Recent", this.recent]] : []), ...SETS];
    const cat = Math.min(names.length - 1, this.cat);
    const shown = names[cat][1];
    const tab = ([name], i) => div().id(`cat-${name}`).h(26).px(10).flex().items_center().rounded(13).text_size(12)
      .bg(i === cat ? t.selected : t.popover).text_color(i === cat ? t.foreground : t.muted).cursor_pointer()
      .hover((s) => s.bg(i === cat ? t.selected : t.hover))
      .on_click((_e, cx) => { this.cat = i; cx.notify(); }).child(tr(name));
    const cell = (e) => div().id(`e-${e}`).size(35).flex().items_center().justify_center().rounded(8).text_size(19).cursor_pointer()
      .bg(e === lead ? t.selected : t.popover).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.setEmoji(e, cx)).child(tr(e));
    const button = (id, label, primary, onClick) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(onClick).child(tr(label));
    return v_flex().id("rename").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).p(18).gap(12).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(tr("Rename tab")))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(h_flex().gap(8).items_center()
        .child(div().size(36).flex_none().flex().items_center().justify_center().rounded(9).border_1().border_color(t.input).bg(t.background)
          .text_size(19).text_color(lead ? t.foreground : t.dim).child(tr(lead ?? "🙂")))
        .child(div().flex_1().min_w(0).child(Input.new(this.input).h(36).w_full().px(10).rounded(9).border_1()
          .border_color(this.focused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))))
      .child(h_flex().gap(4).items_center().flex_wrap().children(names.map((n, i) => tab(n, i)))
        .child(div().flex_1())
        .when(Boolean(lead), (el) => el.child(div().id("no-emoji").h(26).px(10).flex().items_center().rounded(13).text_size(12).text_color(t.dim)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.setEmoji(null, cx)).child(tr("No emoji")))))
      .child(h_flex().id("grid").flex_1().min_h(0).flex_wrap().content_start().gap(2).overflow_y_scrollbar().children(shown.map((e) => cell(e))))
      .child(div().text_size(11.5).text_color(t.dim).child(tr("The emoji becomes the first character of the name. Empty name: the tab's number.")))
      .child(h_flex().gap(8).justify_end()
        .child(button("rn-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("rn-save", "Save", true, () => this.submit())));
  }
}
