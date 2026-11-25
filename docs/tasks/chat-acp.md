# Task: `chat-acp` — a chat UI for any agent (Pi first)

## Goal
A Herdr mod `chat-acp`: a full chat pane (like Shepherdr's `chat` mod for Claude Code / Codex, or ZCode's chat) for **Pi** first, then any agent that speaks the Agent Client Protocol (ACP). It plugs into the Agent IDE + Coordinator layout as another chat backend: a coordinator, a worker, or a plain agent tab can be shown as this chat.

## Why ACP
ACP (https://github.com/agentclientprotocol/agent-client-protocol, registry: https://github.com/agentclientprotocol/registry) gives one JSON-RPC-over-stdio interface (sessions, prompts, streamed messages, tool calls, permission requests, modes/models). Adapters exist for Claude, Codex, Gemini CLI, OpenCode, Qwen, Copilot. Pi: an adapter is already on this machine at `~/.pi/pi-acp` (check it first; otherwise use Pi's RPC/JSON mode, `pi --help`). Reference clients: openclaw/acpx (headless CLI), formulahendry/acp-ui, RAIT-09/obsidian-agent-client, formulahendry/vscode-acp. Do not parse terminal screens or session files.

## Scope (Phase 1: Pi)
1. **Transport**: start the agent (`hc run --bg` so it survives the window; or `exec` with a long-lived stdio bridge if the mod API allows it — verify in `~/.config/herdr-app/herdr.d.ts`, `AGENTS.md`). Handle `initialize`, `session/new`, `session/load` (resume), `session/prompt`, `session/update` streaming, `session/cancel`, `session/request_permission`.
2. **Chat UI** (native gpui-kit mod, same look as `mods/chat`): message list with markdown and code blocks, streaming text, collapsible thinking, tool-call rows (command, edit with diff, read, search) with status, permission cards (Allow / Allow always / Deny), queued messages, stop button, image/file attach, `@` file mention, slash commands from the agent, copy/fork/retry.
3. **Composer controls** (as in Claude/Codex chat and ZCode): **model picker** (search, vision/context badges), **thinking level** (slider or segmented: off/low/medium/high), **speed/fast mode** if the agent exposes it, **access mode** (read only / ask / full access), working folder + branch chips, token/cost/context-use meter.
4. **Providers and models**: a settings screen (like ZCode's «Настройки моделей»): provider list (built-in + custom), per provider Base URL, API format (Responses / Chat Completions / Anthropic), API key (stored via `herdr-secret`, never in files or logs), model list with context size and capability flags (vision, reasoning), per-model enable toggle, test-connection, add/edit/delete model, refresh from `/models`. Custom OpenAI-compatible providers are first class. Selected model is passed to the agent through its own config/ACP model API (for Pi: `~/.pi/agent` settings or flags — find the supported way).
5. **Integration**: usable as the chat of any tab (`pane-chat` Chat/Terminal switch, or its own header), as the coordinator chat (`props.role: "coordinator"`, template `assistant`), and in the Tasks thread panel. Status (working/idle/needs-you) feeds the Agents list and Tasks counts. Russian/English via `i18n/` (`tr()`), Coordinator wording.
6. **Phase 2**: any ACP agent from the registry (agent picker, per-agent adapter command, capability-driven UI: hide controls the agent does not offer). Phase 3: replace Claude/Codex-only paths.

## Constraints
- Follow `~/.config/herdr-app/AGENTS.md` (mods are gpui-kit JS; no HTML/Node APIs; clone shipped mods before editing; check with `herdr-app check`; don't kill `herdr-app`/`hc`).
- Reuse, don't copy blindly: study `mods/chat` (message layout, composer, keyholder protocol — dialogs must hold `keyholder` so the chat doesn't steal focus), but build the ACP client as its own module (`acp.js`) with a small, tested JSON-RPC layer.
- No secrets in the repo or in logs. MIT-compatible code only; credit sources.
- Agents keep running if the window closes (`hc`), the chat re-attaches by session id.

## Done when
- A Pi session starts from the chat, streams answers, shows tool calls and permission cards, can be stopped, resumed after restart.
- Model, thinking level, and access mode can be changed from the composer; a custom OpenAI-compatible provider can be added and its model used in a real turn.
- Works as a coordinator chat: it can run `herdr-task add/start`, and the Tasks panel updates.
- `herdr-app check chat-acp` passes; screenshot (`herdr-app shot`) of chat, model picker and provider settings attached to the PR; README/RECIPE section added.
