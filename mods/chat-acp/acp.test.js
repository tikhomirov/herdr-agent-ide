import { tr } from "./i18n.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createParser, frame, freshTranscript, reduceUpdate, pushUser, decidePermission, applySession, scrubError, optionGroups } from "./acp.js";
import { mergeModels, secretName, enableModels, fastSibling, publicProvider } from "./providers.js";

test("frames are one JSON object per line", () => {
  const parser = createParser();
  const first = parser.push(frame({ jsonrpc: "2.0", id: 1, method: "initialize" }).slice(0, 10));
  assert.deepEqual(first, []);
  const rest = parser.push(frame({ jsonrpc: "2.0", id: 1, method: "initialize" }).slice(10) + frame({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk" } } }));
  assert.equal(rest.length, 2);
  assert.equal(rest[1].method, "session/update");
});

test("streaming text, thought and tool diffs become a transcript", () => {
  const state = freshTranscript();
  pushUser(state, "hello");
  reduceUpdate(state, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "plan" } });
  reduceUpdate(state, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } });
  reduceUpdate(state, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: " there" } });
  reduceUpdate(state, {
    sessionUpdate: "tool_call", toolCallId: "t1", title: "edit file", kind: "edit", status: "in_progress",
    rawInput: { path: "a.js" },
  });
  reduceUpdate(state, {
    sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed",
    content: [{ type: "diff", path: "a.js", oldText: "a", newText: "b" }],
  });
  reduceUpdate(state, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: tr("Done") } });
  assert.deepEqual(state.items.map((item) => item.kind), ["user", "assistant", "tool", "assistant"]);
  assert.equal(state.items[1].text, "Hi there");
  assert.equal(state.items[1].thought, "plan");
  assert.equal(state.items[2].diff.newText, "b");
  assert.equal(state.items[3].text, "Done");
});

test("a repeated user chunk does not duplicate the bubble", () => {
  const state = freshTranscript();
  pushUser(state, "hello");
  reduceUpdate(state, { sessionUpdate: "user_message_chunk", content: { type: "text", text: "hello" } });
  assert.equal(state.items.filter((item) => item.kind === "user").length, 1);
});

test("access policy selects an option or leaves the decision", () => {
  const request = {
    toolCall: { kind: "execute" },
    options: [
      { optionId: "once", kind: "allow_once", name: "Allow" },
      { optionId: "always", kind: "allow_always", name: "Allow always" },
      { optionId: "no", kind: "reject_once", name: "Deny" },
    ],
  };
  assert.equal(decidePermission("ask", request), null);
  assert.equal(decidePermission("full", request).optionId, "always");
  assert.equal(decidePermission("read", request).optionId, "no");
  assert.equal(decidePermission("read", { ...request, toolCall: { kind: "read" } }).optionId, "once");
});

test("session meta fills model and thinking controls", () => {
  const state = freshTranscript();
  applySession(state, {
    sessionId: "s1",
    modes: { currentModeId: "low", availableModes: [{ id: "off", name: "Off" }, { id: "low", name: "Low" }] },
    configOptions: [{
      id: "model", name: "Model", currentValue: "test/a", type: "select",
      options: [{ value: "test/a", name: "A" }, { value: "test/a-fast", name: "A fast" }],
    }],
  });
  const groups = optionGroups(state);
  assert.equal(groups.modelId, "test/a");
  assert.equal(groups.thinkingId, "low");
  assert.equal(fastSibling(groups.models, groups.modelId).id, "test/a-fast");
});

test("custom providers are written as env references, never as key values", () => {
  const provider = publicProvider({
    id: "acme", name: "Acme", baseUrl: "https://acme.example/v1", api: "openai-completions",
    secret: secretName("acme"), models: [{ id: "chat", name: "Chat", contextWindow: 1000, vision: true, reasoning: false, enabled: true }],
  });
  const merged = mergeModels({ providers: { keep: { apiKey: "secret-value", models: [] } } }, [provider]);
  assert.equal(merged.providers.keep.apiKey, "secret-value");
  assert.equal(merged.providers.acme.apiKey, "$CHAT_ACP_ACME");
  assert.equal(JSON.stringify(merged.providers.acme).includes("secret-value"), false);
  const settings = enableModels({ enabledModels: ["keep/old"] }, [provider]);
  assert.ok(settings.enabledModels.includes("acme/chat"));
});

test("errors that echo a key are masked", () => {
  assert.equal(scrubError("bad sk-abcdefghijklmnopqrstuvwxyz"), "bad sk-…");
});
