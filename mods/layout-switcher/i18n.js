// UI language for the Agent IDE mods. shared "ui.lang" = "ru" | "en" (the Ru/En button in the sidebar's top row).
// tr("Files") -> "Файлы" in Russian, the same string otherwise. Strings missing from RU stay English.
import { shared } from "herdr";
import RU from "./ru.js";

export const lang = () => shared("ui.lang") ?? "ru";
export const tr = (s) => (typeof s === "string" && lang() === "ru" ? RU[s] ?? s : s);
// trf("Next in {0} min", n) -> "Через 5 мин": the dictionary's sentence with the values put in (English when it has none).
export const trf = (s, ...v) => tr(s).replace(/\{(\d+)\}/g, (_, i) => String(v[Number(i)] ?? ""));
