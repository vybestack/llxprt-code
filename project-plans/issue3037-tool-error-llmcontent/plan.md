# Issue #3037 — Tool errors must deliver the model-facing `llmContent` remedy

## Problem (verified in source)

`ToolResult` carries two error-facing strings:

- `llmContent` — written for the model: states the constraint **and names the remedy**.
- `error.message` — written for logs / UI status lines: terse, symptom-only.

There is exactly **one** boundary in the codebase that converts a `ToolResult`
that has both fields into a model-facing response:

`packages/agents/src/scheduler/result-aggregator.ts` → `ResultAggregator.publishResult()`

```ts
if (result.error === undefined) {
  // success: llmContent → convertToFunctionResponse → responseParts
} else {
  const error = new Error(result.error.message);
  const errorResponse = createErrorResponse(
    scheduledCall.request,
    error,
    result.error.type,
  );
  this.callbacks.setError(callId, errorResponse);   // result.llmContent DISCARDED
}
```

`createErrorResponse` (`packages/core/src/utils/generateContentResponseUtilities.ts:432`)
builds the sole response part as `result: { error: error.message }`. The
provider layer (`packages/providers/src/utils/toolResponsePayload.ts`)
serialises `block.result` into the tool output the model sees, so the model
receives `{"error":"line_number 999 exceeds file length (8)"}` — exactly the
payload quoted in the issue — and the remedy sentence never leaves the process.

Every other `createErrorResponse` call site has **no** `ToolResult` and
therefore no `llmContent` to preserve (tool not found, invalid tool params,
policy denial, publish failure, unhandled scheduler exception). Those are
out of scope and must keep their current behaviour.

## Accepted behaviour (acceptance criteria)

**AC1 — the remedy reaches the model.**
When a tool returns a `ToolResult` with `error` set and an `llmContent` that
carries text, the published `ToolCallResponseInfo.responseParts` tool_response
block carries that `llmContent` text instead of the terse `error.message`.

**AC2 — the terse message is retained everywhere it is used today.**
`ToolCallResponseInfo.error.message`, `errorType` and `resultDisplay` keep
their current values (`result.error.message`). Logs, telemetry and UI status
lines are unchanged.

**AC3 — boundary cases fall back to `error.message`.**

| `llmContent`                                  | model-facing text        |
| --------------------------------------------- | ------------------------ |
| non-empty string                               | the string               |
| `''` / whitespace only                         | `error.message`          |
| `undefined` / `null`                           | `error.message`          |
| `['a', 'b']` / `[{text:'a'},{text:'b'}]`       | `'a\nb'`                 |
| media / inlineData parts only (no text)        | `error.message`          |
| identical to `error.message`                   | that message, once       |

**AC4 — output limiting applies as it does on the success path.**
The model-facing error text is limited with the same batch / fallback
`ToolOutputSettingsProvider` used by `publishResult`'s success branch, so a
huge error body cannot bypass `tool-output-max-tokens`.

**AC5 — error paths with no `ToolResult` are unchanged.**
`tool-dispatcher.ts`, `policy-helpers.ts`, `coreToolScheduler.ts` and
`nonInteractiveToolExecutor.ts` error responses keep using `error.message`.
`ResultAggregator.bufferError` / `bufferCancelled` synthesise
`llmContent === error.message`, so their observable output is unchanged.

**AC6 — the issue's cited tools are demonstrably fixed.**
`insert_at_line` out-of-range, `apply_patch` header mismatch, and `apply_patch`
multi-file now deliver their remedial sentence to the model.

## Explicitly out of scope

- Rewriting any tool's `llmContent` / `error.message` wording (the issue's
  "audit the editing tools" follow-up). The boundary fix alone repairs every
  example cited in the issue without touching a single tool.
- Changing `resultDisplay` to `result.returnDisplay` (the issue explicitly
  keeps `error.message` for `returnDisplay`).
- Setting the top-level `ToolResponseBlock.error` field / changing the
  provider payload `status`.
- Any change to media-block handling on the error path.

## Implementation shape

### 1. `packages/core/src/utils/generateContentResponseUtilities.ts`

Add an exported helper:

```ts
export function extractModelFacingErrorText(
  llmContent: unknown,
  toolName: string,
  config?: ToolOutputSettingsProvider,
): string | undefined;
```

- `string` input → return it when it has non-whitespace content, after
  `limitStringOutput(llmContent, toolName, config)`.
- otherwise → `toBlocksFromLegacyParts(llmContent)`, join `text` blocks with
  `'\n'`, return it when non-whitespace, after `limitStringOutput`.
- no usable text → `undefined`.

Extend `createErrorResponse` with a fourth optional parameter:

```ts
export const createErrorResponse = (
  request: ToolCallRequestInfo,
  error: Error,
  errorType: ToolErrorType | undefined,
  modelFacingContent?: string,
): ToolCallResponseInfo => ({
  ...
  responseParts: [{ ..., result: { error: modelFacingContent ?? error.message } }],
  resultDisplay: error.message,
  ...
});
```

The `{ error: … }` result shape is preserved so downstream consumers
(`humanizeJsonForDisplay`, zed replay, existing tests) keep working.

### 2. `packages/agents/src/scheduler/result-aggregator.ts`

In `publishResult`'s error branch, resolve the output config the same way the
success branch does and pass the extracted text through:

```ts
const outputConfig =
  this.batchOutputConfig ?? this.callbacks.getFallbackOutputConfig();
const errorResponse = createErrorResponse(
  scheduledCall.request,
  new Error(result.error.message),
  result.error.type,
  extractModelFacingErrorText(result.llmContent, toolName, outputConfig),
);
```

Hoist the shared `outputConfig` lookup above the `if` so it is computed once.

## Test plan (write tests first — RED before GREEN)

All new/changed tests use **Bun** (`bun:test`, via each package's existing
test facade). No Vitest suites added or modified.

### T1 — `packages/core/src/utils/generateContentResponseUtilities.test.ts`

Extend the existing `createErrorResponse` describe block and add an
`extractModelFacingErrorText` block:

1. `createErrorResponse` with no fourth argument still produces
   `result: { error: <error.message> }` (regression guard for AC5).
2. `createErrorResponse` with model-facing content produces
   `result: { error: <model-facing content> }` while `resultDisplay` and
   `error.message` stay terse (AC1 + AC2).
3. `extractModelFacingErrorText('Cannot insert at line 999: exceeds file
   length (8). Use line_number <= 9 to append.', 'insert_at_line')` returns
   that string verbatim.
4. Returns `undefined` for `''`, `'   '`, `undefined`, `null`.
5. Joins `[{text:'a'},{text:'b'}]` to `'a\nb'`; handles a plain `string[]`.
6. Returns `undefined` when only `inlineData` parts are present.
7. Applies the token limit: with a `ToolOutputSettingsProvider` capping
   `tool-output-max-tokens` low, an oversized `llmContent` comes back
   truncated (assert length shrank / limit marker present, matching how the
   existing limiter tests in this file assert truncation).

### T2 — `packages/agents/src/scheduler/result-aggregator.test.ts`

Behavioural tests against the **real** `ResultAggregator` (no stubbing of the
unit under test); assert on the `ToolCallResponseInfo` handed to `setError`.

1. **The issue's reproduction.** Buffer a `ToolResult` whose `llmContent` is
   `'Cannot insert at line 999: exceeds file length (8). Use line_number <= 9
   to append.'` and whose `error.message` is `'line_number 999 exceeds file
   length (8)'`. Publish. The `setError` response part's `result.error`
   contains `'Use line_number <= 9 to append.'`; `response.error.message` and
   `response.resultDisplay` are still the terse message; `errorType` is
   preserved.
2. **`apply_patch` header mismatch** — same shape, asserts the
   `'Ensure the patch header matches the target file'` clause survives.
3. **Fallback** — `llmContent: ''` publishes `result.error ===
   error.message`.
4. **Fallback** — `llmContent` with only a media/inlineData part publishes
   `result.error === error.message`.
5. **Array `llmContent`** — text parts are joined and delivered.
6. **`bufferError` unchanged** — a raw `Error` still publishes
   `result.error === error.message` (AC5).
7. **Success path untouched** — an existing success assertion must keep
   passing (no new test needed if already covered; add one if not).
8. **Batch limiting** — inside a 2-tool batch with a low
   `tool-output-max-tokens`, an oversized error `llmContent` is truncated,
   proving AC4 uses the batch config.

### T3 — end-to-end evidence for AC6

New Bun test file
`packages/agents/src/scheduler/result-aggregator.tool-error-remedy.test.ts`:

- Build a real `InsertAtLineTool` from `@vybestack/llxprt-code-tools` with a
  minimal structural `IToolHost` fake over a real temp directory (mirror
  `_createFakeFileHost` in
  `packages/tools/src/__tests__/filesystem-tools.test.ts`, but only the
  members `IToolHost` requires).
- Write an 8-line file, build the invocation with `line_number: 999`, and
  `execute()` it to obtain a **real** `ToolResult`.
- Feed that real result through a real `ResultAggregator` and assert the
  published `setError` response part contains `'Use line_number <= 9 to
  append.'`.
- Repeat for the real `ApplyPatchTool` header-mismatch case if it can be
  driven with the same host fake; if the host surface required by
  `apply_patch` is materially larger, cover it at T2 level with the literal
  strings taken from the tool source and note that in the test docstring.

If placing tool construction inside `packages/agents` tests turns out to
require production dependency changes, put T3 in `packages/tools` instead as a
test that the real tool's `ToolResult.llmContent` carries the remedy, and keep
the boundary proof at T2. **Do not add a production dependency to satisfy a
test.**

## Verification

Run and pass, from the repo root:

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
- No `any`, no type assertions to dodge strict mode.
- Fail fast: no defensive layering. One extraction helper, one fallback.
