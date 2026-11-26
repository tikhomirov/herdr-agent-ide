#!/usr/bin/env python3
"""Builds mods/tabs-ide-tasks from the vendored tabs-tasks mod.

Result: the coordinator tab bar (Tasks badges, service, inbox) plus Files, Changes,
Git, Artifacts, Remote, Browser, Chat and the layout switcher. Callers in the other
mods are pointed at tabs-ide-tasks.* so the layout does not need a second tab bar.
"""
import json, os, re, shutil

root = os.path.dirname(os.path.abspath(__file__)) + "/.."
mods = os.path.join(root, "mods")
src, dst = os.path.join(mods, "tabs-tasks"), os.path.join(mods, "tabs-ide-tasks")
if not os.path.isdir(src):
    raise SystemExit("mods/tabs-tasks is missing (run tools/vendor.py)")
shutil.rmtree(dst, ignore_errors=True)
shutil.copytree(src, dst, ignore=shutil.ignore_patterns("gpui-kit.d.ts", "jsconfig.json"))
shutil.copy(os.path.join(mods, "tabs-ide", "chat.svg"), dst)
shutil.copy(os.path.join(mods, "tabs-ide", "layout.svg"), dst)
s = open(os.path.join(dst, "main.js"), encoding="utf-8").read()
ide = open(os.path.join(mods, "tabs-ide", "main.js"), encoding="utf-8").read()
helpers = ide[ide.index("// Claude Code and Codex are the agents"):ide.index("export default class Tabs")]
s = s.replace("import { panes, run, openOverlay,", "import { panes, exec, run, openOverlay,")
s = s.replace("export default class Tabs", helpers + "export default class Tabs", 1)
a = s.index('    const enabled = [...(shared("workspace.panels")')
b = s.index("    this.syncPanel(space, panel, body, enabled);")
s = s[:a] + '''    const here = new Set((body?.children ?? []).map(c => c.id));
    const known = [
      ["files", "Files", "mods/files/file.svg"], ["changes", "Changes", "mods/changes/changes.svg"],
      ["git-graph", "Git", "mods/git-graph/icons/graph.svg"], ["tasks", "Tasks", "mods/tasks/tasks.svg"],
      ["artifacts", "Artifacts", "mods/artifacts/artifacts.svg"], ["remote", "Remote", "mods/remote-files/server.svg"],
      ["browser", "Browser", "mods/workspace-chrome/monitor.svg"],
    ].filter(([id]) => here.has(id) && (id !== "artifacts" || addonOn("artifacts")));
    const enabled = known.map(([id]) => id);
    const chatHeader = find(root, "main")?.content?.pane?.header?.content?.mod === "pane-chat";
''' + s[b:]
a = s.index('      .when(enabled.includes("files")')
b = s.index('      .when(w?.buttons')
s = s[:a] + '''      .when(chatHeader, el => el.child(h_flex().id("chat-toggle").h(H.sm).px(8).gap(5).flex_none().items_center().rounded(RADIUS.control)
        .text_size(TEXT.label).bg(t.chrome).text_color(t.muted).cursor_pointer().hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.spawn(async (cx) => { try { await showChat(cx); } catch {} }); }).child(svg("mods/tabs-ide-tasks/chat.svg").size(14)).child("Chat")))
      .children(known.map(([id, name, icon]) => panelButton(id, name, icon, id === "tasks" ? [counts ? inboxCount() : 0, greens ? readyCount() : 0] : [0, 0])))
      .child(button("layout-switcher", svg("mods/tabs-ide-tasks/layout.svg").size(16),
        () => openOverlay({ mod: "layout-switcher", kind: "dialog", width: 340, height: 302 })))
''' + s[b:]
s = s.replace("mods/tabs-tasks/", "mods/tabs-ide-tasks/")
s = re.sub(r'(["`])tabs-tasks\.(newspace|inbox|alert|coordinator|rename|close)', r'\1tabs-ide-tasks.\2', s)
open(os.path.join(dst, "main.js"), "w", encoding="utf-8").write(s)
meta = json.load(open(os.path.join(dst, "mod.json"), encoding="utf-8"))
meta["title"] = "Tabs (IDE + Tasks)"
json.dump(meta, open(os.path.join(dst, "mod.json"), "w", encoding="utf-8"), indent=2)
open(os.path.join(dst, "mod.json"), "a", encoding="utf-8").write("\n")
# Other mods call the tab bar as "tabs-tasks.*". The layout loads tabs-ide-tasks.
for name in os.listdir(mods):
    if name in ("tabs-tasks", "tabs-ide-tasks"):
        continue
    folder = os.path.join(mods, name)
    if not os.path.isdir(folder):
        continue
    for fn in os.listdir(folder):
        if not fn.endswith(".js"):
            continue
        path = os.path.join(folder, fn)
        text = open(path, encoding="utf-8").read()
        new = re.sub(r'(["`])tabs-tasks\.(newspace|inbox|alert|coordinator|rename|close)', r'\1tabs-ide-tasks.\2', text)
        if new != text:
            open(path, "w", encoding="utf-8").write(new)
print("built", os.path.relpath(dst, root))
