---
name: herdr-ide-browser
description: Use for any browser work (open pages, check UI, screenshots, clicking, forms, testing a local dev server) when running inside Herdr with the Agent IDE layout. Drives the project's live browser that the person watches in Herdr's Browser tab, instead of Playwright/Chrome MCP.
---

# The project's browser in Herdr

The person watches this browser live in Herdr's **Browser** tab (right panel), and each project (Herdr space) has its
own. ALWAYS use it instead of Playwright MCP, chrome-devtools or launching Chrome yourself.

The command is `hib` (a thin wrapper over `agent-browser` that picks this project's session). Run it from the
project's folder; it names the project after the git root's folder.

    hib open http://localhost:8000
    hib snapshot -i                # accessibility tree with @refs (interactive elements)
    hib click @e3
    hib fill @e5 "text"
    hib screenshot /tmp/shot.png   # then look at the file
    hib eval "document.title"
    hib --help                     # the whole command list (it is agent-browser underneath)

`agent-browser skills get core --full` has usage patterns.

Rules:
- Exit code 4 ("the person is using the browser right now"): wait a few seconds and retry; do not fight for the page.
- Don't pass `--session`, `--profile` or `--cdp`; `hib` owns them. Don't close the browser when you finish: the person is looking at it.
- Local dev servers: use the real URL (`http://localhost:PORT`, or `https://name.localhost` as the project serves it).
- Working from another folder than the project's? `hib --task <project>` (or `HERDR_IDE_TASK=<project>`).
- If `hib` isn't on the PATH: `~/.config/herdr-app/mods/ide-browser/hib`.

## Elements the person points at

The person can press **Select** in the toolbar, then click an element or drag a region. Their message to you then starts with
`[Browser element on <url>]` (selector, html, text, attributes, screenshot path) or `[Browser region …]` (screenshot path), and
`[Browser screenshot of <url> — <path>]` for "Screenshot to Agent". Treat the selector as the target of their request;
open the screenshot file when you need to see it.
