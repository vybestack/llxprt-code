## TLDR

Fixes a streaming UI bug where Gemini output text could be incorrectly merged across a context clear event.

When an AgentExecutionStopped or AgentExecutionBlocked event arrives with contextCleared: true, we now flush any pending Gemini text, reset the in-memory Gemini buffer, and then continue streaming fresh content so post-clear output starts cleanly.

## Dive Deeper

### Root cause

useStreamEventHandlers accumulated streamed Gemini content in geminiMessageBuffer. If context was cleared mid-stream, the handler showed an informational context-cleared message but did not reset the buffer. Subsequent streamed content could append to pre-clear text and appear as one merged assistant response.

### What changed

- Added shouldResetGeminiBufferForContextClear(event) to centralize the reset condition (contextCleared === true).
- Added clearContextAndResetBuffer() inside stream processing to:
  - flush pending Gemini text into history,
  - clear pending state,
  - reset geminiMessageBuffer to an empty string,
  - add the existing info message: "Conversation context has been cleared."
- Wired reset handling so it runs for relevant events after their existing info messages are emitted.
- Added focused tests in:
  - packages/cli/src/ui/hooks/geminiStream/**tests**/useStreamEventHandlers.contextCleared.test.ts

### Test coverage added

New tests validate:

1. Buffer is flushed/reset on AgentExecutionStopped with contextCleared: true.
2. Buffer is flushed/reset on AgentExecutionBlocked with contextCleared: true.
3. Buffer is not reset when contextCleared: false (existing concatenation behavior remains for that case).

## Reviewer Test Plan

1. Run the new focused test file:
   - packages/cli/src/ui/hooks/geminiStream/**tests**/useStreamEventHandlers.contextCleared.test.ts
2. Manually verify behavior in a streamed response flow where a hook triggers context clear mid-stream:
   - confirm pre-clear text is committed as its own Gemini message,
   - confirm "Conversation context has been cleared." appears,
   - confirm post-clear streamed text starts a new Gemini message and does not include pre-clear text.

## Testing Matrix

|          |     |     |     |
| -------- | --- | --- | --- |
| npm run  |     |     |     |
| npx      |     |     |     |
| Docker   |     |     |     |
| Podman   |     | -   | -   |
| Seatbelt |     | -   | -   |

## Linked issues / bugs

Fixes #1803
