// ACP (Agent Client Protocol) JSON-RPC framing and the chat transcript it builds.
// Pure: no filesystem, no process, no secrets. The bridge and the tests both use it.
// Protocol: https://agentclientprotocol.com — newline-delimited JSON-RPC 2.0.

export function frame(message) {
  return JSON.stringify(message) + "\n";
}

export function createParser() {
  let buf = "";
  return {
    push(chunk) {
      buf += chunk;
      const out = [];
      for (;;) {
        const i = buf.indexOf("\n");
        if (i < 0) break;
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        out.push(JSON.parse(line));
      }
      return out;
    },
  };
}

const READ_KINDS = new Set(["read", "search", "think", "fetch", "other"]);

export function freshTranscript() {
  return {
    items: [],
    commands: [],
    config: [],
    modes: [],
    modeId: null,
    models: [],
    modelId: null,
    usage: null,
    permissions: [],
    queue: [],
    status: "idle",
    sessionId: null,
    stopReason: null,
    error: null,
    capabilities: null,
  };
}

function textOf(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (content.type === "text") return content.text || "";
  if (Array.isArray(content)) return content.map(textOf).join("");
  return "";
}

function lastOpen(state, kind) {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i];
    if (item.kind === "tool" || item.kind === "user") return null;
    if (item.kind === kind && item.open) return item;
  }
  return null;
}

function closeAssistants(state) {
  for (const item of state.items) if (item.kind === "assistant") item.open = false;
}

export function pushUser(state, text, extra = {}) {
  closeAssistants(state);
  state.items.push({
    kind: "user", id: extra.id || `u${state.items.length + 1}`, text, files: extra.files || [], at: Date.now(),
  });
  return state;
}

function assistant(state) {
  const open = lastOpen(state, "assistant");
  if (open) return open;
  const item = { kind: "assistant", id: `a${state.items.length + 1}`, text: "", thought: "", open: true, at: Date.now() };
  state.items.push(item);
  return item;
}

function toolSummary(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const command = [input.command, input.cmd].find((v) => typeof v === "string") || "";
  const path = [input.path, input.file, input.filePath].map((v) => (typeof v === "string" ? v : "")).find(Boolean) || "";
  return { command, path };
}

function diffOf(content) {
  const blocks = Array.isArray(content) ? content : [];
  for (const block of blocks) {
    const diff = block?.diff || (block?.type === "diff" ? block : null);
    if (diff && (diff.oldText != null || diff.newText != null)) {
      return { path: diff.path || "", oldText: String(diff.oldText ?? ""), newText: String(diff.newText ?? "") };
    }
  }
  return null;
}

export function reduceUpdate(state, update) {
  const kind = update?.sessionUpdate;
  if (kind === "agent_message_chunk" || kind === "user_message_chunk") {
    const text = textOf(update.content);
    if (!text) return state;
    if (kind === "user_message_chunk") {
      const last = [...state.items].reverse().find((item) => item.kind === "user");
      if (last && (last.text === text || last.text.endsWith(text) || text.endsWith(last.text))) {
        last.text = text.length > last.text.length ? text : last.text;
        return state;
      }
      pushUser(state, text);
      return state;
    }
    assistant(state).text += text;
    return state;
  }
  if (kind === "agent_thought_chunk") {
    assistant(state).thought += textOf(update.content);
    return state;
  }
  if (kind === "tool_call" || kind === "tool_call_update") {
    closeAssistants(state);
    const id = update.toolCallId || update.id;
    let row = state.items.find((item) => item.kind === "tool" && item.id === id);
    if (!row) {
      row = { kind: "tool", id: id || `t${state.items.length + 1}`, title: "", toolKind: "other", status: "pending", command: "", path: "", diff: null, open: false };
      state.items.push(row);
    }
    if (update.title) row.title = update.title;
    if (update.kind) row.toolKind = update.kind;
    if (update.status) row.status = update.status;
    const bits = toolSummary(update.rawInput);
    if (bits.command) row.command = bits.command;
    if (bits.path) row.path = bits.path;
    const diff = diffOf(update.content);
    if (diff) row.diff = diff;
    const locations = update.locations || [];
    if (!row.path && locations[0]?.path) row.path = locations[0].path;
    return state;
  }
  if (kind === "available_commands_update") {
    state.commands = (update.availableCommands || update.commands || []).map((command) => ({
      name: String(command.name || "").replace(/^\//, ""),
      description: command.description || "",
    })).filter((command) => command.name);
    return state;
  }
  if (kind === "config_option_update") {
    state.config = update.configOptions || [];
    applyConfig(state);
    return state;
  }
  if (kind === "current_mode_update") {
    state.modeId = update.currentModeId || state.modeId;
    return state;
  }
  if (kind === "usage_update" || kind === "context_usage_update") {
    state.usage = {
      used: numberOr(update.used ?? update.usedTokens ?? update.inputTokens),
      size: numberOr(update.size ?? update.contextSize ?? update.limit),
      cost: numberOr(update.cost?.amount ?? update.cost),
    };
    return state;
  }
  return state;
}

function numberOr(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function applyConfig(state) {
  for (const option of state.config) {
    if (option?.id === "model" && option.currentValue) state.modelId = option.currentValue;
    if (option?.id === "thought_level" && option.currentValue) state.modeId = option.currentValue;
  }
}

export function applySession(state, result) {
  if (!result || typeof result !== "object") return state;
  if (result.sessionId) state.sessionId = result.sessionId;
  if (result.modes?.availableModes) {
    state.modes = result.modes.availableModes.map((mode) => ({ id: mode.id, name: mode.name || mode.id }));
    state.modeId = result.modes.currentModeId || state.modeId;
  }
  if (result.models?.availableModels) {
    state.models = result.models.availableModels.map((model) => ({
      id: model.modelId, name: model.name || model.modelId, description: model.description || "",
    }));
    state.modelId = result.models.currentModelId || state.modelId;
  }
  if (Array.isArray(result.configOptions)) {
    state.config = result.configOptions;
    applyConfig(state);
  }
  return state;
}

// A client-side access policy for agents that ask permission. null means the person decides.
export function decidePermission(access, request) {
  const options = request?.options || [];
  const kind = request?.toolCall?.kind || "other";
  const pick = (wanted) => {
    for (const name of wanted) {
      const option = options.find((item) => item.kind === name);
      if (option) return option;
    }
    return null;
  };
  if (access === "full") return pick(["allow_always", "allow_once"]);
  if (access === "read") {
    if (READ_KINDS.has(kind)) return pick(["allow_once", "allow_always"]);
    return pick(["reject_once", "reject_always"]);
  }
  return null;
}

export function optionGroups(state) {
  const config = state.config || [];
  const byId = (id) => config.find((option) => option.id === id);
  const model = byId("model");
  const thought = byId("thought_level");
  const speed = config.find((option) => /speed|fast/i.test(`${option.id} ${option.name}`));
  const models = model
    ? model.options.flatMap((option) => option.options || [option]).map((option) => ({
      id: option.value, name: option.name || option.value, description: option.description || "",
    }))
    : state.models;
  const thinking = thought
    ? (thought.options || []).map((option) => ({ id: option.value, name: option.name || option.value }))
    : (state.modes || []);
  return {
    models,
    modelId: model?.currentValue || state.modelId,
    thinking,
    thinkingId: thought?.currentValue || state.modeId,
    speed,
    commands: state.commands,
  };
}

export function scrubError(text) {
  return String(text || "")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-…")
    .replace(/(api[_-]?key|authorization|bearer)\s*[:=]\s*\S+/gi, "$1=…")
    .slice(0, 500);
}
