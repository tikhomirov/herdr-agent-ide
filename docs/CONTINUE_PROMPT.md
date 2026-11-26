# Prompt to start an agent on this package

Paste this into a new agent session opened in the repository folder (`~/src/herdr-agent-ide`):

```
You are continuing work on Agent IDE for Herdr (this repository): a layout plus 36 mods that turn Herdr into an IDE for coding agents, with a per-project Coordinator, tasks, a Claude/Codex/Pi chat, a shared browser, Remote over SSH, and a Russian/English UI.

Before changing anything read, in this order: docs/CONTEXT.md (map, pitfalls, open work), AGENTS.md (rules), lib/manifest.json (the mod list), README.md. Then look at the files for the task at hand; do not guess where code lives, use the map.

Goals to protect: (1) a fresh machine with only Herdr runs `./herdr-ide install && ./herdr-ide doctor` and gets what the maintainer has; (2) no dependency on Shepherdr or its folders; (3) every UI string works in English and Russian (tr/trf, i18n/ru.js); (4) every change is verified with herdr-app status (errors: []), ./herdr-ide doctor, bash tools/check.sh and a screenshot (herdr-app shot).

Rules: keep copies of shared core files identical (see "Shared core copies"); update lib/manifest.json when you add or remove a mod; update README.md/RECIPE.md when behaviour changes; no personal data in docs or screenshots; commit in small steps with clear messages and push to master.

My task: <describe it here>
```
