# Phase 15 – Implement AnthropicProvider Chat Completions (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To implement the `generateChatCompletion` method in `AnthropicProvider` to support streaming chat completions using the Anthropic SDK. This phase will focus on the standard Anthropic Messages API and its native tool format. The `getModels` method will remain a stub.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.ts` with `generateChatCompletion` implementation.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.test.ts` with tests for `generateChatCompletion`.

## Checklist (implementer)

- [ ] Install the `@anthropic-ai/sdk` npm package if not already installed.
- [ ] Update `packages/cli/src/providers/anthropic/AnthropicProvider.ts`:
  - [ ] Import `Anthropic` from `@anthropic-ai/sdk`.
  - [ ] Add a constructor that takes `apiKey` and `baseURL` (optional) and initializes the `Anthropic` client.
  - [ ] Implement `generateChatCompletion` to:
    - [ ] Take `messages`, `tools` (optional), and `toolFormat` (optional, assume 'anthropic' for now).
    - [ ] Use `this.anthropic.messages.create` with `stream: true`.
    - [ ] Yield chunks from the stream.
    - [ ] Handle `tool_use` (Anthropic's equivalent of tool calls) from the stream and yield them as part of the response.
    - [ ] Ensure the yielded chunks conform to a consistent internal format (e.g., `{ type: 'content', delta: '...' }` or `{ type: 'tool_calls', tool_calls: [...] }`).
    - [ ] The `getModels` method should still throw `NotYetImplemented`.
- [ ] Update `packages/cli/src/providers/anthropic/AnthropicProvider.test.ts`:
  - [ ] Add tests for `generateChatCompletion` that:
    - [ ] Mock the `@anthropic-ai/sdk` to simulate streaming responses with content and tool calls.
    - [ ] Assert that the `generateChatCompletion` method yields the expected content and tool calls.
    - [ ] Ensure the `getModels` test still passes (i.e., still throws `NotYetImplemented`).

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/anthropic/AnthropicProvider.test.ts
```

**STOP. Wait for Phase 15a verification.**
