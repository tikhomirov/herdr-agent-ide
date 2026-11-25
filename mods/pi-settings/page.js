// Pi's provider and model list. Settings (frame/settings) and this mod's own
// dialog both call these methods. Keys stay in ~/.pi/agent/models.json.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { home, readTextFile, writeTextFile } from "herdr";

const empty = () => ({ providers: [], models: [], provider: "", model: "", note: "" });

export function bindPi(Class) {
  Class.prototype.loadPi = loadPi;
  Class.prototype.savePi = savePi;
  Class.prototype.piModels = piModels;
  Class.prototype.pickPiProvider = pickPiProvider;
  Class.prototype.togglePiModel = togglePiModel;
  Class.prototype.defaultPiModel = defaultPiModel;
  Class.prototype.piPage = piPage;
}

async function loadPi() {
  const root = `${home()}/.pi/agent`;
  const settingsText = await readTextFile(`${root}/settings.json`).catch(() => null);
  const modelsText = await readTextFile(`${root}/models.json`).catch(() => null);
  if (!settingsText || !modelsText) {
    this.pi = { ...empty(), note: "Pi settings were not found in ~/.pi/agent." };
    return;
  }
  let settings, models;
  try {
    settings = JSON.parse(settingsText);
    models = JSON.parse(modelsText);
  } catch {
    this.pi = { ...empty(), note: "Pi settings could not be read." };
    return;
  }
  const enabled = new Set(settings.enabledModels ?? []);
  const providers = Object.entries(models.providers ?? {}).map(([id, provider]) => ({ id, name: provider.name || id }));
  const rows = [];
  const known = new Set();
  const split = (id) => {
    const at = String(id).indexOf("/");
    return at < 0 ? ["", id] : [id.slice(0, at), id.slice(at + 1)];
  };
  for (const [pid, provider] of Object.entries(models.providers ?? {})) {
    for (const model of provider.models ?? []) {
      const id = `${pid}/${model.id}`;
      known.add(id);
      rows.push({ id, provider: pid, name: model.name || model.id, on: enabled.has(id) });
    }
  }
  for (const id of settings.enabledModels ?? []) {
    if (known.has(id)) continue;
    rows.push({ id, provider: split(id)[0], name: split(id)[1], on: true });
  }
  const provider = settings.defaultProvider || providers[0]?.id || "";
  this.pi = { providers, models: rows, provider, model: settings.defaultModel ? `${provider}/${settings.defaultModel}` : "", note: "" };
}

async function savePi(edit, cx) {
  const path = `${home()}/.pi/agent/settings.json`;
  try {
    const text = await readTextFile(path);
    const data = JSON.parse(text);
    edit(data);
    const next = JSON.stringify(data, null, 2) + (text.endsWith("\n") ? "\n" : "");
    await writeTextFile(path, next, text);
    await this.loadPi();
  } catch (error) {
    this.pi = { ...(this.pi ?? empty()), note: String(error?.message ?? error) };
  }
  cx.notify();
}

function piModels() {
  const pi = this.pi ?? empty();
  return pi.models.filter((model) => model.provider === pi.provider);
}

function pickPiProvider(id, cx) {
  const models = (this.pi?.models ?? []).filter((model) => model.provider === id);
  const current = this.pi?.model ?? "";
  const keep = current.startsWith(`${id}/`) ? models.find((model) => model.id === current) : null;
  const next = keep ?? models.find((model) => model.on) ?? models[0] ?? null;
  this.pi = { ...this.pi, provider: id, model: next?.id ?? "", note: "" };
  cx.notify();
  cx.spawn(async (cx) => this.savePi((data) => {
    data.defaultProvider = id;
    if (next) data.defaultModel = next.id.slice(id.length + 1);
  }, cx));
}

function togglePiModel(model, cx) {
  const on = !model.on;
  this.pi = { ...this.pi, models: this.pi.models.map((item) => item.id === model.id ? { ...item, on } : item), note: "" };
  cx.notify();
  cx.spawn(async (cx) => this.savePi((data) => {
    const list = new Set(data.enabledModels ?? []);
    if (on) list.add(model.id);
    else list.delete(model.id);
    data.enabledModels = [...list];
    if (!on && `${data.defaultProvider}/${data.defaultModel}` === model.id) {
      const other = [...list].find((id) => id.startsWith(`${model.provider}/`));
      if (other) data.defaultModel = other.slice(model.provider.length + 1);
    }
  }, cx));
}

function defaultPiModel(model, cx) {
  this.pi = {
    ...this.pi,
    provider: model.provider,
    model: model.id,
    note: "",
    models: this.pi.models.map((item) => item.id === model.id ? { ...item, on: true } : item),
  };
  cx.notify();
  cx.spawn(async (cx) => this.savePi((data) => {
    const list = new Set(data.enabledModels ?? []);
    list.add(model.id);
    data.enabledModels = [...list];
    data.defaultProvider = model.provider;
    data.defaultModel = model.id.slice(model.provider.length + 1);
  }, cx));
}

function piPage(t) {
  const pi = this.pi ?? empty();
  const shown = this.piModels();
  const provider = pi.providers.find((item) => item.id === pi.provider);
  return v_flex()
    .child(this.heading(t, "Pi"))
    .when(Boolean(pi.note), (el) => el.child(div().pb(8).text_size(12.5).text_color(t.dim).child(pi.note)))
    .child(div().pb(8).text_size(12.5).line_height("18px").text_color(t.dim).child("Pi starts on this provider. The list below is only its models. The key stays in Pi's own file."))
    .child(h_flex().gap(6).flex_wrap().pb(8).children(pi.providers.map((item) => this.button(t, `st-pi-${item.id}`, item.id === pi.provider ? `${item.name} · on` : item.name, (_e, cx) => this.pickPiProvider(item.id, cx)))))
    .child(this.heading(t, provider?.name || "Models"))
    .when(shown.length === 0, (el) => el.child(div().text_size(13).text_color(t.dim).child("This provider has no models in ~/.pi/agent.")))
    .children(shown.map((model) => this.row(t, model.name, model.id,
      h_flex().gap(6).items_center()
        .child(this.button(t, `st-pi-on-${model.id.replace(/[^\w]+/g, "_")}`, model.on ? "On" : "Off", (_e, cx) => this.togglePiModel(model, cx)))
        .child(div().text_size(12.5).text_color(model.id === pi.model ? t.foreground : t.muted)
          .when(model.id !== pi.model, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => this.defaultPiModel(model, cx)))
          .child(model.id === pi.model ? "Default" : "Make default")))));
}
