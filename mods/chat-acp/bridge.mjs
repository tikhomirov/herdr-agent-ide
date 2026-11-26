// Long-lived ACP bridge. Herdr starts it with `hc run --bg` so the agent survives the window.
// The mod polls state.json and drops one JSON file per command in inbox/.
// stdout is only an OSC 7501 status line. Secrets stay in the environment (herdr-secret run)
// and are never written to state.json, inbox files, or this process's logs.
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createParser, frame, freshTranscript, reduceUpdate, pushUser, decidePermission, applySession, scrubError } from "./acp.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const command = args[0];

function arg(name, fallback = "") {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

function writeJson(path, value) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}

function report(status) {
  const safe = ["idle", "working", "blocked", "done", "error"].includes(status) ? status : "idle";
  process.stdout.write(`\x1b]7501;state=${safe}\x07`);
}

if (command === "test") {
  const base = arg("--base");
  const api = arg("--api");
  const envName = arg("--env");
  const key = process.env[envName] || "";
  if (!base || !key) {
    process.stdout.write(JSON.stringify({ ok: false, error: "Set the API key and a base URL first." }) + "\n");
    process.exit(0);
  }
  const url = base.replace(/\/$/, "") + "/models";
  const headers = api === "anthropic-messages"
    ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
    : { authorization: `Bearer ${key}` };
  const response = await fetch(url, { headers }).catch((error) => ({ ok: false, status: 0, text: () => Promise.resolve(scrubError(error.message)) }));
  const body = await response.text();
  if (!response.ok) {
    process.stdout.write(JSON.stringify({ ok: false, error: `HTTP ${response.status || "error"}` }) + "\n");
    process.exit(0);
  }
  let models = [];
  try {
    const parsed = JSON.parse(body);
    models = (parsed.data || parsed.models || []).map((model) => model.id).filter(Boolean);
  } catch { models = []; }
  process.stdout.write(JSON.stringify({ ok: true, models }) + "\n");
  process.exit(0);
}

if (command !== "serve") {
  process.stderr.write("usage: bridge.mjs serve --dir DIR --cwd DIR --agent-json FILE\n");
  process.exit(2);
}

const dir = resolve(arg("--dir"));
const cwd = resolve(arg("--cwd") || process.cwd());
const agentFile = arg("--agent-json");
const access = arg("--access") || "ask";
const role = arg("--role") || "";
mkdirSync(join(dir, "inbox"), { recursive: true });

const state = freshTranscript();
state.access = access;
let child = null;
let parser = createParser();
let nextId = 1;
const pending = new Map();
let promptFlight = null;
let closed = false;

function publish() {
  const view = {
    items: state.items.slice(-200).map((item) => ({
      ...item,
      text: String(item.text || "").slice(-20000),
      thought: String(item.thought || "").slice(-20000),
      diff: item.diff ? { path: item.diff.path, oldText: item.diff.oldText.slice(0, 4000), newText: item.diff.newText.slice(0, 4000) } : null,
    })),
    commands: state.commands,
    config: state.config,
    modes: state.modes,
    modeId: state.modeId,
    models: state.models,
    modelId: state.modelId,
    usage: state.usage,
    permissions: state.permissions,
    queue: state.queue,
    status: state.permissions.length ? "blocked" : state.status,
    sessionId: state.sessionId,
    stopReason: state.stopReason,
    error: state.error,
    access: state.access,
    cwd,
  };
  writeJson(join(dir, "state.json"), view);
  report(view.status);
}

function send(method, params, notify = false) {
  if (!child?.stdin.writable) return Promise.reject(new Error("agent is not running"));
  if (notify) {
    child.stdin.write(frame({ jsonrpc: "2.0", method, params }));
    return Promise.resolve(null);
  }
  const id = nextId++;
  child.stdin.write(frame({ jsonrpc: "2.0", id, method, params }));
  return new Promise((resolvePromise, reject) => pending.set(id, { resolve: resolvePromise, reject }));
}

function fail(error) {
  state.error = scrubError(error?.message || error);
  state.status = "idle";
  publish();
}

async function onRequest(message) {
  if (message.method === "session/request_permission") {
    const decision = decidePermission(state.access, message.params);
    if (decision) {
      sendResult(message.id, { outcome: { outcome: "selected", optionId: decision.optionId } });
      return;
    }
    state.permissions.push({
      requestId: message.id,
      title: message.params?.toolCall?.title || message.params?.toolCall?.kind || "Permission",
      toolKind: message.params?.toolCall?.kind || "other",
      options: (message.params?.options || []).map((option) => ({ id: option.optionId, name: option.name, kind: option.kind })),
    });
    publish();
    return;
  }
  if (message.method === "fs/read_text_file") {
    const text = readAllowed(message.params?.path, message.params?.line, message.params?.limit);
    if (text == null) sendError(message.id, "Path is not available to the chat.");
    else sendResult(message.id, { content: text });
    return;
  }
  sendError(message.id, "Method not implemented.");
}

function sendResult(id, result) {
  child?.stdin.write(frame({ jsonrpc: "2.0", id, result }));
}
function sendError(id, message) {
  child?.stdin.write(frame({ jsonrpc: "2.0", id, error: { code: -32601, message: scrubError(message) } }));
}

function readAllowed(path, line, limit) {
  if (!path || path.includes("\0")) return null;
  const full = resolve(path);
  const banned = ["/secrets/", "/vault.json", "/.ssh/"];
  if (banned.some((part) => full.includes(part))) return null;
  if (!full.startsWith(cwd) && !full.startsWith(resolve(process.env.HOME || "/home"))) return null;
  try {
    if (!statSync(full).isFile() || statSync(full).size > 1_000_000) return null;
    let text = readFileSync(full, "utf8");
    if (line) {
      const rows = text.split("\n").slice(Math.max(0, line - 1), line - 1 + (limit || 200));
      text = rows.join("\n");
    }
    return text;
  } catch { return null; }
}

function onMessage(message) {
  if (message.id != null && message.method) { void onRequest(message); return; }
  if (message.id != null && pending.has(message.id)) {
    const wait = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) wait.reject(new Error(message.error.message || "request failed"));
    else wait.resolve(message.result);
    return;
  }
  if (message.method === "session/update") reduceUpdate(state, message.params?.update || {});
  publish();
}

function agentCommand() {
  const spec = JSON.parse(readFileSync(agentFile, "utf8"));
  return { command: spec.command || "npx", agentArgs: spec.args || ["-y", "pi-acp"], pi: spec.pi !== false };
}

function realPiPath() {
  const fromEnv = process.env.CHAT_ACP_PI_BIN || "";
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
}

function prepareShim() {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const shim = join(bin, "pi");
  copyFileSync(join(here, "pi-shim.sh"), shim);
  chmodSync(shim, 0o755);
  if (role === "coordinator") {
    writeFileSync(join(dir, "system.md"), [
      "You are the coordinator for this project.",
      "You do not write the project's code yourself.",
      "Break work into tasks with `herdr-task add` and start them with `herdr-task start`.",
      "Watch those tasks and report their status in this chat.",
      "Keep durable project notes in the project's .ai/MEMORY.md.",
      "",
    ].join("\n"));
  }
  return bin;
}

function within(ms, promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

async function startAgent() {
  const spec = agentCommand();
  parser = createParser();
  const env = { ...process.env, CHAT_ACP_ACCESS: state.access };
  if (spec.pi) {
    const bin = prepareShim();
    env.PATH = `${bin}:${process.env.PATH || ""}`;
    env.CHAT_ACP_PI = realPiPath();
    if (role === "coordinator") env.CHAT_ACP_SYSTEM_FILE = join(dir, "system.md");
  }
  child = spawn(spec.command, spec.agentArgs, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const errLog = createWriteStream(join(dir, "agent.err"), { flags: "a" });
  child.stderr.on("data", (chunk) => {
    const text = scrubError(chunk.toString("utf8"));
    errLog.write(text);
    if (text.trim()) state.error = text.trim().split("\n").pop();
  });
  child.stdout.on("data", (chunk) => {
    let messages = [];
    try { messages = parser.push(chunk.toString("utf8")); } catch (error) { fail(error); return; }
    for (const message of messages) onMessage(message);
  });
  child.on("exit", (code) => {
    if (closed) return;
    state.status = "idle";
    state.error = scrubError(`agent exited (${code})`);
    publish();
  });
  const init = await within(20000, send("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: false }, terminal: false },
    clientInfo: { name: "herdr-chat-acp", version: "0.1.0" },
  }), "initialize timed out");
  state.capabilities = init?.agentCapabilities || null;
  const saved = existsSync(join(dir, "session-id")) ? readFileSync(join(dir, "session-id"), "utf8").trim() : "";
  let result;
  if (saved) {
    try { result = await within(30000, send("session/load", { sessionId: saved, cwd, mcpServers: [] }), "session load timed out"); }
    catch { result = await within(30000, send("session/new", { cwd, mcpServers: [] }), "session new timed out"); }
  } else result = await within(30000, send("session/new", { cwd, mcpServers: [] }), "session new timed out");
  applySession(state, result || {});
  if (state.sessionId) writeFileSync(join(dir, "session-id"), state.sessionId);
  state.status = "idle";
  state.error = null;
  publish();
}

async function setConfig(configId, value) {
  let applied = false;
  try {
    const result = await send("session/set_config_option", { sessionId: state.sessionId, configId, value });
    if (result?.configOptions) state.config = result.configOptions;
    applied = true;
  } catch {
    try {
      if (configId === "model") await send("session/set_model", { sessionId: state.sessionId, modelId: value });
      else await send("session/set_mode", { sessionId: state.sessionId, modeId: value });
      applied = true;
    } catch (error) { state.error = scrubError(error.message); }
  }
  if (applied && configId === "model") state.modelId = value;
  if (applied && (configId === "thought_level" || configId === "mode")) state.modeId = value;
  publish();
}

async function deliver(text, files) {
  const prompt = [{ type: "text", text }];
  for (const file of files || []) {
    prompt.push({ type: "resource_link", uri: file.uri || `file://${file.path}`, name: file.name || file.path });
  }
  state.status = "working";
  publish();
  try {
    const result = await send("session/prompt", { sessionId: state.sessionId, prompt });
    state.stopReason = result?.stopReason || null;
  } catch (error) { state.error = scrubError(error.message); }
  state.status = state.permissions.length ? "blocked" : "idle";
  publish();
  await drain();
}

async function drain() {
  if (state.status === "working" || promptFlight) return;
  const next = state.queue.shift();
  if (!next) return;
  promptFlight = deliver(next.text, next.files).finally(() => { promptFlight = null; });
  await promptFlight;
}

async function handle(op) {
  if (op.op === "prompt") {
    pushUser(state, op.text || "", { files: op.files || [] });
    if (state.status === "working" || promptFlight) { state.queue.push({ text: op.text || "", files: op.files || [] }); publish(); return; }
    promptFlight = deliver(op.text || "", op.files).finally(() => { promptFlight = null; });
    await promptFlight;
    return;
  }
  if (op.op === "cancel") {
    state.queue = [];
    await send("session/cancel", { sessionId: state.sessionId }, true);
    return;
  }
  if (op.op === "permission") {
    const index = state.permissions.findIndex((item) => item.requestId === op.requestId);
    const item = index >= 0 ? state.permissions.splice(index, 1)[0] : null;
    if (item) sendResult(op.requestId, op.optionId
      ? { outcome: { outcome: "selected", optionId: op.optionId } }
      : { outcome: { outcome: "cancelled" } });
    publish();
    return;
  }
  if (op.op === "config") { await setConfig(op.configId, op.value); return; }
  if (op.op === "access") {
    state.access = op.access || "ask";
    publish();
    return;
  }
  if (op.op === "fork") {
    const result = await send("session/fork", { sessionId: state.sessionId, cwd, mcpServers: [] });
    applySession(state, result || {});
    if (state.sessionId) writeFileSync(join(dir, "session-id"), state.sessionId);
    publish();
    return;
  }
  if (op.op === "new") {
    const result = await send("session/new", { cwd, mcpServers: [] });
    state.items = [];
    applySession(state, result || {});
    if (state.sessionId) writeFileSync(join(dir, "session-id"), state.sessionId);
    publish();
  }
}

async function inbox() {
  const folder = join(dir, "inbox");
  const names = readdirSync(folder).filter((name) => name.endsWith(".json")).sort();
  for (const name of names) {
    const path = join(folder, name);
    let op = null;
    try { op = JSON.parse(readFileSync(path, "utf8")); } catch { op = null; }
    rmSync(path, { force: true });
    if (op) await handle(op).catch((error) => fail(error));
  }
}

try {
  await startAgent();
} catch (error) { fail(error); }

setInterval(() => { inbox().catch((error) => fail(error)); }, 80);
process.on("SIGTERM", () => { closed = true; child?.kill("SIGTERM"); process.exit(0); });
