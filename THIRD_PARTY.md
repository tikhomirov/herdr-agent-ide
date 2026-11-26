# Third-party code

Agent IDE vendors the Coordinator, chat, and task engine so a machine with only Herdr can install them. The service, web app, voice, usage insights, and Shepherdr settings brand are not included. Data directories are `herdr-ide` (`~/.config/herdr-ide`, `~/.local/share/herdr-ide`, `~/.local/state/herdr-ide`), not `shepherdr`.

## Shepherdr

Copyright (c) 2026 Elias Stravik. MIT licensed. Upstream: https://github.com/eliasstravik/shepherdr

The license text is `third_party/shepherdr/LICENSE`. `third_party/shepherdr/REVISION` is the commit this tree was taken from. The code began as a copy of that commit and is now maintained here on its own; it is not refreshed from upstream.

Shipped from that tree, under `mods/`: `accept-card`, `artifacts`, `chat`, `chat-image`, `chat-models`, `chat-react`, `confirm-chat`, `coordinator`, `menu-tasks`, `new-menu-tasks`, `newspace`, `pane-chat`, `prompt-chat`, `spaces-chat`, `tabs-tasks` (input to `tabs-ide-tasks`), `task-artifacts`, `task-browser`, `task-pr`, `tasks` (includes `herdr-task`), `tasks-menu`, `toasts`, `workspace-status-chat`, and `coord-settings` (upstream `shepherdr-settings`, renamed). Helpers: `bin/herdr-browser`, `bin/herdr-secret`. Role templates: `templates/assistant.md`, `worker.md`, `reviewer.md`.

Some of those mods began as copies of mods the Herdr app ships (Apache License 2.0). That notice is `third_party/shepherdr/NOTICE` and the license is `third_party/shepherdr/LICENSE-herdr`. Icons from Lucide stay under the ISC license, as in that notice.

Not shipped: the Shepherdr service, the web app, `chat-call` (voice), usage insights, Jump, keybinds, other-machines, and `workspace-chrome-shepherdr`.

## git-graph

Copyright (c) Rabeeh T.A. MIT licensed. Upstream: https://github.com/rabeeh-ta/herdr-git-graph

`mods/git-graph`. License text: `third_party/git-graph/LICENSE`. `third_party/git-graph/REVISION` is the commit.

## Coordinator tiles

`mods/spaces-chat/tile.js` is adapted from [petekp/coordinator](https://github.com/petekp/coordinator), MIT, (c) 2026 Pete Petrash. The same helper is `patches/spaces-chat-tile.js`.

## file-editor

[werlang/herdr-file-editor](https://github.com/werlang/herdr-file-editor) has no license file. It is used at the maintainer's own risk: `install.sh` clones the fork [tikhomirov/herdr-file-editor](https://github.com/tikhomirov/herdr-file-editor) into the app's `mods/` (skip with `--no-editor`) and points the Files block at it. It is not copied into this repository. If the fork cannot be fetched, the Files block keeps Herdr's own `files` mod.
