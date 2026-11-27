# Context for whoever works on this package next

Read this first, then `AGENTS.md`. It says what the package is, where things are, what has been decided and what is still open.

## What it is

Agent IDE for [Herdr](https://herdr.dev): one layout (`agent-ide`) and 36 mods that turn Herdr into an IDE for coding agents. A sidebar of spaces, per-project **Coordinators** and agents; a tab bar; a right panel with Files, Changes, Git, Tasks, Artifacts, Remote (SSH) and a shared Browser; a chat view for Claude Code, Codex and Pi; Russian and English UI. It is the maintainer's own, independent product (Shepherdr's code was vendored under MIT; attribution in `THIRD_PARTY.md`). It must stay independent: no dependency on a Shepherdr install, no `~/.config/shepherdr`.

Goal: a person with only Herdr runs `./herdr-ide install && ./herdr-ide doctor` and gets exactly what the maintainer has. Secondary goal: be found and used (the repo has the `herdr-layout` topic; the gallery reads `RECIPE.md` and `preview.png`).

## Map of the repo

| Where | What |
| --- | --- |
| `layouts/agent-ide.json` | the only layout (a clone of Herdr's `main` plus the panel, coordinators, tasks, chat) |
| `lib/manifest.json` | **single source of the mod list**, helpers, templates, tool requirements, external mods. Change it when you add or remove a mod |
| `install.sh`, `herdr-ide`, `tools/doctor.py` | installer, wrapper (`install`, `doctor`, `update`), checker |
| `mods/<name>/` | one folder per mod (`main.js`, `mod.json`, icons). All live in the app folder `~/.config/herdr-app/mods/` once installed |
| `i18n/i18n.js`, `i18n/ru.js` | `tr(s)`, `trf(s, ...v)` and the Russian dictionary (about 1300 keys). Copied into every mod at install |
| `tools/localize.py`, `tools/tpl.py` | wrap UI literals with `tr()` / template literals with `trf()` in the repo mods (idempotent) |
| `tools/check.sh`, `tools/check-paths.py` | syntax of every JS file, no `shepherdr` paths, a fresh-home install and `herdr-app check` |
| `mods/tasks/bin/herdr_task/` | the task engine (Python): tasks, autopilot, start gates (`machine.py`: CPU from `/proc/stat` deltas; disk gate needs <20 GB free as well as >90% full) |
| `bin/` | helpers linked into `~/.local/bin`: `herdr-browser`, `herdr-browser-view`, `herdr-secret` (and `herdr-task`, `herdr-artifact` from the mods) |
| `templates/` | the role prompts `assistant.md`, `worker.md`, `reviewer.md` |
| `skills/herdr-ide-browser` | skill that tells agents to use `hib` |
| `docs/` | screenshots the README shows, `social.png` (cover, built by `tools/cover/cover.html`), this file |

Mod groups (see `lib/manifest.json` for the list): **browser** (`ide-browser*`), **remote** (`remote-files`), **chrome** (`tabs-ide`, `tabs-ide-tasks`, `agents-ide`, `ide-topbar`, `layout-switcher`, `rename-dialog`), **chat** (`chat` is the largest: Claude/Codex/Pi transcript readers in `core/`, `chat-acp`, `chat-react`, `chat-image`, `chat-models`, `chat-sessions` = Pi history, `confirm-chat`, `prompt-chat`, `pane-chat`, `workspace-status-chat`), **coordinator** (`coordinator`, `spaces-chat`, `newspace`, `new-menu-tasks`, `menu-tasks`, `tasks-menu`), **tasks** (`tasks`, `task-artifacts`, `task-browser`, `task-pr`, `artifacts`, `accept-card`), **settings** (`coord-settings`, `pi-settings`), `toasts`, `git-graph`.

Herdr itself ships `files`, `changes`, `workspace-chrome`; the layout uses them. The optional external mod `file-editor` is cloned from `tikhomirov/herdr-file-editor` (a fork of `werlang/herdr-file-editor`, which has no licence: used at the maintainer's risk).

## Things that bite

- **Shared core copies.** Some files exist in several mods as copies (`core/settings.js`, `core/agents.js`, `core/machines.js`, `core/autopilot.js` in `coord-settings`, `chat`, `newspace`, `coordinator`, `chat-models`, `spaces-chat`...). The source is the one in `coord-settings/core` (for settings) or `chat/core` (for agents). There is no sync script any more: after editing one, `cp` it to the others (check with `diff`). Pure core files must not import `herdr`; translate at the call site in `main.js` (`tr`, `trf`).
- **i18n.** Write UI text in English in the mods; `python3 tools/localize.py` wraps it. Constants and strings built in code are *not* wrapped: translate them where they are rendered. Add every new sentence to `i18n/ru.js` (keys exactly as in code; values use `{0}`, `{1}`), run `localize.py`, then `install` (copies `ru.js` into each mod; `doctor` warns when a copy is stale).
- **gpui-kit rules**: event handlers get their own `cx`; `herdr-app do` inside a terminal acts on that terminal; `hc keys` types into agents.
- **Pi chat**: sessions are `~/.pi/agent/sessions/--<cwd-encoded>--/<ts>_<uuid>.jsonl`; resume with `--session <uuid>`; changing model/thinking/permissions restarts the agent through `mods/coordinator/restart.sh` (starts the new agent, then kills the old one, which aborts its turn; the restart waits for the answer to finish).
- `herdr-app check <mod>` must be run from `~/.config/herdr-app/mods`.
- A live Herdr may be edited by another agent at the same time: re-read files before editing, commit small.
- Do not put personal data (project names, hosts, tokens) in screenshots, docs or code.

## Verify a change

```sh
python3 tools/localize.py          # only if you touched UI text
./herdr-ide install --no-doctor    # copy to the app folder (reloads mods)
herdr-app status                   # "errors": [] expected
./herdr-ide doctor                 # exit 0
bash tools/check.sh                # syntax + fresh-home install
herdr-app shot /tmp/x.png          # look at the result (Russian and English)
```

## History in one paragraph

Started as a layout with Files/Changes/Browser/Remote. Then the Coordinator system (chat + tasks + artifacts) was vendored from Shepherdr and made standalone. Then: a single layout `agent-ide`; Pi as a third chat agent (resumed sessions, history button, queued restarts); `coord-settings` trimmed to working pages; CPU/disk start-gate fix; a full Russian/English pass with value substitution (`trf`); `lib/manifest.json` + installer + doctor; the file editor from our own fork.

## Open work

- Live GUI scenario tests for the Pi history button and session switching.
- Leftover `shepherdr` words in comments and dead code (`coord-settings/service.js` and similar).
- Strings still English on some pages (Autopilot, Tasks, Notify, Secrets) after the last pass: open each page in the RU UI and add missing keys.
- The task engine's README for people who want to run `herdr-task` alone.
- Stars and visibility: the gallery search box matches the layout name (`#` title), the first paragraph of `RECIPE.md` (cut at 500 characters) and the GitHub owner, as one lowercase string. The README tag line, the repo description and any GitHub topic besides `herdr-layout` are not searched. Ask for a star only in the README. The cover is `preview.png`.
