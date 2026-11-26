// UI language for the Agent IDE mods. shared "ui.lang" = "ru" | "en" (the Ru/En button in the sidebar's top row).
// tr("Files") -> "Файлы" in Russian, the same string otherwise. Strings missing from RU stay English.
import { shared } from "herdr";
import RU from "./ru.js";

export const lang = () => shared("ui.lang") ?? "ru";
export const tr = (s) => (typeof s === "string" && lang() === "ru" ? RU[s] ?? s : s);
