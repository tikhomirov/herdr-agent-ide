// Pi's saved conversations for the folder an agent runs in (~/.pi/agent/sessions/--<folder>--/*.jsonl), newest first:
// what the chat's history button lists. The script prints one JSON object per line.
export const LIST = `
pid="$1"
cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null) || exit 0
python3 - "$HOME/.pi/agent/sessions" "$cwd" <<'PY'
import json, os, sys, glob, re
root, cwd = sys.argv[1], sys.argv[2]
enc = re.sub(r"[/\\\\:]", "-", cwd.lstrip("/"))
files = sorted(glob.glob(os.path.join(root, "--" + enc + "--", "*.jsonl")), key=os.path.getmtime, reverse=True)[:40]
for f in files:
    sid = re.search(r"_([0-9a-f-]{36})\\.jsonl$", f)
    if not sid:
        continue
    title, n = "", 0
    try:
        with open(f, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if '"role":"user"' not in line:
                    continue
                n += 1
                if title:
                    continue
                try:
                    m = json.loads(line).get("message", {})
                except ValueError:
                    continue
                c = m.get("content")
                if isinstance(c, list):
                    c = " ".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
                title = " ".join(str(c or "").split())[:120]
    except OSError:
        continue
    print(json.dumps({"id": sid.group(1), "path": f, "at": int(os.path.getmtime(f) * 1000), "title": title, "turns": n}))
PY
`;

export function parseSessions(stdout) {
  const out = [];
  for (const l of String(stdout ?? "").split("\n")) {
    try { const s = JSON.parse(l); if (s?.id) out.push(s); } catch {}
  }
  return out;
}
