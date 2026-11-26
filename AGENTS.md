# AGENTS.md

Notes for agents working in this repository (a Herdr layout + mods; see README.md and RECIPE.md).

## Layout of the repo

- `layouts/agent-ide.json`: the one layout. `mods/<name>/`: one folder per mod. `skills/`: a skill for agents that *use* the browser. `RECIPE.md` and `preview.png`: the gallery's brief and picture; `docs/`: the screenshots the README shows. Herdr's gallery reads them from the repo root; the topic `herdr-layout` is on the repo.
- Nothing outside `layouts/` and `mods/` is copied into a person's Herdr by Herdr's own "add a layout" flow; that's why `viewer.js`, `hib` and `start.html` live inside `mods/ide-browser/`.

## Start here

Read `docs/CONTEXT.md` (map of the repo, pitfalls, open work). A ready prompt for a new agent is in `docs/CONTINUE_PROMPT.md`.

## Installing for a person (when asked to "add this layout")

1. Read `RECIPE.md`, `lib/manifest.json` and skim `mods/` and `layouts/`. Tell the person that the mods run programs (`node`, `agent-browser`, `git`, `hc`, `herdr-app`, `ssh`, optionally a clipboard tool), read and write `layouts/<current>.json`, write files in `~/.local/state/herdr-ide/`, `~/.local/share/herdr-ide/` and `~/Pictures/herdr-screenshots/`, clone the file editor from `github.com/tikhomirov/herdr-file-editor`, and that Chrome pages are loaded from the network.
2. Herdr must have been started once (`~/.config/herdr-app` exists; or set `HERDR_APP_HOME`).
3. `git clone https://github.com/tikhomirov/herdr-agent-ide && cd herdr-agent-ide && ./herdr-ide install --deps` (`--deps` installs agent-browser with npm; `--force` replaces an existing layout file; `--no-editor` skips the file editor).
4. `./herdr-ide doctor` must end with `0 failed` (exit 0). Read every `fail` line; fix it (the text says how) and run it again. `warn` lines are optional things.
5. `herdr-app do layout.switch '{"name":"agent-ide"}'`.
6. Never tell the person to install Shepherdr. Do not edit files in `~/.config/herdr-app/mods/` by hand: edit the repo and reinstall, or the next install overwrites the change.

## When a person has modified their copy

- Their changes live in the app folder or in a fork. Before `./herdr-ide update`, run `git status` in the clone and `diff -r mods ~/.config/herdr-app/mods/<name>` for the mods they touched; the installer replaces the mods it ships. Keep their edits by committing them to their clone first (or install with a different `HERDR_APP_HOME`).
- `layouts/agent-ide.json` is never replaced without `--force`.
- Their language is the shared setting `ui.lang` (RU/EN button in the sidebar's top row); a change they make to the dictionary goes in `i18n/ru.js`, then `python3 tools/localize.py` and `./herdr-ide install`.

## Working on the code

- Edit files here, then `./herdr-ide install --no-doctor` to copy them to the app folder; the app reloads mods when their files change. Verify with `herdr-app check` per mod and `node --check mods/ide-browser/viewer.js`; look at the result with `herdr-app shot file.png`.
- The mods are gpui-kit mods (`herdr.d.ts` and `gpui-kit.d.ts` in the app folder describe the API; `herdr-app types <dir>` writes the latter). Write UI text in English; Russian goes in `i18n/ru.js` (see docs/CONTEXT.md).
- Do not put personal data, project names or tokens in `preview.png`, the docs or the code. Screenshots in `docs/` and `preview.png` are of the whole window, taken with `herdr-app shot` in a throw-away demo space (a made-up project such as `acme-shop`, a demo page on localhost, a throw-away folder on a test server). Blank the other spaces and agents in the sidebar and any status line before committing them.
- The viewer talks to the browser only through agent-browser's CDP address; it never launches Chrome itself.
- Don't add a build step or npm dependencies to the viewer: it must run as `node viewer.js`.
- Never call `herdr-app do` from the viewer without thinking: called inside a terminal it acts on that terminal. Typing into agents goes through `hc keys`.
- Event handlers get their own `cx`: never use the `cx` of `render` inside a click handler (the click then doesn't redraw).
- If you change a control command (`<project>.ctl`) or the state file's fields, change the toolbar, the menu, the viewer and RECIPE.md together.
- Updating RECIPE.md is part of every behavior change: it must describe what the files do, no more.

## Publishing

`gh repo create tikhomirov/herdr-agent-ide --public --source . --push`, then `gh repo edit --add-topic herdr-layout` (only that topic: a repo with `layouts/` is a layout, `herdr-mod` is for mod-only repos). The gallery lists the repo within the hour.

Verify every change as in `docs/CONTEXT.md` ("Verify a change"): `herdr-app status` (no errors), `./herdr-ide doctor`, `bash tools/check.sh`, a screenshot. Add a mod to `lib/manifest.json`.
