#!/bin/sh
# Installs the Agent IDE layout and its mods into Herdr's app folder.
#   ./install.sh            copy mods (replacing earlier copies of these mods) and the layout if it isn't there yet
#   ./install.sh --force    also replace the layout file
#   ./install.sh --hib      also link `hib` (the agents' browser command) into ~/.local/bin
# Herdr's app folder is $HERDR_APP_HOME, else ~/.config/herdr-app.
set -e
here=$(cd "$(dirname "$0")" && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
[ -d "$home" ] || { echo "No Herdr app folder at $home (is Herdr installed and started once?)" >&2; exit 1; }

force=; link=
for a in "$@"; do case "$a" in --force) force=1 ;; --hib) link=1 ;; esac; done

mkdir -p "$home/mods" "$home/layouts"
for m in ide-browser ide-browser-bar ide-browser-menu remote-files tabs-ide agents-ide layout-switcher; do
  rm -rf "$home/mods/$m.new"; cp -R "$here/mods/$m" "$home/mods/$m.new"
  rm -rf "$home/mods/$m"; mv "$home/mods/$m.new" "$home/mods/$m"
  echo "mod    $m"
done
chmod +x "$home/mods/ide-browser/hib" "$home/mods/ide-browser/viewer.js"

if [ ! -e "$home/layouts/ide.json" ] || [ -n "$force" ]; then
  cp "$here/layouts/ide.json" "$home/layouts/ide.json"; echo "layout ide"
  # With Shepherdr's chat mods installed, the agent panes get a Chat / Terminal switch and the tab bar a Chat button.
  if [ -d "$home/mods/pane-chat" ] && [ -d "$home/mods/spaces-chat" ] && [ -d "$home/mods/workspace-status-chat" ] && command -v python3 >/dev/null 2>&1; then
    python3 - "$home/layouts/ide.json" <<'PY'
import json, sys
p = sys.argv[1]
t = json.load(open(p))
swap = {"pane": "pane-chat", "spaces": "spaces-chat", "workspace-status": "workspace-status-chat"}
def walk(n):
    c = n.get("content")
    if isinstance(c, dict):
        if c.get("mod") in swap and n.get("id") in ("spaces", "status"): c["mod"] = swap[c["mod"]]
        h = (c.get("pane") or {}).get("header", {}).get("content")
        if isinstance(h, dict) and h.get("mod") == "pane": h["mod"] = "pane-chat"
    for k in n.get("children", []): walk(k)
walk(t)
json.dump(t, open(p, "w"), indent=2)
PY
    echo "layout: chat switch enabled (pane-chat found)"
  fi
else
  echo "layout ide.json exists, left as it is (--force replaces it)"
fi

if [ -n "$link" ]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$home/mods/ide-browser/hib" "$HOME/.local/bin/hib"; echo "linked ~/.local/bin/hib"
fi

command -v node >/dev/null 2>&1 || echo "warning: node is needed (the browser viewer is a Node script)" >&2
command -v agent-browser >/dev/null 2>&1 || echo "note: install the browser engine with: npm i -g agent-browser && agent-browser install" >&2
echo "Next: switch to the layout (the layout button in the tab bar, or: herdr-app do layout.switch '{\"name\":\"ide\"}')"
