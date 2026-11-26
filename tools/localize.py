#!/usr/bin/env python3
"""Adds Russian/English UI: copies i18n/ into each mod and wraps UI string literals with tr().
Only literals in UI positions are wrapped (.child("X"), .tooltip("X"), label:/title:/placeholder:/hint:/verb:/detail:/body: "X")
and only when "X" is in i18n/ru.js. Idempotent.
  localize.py [mod ...]            the mods in this repo (what install.sh ships)
  localize.py --home [mod ...]     the mods in $HERDR_APP_HOME instead
  localize.py --undo               restore *.js.orig-i18n where those backups exist
"""
import os, re, shutil, sys, json
here = os.path.dirname(os.path.abspath(__file__)) + "/../i18n"
repo = os.path.dirname(os.path.abspath(__file__)) + "/../mods"
installed = os.environ.get("HERDR_APP_HOME", os.path.expanduser("~/.config/herdr-app")) + "/mods"
home = installed if "--home" in sys.argv else repo
MODS = ("tabs-ide-tasks agents-ide ide-topbar ide-browser ide-browser-bar ide-browser-menu remote-files spaces-chat workspace-status-chat pane-chat new-menu-tasks menu-tasks "
        "layout-switcher tasks newspace coordinator confirm-chat prompt-chat rename-dialog task-pr task-browser accept-card chat chat-models chat-sessions chat-react chat-image "
        "chat-acp coord-settings git-graph artifacts task-artifacts toasts tasks-menu").split()
ru = open(f"{here}/ru.js").read()
keys = set(json.loads(ru[ru.index("{"):ru.rindex("}") + 1]))
POS = r'(\.child\(\s*|\.tooltip\(\s*|accessibility_label\(\s*|\b(?:label|title|placeholder|hint|verb|detail|body|text|about|heading|note|empty|words):\s*)'
rx = re.compile(POS + r'"((?:[^"\\\n]|\\.)*)"')
IDENT = re.compile(r'^[A-Za-z_$][\w$]*(?:(?:\?\.|\.)[A-Za-z_$][\w$]*)*$')
STR = re.compile(r'"((?:[^"\\\n]|\\.)*)"')

def balanced(s, i):
    """Index of the ')' closing the call whose '(' is just before i, or -1 (strings and templates skipped)."""
    depth, q = 1, None
    while i < len(s):
        c = s[i]
        if q:
            if c == "\\": i += 1
            elif c == q: q = None
        elif c in "\"'`": q = c
        elif c == "(": depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0: return i
        i += 1
    return -1

def wrap_calls(s):
    """tr() around a .child()/.tooltip() argument that is a plain name (W.about, x.label) or a ternary/|| of literals."""
    out, i = [], 0
    for m in re.finditer(r'\.(?:child|tooltip)\(', s):
        a = m.end()
        if a < i: continue
        e = balanced(s, a)
        if e < 0: continue
        arg = s[a:e].strip()
        if IDENT.match(arg) and not arg.startswith(("tr", "el", "div")):
            out.append(s[i:a] + f"tr({arg})"); i = e
        elif "(" not in arg and re.search(r'\?|\|\||\?\?', arg) and not arg.startswith("tr("):
            out.append(s[i:a] + f"tr({arg})"); i = e
    out.append(s[i:])
    return "".join(out)

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
        n = wrap_calls(n)
        if "tr(" not in n or re.search(r'\bfunction tr\b|\bconst tr\b', n): continue
        i = re.search(r'^import ', n, re.M)
        if not i: continue
        if home == installed and not os.path.exists(bak): open(bak, "w").write(s)
        imp = '' if 'from "./i18n.js"' in n else 'import { tr } from "./i18n.js";\n'
        open(p, "w").write(n[:i.start()] + imp + n[i.start():])
    if not undo:
        shutil.copy(f"{here}/i18n.js", d); shutil.copy(f"{here}/ru.js", d)
print("done")
