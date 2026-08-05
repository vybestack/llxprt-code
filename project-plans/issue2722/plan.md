# Issue #2722 — Detect tool-related 400 errors and advise the model to try a different approach

## Problem (verified in source)

When a tool result carries content the provider cannot accept (the canonical
case from #2719: a `.fh` shader source misclassified as `image/png`, so
`read_file` emitted a base64 `media` block), the failure surfaces on the *next*
provider call, not at tool-execution time. The provider rejects the whole
request:

    Client error: The image data you provided does not represent a valid image.
    Please check your input and try again with one of the supported image
    formats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']. (Status: 400)

Traced path (file:line):

1. Provider throws inside `provider.generateChatCompletion` —
   `packages/agents/src/core/StreamProcessor.ts:518`.
2. `retryWithBackoff` (`StreamProcessor.ts:253`) does not retry 400
   (`RETRYABLE_STATUS_CODES` in `packages/core/src/utils/retry.ts`).
3. `TurnProcessor._runStreamAttempt` (`packages/agents/src/core/TurnProcessor.ts:279`)
   returns `action: 'stop'`; `_createStreamGenerator` (line 240) rethrows.
4. `Turn.handleRunError` (`packages/agents/src/core/turn.ts:526`) converts it to
   an `AgentEventType.Error` event carrying a `StructuredError` with `status`
   and `message` intact.
5. `handleErrorEvent` (`packages/agents/src/core/MessageStreamTerminalHandler.ts`)
   reads the status via `getErrorStatus`. **Only `413` has a recovery
   branch** (the `handle413Error` call). Every other status falls through to
   "error event ending iteration without retry".
6. The CLI renders `[API Error: … (Status: 400)]`
   (`packages/core/src/utils/errorParsing.ts`), and the turn dies.

The model therefore never learns that the *content* was the problem, and cannot
self-correct. In #2719 the model eventually worked around it by `cat`-ing the
files with the shell tool.

Two facts make a clean recovery possible:

- **The failing pending content is never persisted.** User/tool contents are
  written to history only after a successful send
  (`TurnProcessor._commitSendResult` → `_recordUserContents`,
  `packages/agents/src/core/TurnProcessor.ts:793-856`; streaming commits via
  `ConversationManager.recordHistory` from `streamResponseHelpers.ts:579`).
  A 400 aborts before any of that, so the offending media is simply dropped.
  The resulting orphaned `tool_call` (the one whose response was rejected) is,
  however, still in history without a matching `tool_response`. This is safe
  because `HistoryService.getCuratedForProvider` runs
  `buildProviderContent`
  (`packages/core/src/services/history/historyProviderPipeline.ts:31-71`),
  which calls
  `HistoryToolNormalization.ensureToolResponseCompleteness`
  (`packages/core/src/services/history/historyToolNormalization.ts:219-286`)
  to synthesize a `tool_response` carrying
  `error: 'Tool call interrupted or cancelled'` for every orphaned tool call,
  for ALL providers, before any provider-specific converter runs. (This is the
  same mechanism that makes the pre-existing 413 recovery safe.)
- **A proven, guarded synthetic-advice-and-reissue mechanism already exists** —
  `handle413Error` (`MessageStreamTerminalHandler.ts:114-167`), guarded against
  looping by the `ctx.is413Retry` one-shot flag.

## Accepted behaviour (acceptance criteria)

**AC1 — Detection and recovery.**
When the terminal `Error` event carries `status === 400`, a message that
identifies rejected/unsupported *content* (see AC8 for the classifier
contract), **and** the failing `initialRequest` actually carried tool
evidence (`describeRejectedPayload(initialRequest)` yields non-empty
`toolNames` **or** non-empty `mediaDescriptors`), the orchestrator injects a
synthetic advice message and re-issues the request via
`deps.sendMessageStream`, exactly as the 413 path does. A 400 that matches the
message classifier but whose request carried no tool evidence (e.g.
user-pasted content) does NOT recover — the iteration ends as today, so the
advice never falsely claims "content supplied by a tool result".

**AC2 — Precision: non-content 400s are unaffected.**
A 400 whose message does not identify rejected content ends the iteration
exactly as today (no extra `turn.run`, no injected message). Representative
messages that must NOT trigger recovery:

| message                                                                     | why                     |
| --------------------------------------------------------------------------- | ----------------------- |
| `Invalid JSON payload received. Unknown name "foo"`                          | request-shape error     |
| `Invalid value for 'temperature': must be <= 2`                              | parameter error         |
| `This model's maximum context length is 128000 tokens`                       | context overflow        |
| `Invalid schema for function 'x': exceeds maximum nesting depth`             | tool-schema depth       |
| `missing required parameter: 'model'`                                        | request-shape error     |
| `Invalid tool call: file_path is required`                                   | tool-arg error          |

**AC3 — Other statuses unchanged.**
`undefined`, `401`, `413`, `429`, `500` are untouched. The 413 branch keeps its
current message text verbatim and keeps winning for 413.

**AC4 — Advice content.**
The injected message is a single `{ type: 'text' }` block that:

- states the provider rejected the previous request with HTTP 400 because
  tool-supplied content was invalid/unsupported for its declared type;
- quotes the provider message (truncated to at most 300 characters, with a
  trailing `…` when truncated);
- states the rejected content was **not** added to the conversation;
- names the tools involved, when the failing request carried tool responses;
- names the rejected media (filename and/or MIME type), when the failing
  request carried `media` blocks;
- instructs the model not to resend the same content or repeat the identical
  tool call, and to try a different approach — explicitly offering "if a file
  was sent as an image or other binary attachment but is actually text or
  source code, read it as text instead".

It contains **no** hardcoded file extension and **no** hardcoded tool name.

**AC5 — Loop guard (one recovery per model round-trip).**
The re-issued call is flagged so a second content-rejection 400 inside it does
**not** inject again; the iteration ends with a warning log, mirroring the
repeated-413 behaviour. The guard is shared with the 413 path so a
413-then-400 (or 400-then-413) sequence inside one round-trip also injects at
most once.

**AC6 — Gating identical to 413.**
Recovery runs only when `config.getContinueOnFailedApiCall()` is `true` and
`canRetryFailedStream(state)` holds (no tool call, content, or thinking was
already emitted in this turn) **and** (per AC1) the failing request carried
tool evidence. Otherwise the iteration ends as today.

**AC7 — The user still sees the error.**
The `Error` event is yielded to the consumer before recovery is attempted
(it is yielded in `MessageStreamOrchestrator._processStreamIteration` at
line 448, before `handleTerminalEvent` at line 452). This is unchanged.

**AC8 — Classifier contract (generic, provider-neutral).**
`isToolContentRejection(status, message)` returns `true` iff `status === 400`
**and** the lower-cased message contains **both**

- at least one *content term* — `image`, `image data`, `image_url`,
  `input_image`, `picture`, `photo`, `screenshot`, `audio`, `video`,
  `document`, `pdf`, `media`, `media type`, `mime type`, `content type`,
  `attachment`, `inline data`, `inline_data`, `base64`, `data uri`,
  `file format`, `file type`, `file data`, `file_data`, `uploaded file`,
  `multimodal`; and
- at least one *rejection term* — `not a valid`, `does not represent a valid`,
  `is not valid`, `should be a valid`, `invalid`, `unsupported`,
  `not supported`, `unable to process`, `could not process`, `cannot process`,
  `unable to decode`, `could not decode`, `failed to decode`,
  `failed to process`, `failed to parse`, `failed to download`,
  `could not download`, `unable to download`, `does not match`, `malformed`,
  `corrupt`, `unrecognized`, `unrecognised`, `supported formats`.

Matching is case-insensitive. A missing/empty/non-string message returns
`false`. A missing/non-400 status returns `false`. Bare `file` is deliberately
excluded from the content terms because `Invalid tool call: file_path is
required` must not match (AC2).

**Word boundaries for content terms.** Content terms are matched with an
index scan that requires the characters immediately before and after the
match (when present) to be non-word characters, where a word character is
`a`-`z`, `0`-`9`, or `_` (the text is already lower-cased). This prevents
`image` from matching inside `read_image` or `image_path`, while still
matching `image.source.base64` and `['image/jpeg', 'image/png', ...]` since
`.`, `/`, `'`, and `[` are not word characters. Rejection terms are multi-word
phrases and remain plain substring matches.

Detection is implemented with plain lower-cased scans — **no regular
expressions** — so it cannot backtrack and satisfies `sonarjs/slow-regex`.

**AC9 — Request-shape tolerance.**
Tool names and media descriptors are extracted after normalising the failing
request through `iContentFromAgentMessageInput`, so `string`,
`ContentBlock[]`, `IContent`, and `IContent[]` request shapes all work.
Duplicate tool names and duplicate media descriptors are de-duplicated and
kept in first-seen order.

## Explicitly out of scope

- The `.fh` MIME misclassification itself (fixed by #2719).
- Any change to which statuses `retryWithBackoff` / `turnRetryPolicy` retry.
- Proactive sanitisation of media before sending, history repair/rewriting, or
  the `enforceImageBudget` (413/size) path.
- The `DirectMessageProcessor` non-streaming path and the compression pipeline.
- Any new user-facing setting.

## Design

### New module — `packages/agents/src/core/toolContentRejection.ts`

Pure, dependency-light, fully unit-testable:

```ts
export function isToolContentRejection(
  status: number | undefined,
  message: unknown,
): boolean;

export interface RejectedPayloadDescription {
  readonly toolNames: readonly string[];
  readonly mediaDescriptors: readonly string[];
}

export function describeRejectedPayload(
  request: AgentMessageInput,
): RejectedPayloadDescription;

export function buildToolContentRejectionAdvice(
  description: RejectedPayloadDescription,
  providerMessage: string,
): string;
```

`extractToolName` / `extractToolNamesFromRequest` currently live in
`MessageStreamTerminalHandler.ts:78-112`. **Move them into the new module**
(exported) and import them back into the handler so the 413 path and the new
400 path share one implementation — no duplicated tool-name parsing. The move
must be behaviour-preserving: the existing 413 assertion in
`packages/agents/src/core/client.sendMessageStream-errors.test.ts:322`
(`… The tools involved were: read_file, search_file. …`) must keep passing
unchanged. `describeRejectedPayload` normalises via
`iContentFromAgentMessageInput` before scanning blocks (AC9); it reuses the
same per-block tool-name extraction.

The moved `extractToolName` carried a vestigial legacy Google branch for
`{ functionResponse: { name } }`. It is dropped: `AgentMessageInput` is the
neutral union (`string | ContentBlock[] | IContent | IContent[]`), so that
shape cannot reach the function, and `scripts/agents-neutral-gate.ts` (the
issue #2424 enforcement) bans Google-shaped fixtures in this package — which
means the branch could not be covered by a test either. Removing it is
preferred over exempting it: it eliminates an unreachable defensive path
rather than pinning one.

Media descriptor formatting, from a `MediaBlock`
(`packages/core/src/services/history/IContent.ts:273`):

- `filename` present → `` `${filename} (${mimeType})` ``
- otherwise → `` `${mimeType}` ``

### Loop-guard flag rename

`is413Retry` becomes `isPayloadRecoveryRetry` (same positional slot, same
default `false`, same semantics plus the new 400 case). Renaming avoids adding
a seventh positional boolean parameter to a public contract while making the
now-shared meaning explicit. Sites to update:

- `packages/core/src/core/clientContract.ts:159`
- `packages/agents/src/core/client.ts:742,752`
- `packages/agents/src/core/MessageStreamOrchestrator.ts:69,86,149,165`
- `packages/agents/src/core/MessageStreamTerminalHandler.ts:123`
- `packages/cli/src/integration-tests/todo-continuation.integration.test.ts:274,283,310`

### Handler change — `MessageStreamTerminalHandler.ts`

Add `handleToolContentRejection400`, structurally parallel to
`handle413Error`, and dispatch to it from `handleErrorEvent` after the 413
branch:

```ts
if (
  isToolContentRejection(errorStatus, getErrorMessage(event)) &&
  config.getContinueOnFailedApiCall() &&
  canRetryFailedStream(state)
) { … }
```

A `getErrorMessage(event)` reader is added next to the existing
`getErrorStatus(event)` (same defensive narrowing over
`event.value.error.message`).

Keep the file under `max-lines: 800` and each function under
`max-lines-per-function: 80` (current file is 322 lines; moving the two
extractors out offsets the additions).

### Advice message template (exact)

```
System: The provider rejected the previous request with HTTP 400 because
content supplied by a tool result was invalid or unsupported for its declared
type. Provider message: "<TRUNCATED_PROVIDER_MESSAGE>". That content was not
added to the conversation.<TOOL_CLAUSE><MEDIA_CLAUSE> Do not resend the same
content or repeat the same tool call with the same arguments. Try a different
approach instead — for example, if a file was sent as an image or other binary
attachment but is actually text or source code, read it as text.
```

(Emitted as one line; the wrapping above is presentational only.)

- `<TOOL_CLAUSE>` = `` ` The tools involved were: ${names.join(', ')}.` `` when
  non-empty, else `''`.
- `<MEDIA_CLAUSE>` = `` ` The rejected content was: ${descriptors.join(', ')}.` ``
  when non-empty, else `''`.
- `<TRUNCATED_PROVIDER_MESSAGE>` = trimmed message, truncated to 300 characters
  with a trailing `…` when it was longer. An empty/blank provider message
  drops the whole `Provider message: "…".` sentence.

## Test plan (test-first, `bun:test` via the package test facade)

### Unit — `packages/agents/src/core/toolContentRejection.test.ts`

`isToolContentRejection`:

1. `true` for the verbatim #2719 message at status 400.
2. `true` (table-driven) for provider phrasing variants across content types:
   OpenAI `You uploaded an unsupported image…`; Anthropic
   `image does not match the provided media type`; `Could not process image`;
   `Invalid base64 data`; `Unsupported document type`; `unable to decode audio`;
   `Invalid MIME type. Only image types are supported.`;
   `Unsupported video format`.
3. `false` (table-driven) for every AC2 row.
4. `false` for status `413`, `429`, `500`, `undefined` with an otherwise
   matching message.
5. `false` for `undefined`, `null`, `''`, `'   '`, and non-string messages.
6. Case-insensitive: an all-upper-case variant of case 1 returns `true`.

`describeRejectedPayload`:

7. Extracts tool names from a `ContentBlock[]` containing `tool_response`
   blocks, in first-seen order, de-duplicated.
8. Extracts the same names from the equivalent `IContent[]` shape (AC9).
9. Extracts media descriptors `shader.fh (image/png)` (filename present) and
   `image/png` (filename absent), de-duplicated.
10. Returns empty arrays for a plain string request and for `[]`.

`buildToolContentRejectionAdvice`:

11. Includes tool clause and media clause when both are present, and the
    provider message, and the "read it as text" guidance.
12. Omits the tool clause when there are no tool names; omits the media clause
    when there are no media descriptors.
13. Truncates a 1000-character provider message to 300 characters plus `…`.
14. Drops the `Provider message:` sentence for a blank provider message.
15. Contains no `.fh` and no hardcoded tool name (AC4 guard).

### Behavioural — `packages/agents/src/core/client.sendMessageStream-toolContent400.test.ts`

Modelled on the existing 413 suite
(`client.sendMessageStream-errors.test.ts`), driving the real
`AgentClient.sendMessageStream` with a mocked `Turn.run`:

16. **AC1/AC4** — first stream yields an `Error` event with the #2719 message
    at status 400 and the request carries a `read_file` `tool_response` plus a
    `media` block; second stream yields content. Asserts: the error event is
    still emitted, `turn.run` is called twice, and the second call's request is
    the single advice text block naming `read_file`, the media descriptor, and
    the alternative-approach guidance.
17. **AC2** — a 400 with `Invalid value for 'temperature': must be <= 2` calls
    `turn.run` exactly once and emits only the error event.
18. **AC5** — a stream that always yields the content-rejection 400 calls
    `turn.run` exactly twice (one recovery, then stop).
19. **AC6a** — with `getContinueOnFailedApiCall()` returning `false`,
    `turn.run` is called once.
20. **AC6b** — when a `Content` event precedes the content-rejection 400,
    `turn.run` is called once (`canRetryFailedStream` false).
21. **AC3** — the existing 413 assertions in
    `client.sendMessageStream-errors.test.ts` still pass verbatim after the
    extractor move and the flag rename (regression guard, no new test needed).

All new/changed tests import the test API from the package facade
(`../testApi.js`) and run under `bun test`. No Vitest suites are added or
modified.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
