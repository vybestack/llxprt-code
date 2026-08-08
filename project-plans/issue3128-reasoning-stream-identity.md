# Issue #3128 — Reasoning stream identity collides across model iterations

## Origin

Issue #3128 reported that a thinking block in the Ink UI appeared cut off mid-sentence
at the word "I", while the same assistant turn continued normally with text and two
tool calls.

## Root cause of the reported symptom: NOT an llxprt bug

The event was located in a real session recording
(`~/Library/Logs/llxprt-code/tmp/1e1db339.../chats/session-2026-08-06T06-33-31-2d7489ef-cbb.jsonl`,
seq 1082, provider `claudecode`, model `claude-opus-5`).

Evidence that the stream was healthy:

- the block carries `streamStatus: "complete"` and a valid non-empty `signature`
  (Anthropic emits `signature_delta` only immediately before `content_block_stop`)
- the same assistant message contains a `text` block and two `tool_call` blocks
- the recording contains zero retry / discard / error / invalid-stream events

Evidence that the truncation originates upstream of llxprt:

- the display path and the recording path are independent, and both produced the
  identical 147 characters; the recording path never touches Ink
- across 244 thinking blocks in that session, only 3 (1.2%) end mid-sentence, and
  all 3 end at a clean word boundary rather than mid-word
- median ratio of (thought characters / 4) to billed `completionTokens` is 0.188

Anthropic documents that thinking text is a summary produced by a *different model*,
and that billing reflects the full raw thinking rather than the summary. A summary
that stops mid-sentence is a summarizer artefact. llxprt recorded and displayed
exactly what the API returned.

`summary_status` was evaluated as a detection signal and **rejected**: it appears only
in AWS Bedrock's older Claude 4 documentation, is absent from the current Claude
platform thinking documentation, and is not typed by the pinned
`@anthropic-ai/sdk@0.55.1`. There is no supported signal to detect this condition, so
nothing is implemented against it.

## The defect this investigation surfaced (what this change fixes)

Reasoning stream identifiers are only unique *within a single API call*, but the UI
state that consumes them lives for the whole user turn, which spans many API calls.

- `packages/providers/src/anthropic/AnthropicStreamProcessor.ts:51-57` —
  `createThinkingBlockIdentity()` allocates a fresh `nextLifecycleId = 0` closure per
  API call, so every iteration's first thinking block is `anthropic-thinking:0:block-0`.
  Confirmed empirically: 244 thinking blocks in one session, **1 distinct streamId**.
- `packages/providers/src/openai/parseResponsesStream.ts:871` — `nextReasoningStreamIndex: 0`
  is initialised per stream, so `openai-responses-reasoning:0` repeats every API call.
- `packages/cli/src/ui/hooks/agentStream/thoughtState.ts:69-93` — `findStreamBlockIndex`
  matches the stale block from the previous iteration and overwrites its text.
- `thinkingBlocksRef` is cleared on a new user prompt (`turnPreparation.ts:27`), on
  pending-item commit (`useStreamState.ts:188`), and on a content split
  (`contentEventProcessor.ts:114`) — but **not between model iterations within one turn**.

Consequence in principle: when an iteration produces thinking followed by a tool call
and no text, no content split occurs, so the next iteration's reasoning could replace
the previous iteration's reasoning in the transcript.

### Verified reachability: NOT currently reachable

This was tested rather than assumed. The same scripted tmux-harness scenario
(`opus5`/`claude-opus-5`, three sequential shell commands with reasoning between each)
was run against clean `main` and against this branch. Both rendered all three reasoning
segments in order. There is no observable difference.

The mitigating path is `handleToolsComplete`
(`packages/cli/src/ui/hooks/agentStream/useAgentEventStream.ts:111`), which calls
`flushPendingHistoryItem` before rendering each tool group. That commits the pending AI
item and clears `thinkingBlocksRef` (`useStreamState.ts:188`). Tool completion is exactly
the iteration boundary, so the ref is already empty when the next iteration's thinking
arrives. Concurrent subagents were also checked: there is no path from subagent thinking
into the parent UI's thought state.

**So this change is latent-correctness hardening, not a user-facing bug fix.** It is worth
making because `streamId` exists solely to identify a stream yet repeated on every API
call, and was rendered harmless only by an incidental flush in unrelated code. Any change
to that flush would reintroduce silent reasoning loss with nothing to catch it. The
regression tests are the durable value: they pin the invariant so it is enforced rather
than accidental.

## Design decision

**Within one thinking block: replace.** The provider emits cumulative snapshots on each
`thinking_delta` and a final identical snapshot at `content_block_stop`. Replace-by-id
is the correct semantic and already works. There is no late-arriving "final summary"
that supersedes the streamed text; per Anthropic's documentation the summary *is* what
streams.

**Across thinking blocks: append, never replace.** Each thinking block is a distinct
reasoning segment bound to the tool call that follows it. Collapsing segments destroys
the causal record of why a tool was chosen.

The fix therefore targets the root cause — non-unique identity — rather than adding
clearing logic or defensive guards in the UI. This mirrors the pattern the Anthropic
processor already uses for tool call ids, for exactly the same reason:

    // Global counter appended to tool call IDs so providers that reset indices per
    // API call (e.g. Kimi on Fireworks) never produce duplicates across turns.
    let toolCallSequence = 0;

## Acceptance criteria

1. Two consecutive API calls within one user turn produce thinking blocks with
   **distinct** `streamId` values, for both the Anthropic and OpenAI Responses paths.
2. Cumulative delta snapshots within a single thinking block still collapse onto one
   rendered block (no regression in streaming behaviour).
3. Given thinking from iteration 1 followed by thinking from iteration 2 with no
   intervening text block, `thinkingBlocksRef` retains **both** blocks in order.
4. Identity remains unique across a resumed session, so replayed history cannot collide
   with newly generated ids.
5. No change to recording/history content shape beyond the streamId value.

## Test plan (behavioral, bun:test, extend existing files)

All new/changed tests use `bun:test`. No Vitest. No mock theater — assert observable
behaviour through the real functions.

1. `packages/providers/src/anthropic/AnthropicProvider.thinking.streaming.test.ts`
   - Drive two separate streams through the processor with the same Anthropic event
     shape (`content_block_start` thinking at index 0, `thinking_delta`, `signature_delta`,
     `content_block_stop`) and assert the emitted `streamId` values differ between calls.
   - Assert that within one stream, every delta plus the final complete emission share
     one `streamId`.

2. `packages/cli/src/ui/hooks/agentStream/__tests__/thoughtState.test.ts`
   - Apply a `complete` thought with streamId A, then a `delta` thought with a
     *different* streamId B, and assert `thinkingBlocksRef.current` has length 2 and
     preserves the first block's text verbatim.
   - Keep the existing same-streamId replacement test green.

3. OpenAI Responses reasoning identity — extend the existing reasoning stream test file
   under `packages/providers/src/openai/` (locate the one covering
   `allocateReasoningStreamId` / `parseResponsesStream` reasoning) with an equivalent
   two-call distinctness assertion.

## Implementation steps

1. Make the Anthropic thinking identity unique beyond the single call, following the
   `toolCallSequence` precedent in the same file. Ensure uniqueness also holds against
   ids replayed from a resumed session.
2. Apply the same treatment to the OpenAI Responses reasoning identity.
3. Do not add clearing logic to `thinkingBlocksRef` and do not add defensive guards in
   `thoughtState.ts`; the identity fix is the root-cause fix.
4. Add a short note to the reasoning/provider documentation describing Anthropic's
   summarized thinking, so future "thinking cut off" reports are triaged as a summarizer
   artefact rather than chased as a streaming bug.

## Verification

    npm run test
    npm run lint
    npm run typecheck
    npm run format
    npm run build
    bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"

Plus a tmux-harness check of the transcript, since this changes terminal UI behaviour.

## Constraints

- No `eslint-disable*`, no `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`, no lint
  severity downgrades, no complexity/size threshold increases. Fix the underlying issue.
- TypeScript strict; no `any`, no type assertions used to dodge typing.
- New files carry a 2026 copyright year.
