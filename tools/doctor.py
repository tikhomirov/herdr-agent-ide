#!/usr/bin/env python3
"""Checks that Agent IDE is installed whole and will work: the layout, every mod it needs, the helpers, the role
templates, the keys, the Russian dictionary, and what Herdr says about the layout. Exit code 1 when something is broken.

  herdr-ide doctor            check
  herdr-ide doctor --fix      run the installer again first, then check
  herdr-ide doctor --json     the results as JSON

Herdr's app folder is $HERDR_APP_HOME, else ~/.config/herdr-app.
"""
import json, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HOME = os.environ.get("HERDR_APP_HOME") or os.path.expanduser("~/.config/herdr-app")
args = set(sys.argv[1:])
M = json.load(open(os.path.join(ROOT, "lib", "manifest.json")))
rows = []  # (level, group, text) level: ok | warn | fail


def add(level, group, text):
    rows.append((level, group, text))


def run(cmd, timeout=60, env=None):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
        return r.returncode, r.stdout, r.stderr
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, "", str(e)


def load(p):
    try:
        with open(p) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


if "--fix" in args:
    subprocess.call(["sh", os.path.join(ROOT, "install.sh"), "--no-doctor"])

# ---- the machine -------------------------------------------------------------------------------------------------
for tool in M["needs"]["required"] + M["needs"]["herdr"]:
    add("ok" if shutil.which(tool) else "fail", "tools", f"{tool} {'found' if shutil.which(tool) else 'is missing'}")
agents = [a for a in M["needs"]["agents_any"] if shutil.which(a)]
add("ok" if agents else "warn", "tools", "agents installed: " + (", ".join(agents) if agents else "none of claude, codex, pi (a chat needs one)"))
for tool in M["needs"]["optional"]:
    add("ok" if shutil.which(tool) else "warn", "tools", f"{tool} {'found' if shutil.which(tool) else 'not found (optional: browser engine / GitHub)'}")
if shutil.which("herdr-app"):
    code, out, _ = run(["herdr-app", "--version"], 10)
    add("ok", "tools", "Herdr " + out.strip().split()[-1] if out.strip() else "Herdr version unknown")

# ---- the app folder ----------------------------------------------------------------------------------------------
if not os.path.isdir(HOME):
    add("fail", "install", f"no Herdr app folder at {HOME} (start Herdr once, then run the installer)")
else:
    add("ok", "install", f"app folder {HOME}")
    mods_dir = os.path.join(HOME, "mods")
    for m in M["mods"]:
        d = os.path.join(mods_dir, m)
        if not os.path.isdir(d):
            add("fail", "mods", f"mod {m} is not installed")
            continue
        src = os.path.join(ROOT, "mods", m, "main.js")
        mine, theirs = os.path.join(d, "main.js"), src
        if not os.path.exists(mine):
            add("fail", "mods", f"mod {m} has no main.js")
        else:
            add("ok", "mods", f"mod {m}")
    # a mod folder here that the package does not ship is not ours to judge, but a missing file in one of ours is
    # found by Herdr's own check below.

    # ---- the layout ----------------------------------------------------------------------------------------------
    lp = os.path.join(HOME, "layouts", M["layout"] + ".json")
    layout = load(lp)
    if layout is None:
        add("fail", "layout", f"layout {M['layout']} is missing or not valid JSON ({lp})")
    else:
        used = set()

        def walk(n):
            c = n.get("content")
            if isinstance(c, dict) and c.get("mod"):
                used.add(c["mod"])
            for k in n.get("children", []):
                walk(k)
        walk(layout)
        missing = sorted(u for u in used if not os.path.isdir(os.path.join(mods_dir, u)))
        if missing:
            shipped = [u for u in missing if u in M["shipped_by_herdr"]]
            other = [u for u in missing if u not in M["shipped_by_herdr"]]
            if other:
                add("fail", "layout", "the layout uses mods that are not installed: " + ", ".join(other))
            if shipped:
                add("warn", "layout", "Herdr's own " + ", ".join(shipped) + " not there yet: start Herdr once")
        else:
            add("ok", "layout", f"layout {M['layout']} uses {len(used)} mods, all present")

    # ---- helpers, templates, keys --------------------------------------------------------------------------------
    for h in M["helpers"]:
        p = shutil.which(h)
        add("ok" if p else "fail", "helpers", f"{h} {'-> ' + p if p else 'is not on PATH (~/.local/bin?)'}")
    root = os.environ.get("HERDR_IDE_INSTALL_ROOT")
    tdir = os.path.join(root, "templates") if root else os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "herdr-core", "templates")
    for t in M["templates"]:
        add("ok" if os.path.isfile(os.path.join(tdir, t)) else "fail", "templates", f"template {t}")
    keys = load(os.path.join(HOME, "keys.json")) or {}
    want = load(os.path.join(ROOT, "lib", "keys.json")) or {}
    lost = [f"{c} {k}" for c, ks in want.items() for k in ks if k not in (keys.get(c) or {})]
    add("ok" if not lost else "warn", "keys", "keys in place" if not lost else "keys not set (you may have changed them): " + ", ".join(lost))

    # ---- languages -----------------------------------------------------------------------------------------------
    ru_src = open(os.path.join(ROOT, "i18n", "ru.js"), encoding="utf-8").read()
    stale = [m for m in M["mods"] if os.path.exists(os.path.join(mods_dir, m, "ru.js"))
             and open(os.path.join(mods_dir, m, "ru.js"), encoding="utf-8").read() != ru_src]
    add("ok" if not stale else "warn", "i18n", "Russian dictionary current in every mod" if not stale else "older dictionary in: " + ", ".join(stale) + " (run the installer)")

    # ---- what Herdr says -----------------------------------------------------------------------------------------
    if shutil.which("herdr-app"):
        code, out, _ = run(["herdr-app", "status"], 20)
        try:
            st = json.loads(out)
            errs = st.get("errors") or []
            add("ok" if not errs else "fail", "herdr", "Herdr reports no layout errors" if not errs else "Herdr reports: " + "; ".join(map(str, errs))[:300])
            shown = (st.get("layout") or {}).get("name") if isinstance(st.get("layout"), dict) else st.get("layout")
            if shown and shown != M["layout"]:
                add("warn", "herdr", f"the layout shown is {shown}, not {M['layout']}: herdr-app do layout.switch '{{\"name\":\"{M['layout']}\"}}'")
        except ValueError:
            add("warn", "herdr", "Herdr is not running (its status could not be read)")
        bad = []
        for m in M["mods"]:
            d = os.path.join(HOME, "mods", m)
            if os.path.isdir(d):
                c, _, _ = run(["herdr-app", "check", m], 60, env={**os.environ, "PWD": os.path.join(HOME, "mods")}) if False else run(["sh", "-c", f'cd "{HOME}/mods" && herdr-app check "{m}" >/dev/null 2>&1'], 60)
                if c != 0:
                    bad.append(m)
        add("ok" if not bad else "fail", "herdr", "herdr-app check passes for every mod" if not bad else "herdr-app check fails for: " + ", ".join(bad))

# ---- the report --------------------------------------------------------------------------------------------------
if "--json" in args:
    print(json.dumps([{"level": l, "group": g, "text": t} for l, g, t in rows], ensure_ascii=False, indent=1))
else:
    mark = {"ok": "  ok  ", "warn": " warn ", "fail": " FAIL "}
    group = None
    for l, g, t in rows:
        if l == "ok" and g in ("mods", "helpers", "templates") and "--verbose" not in args:
            continue
        if g != group:
            print(f"\n{g}"); group = g
        print(f"[{mark[l]}] {t}")
    n = {k: sum(1 for r in rows if r[0] == k) for k in ("ok", "warn", "fail")}
    print(f"\n{n['ok']} ok, {n['warn']} warnings, {n['fail']} failed" + ("" if n["fail"] else ": everything needed is in place."))
sys.exit(1 if any(r[0] == "fail" for r in rows) else 0)
