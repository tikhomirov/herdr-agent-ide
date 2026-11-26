// Same contract as the chat mod: shared "keyboard.holder" = { who, at }. A dialog renews its
// claim every few seconds; this chat does not take the keyboard back while that claim is fresh.
import { shared, setShared } from "herdr";

export const KEY_HOLDER = "keyboard.holder";
const DIALOG_FRESH = 6000;
const isDialog = (holder) => String(holder?.who ?? "").startsWith("dialog:");

export function holdKeys(who) {
  if (!who || shared(KEY_HOLDER)?.who === who) return;
  setShared(KEY_HOLDER, { who, at: Date.now() });
}

export function keepKeys(who, now = Date.now()) {
  const h = shared(KEY_HOLDER);
  if (h?.who === who && now - (h.at ?? 0) < DIALOG_FRESH / 3) return;
  setShared(KEY_HOLDER, { who, at: now });
}

export function dropKeys(who) {
  if (shared(KEY_HOLDER)?.who === who) setShared(KEY_HOLDER, { who: null, at: Date.now() });
}

export const dialogHolds = (holder, now = Date.now()) => isDialog(holder) && now - (holder.at ?? 0) < DIALOG_FRESH;
