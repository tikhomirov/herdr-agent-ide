# AGENTS.md

Notes for agents working in this repository (a Herdr layout + mods; see README.md and RECIPE.md).

## Layout of the repo

- `layouts/ide.json`: the layout. `mods/<name>/`: one folder per mod. `skills/`: a skill for agents that *use* the browser. `RECIPE.md` and `preview.png`: the gallery's brief and picture; `docs/`: the screenshots the README shows. Herdr's gallery reads them from the repo root; the topic `herdr-layout` is on the repo.
- Nothing outside `layouts/` and `mods/` is copied into a person's Herdr by Herdr's own "add a layout" flow; that's why `viewer.js`, `hib` and `start.html` live inside `mods/ide-browser/`.

## Installing for a person (when asked to "add this layout")

1. Read `RECIPE.md` and every file under `mods/` and `layouts/` first. Tell the person that the mods run programs (`node`, `agent-browser`, `git`, `hc`, `herdr-app`, `ssh`, optionally a clipboard tool), read and write `layouts/<current>.json`, write files in `~/.local/state/herdr-ide/` and `~/Pictures/herdr-screenshots/`, and that Chrome pages are loaded from the network.
2. Run `./install.sh --hib` (or copy by hand: `layouts/ide.json` to `<app home>/layouts/`, each `mods/<name>/` to `<app home>/mods/`; never overwrite a name that is taken, rename instead; the app home is `$HERDR_APP_HOME` or `~/.config/herdr-app`).
3. Check agent-browser: `command -v agent-browser`; if missing, `npm i -g agent-browser && agent-browser install`.
4. `herdr-app check` each mod directory (`cd mods/<name> && herdr-app check .`), then `herdr-app do layout.switch '{"name":"ide"}'`.
5. Offer to copy `skills/herdr-ide-browser` to the person's skills folder.

## Working on the code

- Edit files here, then `./install.sh` to copy them to the app folder; the app reloads mods when their files change. Verify with `herdr-app check` per mod and `node --check mods/ide-browser/viewer.js`; look at the result with `herdr-app shot file.png`.
- The mods are gpui-kit mods (`herdr.d.ts` and `gpui-kit.d.ts` in the app folder describe the API; `herdr-app types <dir>` writes the latter). Keep all UI text in English.
- Do not put personal data, project names or tokens in `preview.png`, the docs or the code. Screenshots in `docs/` and `preview.png` are of the whole window, taken with `herdr-app shot` in a throw-away demo space (a made-up project such as `acme-shop`, a demo page on localhost, a throw-away folder on a test server). Blank the other spaces and agents in the sidebar and any status line before committing them.
- The viewer talks to the browser only through agent-browser's CDP address; it never launches Chrome itself.
- Don't add a build step or npm dependencies to the viewer: it must run as `node viewer.js`.
- Never call `herdr-app do` from the viewer without thinking: called inside a terminal it acts on that terminal. Typing into agents goes through `hc keys`.
- Event handlers get their own `cx`: never use the `cx` of `render` inside a click handler (the click then doesn't redraw).
- If you change a control command (`<project>.ctl`) or the state file's fields, change the toolbar, the menu, the viewer and RECIPE.md together.
- Updating RECIPE.md is part of every behavior change: it must describe what the files do, no more.

## Publishing

`gh repo create tikhomirov/herdr-agent-ide --public --source . --push`, then `gh repo edit --add-topic herdr-layout` (only that topic: a repo with `layouts/` is a layout, `herdr-mod` is for mod-only repos). The gallery lists the repo within the hour.
