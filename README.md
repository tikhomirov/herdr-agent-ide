# Agent IDE for Herdr

A [Herdr](https://herdr.dev) layout that makes the window work like an agent IDE: next to your agents' terminals, a right-hand panel with **Files**, **Changes** and a real **Browser** that you and your agents share.

![Agent IDE](preview.png)

- **A browser per project.** Every Herdr space (project) has its own Chrome: its page, sign-ins and cookies stay with the project. Switch spaces and you see that project's site.
- **Agents use it too.** They drive the same browser with one command, `hib`, so you watch them work instead of chasing Playwright windows.
- **Point at things.** *Select* lets you click an element or draw a region; the selector, HTML and a screenshot are typed into your agent's input.
- **Cursor-style toolbar.** Back/forward/reload, address bar, screenshot, and a "…" menu: Hard Reload, Copy Current URL, Clear Cookies / Cache / Site Data, Open in Chrome Window.
- **Device mode.** Responsive width × height, presets (iPhone, Pixel, iPad, laptop, desktop), rotate; phones get touch and a mobile user agent.
- **Layout switcher** button in the tab bar.

The page is a stream of PNG frames drawn with Kitty graphics in a Herdr terminal (Herdr has no web view), so it needs a terminal with Kitty graphics, which Herdr has.

## Install

Requirements: Herdr (run once so `~/.config/herdr-app` exists), `node` 22+, `git`, a clipboard tool (`wl-clipboard`, `xclip` or `pbcopy`), and [agent-browser](https://github.com/vercel-labs/agent-browser):

```sh
npm i -g agent-browser && agent-browser install     # the browser engine + Chrome for Testing
git clone https://github.com/tikhomirov/herdr-agent-ide && cd herdr-agent-ide
./install.sh --hib          # copies the mods and the layout, links `hib` into ~/.local/bin
herdr-app do layout.switch '{"name":"ide"}'
```

Or let your agent do it: *"Add the layout from https://github.com/tikhomirov/herdr-agent-ide"* (Herdr's agents read `RECIPE.md` and the files).

Then open the **Browser** tab in the right panel. Give your agents the skill so they use it: copy `skills/herdr-ide-browser` to `~/.agents/skills/` (or `~/.claude/skills/`).

`install.sh` never replaces an existing `layouts/ide.json` unless you pass `--force`. It replaces its own mods (`ide-browser`, `ide-browser-bar`, `ide-browser-menu`, `tabs-ide`, `layout-switcher`).

### Optional

- A better file tab: install [`werlang/herdr-file-editor`](https://github.com/werlang/herdr-file-editor) and put `{"mod":"file-editor"}` in the `files` block of `layouts/ide.json`: clicking a file opens it in an editor tab with syntax highlighting.
- A Git graph tab: any mod with the id `git-graph` in the panel's stack gets a button automatically.

## For agents: `hib`

```sh
hib open http://localhost:8000     # run from the project's folder; the project = git root's folder name
hib snapshot -i                    # accessibility tree with @refs
hib click @e3
hib screenshot /tmp/shot.png
```

`hib` is [agent-browser](https://github.com/vercel-labs/agent-browser) on the project's own session and profile. If you are using the page, acting commands exit with code 4 until you are idle for 20 seconds.

## Files

| Path | What |
| --- | --- |
| `layouts/ide.json` | the layout: Herdr's `main` plus the right panel |
| `mods/tabs-ide` | the tab bar with the panel buttons and the layout button (a clone of Herdr's `tabs`) |
| `mods/layout-switcher` | the layout list dialog |
| `mods/ide-browser` | starts/stops the viewer for the shown project; `viewer.js` (the browser view), `hib` (CLI for agents), `start.html` |
| `mods/ide-browser-bar` | the toolbar |
| `mods/ide-browser-menu` | the "…" and preset menus |
| `skills/herdr-ide-browser` | the skill for agents |
| `RECIPE.md` | the brief the layout can be rebuilt from (the Herdr gallery format) |
| `AGENTS.md` | notes for agents working on this repo |

State lives in `~/.local/state/herdr-ide/` (`<project>.state.json`, `<project>.ctl`, `profiles/`, `annotations/`); screenshots go to `~/Pictures/herdr-screenshots/`.

## Limits

12 fps frames, so no smooth animation; Chrome stays open per project (memory); text from Select is typed but not sent. See "Watch out" in [RECIPE.md](RECIPE.md).

## Credits and license

MIT, see [LICENSE](LICENSE). `layouts/ide.json` and `mods/tabs-ide` are derived from Herdr's shipped `main` layout and `tabs` mod. The browser engine is [agent-browser](https://github.com/vercel-labs/agent-browser) by Vercel Labs. Ideas for the toolbar and the screenshot, console and cookie helpers come from [MattJColes/herdr-web-browser](https://github.com/MattJColes/herdr-web-browser) and from Cursor's browser.
