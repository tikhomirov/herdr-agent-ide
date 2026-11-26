// UI language shared with the Agent IDE: shared "ui.lang" = "ru" | "en".
import { shared } from "herdr";
import RU from "./ru.js";

export const lang = () => shared("ui.lang") ?? "ru";
export const tr = (s) => (typeof s === "string" && lang() === "ru" ? RU[s] ?? s : s);
