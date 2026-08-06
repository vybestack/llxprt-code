# Issue #3063 — A failed tool call must stay failed on the way out

Two independent places degrade a failed tool call between the tool and its
reader. Both are the same class of defect: **the tool failed, and something on
the way out threw away the fact that it failed.**

---

## Part 1 — Providers are told a failed tool call succeeded

### Problem (verified in source)

`ToolResponseBlock` (`packages/core/src/services/history/IContent.ts:244`)
carries two error-ish fields:

    result: unknown      // the payload
    error?: string       // top-level failure marker

`buildToolResponsePayload` (`packages/providers/src/utils/toolResponsePayload.ts:233`)
derives the provider-visible status from the **top-level** field only:

    status: block.error ? 'error' : 'success',

`createErrorResponse` (`packages/core/src/utils/generateContentResponseUtilities.ts`)
never sets that field. It puts the message inside the payload instead:

    result: { error: modelFacingContent ?? error.message },
    // block.error is left undefined

Those blocks reach the provider layer unchanged — `ToolCallResponseInfo.responseParts`
are flattened straight into history by `buildToolResponses` /
`recordCompletedToolHistory` (`packages/agents/src/core/agenticLoop/loopHelpers.ts`)
— so for **every** genuine tool failure `payload.status` is `'success'`.

Observed downstream consequences:

| Consumer                                                   | Today on a failed tool call            |
| ---------------------------------------------------------- | -------------------------------------- |
| `AnthropicMessageNormalizer.buildToolResult` (`:408`)       | `is_error` never set                   |
| `GeminiMessageConverter` (`:96`)                            | `response.status === "success"`         |
| `OpenAIRequestBuilder.buildToolResponseContent` (`:104`)    | `status:\nsuccess`, empty `error:` line |
| `buildResponsesRequest` (`:250`)                            | same as above                          |
| `iContentToHistoryItems` (cli, `:38`)                       | `ToolCallStatus.Success` on replay      |
| `HighDensityStrategy.buildToolSummaryText` (`:899`)         | `[tool: success]` in compressed summary |

The only writers of the top-level `error` today are cancellation
synthesis (`historyToolPairing.ts:75`, `historyToolNormalization.ts:277`, both
literally `'Tool call interrupted or cancelled'`) and clone/copy helpers.

### Decision: what the top-level marker carries

The issue requires an explicit decision. **The top-level `error` carries the
terse, log-shaped `error.message`; `result` keeps carrying the model-facing
payload.**

Rationale:

- The field is declared as _"Error message if the tool call failed"_ — a
  marker, not the model's remedy.
- `OpenAIRequestBuilder` renders `error:` and `output:` as separate sections.
  Putting the terse message in `error` and the remedial `llmContent` in
  `output` keeps both, un-duplicated. Putting the model-facing text in both
  would duplicate a potentially large remedy on every OpenAI-family request.
- It preserves #3037: the remedial `llmContent` still travels in `result` and
  is still what Anthropic/Gemini surface as the tool output.

### Boundary case: an empty `error.message`

`status` is derived by truthiness, so `error: ''` would silently mean
"success". A failure must always be marked as a failure, so when
`error.message` has no non-whitespace content the marker falls back to the
constant `'Tool call failed'`. This is the single fallback on this path — no
layered guards.

### Accepted behaviour (acceptance criteria)

**AC1 — `createErrorResponse` sets the top-level marker.**
The tool_response block it builds carries `error` set to `error.message`
(trimmed-non-empty), in addition to the existing `result: { error: … }`.

**AC2 — the model-facing payload is unchanged.**
`result` still carries `modelFacingContent ?? error.message` exactly as after
#3037. `resultDisplay`, `errorType`, `callId` and `agentId` are unchanged.

**AC3 — empty/whitespace `error.message` still marks a failure.**
`createErrorResponse(request, new Error(''), …)` produces a block whose
`error` is `'Tool call failed'`, so `payload.status === 'error'`.

**AC4 — the provider payload reports the failure.**
`buildToolResponsePayload` on such a block returns `status: 'error'` and
`error` set to the marker text.

**AC5 — Anthropic marks the tool result as an error.**
A `tool` `IContent` whose tool_response came from `createErrorResponse`
converts to an Anthropic `tool_result` block with `is_error: true`, and the
`content` still carries the model-facing payload (the #3037 remedy).

**AC6 — Gemini reports the failure status.**
The same content converts to a `functionResponse` whose `response.status` is
`'error'` and whose `response.error` is the terse marker, with
`response.result` still carrying the model-facing payload.

**AC7 — OpenAI-family text reports the failure.**
`buildToolResponseContent` renders `status:\nerror` and a non-empty `error:`
section for the same block.

**AC8 — successes are untouched.**
A tool_response block with no top-level `error` still yields
`status: 'success'`, no `is_error` on Anthropic, and `status: "success"` on
Gemini.

**AC9 — cancellation is untouched.**
Synthetic cancellation blocks keep `error: 'Tool call interrupted or
cancelled'` and keep reporting `status: 'error'`.

### Implementation shape

`packages/core/src/utils/generateContentResponseUtilities.ts`:

```ts
const TOOL_FAILURE_MARKER_FALLBACK = 'Tool call failed';

export const createErrorResponse = (
  request: ToolCallRequestInfo,
  error: Error,
  errorType: ToolErrorType | undefined,
  modelFacingContent?: string,
): ToolCallResponseInfo => {
  const failureMarker =
    error.message.trim().length > 0
      ? error.message
      : TOOL_FAILURE_MARKER_FALLBACK;
  return {
    callId: request.callId,
    error,
    responseParts: [
      {
        type: 'tool_response',
        callId: request.callId,
        toolName: request.name,
        result: { error: modelFacingContent ?? error.message },
        error: failureMarker,
      },
    ],
    resultDisplay: error.message,
    errorType,
    agentId: request.agentId ?? DEFAULT_AGENT_ID,
  };
};
```

No other production file changes for Part 1 — every downstream consumer
already reads the top-level marker correctly and starts reporting the truth
once it is set.

### Explicitly out of scope for Part 1

- Changing `historyToolNormalization.scoreResponse` duplicate-response
  preference (it only fires when one `callId` has two responses).
- Changing what `result` carries, or any tool's `llmContent` / `error.message`
  wording.
- Retry/backoff policy changes.
- Changing `humanizeJsonForDisplay` precedence or the `{ error: … }` result
  shape.

---

## Part 2 — `ReadFileTool.execute()` destroys both halves of its own error

### Problem (verified in source)

`packages/tools/src/tools/read-file.ts:494`:

```ts
private normalizeLegacyExecutableResult(result: ToolResult): ToolResult {
  const normalized: ToolResult = { ...result };
  if (normalized.returnDisplay === '' && typeof normalized.llmContent === 'string') {
    normalized.returnDisplay = normalized.llmContent;
  }
  if (normalized.error != null) {
    return {
      ...normalized,
      llmContent: normalized.error.message,
      error: normalized.error.message as unknown as ToolResult['error'],
    };
  }
  return normalized;
}
```

1. The model-facing `llmContent` is overwritten with the terse
   `error.message` — the #3037 defect hard-coded into a tool.
2. `error` is coerced from `{ message, type }` to a bare **string** through a
   double cast, so the value no longer matches its declared type.
   `result.error.message` is `undefined` for any caller and the
   machine-readable `ToolErrorType` is gone.

`ReadFileTool.execute()` is the only caller of that helper and has **no**
production caller: `ReadFileTool` extends `BaseDeclarativeTool`, so scheduler
execution goes through `build(...).execute(signal)` →
`ReadFileToolInvocation.execute`. The `BaseTool` legacy bridge in
`tools.ts` / `tool-registry.ts` only wraps `BaseTool` subclasses. Verified by
search: no `.execute(params, signal)` call against a `ReadFileTool` anywhere
in `packages/`.

### Decision

Take the issue's explicitly sanctioned option: **delete
`normalizeLegacyExecutableResult` and make `execute()` return the
invocation's `ToolResult` unchanged.** `execute()` is kept (it is exported
public surface and is what the required direct-API test drives); only the
lying normalization goes.

Consequence, stated deliberately: the `returnDisplay === '' → llmContent`
success-path substitution also disappears, so the direct API now returns
exactly what the invocation returned. That substitution has no caller and no
test; keeping a partially-lying normalizer to preserve it would defeat the
point of the fix.

### Accepted behaviour (acceptance criteria)

**AC10 — a failed direct-API `read_file` keeps its model-facing content.**
`new ReadFileTool(host).execute({ absolute_path: <missing file> })` returns a
`ToolResult` whose `llmContent` is the invocation's model-facing content, not
the terse `error.message`.

**AC11 — a failed direct-API `read_file` keeps a well-formed error object.**
The returned `error` is an object with a `string` `message` and a `type` equal
to the invocation's `ToolErrorType` (e.g. `ToolErrorType.FILE_NOT_FOUND`), so
`result.error.message` and `result.error.type` are both readable.

**AC12 — `execute()` and `build().execute()` agree.**
For the same params and signal, the two paths return deeply equal results, for
both a success case and a failure case.

**AC13 — no `as unknown as` cast remains in `read-file.ts`.**

### Implementation shape

```ts
  async execute(
    params: ReadFileToolParams,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<ToolResult> {
    return this.build(params).execute(signal);
  }
```

and delete `normalizeLegacyExecutableResult`.

### Explicitly out of scope for Part 2

- Removing `execute()` itself (public surface; the required direct-API test
  drives it).
- Any change to `ReadFileToolInvocation.execute`, its `returnDisplay`
  values, or `processSingleFileContent`.
- Applying the same treatment to any other tool.

---

## Test plan (RED before GREEN)

All new/changed tests use **Bun** (`bun:test`). No Vitest suite is added or
modified. Tests assert observable outputs (payloads, provider wire shapes,
`ToolResult` fields), never internal call bookkeeping.

### T1 — `packages/core/src/utils/generateContentResponseUtilities.*.test.ts`

Extend the existing `createErrorResponse` coverage (keep it in the existing
`generateContentResponseUtilities.test.ts` describe block for
`createErrorResponse`, or add to the `toolErrorRemedy` file where the #3037
assertions already live — do not create a third file):

1. AC1 — block `error === error.message` for a normal failure.
2. AC2 — `result` is still `{ error: <modelFacingContent> }` when the fourth
   argument is supplied, and `{ error: <error.message> }` when it is not;
   `resultDisplay` / `errorType` / `callId` / `agentId` unchanged.
3. AC3 — `new Error('')` and `new Error('   ')` both yield
   `error === 'Tool call failed'`.

### T2 — `packages/providers/src/utils/toolResponsePayload.test.ts`

4. AC4 — a block produced by the same shape `createErrorResponse` emits
   (`result: { error: 'remedy' }`, `error: 'terse'`) yields
   `status: 'error'` and `payload.error === 'terse'`.
5. AC8 — the same block without a top-level `error` yields
   `status: 'success'` and no `payload.error`.

### T3 — Anthropic (new file
`packages/providers/src/anthropic/AnthropicMessageNormalizer.toolFailure.test.ts`,
following the naming of the existing focused normalizer tests)

6. AC5 — a `tool` `IContent` carrying a `createErrorResponse`-shaped block
   converts to a `tool_result` with `is_error: true` whose content still
   contains the model-facing remedy text.
7. AC8 — a success block converts to a `tool_result` with `is_error`
   absent/undefined.

### T4 — Gemini (extend `packages/providers/src/gemini/GeminiMessageConverter.test.ts`)

8. AC6 — failure block → `functionResponse.response.status === 'error'` and
   `response.error` is the terse marker while `response.result` still carries
   the remedy.
9. AC8 — success block → `response.status === 'success'`, `response.error`
   undefined.

### T5 — OpenAI text rendering

10. AC7 — `buildToolResponseContent` for the failure block renders a
    `status:` section reading `error` and a non-empty `error:` section.
    Place this alongside the existing `OpenAIRequestBuilder` tests.

### T6 — cancellation regression (AC9)

11. A synthetic cancellation block (`result: null`, `error: 'Tool call
    interrupted or cancelled'`) still yields `status: 'error'` through
    `buildToolResponsePayload`. Add to T2's file.

### T7 — `read_file` direct API (new Bun test in `packages/tools`)

New file `packages/tools/src/tools/__tests__/read-file-direct-api.test.ts`
(or the package's established location for tool tests — mirror
`packages/tools/src/__tests__/filesystem-tools.test.ts`'s host fake, using a
real temp directory; do **not** add a production dependency for a test):

12. AC10 + AC11 — `execute()` on a missing file returns `llmContent` equal to
    the invocation's model-facing content and `error` an object with a string
    `message` and a defined `ToolErrorType`.
13. AC12 — `execute(params)` deep-equals `build(params).execute(signal)` for
    a successful read of a real temp file and for the failing read.

### T8 — existing-test sweep

Any existing assertion that a **failed** tool call produces
`status: 'success'`, absent `is_error`, or an empty `error:` section is
asserting the bug. Update those assertions to the new truth and note in the
test why. Do not add new assertions beyond the ACs while doing so.

---

## Verification

From the repo root, all must pass:

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

## Guardrails

- No new `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`.
- No lint severity downgrades, no complexity/size threshold increases, no
  additions to ignore lists. Fix the underlying issue instead.
- No `any`; no type assertions used to dodge strict mode. Part 2 exists
  precisely because of a lying cast — do not introduce another one.
- Fail fast: no defensive layering. Exactly one fallback on the Part 1 path
  (the empty-message marker), and none added elsewhere.
- Do not touch `.llxprt/`.

---

## Review triage (round 1)

Every finding classified. Blocker-Fix and In-scope-Fix are delivered in this
PR; Defer items get their own issue.

| # | Finding | Class |
| - | ------- | ----- |
| 1 | `openai-vercel/messageConversion.ts` discards `payload.status` | **Defer** |
| 2 | `ContentConverters` drops the marker in both directions | **Defer** |
| 3 | Other explicit failure producers never author the marker | **In-scope-Fix** |
| 4 | Scheduler cancellation builders never author the marker | **In-scope-Fix** |
| 5 | Compression drops the remedy once the marker exists | **Blocker-Fix** |
| 6 | Token estimation counts only the marker, not the payload | **Blocker-Fix** |
| 7 | Zed replay displays the terse marker instead of the remedy | **Blocker-Fix** |
| 8 | Impossible `ToolErrorType` casts + weak evidence chain in tests | **In-scope-Fix** |

### Why 1 and 2 are deferred

Both are pre-existing paths that never consumed the failure status at all, so
neither is a regression from this change and neither is repaired by the
mechanism the issue identifies (`block.error` → `payload.status`).

- **1** requires mapping to the AI SDK's `error-text` / `error-json` output
  types — a wire-format change for one provider adapter, needing SDK-version
  verification and its own tests.
- **2** would change the `functionResponse.response` payload shape emitted to
  Google code-assist, which today carries no `status` field on that path at
  all. The hook round-trip half is equally lossy for `providerMetadata` and
  `isComplete` today; repairing only `error` would be arbitrary.

Both are filed as a follow-up issue.

### Blocker-Fix findings are regressions introduced by Part 1

Before this change `block.error` was never set on an ordinary failure, so
three consumers took their `else` branch. Setting the marker flips them:

- `packages/agents/src/compression/utils.ts` — `if (tr.error) … else if
  (tr.result …)` makes the two channels mutually exclusive, so compression
  keeps the terse marker and discards the #3037 remedy.
- `packages/core/src/services/history/historyTokenEstimation.ts` —
  `stringifyToolResponseForTokens` returns `block.error` before serialising an
  object `block.result`, undercounting what is actually transmitted.
- `packages/cli/src/zed-integration/zed-session-replay.ts` — `failureText`
  gives `block.error` precedence, so replay now shows the terse marker where
  it previously showed the model-facing remedy.

### Additional acceptance criteria

**AC14 — compression keeps both channels.**
`sanitizeHistoryForCompression` renders the terse marker *and* the payload for
a block that carries both, so the #3037 remedy survives compression.

**AC15 — token estimation counts what is transmitted.**
`stringifyToolResponseForTokens` accounts for both the marker and an object
`result` on a failed block; the estimate does not shrink when a marker is
added to a block that already carried a payload.

**AC16 — Zed replay still shows the model-facing text.**
A failed tool response whose `result` carries the remedy replays with `status:
'failed'` *and* content showing the remedy, not the terse marker. Failure
classification keeps honouring either field.

**AC17 — every explicit failure producer marks its failure.**
`createErrorCompletedToolCall` (`nonInteractiveToolExecutor.ts`), the
malformed-`self_emitvalue` response (`subagentToolProcessing.ts`), and the
failure call sites in `executor-tool-dispatch.ts` set the top-level marker.
The marker is authored explicitly at each failure boundary — never inferred
from the shape of `result`.

**AC18 — cancellation is marked at its real source.**
`buildCancelledTransition` and `buildCancelAllEntry`
(`packages/agents/src/scheduler/status-transitions.ts`) set the top-level
marker, so a cancelled call in a mixed batch reaches the provider as a
failure.

**AC19 — tests use real `ToolErrorType` members.**
No string-literal-to-enum assertion in any test for this change.

**AC20 — the producer→provider chain is proven end to end.**
At least one test per affected provider builds its block from the real
`createErrorResponse` rather than hand-crafting it, and asserts the remedy
survives into the provider payload (`payload.result` / the OpenAI `output:`
section), so the producer and consumer halves cannot drift apart.
