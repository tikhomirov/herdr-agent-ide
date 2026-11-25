// Sidebar top row without the logo: search and the sidebar toggle (layout idea: petekp/coordinator, MIT).
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, window, shared, setShared, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) { const f = find(c, id); if (f) return f; }
  return null;
}
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

export default class Topbar extends View {
  button(id, icon, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(svg(icon).size(15));
  }
  render() {
    const t = theme(), collapsed = narrow();
    return h_flex().size_full().bg(t.chrome).pl(collapsed ? 6 : 14).pr(10).gap(4).items_center()
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(div().flex_1()))
      .when(!collapsed, el => el.child(this.button("search", "mods/workspace-chrome/search.svg", () => run("mod.open", { name: "picker" }))))
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", "mods/workspace-chrome/sidebar.svg", toggleSidebar)));
  }
}
