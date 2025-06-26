# Phase 02 – Implement OpenAIProvider Chat Completions (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To implement the `generateChatCompletion` method in `OpenAIProvider` to support streaming chat completions using the OpenAI SDK. This phase will focus on the standard OpenAI Chat Completions API and its native tool format. The `getModels` method will remain a stub.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.ts` with `generateChatCompletion` implementation.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.test.ts` with tests for `generateChatCompletion`.

## Checklist (implementer)

- [ ] Install the `openai` npm package if not already installed.
- [ ] Update `packages/cli/src/providers/openai/OpenAIProvider.ts`:
  - [ ] Import `OpenAI` from `openai`.
  - [ ] Add a constructor that takes `apiKey` and `baseURL` (optional) and initializes the `OpenAI` client.
  - [ ] Implement `generateChatCompletion` to:
    - [ ] Take `messages`, `tools` (optional), and `toolFormat` (optional, assume 'openai' for now).
    - [ ] Use `this.openai.chat.completions.create` with `stream: true`.
    - [ ] Yield chunks from the stream.
    - [ ] Handle `tool_calls` from the stream and yield them as part of the response.
    - [ ] Ensure the yielded chunks conform to a consistent internal format (e.g., `{ type: 'content', delta: '...' }` or `{ type: 'tool_calls', tool_calls: [...] }`).
    - [ ] The `getModels` method should still throw `NotYetImplemented`.
- [ ] Update `packages/cli/src/providers/openai/OpenAIProvider.test.ts`:
  - [ ] Add tests for `generateChatCompletion` that:
    - [ ] Mock the `openai` SDK to simulate streaming responses with content and tool calls.
    - [ ] Assert that the `generateChatCompletion` method yields the expected content and tool calls.
    - [ ] Ensure the `getModels` test still passes (i.e., still throws `NotYetImplemented`).

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/openai/OpenAIProvider.test.ts
```

**STOP. Wait for Phase 02a verification.**
