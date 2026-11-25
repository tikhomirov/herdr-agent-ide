#!/usr/bin/env python3
"""Put the Pi item back into Herdr's Settings after an app update replaces that file.

Layouts cannot mount a settings section. The page itself is mods/pi-settings.
This only adds the menu item that opens it. Safe to run twice.
"""
import sys

path = sys.argv[1]
text = open(path, encoding="utf-8").read()
if 'mod: "pi-settings"' in text or "mod: 'pi-settings'" in text:
    print("settings already open pi-settings")
    raise SystemExit(0)

old_import = "playSound, props, closeOverlay, notify, window } from \"herdr\";"
new_import = "playSound, props, closeOverlay, openOverlay, notify, window } from \"herdr\";"
old_section = '  { id: "privacy", title: "Privacy", icon: "shield" },\n];'
new_section = '  { id: "privacy", title: "Privacy", icon: "shield" },\n  { id: "pi", title: "Pi", icon: "server" },\n];'
old_click = 'if (s.id === "machines") cx.spawn(async (cx) => { await this.loadMachines(); cx.notify(); });\n              cx.notify();'
new_click = 'if (s.id === "machines") cx.spawn(async (cx) => { await this.loadMachines(); cx.notify(); });\n              if (s.id === "pi") openOverlay({ mod: "pi-settings", kind: "dialog", frame: "none", width: 720, height: 640 });\n              cx.notify();'
old_body = """                        : this.section === "privacy"
                          ? this.privacy(t)
                          : this.updates(t),"""
new_body = """                        : this.section === "privacy"
                          ? this.privacy(t)
                          : this.section === "pi"
                            ? div().text_size(14).text_color(t.foreground).child("Pi’s provider and models open in their own window, from the mod pi-settings.")
                            : this.updates(t),"""

missing = [name for name, old in (("import", old_import), ("section", old_section), ("click", old_click), ("body", old_body)) if old not in text]
if missing:
    print("settings file has no place to attach Pi:", ", ".join(missing), file=sys.stderr)
    raise SystemExit(1)
text = text.replace(old_import, new_import, 1).replace(old_section, new_section, 1).replace(old_click, new_click, 1).replace(old_body, new_body, 1)
open(path, "w", encoding="utf-8").write(text)
print("attached Pi to", path)
