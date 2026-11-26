#!/bin/bash
# Checks the standalone package: syntax, data paths, a clean Herdr home, then herdr-app check when Herdr is installed.
set -e
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
python3 tools/vendor.py --check
fail=0
while IFS= read -r f; do
  node --input-type=module --check < "$f" || { echo "BAD $f"; fail=1; }
done < <(find mods -name '*.js')
python3 -m compileall -q mods/tasks/bin/herdr_task
python3 - <<'PY'
import sys
sys.path.insert(0, "mods/tasks/bin")
from herdr_task.layout import roots
r = roots(home="/tmp/fresh", env={})
bad = [p for p in r.values() if "shepherdr" in p]
if bad:
    raise SystemExit("data roots still mention shepherdr: " + " ".join(bad))
print("roots", r["config"])
PY
for d in mods/*/; do
  base=$(basename "$d")
  case "$base" in *shepherdr*) echo "mod name $base"; fail=1 ;; esac
done
root=$(mktemp -d)
mkdir -p "$root/app"
HERDR_APP_HOME=$root/app HERDR_IDE_INSTALL_ROOT=$root ./install.sh --force --hib >/tmp/herdr-ide-install.log
if find "$root" -iname '*shepherdr*' | grep -q .; then
  echo "clean home contains a shepherdr path:" >&2
  find "$root" -iname '*shepherdr*' >&2
  fail=1
fi
if [ "$fail" != 0 ]; then exit 1; fi
if command -v herdr-app >/dev/null 2>&1; then
  for d in mods/*/; do
    herdr-app check "$d" >/dev/null || { echo "herdr-app check failed: $d"; exit 1; }
  done
  node --check mods/ide-browser/viewer.js
  echo "herdr-app check ok"
else
  echo "herdr-app is not on PATH; syntax and the clean home were checked"
fi
echo "ok"
