# Bound runaway model output: aggregate budget, ungated diagnostics, retention holes

Covers #3335, #3339, #3340, #3341. Branch `issue3335`.

## Why these ship together

All four came out of one incident investigation and all four are the same class
of defect: a stream of model-controlled data retained with no ceiling. They are
separate issues because they live in different packages, but they share test
infrastructure and a single reviewer needs to see them together to judge whether
the memory ceiling is actually closed.

## Incident being fixed

Telemetry from the event: subagent `typescriptexpert-wg1coz` (profile
`dsflash-mi300x`, OpenAI chat completions against self-hosted vLLM) reached
**turn 253** of a 1000-turn default, emitting the full 16,384-token
`maxOutputTokens` ceiling on five consecutive turns. Per-response capping worked.
Nothing bounded the aggregate. Measured retention on that path was **708 bytes of
heap per streamed delta**, of which 482 bytes (68%) was diagnostic state that no
setting enables.

## Scope decisions taken before implementation

**In scope.** Everything that bounds retention.

**Deliberately OUT of scope: changing provider emission semantics.** #3339 fix
item 2 proposed making Anthropic and OpenAI Responses emit true reasoning deltas
instead of cumulative prefixes. That changes observable provider behaviour,
touches history reconstruction and thinking display, and is defence in depth: the
quadratic dies entirely once `Turn` stops retaining every chunk. Per the project's
stated preference for fail-fast over defence in depth, we fix the actual retention
bug and leave emission alone. Documented as a known follow-up.

**Deliberately OUT of scope: bounding `MessageStreamOrchestrator.responseChunks`
and the five string accumulators.** They are linear, they are 174 bytes/delta
combined, and collapsing them changes AfterAgent hook input semantics. Follow-up.

## Work items

### A. Aggregate output budget for an agent run (#3335)

The gap the incident actually hit. A per-response cap does not constrain a loop.

- Add `SubagentTerminateMode.MAX_OUTPUT` to
  `packages/core/src/core/subagentTypes.ts`.
- Add `max_output_tokens_total?: number` to `RunConfig` in the same file.
- Track cumulative generated tokens across turns in the subagent execution loop
  and terminate when the budget is exceeded, in
  `packages/agents/src/core/subagentExecution.ts` (`checkTerminationConditions`
  is the existing home for `max_turns` and `max_time_minutes`; extend it).
- Resolve the default in `packages/agents/src/core/subagentOrchestrator.ts`
  alongside the existing `max_turns` resolution (`:441-453`). Derive from
  `max_turns * resolved model maxOutputTokens` where the catalog provides it;
  fall back to a flat constant otherwise. `-1` disables.
- Surface actionable guidance in
  `packages/agents/src/core/subagentToolProcessing.ts` next to the existing
  `MAX_TURNS` case (`:256`).
- New ephemeral `subagent-max-output-tokens-total` in
  `packages/settings/src/settings/registry/registry-entries-2.ts`, following the
  hyphenated convention of `shell-output-retention-max-bytes`.

**Behavioural tests.** Drive the real execution loop with a stub provider that
emits N tokens per turn. Assert: terminates with `MAX_OUTPUT` once cumulative
output crosses the budget; does NOT terminate below it; `-1` restores unlimited;
the terminate reason reaches `output.terminate_reason` and the final message
names the budget. No mock verification.

### B. Stop retaining per-chunk diagnostic state (#3335, #3339)

`Turn.debugResponses` (`packages/agents/src/core/turn.ts:179,190,255-263,913`)
pushes one object per chunk, unconditionally. `grep` for any debug flag in that
file returns nothing. Only reader is the getter at `:913`.

`OpenAIStreamProcessor` `allChunks`
(`packages/providers/src/openai/OpenAIStreamProcessor.ts:421`,
`OpenAIStreamProcessorState.ts:43,61`) retains every raw SDK chunk. Only
consumers are three `.length` reads
(`OpenAIStreamProcessorState.ts:358,364,376`).

- Replace `allChunks: ChatCompletionChunk[]` with `chunkCount: number`. Update
  the three log sites.
- Bound `debugResponses`: collapse thinking blocks by `streamId` exactly as
  `StreamOutputAccumulator` already does (`streamOutputAccumulator.ts:32-57`),
  and cap total retained chunks with a constant. This kills the O(N²) on
  cumulative-thinking providers without touching provider emission.

**Behavioural tests.** Feed a `Turn` a stream of D cumulative thinking chunks
sharing one `streamId` and assert retained chunk count and retained characters
are O(D) not O(D²), measured on the real accumulator state, not a mock. Feed the
OpenAI processor N chunks and assert the reported count is N while no chunk
array is retained.

### C. Bound the pending-response buffer under an unclosed fence (#3340)

`IncrementalSplitScanner.getSplitPoint()` returns the frozen `lastFencePos` while
`fenceParityOdd` is true, so nothing is ever committed and the pending item grows
for the whole response, restoring the O(N²) render #2852 removed. Measured: 820,004
chars retained vs 0 for balanced-fence and no-fence controls.

Confirmed no Ink change and no renderer change needed:
`MarkdownDisplay.tsx:80-91` already flushes an open code block at end of input, so
the committed half renders correctly today. Only the retained tail needs a
synthesized opening fence.

- Capture the fence string and language in `scanFence`
  (`packages/cli/src/ui/hooks/agentStream/incrementalSplitScanner.ts:130-146`).
- Add a size-based forced split when the retained tail exceeds a threshold, even
  with odd fence parity; prepend the synthesized fence + language to the tail.
- Thread through `pendingResponseBuffer.ts` and the caller in
  `contentEventProcessor.ts:216-249`.

**Behavioural tests.** Drive the real scanner and buffer. Assert: unclosed-fence
stream retains bounded characters; balanced-fence and no-fence streams are
byte-identical to today including commit boundaries; concatenating committed
prefix + retained tail reproduces the original text modulo the synthesized fence;
the tail parses as a code block continuation.

Accepted cosmetic consequence: a code block longer than the threshold renders as
two adjacent code blocks. Contiguous and identically styled, so near-invisible in
a terminal.

### D. Byte bounds on provider stream parsers (#3341)

Untrusted network input, so hard caps with clear protocol errors are appropriate
here (the fail-fast exception for external data).

- `packages/providers/src/openai/parseResponsesStream.ts:161` tool-call
  `arguments`, and `:893` SSE incomplete-line buffer.
- `packages/providers/src/openai/ToolCallCollector.ts:59-85` fragment retention.
- `packages/providers/src/anthropic/AnthropicStreamProcessor.ts:322`
  `currentToolCall.input`.
- `packages/providers/src/openai-vercel/vercelReasoningCapture.ts:76`
  `reasoningChunks`, `:108` SSE buffer, and wire an `AbortSignal` into
  `parseReasoningFromSseStream` (`:90-94`), which currently has none.
- `packages/providers/src/openai/OpenAIStreamProcessor.ts:296-318` qwen
  `textBuffer`: cap growth independently of the Kimi-section flush suppression
  (`OpenAIStreamProcessorState.ts:79-81`), which today returns `false`
  unconditionally while a section is open and lets the buffer grow for the whole
  response while running two full-buffer regex scans per delta.

**Behavioural tests.** Real parsers, synthetic byte streams. Assert each raises a
typed error naming its limit when exceeded, and that a normal response including
large-but-legitimate tool arguments is byte-identical to today.

## Verification

Full cycle after every remediation round:

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Plus `bun scripts/test-audit/scan.ts` with no new MOCK_MIRROR / ALWAYS_TRUE /
SELF_CONFIRMING / NO_ASSERT findings on touched files.

## Non-negotiables

- Bun + `bun:test` only. No new `.js`. No vitest.
- 2026 copyright on new files.
- No test may assert current-but-wrong behaviour as specification.
- Every default must leave a legitimate maximal response untouched. The largest
  declared `maxOutputTokens` in the catalog is 128,000
  (`AnthropicModelData.ts:104`); budgets must sit far above that.
