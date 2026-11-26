// Provider catalog for the chat. Keys are never stored here: each provider names an
// environment variable, and herdr-secret puts that variable in the agent process.
// Pi reads the same name from models.json as "$NAME" (see Pi's models.json syntax).

export const APIS = [
  { id: "openai-completions", label: "Chat Completions" },
  { id: "openai-responses", label: "Responses" },
  { id: "anthropic-messages", label: "Anthropic" },
];

export const BUILTIN = [
  { id: "openai", name: "OpenAI", secret: "OPENAI_API_KEY", builtin: true, api: "openai-responses", baseUrl: "" },
  { id: "anthropic", name: "Anthropic", secret: "ANTHROPIC_API_KEY", builtin: true, api: "anthropic-messages", baseUrl: "" },
  { id: "openrouter", name: "OpenRouter", secret: "OPENROUTER_API_KEY", builtin: true, api: "openai-completions", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "groq", name: "Groq", secret: "GROQ_API_KEY", builtin: true, api: "openai-completions", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "google", name: "Google", secret: "GEMINI_API_KEY", builtin: true, api: "openai-completions", baseUrl: "" },
];

const SECRET = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;

export function secretName(id) {
  const name = "CHAT_ACP_" + String(id || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!SECRET.test(name)) throw new Error("Provider id cannot become a secret name.");
  return name;
}

export function slug(name) {
  const id = String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  if (!id) throw new Error("Name the provider.");
  return id;
}

export function publicProvider(provider) {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl || "",
    api: provider.api || "openai-completions",
    secret: provider.secret,
    builtin: Boolean(provider.builtin),
    models: (provider.models || []).map((model) => ({
      id: model.id,
      name: model.name || model.id,
      contextWindow: Number(model.contextWindow) || 0,
      maxTokens: Number(model.maxTokens) || 0,
      vision: Boolean(model.vision),
      reasoning: Boolean(model.reasoning),
      enabled: model.enabled !== false,
    })),
  };
}

// Merge our custom providers into Pi's models.json. Existing apiKey values of other
// providers are left untouched and are not copied into the returned view.
export function mergeModels(existing, providers) {
  const doc = existing && typeof existing === "object" ? structuredClone(existing) : { providers: {} };
  if (!doc.providers || typeof doc.providers !== "object") doc.providers = {};
  const custom = providers.filter((provider) => !provider.builtin);
  const ours = new Set(custom.map((provider) => provider.id));
  for (const id of Object.keys(doc.providers)) {
    if (doc.providers[id]?.chatAcp && !ours.has(id)) delete doc.providers[id];
  }
  for (const provider of providers) {
    if (provider.builtin) continue;
    const models = (provider.models || []).filter((model) => model.enabled !== false).map((model) => ({
      id: model.id,
      name: model.name || model.id,
      api: provider.api,
      reasoning: Boolean(model.reasoning),
      input: model.vision ? ["text", "image"] : ["text"],
      contextWindow: Number(model.contextWindow) || 128000,
      maxTokens: Number(model.maxTokens) || 8192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }));
    doc.providers[provider.id] = {
      name: provider.name,
      baseUrl: provider.baseUrl,
      api: provider.api,
      apiKey: `$${provider.secret}`,
      chatAcp: true,
      models,
    };
  }
  return doc;
}

export function enableModels(settings, providers) {
  const doc = settings && typeof settings === "object" ? structuredClone(settings) : {};
  if (!Array.isArray(doc.enabledModels)) return doc;
  const have = new Set(doc.enabledModels);
  for (const provider of providers) {
    if (provider.builtin) continue;
    for (const model of provider.models || []) {
      if (model.enabled === false) continue;
      have.add(`${provider.id}/${model.id}`);
    }
  }
  doc.enabledModels = [...have];
  return doc;
}

export function fastSibling(models, currentId) {
  const list = models || [];
  const current = list.find((model) => model.id === currentId);
  if (!current) return null;
  const family = String(current.id).split("/").slice(0, -1).join("/");
  const same = list.filter((model) => model.id !== current.id && (!family || model.id.startsWith(`${family}/`)));
  const isFast = (model) => /fast|flash/i.test(`${model.id} ${model.name}`);
  if (isFast(current)) {
    const base = same.find((model) => !isFast(model));
    return base ? { id: base.id, on: true } : null;
  }
  const other = same.find(isFast);
  return other ? { id: other.id, on: false } : null;
}
