## TLDR

A subagent went into runaway generation and exhausted the heap. Every
per-response guard in the chain worked; nothing bounded the aggregate. This
closes that gap and the three retention defects found alongside it.

Telemetry from the incident: subagent `typescriptexpert-wg1coz` (profile
`dsflash-mi300x`, OpenAI chat completions against self-hosted vLLM) reached
**turn 253 of the 1000-turn default**, emitting the full 16,384-token
`maxOutputTokens` ceiling on five consecutive turns, entirely inside every
existing limit. Measured retention on that path was **708 bytes of heap per
streamed delta**, of which 482 bytes (68%) was diagnostic state that no setting
enables and no setting can disable.

Reviewers should look hardest at two things: the **clamp** on the derived output
budget (without it the default reproduces the very bound that failed), and the
**control assertions** in the CLI tests that prove balanced-fence and no-fence
streaming is byte-identical to today.

## Dive Deeper

### 1. Aggregate output budget (#3335)

A per-response cap does not constrain a loop. Adds
`SubagentTerminateMode.MAX_OUTPUT`, `RunConfig.max_output_tokens_total`, and the
`subagent-max-output-tokens-total` ephemeral, with precedence mirroring
`max_turns` (explicit task > profile > parent > default, `-1` disables).

The default is `max_turns * resolvedModelMaxOutputTokens` **clamped to
2,000,000**. The clamp is the substance of the fix. Unclamped, the incident
profile resolves to 1000 x 16,384 = 16.4M, and the runaway was still inside that
budget at turn 253, so an unclamped default is a no-op wearing a fix's clothes.
There is a regression test asserting the resolved budget is strictly less than
`1000 * 16_384` so this cannot be quietly restored.

2M output tokens is roughly 4,000 turns of ordinary 500-token responses, or 122
consecutive maximum-length ones. Ordinary runs land well under 500k.

Cumulative output is counted from provider usage metadata, falling back to a
character estimate so a provider that reports nothing cannot render the budget
unenforceable. **Reasoning is counted**, because it is generated output and the
profile behind this issue ran high reasoning effort where reasoning dwarfs
visible text. There is a paired assertion proving reasoning is what trips the
budget: a reasoning-heavy turn terminates, the same visible text without
reasoning does not.

### 2. Ungated per-chunk diagnostic state (#3339, #3335)

`Turn.debugResponses` retained one object per streamed chunk, forever, on a
field whose name implies debug gating that does not exist anywhere in the file.
On providers that emit **cumulative** reasoning (Anthropic re-emits the entire
accumulated thought on every `thinking_delta`; OpenAI Responses does the same)
that turns an O(N) stream into O(N^2) retained characters. Measured **463.8 MB
of heap for 640 KB of reasoning**, versus 12.9 MB when the payloads are never
read; `parseThought` is the read that forces the flatten.

`OpenAIStreamProcessor.allChunks` retained every raw SDK chunk so that three log
lines could read `.length`. Now a counter.

Provider emission semantics are deliberately unchanged. Making Anthropic and
OpenAI Responses emit true deltas is defence in depth against a bug that dies
once `Turn` stops retaining every chunk, and it would touch history
reconstruction and thinking display. Recorded as a follow-up in the plan rather
than smuggled in here.

### 3. Unclosed code fence defeats the pending-response bound (#3340)

`IncrementalSplitScanner.getSplitPoint()` returns the frozen `lastFencePos`
while fence parity is odd, so one unclosed fence stops the split point advancing
and nothing is ever committed. When the fence opens at index 0 the failure is
total: `consume(0)` hits the `splitPoint <= 0` early return and drops nothing.
That restores the O(N^2) rendering #2852 removed.

Measured with the real classes, 20,000 deltas / 820,000 chars:

```
balanced fences (control)  retained=0        committed=820014
no fences (control)        retained=0        committed=820017
UNCLOSED fence             retained=820004   committed=0
```

Fixed entirely inside `packages/cli`. **No Ink change and no renderer change.**
`MarkdownDisplay.tsx:80-91` already flushes an open code block at end of input,
so the committed half renders correctly today; only the retained tail needed a
synthesized opening fence and language to parse as a continuation.

Accepted cosmetic consequence: a code block longer than the threshold renders as
two adjacent code blocks. Contiguous and identically styled, so near-invisible in
a terminal.

### 4. Byte bounds on provider stream parsers (#3341)

Untrusted network input, so hard caps with clear errors are correct here rather
than defensive guards. Covers tool-call argument accumulation, SSE
incomplete-line buffers, the `openai-vercel` tee'd reasoning capture (which also
gains the `AbortSignal` it never had, so a cancelled request stops the detached
background parser), and the qwen `textBuffer`, whose growth was previously
suppressed only by an unterminated Kimi tool section while two full-buffer regex
scans ran per delta.

## Reviewer Test Plan

Behavioural regression coverage is in-tree; these are for hands-on validation.

1. **Budget fires and reports usefully.** Launch any subagent with
   `max_output_tokens_total` set low (e.g. 500) via the `task` tool run config.
   Confirm it terminates with `MAX_OUTPUT` and that the final message names the
   budget and the observed total, rather than dying or truncating silently.
2. **Budget does not fire in normal use.** Run a real multi-turn subagent task at
   defaults. It must complete normally with no truncation and no warning.
   `-1` must restore pre-change behaviour exactly.
3. **Reasoning counts.** Use a reasoning-heavy profile
   (`reasoning.effort: high`). The budget should track total generated output,
   not just what you can see.
4. **Streaming is unchanged.** Ask for a long response containing several
   fenced code blocks. Rendering, commit boundaries, and scrollback must look
   exactly as before.
5. **The fence case.** Ask for a response that opens a code fence and produces a
   very long body without closing it. Before this change memory climbs and the
   UI degrades; after, retention stays bounded and the block renders as two
   contiguous blocks.
6. **Providers still work.** Exercise OpenAI chat completions, OpenAI Responses,
   and Anthropic with tool calls including large arguments. Nothing should hit a
   cap in ordinary use.

## Testing Matrix

|          | 🍏  | 🪟  | 🐧  |
| -------- | --- | --- | --- |
| npm run  | ✅  | ❓  | ❓  |
| npx      | ❓  | ❓  | ❓  |
| Docker   | ❓  | ❓  | ❓  |
| Podman   | ❓  | -   | -   |
| Seatbelt | ❓  | -   | -   |

## Linked issues / bugs

Fixes #3335
Fixes #3339
Fixes #3340
Fixes #3341

Related: #3315 / #3319 already fixed the telemetry outfile body leak that
produced the 24 GB of logs from this incident; no work needed here. #2852 added
the pending-response bound that #3340 restores. #3111 collapsed thinking blocks
in `StreamOutputAccumulator`; #3339 is the same defect one layer up in `Turn`.
