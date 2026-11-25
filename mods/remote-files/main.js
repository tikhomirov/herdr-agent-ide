// Remote files: the project's folder on a server, over SSH, in a tab of the right panel; a file opens in an editor tab
// and is saved back over SSH. Which servers a project has (name, ssh host or alias, folder) is kept per project.
//   - as a panel block (no props): the server picker and the file tree;
//   - as a tab (`props().edit = { host, path, remote }`, made by tab.new): the editor of one remote file.
// Sign-in is by key or ssh-agent only (see ssh.js).
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, EditorState, Editor, ScrollHandle } from "gpui-base";
import { layout, props, run, spaces, theme, home } from "herdr";
import * as ssh from "./ssh.js";

const find = (node, id) => {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const hit = find(c, id); if (hit) return hit; }
  return null;
};
const folderNow = () => spaces().find((s) => s.active)?.folder || home();
const shown = () => { const l = layout(); return !find(l, "panel")?.hidden && find(l, "panel-body")?.active === "remote"; };
const join = (dir, name) => (dir === "/" ? "" : dir.replace(/\/$/, "")) + "/" + name;
const parentOf = (p) => (p === "/" ? "/" : p === "~" ? "~/.." : p.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/");
const icon = (name) => `mods/remote-files/${name}.svg`;

// ---- what each project has: { [folder]: { list: [{ name, host, path }], active } } ----

const store = {
  all() { try { return JSON.parse(localStorage.getItem("projects") ?? "{}") || {}; } catch { return {}; } },
  get(folder) { const p = this.all()[folder]; return p && Array.isArray(p.list) ? p : { list: [], active: 0 }; },
  set(folder, project) { const all = this.all(); all[folder] = project; localStorage.setItem("projects", JSON.stringify(all)); },
};

// ---- the panel ----

class Panel {
  constructor(cx) {
    this.folder = null; this.project = { list: [], active: 0 };
    this.view = "tree";          // tree | form
    this.dir = {};               // `${folder}|${i}` -> current folder of that server
    this.data = null;            // { path, entries } | { error }
    this.loading = false; this.loaded = null; this.msg = null;
    this.sel = null; this.confirm = false; this.menu = false;
    this.prompt = null;          // { kind: "file" | "folder" | "rename", from? }
    this.hosts = [];
    this.scroll = ScrollHandle.new();
    this.path = InputState.new({ placeholder: "/path/on/the/server" });
    this.path.on("submit", (_e, cx) => { const v = this.path.value().trim(); if (v) this.go(v, cx); });
    this.name = InputState.new({ placeholder: "Name (e.g. production)" });
    this.host = InputState.new({ placeholder: "Server: ssh alias or user@host" });
    this.fpath = InputState.new({ placeholder: "Project folder on the server, e.g. /var/www/app" });
    this.pr = InputState.new({ placeholder: "" });
    this.pr.on("submit", (_e, cx) => this.runPrompt(cx));
    for (const i of [this.name, this.host, this.fpath]) i.on("submit", (_e, cx) => this.saveForm(cx));
    cx.spawn(async (cx) => { try { this.hosts = await ssh.sshHosts(); } catch {} cx.notify(); });
  }

  get remote() { return this.project.list[this.project.active] ?? null; }
  key() { return `${this.folder}|${this.project.active}`; }

  // Follows the shown space: its servers, and its tree once the tab is on screen.
  follow() {
    const folder = folderNow();
    if (folder !== this.folder) {
      this.folder = folder; this.project = store.get(folder);
      this.data = null; this.loaded = null; this.sel = null; this.prompt = null; this.msg = null; this.menu = false;
      this.view = this.project.list.length ? "tree" : "form";
      if (this.view === "form") this.openForm(null);
    }
  }
  sync(cx) {
    this.follow();
    if (this.view === "tree" && this.remote && shown() && !this.loading) {
      const want = `${this.key()}|${this.dir[this.key()] ?? this.remote.path}`;
      if (this.loaded !== want) this.load(this.dir[this.key()] ?? this.remote.path, cx);
    }
  }

  load(path, cx) {
    const r = this.remote; if (!r) return;
    const key = this.key();
    this.loading = true; this.loaded = `${key}|${path}`; this.msg = null; this.sel = null; this.prompt = null; this.confirm = false;
    cx.notify();
    cx.spawn(async (cx) => {
      const d = await ssh.list(r.host, path);
      if (this.key() === key) {
        this.data = d;
        if (d.path) { this.dir[key] = d.path; this.loaded = `${key}|${d.path}`; this.path.set_value(d.path); }
        else this.path.set_value(path);
      }
      this.loading = false; cx.notify();
    });
  }

  // Where the tree is, also when that folder couldn't be read (then there is no listing, but Up must still work).
  here() { return this.data?.path ?? this.dir[this.key()] ?? this.remote?.path ?? "~"; }

  go(path, cx) { this.dir[this.key()] = path; this.loaded = null; this.load(path, cx); }
  refresh(cx) { this.load(this.dir[this.key()] ?? this.remote?.path ?? "~", cx); }

  open(entry, cx) {
    const base = this.data.path;
    if (entry.dir) return this.go(join(base, entry.name), cx);
    const path = join(base, entry.name), r = this.remote;
    const name = `${entry.name} · ${r.name}`;
    const have = spaces().find((s) => s.active)?.tabs.find((t) => t.named && t.name === name);
    if (have) return run("tab.select", { id: have.id });
    run("tab.new", { name, mod: "remote-files", props: { edit: { host: r.host, path, remote: r.name } } });
  }

  // A terminal tab on the server, in the selected folder (else the one shown).
  openShell(cx) {
    const r = this.remote;
    if (!r || !ssh.validHost(r.host)) return;
    const d = this.data, sel = d?.entries?.find((e) => e.name === this.sel);
    const path = sel?.dir ? join(d.path, sel.name) : this.here();
    run("terminal.open", { argv: ssh.shellArgv(r.host, path), name: r.name, place: "tab" });
  }

  // ---- actions on the tree ----

  startPrompt(kind, from, cx) {
    this.prompt = { kind, from }; this.confirm = false;
    this.pr.set_value(kind === "rename" ? from : "");
    this.pr.focus(); cx.notify();
  }
  runPrompt(cx) {
    const p = this.prompt, v = this.pr.value().trim(), r = this.remote;
    if (!p || !v || !r) return;
    if (v.includes("/") || v === "." || v === "..") { this.msg = { error: "A name has no slashes" }; return cx.notify(); }
    const base = this.data.path, to = join(base, v);
    this.prompt = null; this.loading = true; cx.notify();
    cx.spawn(async (cx) => {
      const res = p.kind === "folder" ? await ssh.mkdir(r.host, to) : p.kind === "file" ? await ssh.touch(r.host, to) : await ssh.rename(r.host, join(base, p.from), to);
      this.loading = false;
      if (!res.ok) { this.msg = { error: res.err }; cx.notify(); return; }
      this.msg = { ok: p.kind === "rename" ? `Renamed to ${v}` : `Created ${v}` };
      this.loaded = null; this.refresh(cx);
    });
  }
  runDelete(cx) {
    const e = this.data.entries.find((x) => x.name === this.sel), r = this.remote;
    if (!e || !r) return;
    this.confirm = false; this.loading = true; cx.notify();
    cx.spawn(async (cx) => {
      const res = await ssh.remove(r.host, join(this.data.path, e.name), e.dir && !e.link);
      this.loading = false;
      if (!res.ok) { this.msg = { error: res.err.includes("not empty") ? "The folder isn't empty: only empty folders can be deleted here" : res.err }; cx.notify(); return; }
      this.msg = { ok: `Deleted ${e.name}` }; this.refresh(cx);
    });
  }

  // ---- the form: add or edit a server of this project ----

  openForm(i) {
    this.view = "form"; this.editing = i;
    const r = i == null ? null : this.project.list[i];
    this.name.set_value(r?.name ?? ""); this.host.set_value(r?.host ?? ""); this.fpath.set_value(r?.path ?? "");
    this.formError = null;
  }
  saveForm(cx) {
    const host = this.host.value().trim(), path = this.fpath.value().trim() || "~";
    if (!ssh.validHost(host)) { this.formError = "Enter an ssh alias or user@host"; return cx.notify(); }
    const name = this.name.value().trim() || host;
    const list = [...this.project.list];
    if (this.editing == null) { list.push({ name, host, path }); this.project = { list, active: list.length - 1 }; }
    else { list[this.editing] = { name, host, path }; this.project = { list, active: this.editing }; }
    store.set(this.folder, this.project);
    delete this.dir[this.key()];
    this.view = "tree"; this.data = null; this.loaded = null; this.msg = null;
    cx.notify();
  }
  removeRemote(cx) {
    const list = this.project.list.filter((_, i) => i !== this.editing);
    this.project = { list, active: 0 };
    store.set(this.folder, this.project);
    this.data = null; this.loaded = null;
    if (list.length) this.view = "tree"; else this.openForm(null);
    cx.notify();
  }
  choose(i, cx) {
    this.project = { ...this.project, active: i }; store.set(this.folder, this.project);
    this.menu = false; this.data = null; this.loaded = null; this.msg = null; cx.notify();
  }

  // ---- drawing ----

  render(cx) {
    this.follow();
    return this.view === "form" ? this.renderForm(cx) : this.renderTree(cx);
  }

  btn(t, id, ic, tip, onClick, on) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).tooltip(tip)
      .text_color(t.muted).bg(on ? t.selected : t.chrome).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => onClick(cx)).child(svg(icon(ic)).size(15));
  }

  renderForm(cx) {
    const t = theme(), first = this.project.list.length === 0, project = this.folder.split("/").filter(Boolean).pop() || "this project";
    const field = (label, state, hint) => v_flex().gap(4).w_full()
      .child(div().text_size(11.5).text_color(t.muted).child(label))
      .child(div().w_full().h(30).px(10).rounded(7).border_1().border_color(t.input).bg(t.background)
        .child(Input.new(state).size_full().text_size(12.5).text_color(t.foreground)))
      .when(Boolean(hint), (el) => el.child(div().text_size(11).text_color(t.dim).child(hint)));
    const chips = this.hosts.slice(0, 40).map((h) => div().id(`host-${h}`).h(22).px(8).flex_none().flex().items_center().rounded(11)
      .text_size(11.5).bg(t.raised).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { this.host.set_value(h); if (!this.name.value().trim()) this.name.set_value(h); cx.notify(); }).child(h));
    return v_flex().id("remote-form").size_full().min_h(0).p(16).gap(12).bg(t.background).overflow_y_scrollbar()
      .child(h_flex().gap(8).items_center()
        .child(svg(icon("server")).size(18).text_color(t.muted))
        .child(div().flex_1().text_size(14).font_semibold().text_color(t.foreground)
          .child(first ? `Connect a server for ${project}` : this.editing == null ? "Add a server" : "Edit server")))
      .child(div().text_size(12).text_color(t.dim).child("Browse and edit the project's files on a server over SSH. Sign-in is by key or ssh-agent; nothing is stored but the server's name and folder."))
      .child(field("Name", this.name))
      .child(field("Server", this.host, "An alias from ~/.ssh/config, or user@host"))
      .when(chips.length > 0, (el) => el.child(h_flex().gap(6).flex_wrap().children(chips)))
      .child(field("Project folder", this.fpath, "Leave empty for the server's home folder"))
      .when(Boolean(this.formError), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.formError)))
      .child(h_flex().gap(8).items_center().pt(4)
        .child(div().id("form-save").h(30).px(14).flex().items_center().rounded(7).text_size(12.5).bg(t.solid).text_color(t.solid_foreground)
          .cursor_pointer().on_click((_e, cx) => this.saveForm(cx)).child(this.editing == null ? "Connect" : "Save"))
        .when(!first, (el) => el.child(div().id("form-cancel").h(30).px(12).flex().items_center().rounded(7).text_size(12.5).text_color(t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.view = "tree"; cx.notify(); }).child("Cancel")))
        .child(div().flex_1())
        .when(this.editing != null, (el) => el.child(div().id("form-remove").h(30).px(12).flex().items_center().rounded(7).text_size(12.5).text_color(t.blocked)
          .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.removeRemote(cx)).child("Remove"))));
  }

  renderTree(cx) {
    const t = theme(), r = this.remote, d = this.data;
    const sel = d?.entries?.find((e) => e.name === this.sel);
    const header = h_flex().h(38).flex_none().px(10).gap(4).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .child(h_flex().id("remote-switch").h(26).px(8).gap(6).flex_1().min_w(0).items_center().rounded(6).cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.menu = !this.menu; cx.notify(); })
        .child(svg(icon("server")).size(14).flex_none().text_color(t.muted))
        .child(div().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(r.name))
        .child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(r.host))
        .child(svg(icon("chevron")).size(12).flex_none().text_color(t.dim)))
      .child(this.btn(t, "rf-refresh", "refresh", "Refresh", (cx) => this.refresh(cx)))
      .child(this.btn(t, "rf-file", "file-plus", "New file", (cx) => this.startPrompt("file", null, cx), this.prompt?.kind === "file"))
      .child(this.btn(t, "rf-folder", "folder-plus", "New folder", (cx) => this.startPrompt("folder", null, cx), this.prompt?.kind === "folder"))
      .child(this.btn(t, "rf-ssh", "terminal", "SSH terminal in the selected folder", (cx) => this.openShell(cx)))
      .child(this.btn(t, "rf-edit", "pencil", "Edit this server", (cx) => { this.openForm(this.project.active); cx.notify(); }));

    const pathRow = h_flex().h(34).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
      .child(this.btn(t, "rf-up", "arrow-up", "Parent folder", (cx) => this.go(parentOf(this.here()), cx)))
      .child(div().flex_1().min_w(0).h(26).px(8).rounded(6).border_1().border_color(t.input).bg(t.background)
        .child(Input.new(this.path).size_full().text_size(12).text_color(t.foreground)));

    const menu = this.menu && v_flex().id("remote-menu").flex_none().p(6).gap(2).border_b(1).border_color(t.border).bg(t.popover)
      .children(this.project.list.map((x, i) => h_flex().id(`remote-${i}`).h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer()
        .bg(i === this.project.active ? t.selected : t.popover).hover((s) => s.bg(t.hover)).text_size(12.5).text_color(t.foreground)
        .on_click((_e, cx) => this.choose(i, cx))
        .child(div().min_w(0).truncate().child(x.name)).child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(`${x.host}:${x.path}`))))
      .child(h_flex().id("remote-add").h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).text_size(12.5).text_color(t.muted)
        .on_click((_e, cx) => { this.menu = false; this.openForm(null); cx.notify(); }).child("+ Add a server…"));

    const note = this.msg
      ? div().flex_none().px(12).py(6).text_size(12).text_color(this.msg.error ? t.blocked : t.done).border_b(1).border_color(t.border).child(this.msg.error ?? this.msg.ok)
      : null;

    const prompt = this.prompt && h_flex().flex_none().h(36).px(10).gap(8).items_center().border_b(1).border_color(t.border).bg(t.raised)
      .child(svg(icon(this.prompt.kind === "folder" ? "folder-plus" : this.prompt.kind === "file" ? "file-plus" : "pencil")).size(14).text_color(t.muted))
      .child(div().flex_1().min_w(0).h(26).px(8).rounded(6).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.pr).size_full().text_size(12.5).text_color(t.foreground)))
      .child(this.btn(t, "rf-ok", "check", "OK", (cx) => this.runPrompt(cx)))
      .child(this.btn(t, "rf-cancel", "x", "Cancel", (cx) => { this.prompt = null; cx.notify(); }));

    const bar = sel && h_flex().flex_none().h(34).px(10).gap(6).items_center().border_b(1).border_color(t.border).bg(t.raised).text_size(12)
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(this.confirm ? `Delete ${sel.name}${sel.dir ? " (must be empty)" : ""}?` : sel.name))
      .when(!this.confirm, (el) => el
        .child(this.btn(t, "rf-rename", "pencil", "Rename", (cx) => this.startPrompt("rename", sel.name, cx)))
        .child(this.btn(t, "rf-del", "trash", "Delete", (cx) => { this.confirm = true; cx.notify(); }))
        .child(this.btn(t, "rf-x", "x", "Deselect", (cx) => { this.sel = null; cx.notify(); })))
      .when(this.confirm, (el) => el
        .child(div().id("rf-del-yes").h(24).px(10).flex().items_center().rounded(6).bg(t.blocked).text_color(t.solid_foreground).cursor_pointer().on_click((_e, cx) => this.runDelete(cx)).child("Delete"))
        .child(div().id("rf-del-no").h(24).px(10).flex().items_center().rounded(6).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.confirm = false; cx.notify(); }).child("Cancel")));

    const row = (e) => {
      const on = e.name === this.sel;
      return h_flex().id(`rf-${e.name}`).h(26).px(8).gap(7).flex_none().items_center().rounded(5).text_size(12.5).cursor_pointer()
        .bg(on ? t.selected : t.background).text_color(t.foreground).hover((s) => s.bg(on ? t.selected : t.hover))
        .tooltip(`${e.mode} · ${new Date(e.mtime * 1000).toLocaleString()}${e.link ? " · link" : ""}`)
        .on_click((_e, cx) => this.open(e, cx))
        .on_mouse_down("right", (_ev, cx) => { cx.stop_propagation(); this.sel = on ? null : e.name; this.confirm = false; cx.notify(); })
        .child(svg(icon(e.dir ? "folder" : "file")).size(14).flex_none().text_color(e.dir ? t.accent : t.dim))
        .child(div().flex_1().min_w(0).truncate().child(e.name))
        .when(!e.dir, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ssh.human(e.size))));
    };
    const MAX = 1000;
    const entries = d?.entries ?? [];
    const body = v_flex().id("rf-list").flex_1().min_h(0).p(6).gap(1).overflow_y_scrollbar().track_scroll(this.scroll)
      .on_mouse_down("right", (_ev, cx) => { this.sel = null; cx.notify(); })
      .when(Boolean(d?.error), (el) => el.child(div().p(8).text_size(12).text_color(t.blocked).child(d.error)))
      .when(!d && this.loading, (el) => el.child(div().p(8).text_size(12).text_color(t.dim).child("Connecting…")))
      .when(Boolean(d?.entries) && entries.length === 0, (el) => el.child(div().p(8).text_size(12).text_color(t.dim).child("Empty folder")))
      .children(entries.slice(0, MAX).map(row))
      .when(entries.length > MAX, (el) => el.child(div().p(8).text_size(11.5).text_color(t.dim).child(`${entries.length - MAX} more not shown`)));

    return v_flex().id("remote-panel").size_full().min_h(0).bg(t.background)
      .child(header).when(Boolean(menu), (el) => el.child(menu)).child(pathRow)
      .when(Boolean(note), (el) => el.child(note)).when(Boolean(prompt), (el) => el.child(prompt)).when(Boolean(bar), (el) => el.child(bar))
      .child(body)
      .when(this.loading && Boolean(d), (el) => el.child(div().flex_none().h(2).bg(t.accent)));
  }
}

// ---- the editor tab ----

class RemoteEditor {
  constructor(edit, cx) {
    this.edit = edit; this.name = edit.path.split("/").pop();
    this.state = "loading"; this.error = null; this.dirty = false; this.saving = false; this.conflict = false;
    this.mtime = null; this.base = ""; this.code = null; this.wrap = false;
    this.load(cx);
  }

  load(cx) {
    this.state = "loading"; this.error = null; this.conflict = false; cx.notify();
    cx.spawn(async (cx) => {
      const r = await ssh.read(this.edit.host, this.edit.path);
      if (r.error) { this.state = "error"; this.error = r.error; cx.notify(); return; }
      this.mtime = r.mtime; this.base = r.text; this.dirty = false;
      this.code?.release();
      const t = theme();
      this.code = EditorState.new({
        language: ssh.languageOf(this.edit.path), value: r.text, readonly: false, line_numbers: true, folding: true, soft_wrap: this.wrap, font_size: 13,
        syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 },
      });
      this.code.on("change", (_e, cx) => { const d = this.code.value() !== this.base; if (d !== this.dirty) { this.dirty = d; cx.notify(); } });
      this.state = "ready"; cx.notify();
    });
  }

  save(cx, force) {
    if (this.state !== "ready" || this.saving || !this.code) return;
    const text = this.code.value();
    this.saving = true; this.error = null; this.conflict = false; cx.notify();
    cx.spawn(async (cx) => {
      const r = await ssh.write(this.edit.host, this.edit.path, text, force ? null : this.mtime);
      this.saving = false;
      if (r.mtime) { this.mtime = r.mtime; this.base = text; this.dirty = this.code.value() !== text; }
      else { this.error = r.error; this.conflict = Boolean(r.conflict); }
      cx.notify();
    });
  }

  render(cx) {
    const t = theme();
    const bt = (id, label, onClick, strong) => div().id(id).h(26).px(10).flex().items_center().flex_none().rounded(6).text_size(12).cursor_pointer()
      .bg(strong ? t.solid : t.raised).text_color(strong ? t.solid_foreground : t.muted)
      .hover((s) => s.bg(strong ? t.solid : t.hover)).on_click((_e, cx) => onClick(cx)).child(label);
    return v_flex().id("remote-editor").size_full().min_h(0).bg(t.background)
      .on_key_down((e, cx) => {
        if (e.keystroke === "ctrl-s" || e.keystroke === "cmd-s") { cx.stop_propagation(); if (!e.is_held) this.save(cx); }
      })
      .child(h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).bg(t.chrome)
        .child(svg(icon("file")).size(14).flex_none().text_color(t.muted))
        .child(div().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(this.name))
        .when(this.dirty, (el) => el.child(div().size(7).rounded(4).flex_none().bg(t.accent).tooltip("Unsaved changes")))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(`${this.edit.remote} · ${this.edit.path}`))
        .child(bt("re-reload", "Reload", (cx) => this.load(cx)))
        .child(bt("re-save", this.saving ? "Saving…" : "Save", (cx) => this.save(cx), this.dirty)))
      .when(Boolean(this.error) && this.state === "ready", (el) => el.child(h_flex().flex_none().px(12).py(6).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.blocked).child(this.error))
        .when(this.conflict, (el2) => el2.child(bt("re-over", "Overwrite", (cx) => this.save(cx, true))).child(bt("re-fresh", "Reload", (cx) => this.load(cx))))))
      .child(this.state === "ready"
        ? Editor.new(this.code).id("remote-code").flex_1().min_h(0)
        : div().flex_1().p(24).text_size(12.5).text_color(this.state === "error" ? t.blocked : t.dim).child(this.state === "error" ? this.error : "Loading…"));
  }
}

export default class RemoteFiles extends View {
  init(_props, cx) {
    const edit = props()?.edit;
    this.inner = edit ? new RemoteEditor(edit, cx) : new Panel(cx);
    if (!edit) cx.timer.every(1000, (cx) => { this.inner.sync(cx); });
  }
  async close() { this.inner?.code?.release?.(); }
  render(cx) { return this.inner.render(cx); }
}
