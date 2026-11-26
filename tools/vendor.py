#!/usr/bin/env python3
"""Vendor the Shepherdr mods the Agent IDE + Coordinator layout needs.

Source: a Shepherdr checkout (MIT, Elias Stravik), default ~/Projects/shepherdr.
Writes mods/<name>, bin/herdr-browser, bin/herdr-secret, templates/, third_party/shepherdr/.
Does not copy the service, the web app, voice (chat-call), usage recording, Jump, keybinds,
other-machines, or the Shepherdr brand row. Data folders are herdr-ide, not shepherdr.
Settings ship as mods/coord-settings (the mod id shepherdr-settings is renamed).

  tools/vendor.py            refresh the vendored tree from the checkout
  tools/vendor.py --check    fail if a vendored file still points at a shepherdr data folder
"""
import json, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.environ.get("SHEPHERDR_SRC", os.path.expanduser("~/Projects/shepherdr"))
# Closure of layouts/ide-coord.json, plus what those mods open (overlays) and their bin/.
# shepherdr-settings is copied then renamed to coord-settings.
MODS = """
accept-card artifacts chat chat-image chat-models chat-react confirm-chat coordinator
menu-tasks new-menu-tasks newspace pane-chat prompt-chat shepherdr-settings spaces-chat
tabs-tasks task-artifacts task-browser task-pr tasks tasks-menu toasts workspace-status-chat
""".split()
SKIP_FILES = {"gpui-kit.d.ts", "jsconfig.json"}
TEXT_EXT = {".js", ".py", ".sh", ".md", ".json", ".ts", ".swift", ".txt", ""}

# Filesystem folder name. Not a blanket rename of the word Shepherdr.
PATH_SWAPS = [
    ("shepherdr-settings", "coord-settings"),
    (".config/shepherdr", ".config/herdr-ide"),
    (".config}/shepherdr", ".config}/herdr-ide"),
    (".local/share/shepherdr", ".local/share/herdr-ide"),
    ("share}/shepherdr", "share}/herdr-ide"),
    (".local/state/shepherdr", ".local/state/herdr-ide"),
    ("state}/shepherdr", "state}/herdr-ide"),
    (".cache/shepherdr", ".cache/herdr-ide"),
    (".cache}/shepherdr", ".cache}/herdr-ide"),
    ("Caches/shepherdr", "Caches/herdr-ide"),
    (', "shepherdr")', ', "herdr-ide")'),
    ("|shepherdr)", "|herdr-ide)"),
    ("}/shepherdr", "}/herdr-ide"),
    ("SHEPHERDR_HOME", "HERDR_IDE_HOME"),
]
DROPPED_ON = '''// Agent IDE does not ship Shepherdr's voice, web app or usage insights.
const DROPPED = ["voice", "web", "insights"];
export const on = (id) => !DROPPED.includes(id) && !off().includes(id);'''
ON_LINE = "export const on = (id) => !off().includes(id);"
TILE_IMPORT = 'import { spacesWithChats } from "./parked.js";'
TILE_IMPORT_NEW = TILE_IMPORT + '\nimport { spaceTile } from "./tile.js";'
TILE_OLD = '''          .when(!tree, el => el.child(div().w(18).flex_none().text_center().text_size(iconOf(w.id) ? 14 : 15).text_color(fresh ? t.foreground : w.active && !quiet ? t.muted : t.dim)
            .when(quiet && Boolean(iconOf(w.id)), (el) => el.opacity(0.5)).child(iconOf(w.id) ?? "#")))'''
TILE_NEW = '''          .when(!tree && !iconOf(w.id), el => el.child(h_flex().w(18).flex_none().when(quiet, e => e.opacity(0.5)).child(spaceTile(t, { id: w.id, name }, 18))))
          .when(!tree && Boolean(iconOf(w.id)), el => el.child(div().w(18).flex_none().text_center().text_size(14).text_color(fresh ? t.foreground : w.active && !quiet ? t.muted : t.dim)
            .when(quiet, (el) => el.opacity(0.5)).child(iconOf(w.id))))'''
KEEP_ADDONS = {"tasks", "assistants", "chat", "needs", "secrets", "artifacts", "reactions", "browser", "autopilot"}
# voice, web, insights, keyboard, machines: not shipped


def ignore(_dir, names):
    return [n for n in names if n in SKIP_FILES or n == "__pycache__" or n.endswith((".pyc", ".orig-i18n", ".bak"))]


def walk_text(top):
    for dirpath, dirs, files in os.walk(top):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__")]
        for name in files:
            ext = os.path.splitext(name)[1]
            if ext not in TEXT_EXT and name not in ("herdr-task", "herdr-artifact", "herdr-browser", "herdr-secret"):
                continue
            yield os.path.join(dirpath, name)


def rewrite(path):
    try:
        text = open(path, encoding="utf-8").read()
    except (UnicodeDecodeError, OSError):
        return False
    new = text
    for a, b in PATH_SWAPS:
        new = new.replace(a, b)
    if new != text:
        open(path, "w", encoding="utf-8").write(new)
        return True
    return False


def patch_dropped(path):
    text = open(path, encoding="utf-8").read()
    if ON_LINE not in text:
        return False
    open(path, "w", encoding="utf-8").write(text.replace(ON_LINE, DROPPED_ON, 1))
    return True


def patch_tiles():
    main = os.path.join(ROOT, "mods", "spaces-chat", "main.js")
    text = open(main, encoding="utf-8").read()
    if TILE_IMPORT not in text or TILE_OLD not in text:
        sys.exit("spaces-chat tile patch: upstream text moved; update tools/vendor.py")
    text = text.replace(TILE_IMPORT, TILE_IMPORT_NEW, 1).replace(TILE_OLD, TILE_NEW, 1)
    open(main, "w", encoding="utf-8").write(text)
    shutil.copy(os.path.join(ROOT, "patches", "spaces-chat-tile.js"), os.path.join(ROOT, "mods", "spaces-chat", "tile.js"))


def trim_addons():
    src = os.path.join(SRC, "lib", "addons.json")
    data = json.load(open(src, encoding="utf-8"))
    data["core"]["mods"] = [m for m in data["core"]["mods"] if m != "workspace-chrome-shepherdr" and m != "shepherdr-settings"]
    data["core"]["mods"].append("coord-settings")
    data["core"]["layouts"] = ["ide-coord"]
    data["core"]["about"] = "Coordinator layout shipped with Agent IDE: sidebar, tab bar, chat, tasks, menus and dialogs."
    kept = []
    for addon in data["addons"]:
        if addon["id"] not in KEEP_ADDONS:
            continue
        addon["mods"] = [("coord-settings" if m == "shepherdr-settings" else m) for m in addon.get("mods", [])]
        addon.pop("web", None)
        addon.pop("service", None)
        kept.append(addon)
    data["addons"] = kept
    dest = os.path.join(ROOT, "lib", "addons.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    json.dump(data, open(dest, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    open(dest, "a", encoding="utf-8").write("\n")


def write_keys():
    dest = os.path.join(ROOT, "lib", "keys.json")
    json.dump({
        "global": {
            "alt-1": "tab.select:1", "alt-2": "tab.select:2", "alt-3": "tab.select:3",
            "alt-4": "tab.select:4", "alt-5": "tab.select:5", "alt-6": "tab.select:6",
            "alt-7": "tab.select:7", "alt-8": "tab.select:8", "alt-9": "tab.select:9",
            "alt-left": "tab.prev", "alt-right": "tab.next", "alt-down": "space.next", "alt-up": "space.prev",
            "alt-enter": "pane.split:right", "alt-shift-enter": "pane.split:down", "alt-escape": "pane.close",
            "ctrl-alt-left": "pane.go:left", "ctrl-alt-down": "pane.go:down",
            "ctrl-alt-up": "pane.go:up", "ctrl-alt-right": "pane.go:right",
        },
        "terminal": {"ctrl-v": "terminal.paste"},
        "mod:chat": {"ctrl-f": "chat.find"},
        "layout:ide-coord": {
            "ctrl-shift-w": "tabs-ide-tasks.close",
            "ctrl-shift-n": "tabs-ide-tasks.newspace",
            "f2": "tabs-ide-tasks.rename-tab",
            "shift-f2": "tabs-ide-tasks.rename-space",
        },
    }, open(dest, "w", encoding="utf-8"), indent=2)
    open(dest, "a", encoding="utf-8").write("\n")


def copy_licenses():
    third = os.path.join(ROOT, "third_party", "shepherdr")
    os.makedirs(third, exist_ok=True)
    for name in ("LICENSE", "LICENSE-herdr", "NOTICE"):
        shutil.copy(os.path.join(SRC, name), os.path.join(third, name))
    rev = subprocess.check_output(["git", "-C", SRC, "rev-parse", "HEAD"], text=True).strip()
    sub = subprocess.check_output(["git", "-C", SRC, "log", "-1", "--format=%ci %s"], text=True).strip()
    open(os.path.join(third, "REVISION"), "w", encoding="utf-8").write(f"{rev}\n{sub}\n")


def copy_git_graph():
    dest = os.path.join(ROOT, "mods", "git-graph")
    src = os.environ.get("GIT_GRAPH_SRC")
    tmp = None
    if not src:
        tmp = os.path.join("/tmp", "herdr-git-graph-vendor")
        if os.path.isdir(os.path.join(tmp, ".git")):
            subprocess.check_call(["git", "-C", tmp, "fetch", "--depth", "1", "origin"], stdout=subprocess.DEVNULL)
            subprocess.check_call(["git", "-C", tmp, "reset", "--hard", "origin/HEAD"], stdout=subprocess.DEVNULL)
        else:
            shutil.rmtree(tmp, ignore_errors=True)
            subprocess.check_call(["git", "clone", "--depth", "1", "https://github.com/rabeeh-ta/herdr-git-graph.git", tmp])
        src = tmp
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    shutil.copytree(os.path.join(src, "mods", "git-graph"), dest, ignore=ignore)
    third = os.path.join(ROOT, "third_party", "git-graph")
    os.makedirs(third, exist_ok=True)
    shutil.copy(os.path.join(src, "LICENSE"), os.path.join(third, "LICENSE"))
    rev = subprocess.check_output(["git", "-C", src, "rev-parse", "HEAD"], text=True).strip()
    open(os.path.join(third, "REVISION"), "w", encoding="utf-8").write(rev + "\n")


def vendor():
    if not os.path.isdir(os.path.join(SRC, "mods", "chat")):
        sys.exit(f"no Shepherdr checkout at {SRC} (set SHEPHERDR_SRC)")
    for mod in MODS:
        src, dest = os.path.join(SRC, "mods", mod), os.path.join(ROOT, "mods", mod)
        if not os.path.isdir(src):
            sys.exit(f"missing {src}")
        if os.path.isdir(dest):
            shutil.rmtree(dest)
        shutil.copytree(src, dest, ignore=ignore)
        print("mod   ", mod)
    settings = os.path.join(ROOT, "mods", "shepherdr-settings")
    renamed = os.path.join(ROOT, "mods", "coord-settings")
    if os.path.isdir(renamed):
        shutil.rmtree(renamed)
    os.rename(settings, renamed)
    print("rename coord-settings")
    os.makedirs(os.path.join(ROOT, "bin"), exist_ok=True)
    for name in ("herdr-browser", "herdr-secret"):
        shutil.copy(os.path.join(SRC, "bin", name), os.path.join(ROOT, "bin", name))
        os.chmod(os.path.join(ROOT, "bin", name), 0o755)
        print("bin   ", name)
    os.makedirs(os.path.join(ROOT, "templates"), exist_ok=True)
    for name in ("assistant.md", "worker.md", "reviewer.md"):
        shutil.copy(os.path.join(SRC, "templates", name), os.path.join(ROOT, "templates", name))
        print("template", name)
    copy_licenses()
    trim_addons()
    write_keys()
    targets = [os.path.join(ROOT, "mods"), os.path.join(ROOT, "bin"), os.path.join(ROOT, "templates"), os.path.join(ROOT, "lib")]
    n = 0
    for top in targets:
        for path in walk_text(top):
            if rewrite(path):
                n += 1
    print(f"rewrote {n} files")
    patched = 0
    for path in walk_text(os.path.join(ROOT, "mods")):
        if path.endswith("addons.js") and patch_dropped(path):
            patched += 1
    lib_addons = os.path.join(ROOT, "lib", "addons.js")
    if os.path.isfile(os.path.join(SRC, "lib", "addons.js")):
        shutil.copy(os.path.join(SRC, "lib", "addons.js"), lib_addons)
        rewrite(lib_addons)
        patch_dropped(lib_addons)
    print(f"dropped voice/web/insights in {patched} addons.js")
    patch_tiles()
    print("tile  spaces-chat")
    copy_git_graph()
    print("mod    git-graph")
    for path in (os.path.join(ROOT, "mods", "tasks", "bin", "herdr-task"),
                 os.path.join(ROOT, "mods", "artifacts", "bin", "herdr-artifact")):
        os.chmod(path, 0o755)
    check()


def check():
    bad = []
    roots = [os.path.join(ROOT, p) for p in ("mods", "bin", "templates", "lib")]
    needles = (".config/shepherdr", ".local/share/shepherdr", ".local/state/shepherdr",
               ".cache/shepherdr", ", \"shepherdr\")", "}/shepherdr", "SHEPHERDR_HOME")
    for top in roots:
        if not os.path.isdir(top):
            continue
        for path in walk_text(top):
            # attribution and comments may name the project; data folders may not
            try:
                text = open(path, encoding="utf-8").read()
            except (UnicodeDecodeError, OSError):
                continue
            for needle in needles:
                if needle in text:
                    bad.append(f"{os.path.relpath(path, ROOT)}: {needle}")
    if bad:
        print("shepherdr data paths still present:", file=sys.stderr)
        print("\n".join(bad[:40]), file=sys.stderr)
        sys.exit(1)
    print("paths ok")


if __name__ == "__main__":
    if "--check" in sys.argv:
        check()
    else:
        vendor()
