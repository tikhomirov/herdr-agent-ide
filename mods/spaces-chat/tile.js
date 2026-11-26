// Adapted from petekp/coordinator (MIT, (c) 2026 Pete Petrash).
// A space's letter tile, shared by the Spaces and Agents lists: the theme's own
// color for the space, a subtle top-to-bottom gradient, and a letter dark or
// light enough to read on it.

import { div, Background, PathBuilder } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared } from "herdr";

export const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mix = (a, b, f) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * f));
const luminance = (h) => {
  const [r, g, b] = rgb(h).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// `override`: a palette key that replaces the space's color, such as an agent's own.
export function spaceColor(t, spaceId, override) {
  // No color picked: a stable one from the space's id.
  const h = [...String(spaceId)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const key = override ?? (shared("space.colors") ?? {})[spaceId] ?? PALETTE[h % PALETTE.length];
  const color = key.startsWith("#") ? key : t[key];
  return (color ?? t.accent).slice(0, 7);
}

// A rounded rectangle in percentages, so it fills whatever box holds it.
function rounded(r) {
  const e = `${100 - r}%`, s = `${r}%`;
  return PathBuilder.fill()
    .move_to(s, 0).line_to(e, 0).arc_to(s, s, 0, false, true, "100%", s)
    .line_to("100%", e).arc_to(s, s, 0, false, true, e, "100%")
    .line_to(s, "100%").arc_to(s, s, 0, false, true, 0, e)
    .line_to(0, s).arc_to(s, s, 0, false, true, s, 0)
    .close().build();
}

export function spaceTile(t, { id, name, color }, size = 18) {
  const base = spaceColor(t, id, color);
  const fill = Background.linear_gradient(180, Background.stop(mix(base, "#ffffff", 0.2), 0), Background.stop(mix(base, "#000000", 0.12), 1));
  const dark = luminance(base) > 0.3;
  const letter = dark ? mix(base, "#000000", 0.8) : mix(base, "#ffffff", 0.92);
  return div()
    .relative()
    .size(size)
    .flex_none()
    .child(globalThis.window.paint_path(rounded(28), fill).absolute().top(0).left(0).size_full())
    .child(h_flex().absolute().top(0).left(0).size_full().items_center().justify_center()
      .child(div().font_family(".SystemUIFont").text_size(size * 0.6).font_weight(700).text_color(letter)
        .child([...(name || "?")][0].toUpperCase())));
}
