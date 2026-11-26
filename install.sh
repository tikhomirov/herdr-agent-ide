#!/bin/sh
# Installs Agent IDE and the Coordinator into Herdr's app folder. One command, no Shepherdr install.
#   ./install.sh            copy mods (replacing earlier copies) and a layout that is not there yet
#   ./install.sh --force    also replace layout files and the role templates
#   ./install.sh --hib      also link `hib` into ~/.local/bin
# Herdr's app folder is $HERDR_APP_HOME, else ~/.config/herdr-app.
# Task data lives under ~/.config/herdr-ide, ~/.local/share/herdr-ide and ~/.local/state/herdr-ide
# (HERDR_IDE_HOME puts all four under that root). Templates go to herdr-core, which Herdr already uses.
set -e
here=$(cd "$(dirname "$0")" && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
[ -d "$home" ] || { echo "No Herdr app folder at $home (is Herdr installed and started once?)" >&2; exit 1; }

force=; link=
for a in "$@"; do case "$a" in --force) force=1 ;; --hib) link=1 ;; esac; done

mods="ide-topbar ide-browser ide-browser-bar ide-browser-menu remote-files tabs-ide tabs-ide-tasks agents-ide rename-dialog layout-switcher chat-acp pi-settings
accept-card artifacts chat chat-image chat-models chat-react confirm-chat coordinator coord-settings git-graph
menu-tasks new-menu-tasks newspace pane-chat prompt-chat spaces-chat task-artifacts task-browser task-pr tasks tasks-menu toasts workspace-status-chat"

mkdir -p "$home/mods" "$home/layouts" "$home/lib" "$home/bin"
for m in $mods; do
  [ -d "$here/mods/$m" ] || { echo "missing mods/$m" >&2; exit 1; }
  rm -rf "$home/mods/$m.new"; cp -R "$here/mods/$m" "$home/mods/$m.new"
  rm -rf "$home/mods/$m"; mv "$home/mods/$m.new" "$home/mods/$m"
  echo "mod    $m"
done
chmod +x "$home/mods/ide-browser/hib" "$home/mods/ide-browser/viewer.js" \
  "$home/mods/chat-acp/bridge.mjs" "$home/mods/chat-acp/pi-shim.sh" \
  "$home/mods/tasks/bin/herdr-task" "$home/mods/artifacts/bin/herdr-artifact"

cp "$here/bin/herdr-browser" "$here/bin/herdr-browser-view" "$here/bin/herdr-secret" "$home/bin/"
chmod +x "$home/bin/herdr-browser" "$home/bin/herdr-browser-view" "$home/bin/herdr-secret"
cp "$here/lib/addons.json" "$here/lib/addons.js" "$home/lib/"
echo "lib    addons"

# Role instructions. Herdr-core reads this folder; an existing file stays unless --force.
# HERDR_IDE_INSTALL_ROOT keeps a clean-home check from replacing this account's tools and templates.
if [ -n "$HERDR_IDE_INSTALL_ROOT" ]; then
  tpl=$HERDR_IDE_INSTALL_ROOT/templates
  bindir=$HERDR_IDE_INSTALL_ROOT/bin
  skills=$HERDR_IDE_INSTALL_ROOT/skills
else
  tpl=${XDG_CONFIG_HOME:-$HOME/.config}/herdr-core/templates
  bindir=$HOME/.local/bin
  skills=$HOME/.agents/skills
fi
mkdir -p "$tpl"
for f in assistant.md worker.md reviewer.md; do
  if [ ! -e "$tpl/$f" ] || [ -n "$force" ]; then
    cp "$here/templates/$f" "$tpl/$f"; echo "template $f"
  else
    echo "template $f exists, left as it is (--force replaces it)"
  fi
done

mkdir -p "$bindir" "$skills"
ln -sf "$home/mods/tasks/bin/herdr-task" "$bindir/herdr-task"
ln -sf "$home/mods/artifacts/bin/herdr-artifact" "$bindir/herdr-artifact"
ln -sf "$home/bin/herdr-browser" "$bindir/herdr-browser"
ln -sf "$home/bin/herdr-secret" "$bindir/herdr-secret"
echo "linked herdr-task, herdr-artifact, herdr-browser, herdr-secret -> $bindir"
rm -rf "$skills/herdr-ide-browser"
cp -R "$here/skills/herdr-ide-browser" "$skills/herdr-ide-browser"
echo "skill  herdr-ide-browser"

# Keys we own, added only where the file has none yet.
python3 - "$home/keys.json" "$here/lib/keys.json" <<'PY'
import json, sys
dest, src = sys.argv[1], sys.argv[2]
try:
    have = json.load(open(dest))
except (OSError, ValueError):
    have = {}
want = json.load(open(src))
for ctx, keys in want.items():
    slot = have.setdefault(ctx, {})
    for key, value in keys.items():
        slot.setdefault(key, value)
json.dump(have, open(dest, "w"), indent=2)
open(dest, "a").write("\n")
PY
echo "keys   merged"

fresh=
copy_layout() {
  name=$1
  if [ ! -e "$home/layouts/$name.json" ] || [ -n "$force" ]; then
    cp "$here/layouts/$name.json" "$home/layouts/$name.json"
    fresh="$fresh $name"
    echo "layout $name"
  else
    echo "layout $name.json exists, left as it is (--force replaces it)"
  fi
}
copy_layout ide
copy_layout ide-coord

python3 - "$home/layouts" "$home/mods" $fresh <<'PY'
import json, os, sys
layouts, mods, *fresh = sys.argv[1:]
coord = os.path.join(layouts, "ide-coord.json")
def load(p):
    try:
        return json.load(open(p))
    except (OSError, ValueError):
        return None
def save(p, t):
    json.dump(t, open(p, "w"), indent=2)
    open(p, "a").write("\n")
# A machine that already has werlang/herdr-file-editor keeps it in the Files block.
if os.path.isdir(os.path.join(mods, "file-editor")):
    def use_editor(path, copied):
        if not copied: return
        t = load(path)
        if not t: return
        def files(n):
            c = n.get("content")
            if n.get("id") == "files" and isinstance(c, dict) and c.get("mod") == "files":
                c["mod"] = "file-editor"
            for k in n.get("children", []): files(k)
        files(t)
        save(path, t)
        print("layout: Files block uses file-editor")
    use_editor(os.path.join(layouts, "ide.json"), "ide" in fresh)
    use_editor(coord, "ide-coord" in fresh)
PY

if [ -n "$link" ]; then
  ln -sf "$home/mods/ide-browser/hib" "$bindir/hib"; echo "linked $bindir/hib"
fi

command -v node >/dev/null 2>&1 || echo "warning: node is needed (the browser viewer is a Node script)" >&2
command -v agent-browser >/dev/null 2>&1 || echo "note: install the browser engine with: npm i -g agent-browser && agent-browser install" >&2
echo "Next: herdr-app do layout.switch '{\"name\":\"ide\"}'"
