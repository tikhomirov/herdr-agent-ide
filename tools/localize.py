#!/usr/bin/env python3
"""Adds Russian/English UI to the installed mods: copies i18n/ into each mod and wraps UI string literals with tr().
Only literals in UI positions are wrapped (.child("X"), .tooltip("X"), label:/title:/placeholder:/hint:/verb:/detail:/body: "X")
and only when "X" is in i18n/ru.js. Idempotent; re-run after updating a mod (originals are kept as *.js.orig-i18n).
  localize.py [mod ...]   (default: the list below)    localize.py --undo"""
import os, re, shutil, sys, json
here = os.path.dirname(os.path.abspath(__file__)) + "/../i18n"
home = os.environ.get("HERDR_APP_HOME", os.path.expanduser("~/.config/herdr-app")) + "/mods"
MODS = "tabs-ide-tasks agents-ide ide-topbar ide-browser-bar ide-browser-menu remote-files spaces-chat workspace-status-chat pane-chat new-menu-tasks menu-tasks layout-switcher tasks workspace-chrome newspace confirm-chat prompt-chat rename-dialog changes task-pr task-browser accept-card".split()
ru = open(f"{here}/ru.js").read()
keys = set(json.loads(ru[ru.index("{"):ru.rindex("}") + 1]))
POS = r'(\.child\(\s*|\.tooltip\(\s*|accessibility_label\(\s*|\b(?:label|title|placeholder|hint|verb|detail|body):\s*)'
rx = re.compile(POS + r'"((?:[^"\\\n]|\\.)*)"')
undo = "--undo" in sys.argv
for m in [a for a in sys.argv[1:] if not a.startswith("--")] or MODS:
    d = f"{home}/{m}"
    if not os.path.isdir(d): continue
    for f in os.listdir(d):
        p = f"{d}/{f}"
        if not f.endswith(".js") or f in ("i18n.js", "ru.js", "emoji-data.js") or f.endswith(".d.ts"): continue
        bak = p + ".orig-i18n"
        if undo:
            if os.path.exists(bak): shutil.move(bak, p)
            continue
        s = open(p).read()
        if os.path.exists(bak): s = open(bak).read()   # always start from the original
        n = rx.sub(lambda g: f'{g.group(1)}tr("{g.group(2)}")' if g.group(2).replace('\\"', '"') in keys else g.group(0), s)
        if "tr(" not in n or re.search(r'\bfunction tr\b|\bconst tr\b', n): continue
        i = re.search(r'^import ', n, re.M)
        if not i: continue
        if not os.path.exists(bak): open(bak, "w").write(s)
        imp = '' if 'from "./i18n.js"' in n else 'import { tr } from "./i18n.js";\n'
        open(p, "w").write(n[:i.start()] + imp + n[i.start():])
    if not undo:
        shutil.copy(f"{here}/i18n.js", d); shutil.copy(f"{here}/ru.js", d)
print("done")
