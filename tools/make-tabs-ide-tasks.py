#!/usr/bin/env python3
"""Builds mods/tabs-ide-tasks from Shepherdr's tabs-tasks-git (not redistributed here).
Result: Shepherdr's tab bar (Tasks badges, service, inbox) + Files/Changes/Git/Artifacts/Remote/Browser + Chat + layout switcher."""
import json, os, shutil, sys
home = os.environ.get("HERDR_APP_HOME", os.path.expanduser("~/.config/herdr-app")) + "/mods"
src, dst = f"{home}/tabs-tasks-git", f"{home}/tabs-ide-tasks"
if not os.path.isdir(src): sys.exit("tabs-tasks-git (Shepherdr) not installed")
shutil.rmtree(dst, ignore_errors=True); shutil.copytree(src, dst)
shutil.copy(f"{home}/tabs-ide/chat.svg", dst)
s = open(f"{dst}/main.js").read()
ide = open(f"{home}/tabs-ide/main.js").read()
helpers = ide[ide.index("// Claude Code and Codex are the agents"):ide.index("export default class Tabs")]
s = s.replace("import { panes, run, openOverlay,", "import { panes, exec, run, openOverlay,")
s = s.replace("export default class Tabs", helpers + "export default class Tabs", 1)
a = s.index('    const enabled = [...(shared("workspace.panels")'); b = s.index("    this.syncPanel(space, panel, body, enabled);")
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
a = s.index('      .when(enabled.includes("files")'); b = s.index('      .child(button("layout-switcher"')
s = s[:a] + '''      .when(chatHeader, el => el.child(h_flex().id("chat-toggle").h(H.sm).px(8).gap(5).flex_none().items_center().rounded(RADIUS.control)
        .text_size(TEXT.label).bg(t.chrome).text_color(t.muted).cursor_pointer().hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.spawn(async (cx) => { try { await showChat(cx); } catch {} }); }).child(svg("mods/tabs-ide-tasks/chat.svg").size(14)).child("Chat")))
      .children(known.map(([id, name, icon]) => panelButton(id, name, icon, id === "tasks" ? [counts ? inboxCount() : 0, greens ? readyCount() : 0] : [0, 0])))
''' + s[b:]
s = s.replace("mods/tabs-tasks-git/", "mods/tabs-ide-tasks/")
s = s.replace("const name = tabName(c.name, program?.name);", "const name = tr(tabName(c.name, program?.name));")
s = s.replace("el.child(label))", "el.child(tr(label)))").replace('.child("Chat")', '.child(tr("Chat"))')
s = s.replace("import { panes, exec", 'import { tr } from "./i18n.js";\nimport { panes, exec', 1)
shutil.copy(os.path.dirname(os.path.abspath(__file__)) + "/../i18n/i18n.js", dst); shutil.copy(os.path.dirname(os.path.abspath(__file__)) + "/../i18n/ru.js", dst)
open(f"{dst}/main.js", "w").write(s)
m = json.load(open(f"{dst}/mod.json")); m["title"] = "Tabs (IDE + Tasks)"; json.dump(m, open(f"{dst}/mod.json", "w"), indent=2)
print("built", dst)
