// Pi's own page in Settings. Provider and which models are on come from ~/.pi/agent.
// The API key stays in models.json; this page never reads it and never writes that file.
import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { home, readTextFile, writeTextFile } from "herdr";
import { segmented, toggleSwitch } from "./ui.js";

const dir = () => `${home()}/.pi/agent`;
const settingsPath = () => `${dir()}/settings.json`;
const modelsPath = () => `${dir()}/models.json`;

const empty = () => ({ providers: [], models: [], enabled: [], provider: "", model: "", note: "" });

function splitId(id) {
  const at = String(id).indexOf("/");
  return at < 0 ? ["", id] : [id.slice(0, at), id.slice(at + 1)];
}

export function piInit(host) {
  host.pi = empty();
}

export async function piLoad(host) {
  const settingsText = await readTextFile(settingsPath()).catch(() => null);
  const modelsText = await readTextFile(modelsPath()).catch(() => null);
  if (!settingsText || !modelsText) {
    host.pi = { ...empty(), note: "Pi settings were not found in ~/.pi/agent." };
    return;
  }
  let settings, models;
  try {
    settings = JSON.parse(settingsText);
    models = JSON.parse(modelsText);
  } catch {
    host.pi = { ...empty(), note: "Pi settings could not be read." };
    return;
  }
  const enabled = new Set(settings.enabledModels ?? []);
  const providers = Object.entries(models.providers ?? {}).map(([id, provider]) => ({ id, name: provider.name || id }));
  const rows = [];
  const known = new Set();
  for (const [pid, provider] of Object.entries(models.providers ?? {})) {
    for (const model of provider.models ?? []) {
      const id = `${pid}/${model.id}`;
      known.add(id);
      rows.push({ id, provider: pid, name: model.name || model.id, context: model.contextWindow || null, on: enabled.has(id) });
    }
  }
  for (const id of settings.enabledModels ?? []) {
    if (known.has(id)) continue;
    const [provider] = splitId(id);
    rows.push({ id, provider, name: splitId(id)[1], context: null, on: true });
  }
  const provider = settings.defaultProvider || "";
  const model = settings.defaultModel ? `${provider}/${settings.defaultModel}` : "";
  host.pi = { providers, models: rows, enabled: [...enabled], provider, model, note: "" };
}

async function save(host, edit) {
  const text = await readTextFile(settingsPath());
  const data = JSON.parse(text);
  edit(data);
  const next = JSON.stringify(data, null, 2) + (text.endsWith("\n") ? "\n" : "");
  await writeTextFile(settingsPath(), next, text);
  await piLoad(host);
}

export function piSection(host, t) {
  const pi = host.pi ?? empty();
  const setProvider = (id, _e, cx) => cx.spawn(async (cx) => {
    await save(host, (data) => {
      data.defaultProvider = id;
      const keep = (data.enabledModels ?? []).find((model) => model.startsWith(`${id}/`));
      if (keep) data.defaultModel = splitId(keep)[1];
    });
    cx.notify();
  });
  const toggle = (model) => (_next, _e, cx) => cx.spawn(async (cx) => {
    await save(host, (data) => {
      const list = new Set(data.enabledModels ?? []);
      if (list.has(model.id)) list.delete(model.id);
      else list.add(model.id);
      data.enabledModels = [...list];
      if (data.defaultProvider === model.provider && data.defaultModel === splitId(model.id)[1] && !list.has(model.id)) {
        const other = [...list].find((id) => id.startsWith(`${model.provider}/`));
        data.defaultModel = other ? splitId(other)[1] : data.defaultModel;
      }
    });
    cx.notify();
  });
  const makeDefault = (model, cx) => cx.spawn(async (cx) => {
    await save(host, (data) => {
      const list = new Set(data.enabledModels ?? []);
      list.add(model.id);
      data.enabledModels = [...list];
      data.defaultProvider = model.provider;
      data.defaultModel = splitId(model.id)[1];
    });
    cx.notify();
  });
  return v_flex()
    .child(host.title(t, "Pi"))
    .when(Boolean(pi.note), (el) => el.child(div().text_size(12).text_color(t.dim).child(pi.note)))
    .when(pi.providers.length > 0, (el) => el.child(host.row(t, "Provider", "Pi starts on this provider. The key stays in Pi's own file.",
      segmented("pi-provider", pi.providers.map((p) => [p.id, p.name]), pi.provider, setProvider))))
    .child(host.heading(t, "Models"))
    .children(pi.models.map((model) => host.row(t, model.name,
      [model.id, model.context ? `${Math.round(model.context / 1000)}k` : ""].filter(Boolean).join(" · "),
      toggleSwitch(`pi-model-${model.id.replace(/[^\w]+/g, "_")}`, model.on, toggle(model)),
      null, null,
      model.id === pi.model ? div().text_size(12).text_color(t.dim).child("Default")
        : div().text_size(12).text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => makeDefault(model, cx)).child("Make default"))));
}
