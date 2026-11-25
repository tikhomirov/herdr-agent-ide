// SSH helpers: every call is one `ssh` on a shared OpenSSH connection (ControlMaster), so after the first the
// calls are fast. Key or agent sign-in only (BatchMode): nothing here can ask for a password, and nothing is stored.
import { exec, home, writeTextFile } from "herdr";

const DIR = () => `${home()}/.local/state/herdr-ide/ssh`;
const TMP = () => `${home()}/.local/state/herdr-ide/remote-tmp`;

/** Single-quotes a string for a POSIX shell. */
export const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** user@host, host or an alias from ~/.ssh/config; never something ssh could take for an option. */
export const validHost = (h) => /^[A-Za-z0-9_][A-Za-z0-9._@:%\[\]-]*$/.test(h || "");

let ready = null;
function ensureDirs() {
  ready ??= exec("mkdir", ["-p", "-m", "700", DIR(), TMP()]).catch(() => {});
  return ready;
}

const base = () => ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "LogLevel=ERROR", "-o", `ControlPath=${DIR()}/%C`];
// Calls ride on a background master connection kept for 5 minutes. The master is started apart, with its stdio
// closed: one started by a call would keep that call's pipes open and the call would never return.
const opts = () => [...base(), "-o", "ControlMaster=no"];
const masters = new Map();
async function ensureMaster(host) {
  if (Date.now() - (masters.get(host) ?? 0) < 20000) return;
  await exec("sh", ["-c", 'h=$1; shift; ssh "$@" -O check "$h" >/dev/null 2>&1 || ssh "$@" -o ControlMaster=yes -o ControlPersist=300 -fN "$h" >/dev/null 2>&1 </dev/null; true', "sh", host, ...base()], { timeout: 20000 }).catch(() => {});
  masters.set(host, Date.now());
}

/** The one line to show of ssh's complaint. */
function why(r) {
  const lines = (r.stderr.trim() ? r.stderr : r.stdout).split("\n").map((l) => l.trim()).filter((l) => l && !/^(\*\* |Welcome )/.test(l));
  const last = lines[lines.length - 1] || `ssh exited with ${r.code}`;
  if (/Permission denied \((publickey|password|keyboard)/.test(last)) return `${last} (sign-in needs a key or ssh-agent: this panel can't ask for a password)`;
  if (/Host key verification failed/.test(last)) return `${last} (connect once with ssh in a terminal to trust the host)`;
  return last;
}

/** Runs a POSIX shell script on the server. Resolves { ok, out, err }; `input` is a local file fed to its stdin. */
export async function remote(host, script, { input = null, timeout = 30000 } = {}) {
  if (!validHost(host)) return { ok: false, out: "", err: "Invalid host" };
  await ensureDirs();
  await ensureMaster(host);
  const args = [...opts(), host, "--", `sh -c ${q(script)}`];
  const r = input
    ? await exec("sh", ["-c", 'f=$1; shift; exec ssh "$@" < "$f"', "sh", input, ...args], { timeout })
    : await exec("ssh", args, { timeout });
  return r.code === 0 ? { ok: true, out: r.stdout, err: r.stderr.trim() ? why(r) : "" } : { ok: false, out: r.stdout, err: why(r), code: r.code };
}

/** `cd` to a path that may start with ~. */
const cd = (path) => {
  const p = (path || "~").trim() || "~";
  if (p === "~") return 'cd -- "$HOME"';
  if (p.startsWith("~/")) return `cd -- "$HOME"/${q(p.slice(2))}`;
  return `cd -- ${q(p)}`;
};

/** The command that opens an interactive shell on the server in `path`: for a terminal (it may ask for a password, and shares the open connection when there is one). */
export const shellArgv = (host, path) => ["ssh", "-t", "-o", `ControlPath=${DIR()}/%C`, "-o", "ControlMaster=no", host, "--", `sh -c ${q(`${cd(path)} || true; exec "\${SHELL:-sh}" -l`)}`];

/** A folder: { path (resolved), entries: [{ name, dir, link, size, mtime, mode }] }, folders first. */
export async function list(host, path) {
  const r = await remote(host, `${cd(path)} && pwd -P && { LC_ALL=C find . -mindepth 1 -maxdepth 1 -printf '%y%Y\\t%s\\t%T@\\t%m\\t%f\\0'; true; }`);
  if (!r.ok) return { error: r.err };
  const nl = r.out.indexOf("\n");
  const entries = [];
  for (const rec of r.out.slice(nl + 1).split("\0")) {
    if (!rec) continue;
    const [type, size, mtime, mode, ...name] = rec.split("\t");
    entries.push({ name: name.join("\t"), dir: type[0] === "d" || (type[0] === "l" && type[1] === "d"), link: type[0] === "l", size: Number(size), mtime: Math.floor(Number(mtime)), mode });
  }
  if (!entries.length && r.err) return { error: r.err };
  entries.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  return { path: r.out.slice(0, nl), entries };
}

const MAX_BYTES = 1024 * 1024;

/** A text file: { text, mtime, size } or { error }. Refuses big, binary and non-UTF-8 files. */
export async function read(host, path) {
  const r = await remote(host, `f=${q(path)}; [ -f "$f" ] || { echo "Not a regular file" >&2; exit 3; }; stat -c '%s %Y' -- "$f" && head -c ${MAX_BYTES + 1} -- "$f"`, { timeout: 60000 });
  if (!r.ok) return { error: r.err };
  const nl = r.out.indexOf("\n");
  const [size, mtime] = r.out.slice(0, nl).split(" ").map(Number);
  const text = r.out.slice(nl + 1);
  if (size > MAX_BYTES) return { error: `Too big to edit here (${Math.round(size / 1024)} KB, the limit is 1024 KB)` };
  if (text.includes("\0")) return { error: "Binary file" };
  if (text.includes("\uFFFD")) return { error: "Not UTF-8 text: editing it here would damage it" };
  return { text, mtime, size };
}

/**
 * Saves a file. `expect` is the mtime it had when opened: if the server's differs the save is refused
 * ({ conflict: true }), unless `expect` is null. The new content goes to a temp file beside it and replaces it
 * (mode and owner kept); when the folder isn't writable the file is written in place.
 */
export async function write(host, path, text, expect) {
  await ensureDirs();
  const local = `${TMP()}/${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try { await writeTextFile(local, text, null); } catch (e) { return { error: `Can't stage the file: ${e?.message ?? e}` }; }
  const exp = expect == null ? "" : String(Math.floor(expect));
  const script = [
    `f=${q(path)}; exp=${q(exp)}`,
    `cur=$(stat -c %Y -- "$f" 2>/dev/null) || cur=`,
    `if [ -n "$exp" ] && [ "$cur" != "$exp" ]; then echo CONFLICT >&2; exit 9; fi`,
    `t=; if [ -n "$cur" ]; then t=$(mktemp -- "$f.herdr-XXXXXX" 2>/dev/null) || t=; fi`,
    `if [ -n "$t" ]; then`,
    `  cat > "$t" || { rm -f -- "$t"; exit 1; }`,
    `  chmod --reference="$f" -- "$t" 2>/dev/null; chown --reference="$f" -- "$t" 2>/dev/null`,
    `  mv -f -- "$t" "$f" || { rm -f -- "$t"; exit 1; }`,
    `else cat > "$f" || exit 1; fi`,
    `stat -c %Y -- "$f"`,
  ].join("\n");
  const r = await remote(host, script, { input: local, timeout: 120000 });
  exec("rm", ["-f", local]).catch(() => {});
  if (r.ok) return { mtime: Number(r.out.trim()) };
  if (r.code === 9) return { conflict: true, error: "The file changed on the server since you opened it" };
  return { error: r.err };
}

/** mkdir, touch, mv, rm for the tree's actions. */
export const mkdir = (host, path) => remote(host, `mkdir -- ${q(path)}`);
export const touch = (host, path) => remote(host, `[ ! -e ${q(path)} ] || { echo "Already exists" >&2; exit 1; }; : > ${q(path)}`);
export const rename = (host, from, to) => remote(host, `[ ! -e ${q(to)} ] || { echo "Already exists" >&2; exit 1; }; mv -- ${q(from)} ${q(to)}`);
export const remove = (host, path, dir) => remote(host, dir ? `rmdir -- ${q(path)}` : `rm -- ${q(path)}`);

/** Host aliases of ~/.ssh/config (no wildcards), for suggestions. */
export async function sshHosts() {
  const r = await exec("sh", ["-c", 'cat "$HOME/.ssh/config" 2>/dev/null']);
  const hosts = [];
  for (const line of r.stdout.split("\n")) {
    const m = /^\s*Host\s+(.+)$/i.exec(line);
    if (!m) continue;
    for (const h of m[1].trim().split(/\s+/)) if (!/[*?!]/.test(h) && !hosts.includes(h)) hosts.push(h);
  }
  return hosts;
}

const LANG = {
  php: "php", js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", tsx: "typescript", jsx: "javascript", json: "json",
  html: "html", htm: "html", css: "css", scss: "css", less: "css", md: "markdown", py: "python", sh: "bash", bash: "bash", zsh: "bash",
  yml: "yaml", yaml: "yaml", toml: "yaml", xml: "xml", svg: "xml", sql: "sql", go: "go", rs: "rust", rb: "ruby", java: "java",
  c: "c", h: "c", cpp: "cpp", lua: "lua", vue: "html",
};
const SPECIAL = { dockerfile: "dockerfile", makefile: "makefile", ".env": "bash", ".bashrc": "bash", ".profile": "bash", "nginx.conf": "text", "package.json": "json" };

/** The editor's language for a path. */
export function languageOf(path) {
  const base = String(path).split("/").pop().toLowerCase();
  if (SPECIAL[base]) return SPECIAL[base];
  const ext = base.includes(".") ? base.split(".").pop() : "";
  return LANG[ext] ?? "text";
}

export const human = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
