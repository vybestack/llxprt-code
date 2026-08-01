# PLAN-20260731-CHRONOLOGY — Stable chronology markers in chat history (Issue #1721)

## 1. Problem statement

When provider requests are retried, and when tool calls interleave with normal
messages, there is no reliable way to reconstruct the exact order of history
events or to correlate "what the model saw" with what happened in the client.

Grounded findings (evidence in `RESEARCH.md`):

- `ContentMetadata` has **no ordinal / sequence concept at all**.
- `metadata.turnId` is `turn_<randomUUID()>` — unique but **not ordered**, and a
  new UUID is minted per construction site (user input, AI turn, restored
  history), so it does not correlate a user turn with its downstream tool
  round-trips.
- `metadata.timestamp` is **not set on production AI/tool history items** — only
  tests and explicit `createUserMessage` callers set it.
- `metadata.id` conflates tool-call ID canonicalisation with OpenAI Responses
  `previous_response_id` identity; it is absent on most AI turns.
- Array position is the only ordering signal, and **compression destroys it**:
  `CompressionHandler` does `historyService.clear()` then re-`add()`s the new
  history, and summary entries carry no trace of what they replaced.

## 2. Owner constraints (issue thread, @acoliver)

> "(BTW I'm not against stamps per se you just cant send them to the provider
> and we will munge them in summarization)"

Three hard constraints, all are acceptance criteria:

1. **C1 — Chronology must never reach a provider wire payload.** Providers reject
   unknown fields in message objects with HTTP 400 (z.ai already does this for
   empty human turns per issue #2410). A leaked `chronology` key on any message
   would break every request for that provider. This is the single highest risk
   of the change and is guarded by an explicit regression test over **every**
   wire converter, not by inspection.
2. **C2 — Chronology must survive summarization/compression**, and where items
   are destroyed by summarization, the summary must record what span it
   replaced.
3. **C3 — Chronology must not inflate token accounting.** Three fallback
   estimators serialize the *whole* `IContent` (metadata included) to estimate
   tokens. Adding a ~90-character marker per history item would silently inflate
   context estimates and trigger compression early. Since metadata is never sent,
   these estimators must serialize only the wire-relevant `{ speaker, blocks }`.

## 3. Non-goals (explicit, will not be implemented)

| # | Non-goal | Rationale |
|---|---|---|
| NG1 | Sending chronology to providers / rendering it into prompts | Explicitly vetoed by the owner. The issue text mentions "surfaced to prompt rendering and provider payloads" — the owner overrode that. |
| NG2 | New telemetry event fields or OTel schema changes | Separate subsystem; would be a workflow/dependency-class change requiring approval. |
| NG3 | Threading `HistoryService` into provider SDK execution so `/dumpcontext on|error` dumps get a chronology sidecar | Large cross-package plumbing change through 4 provider execution paths. Out of budget. `/dumpcontext now` (which already has history access) is covered. |
| NG4 | Redesigning or replacing `turnId`, `metadata.id`, or `metadata.timestamp` semantics | Pre-existing behaviour, widely depended on. Chronology is purely additive. |
| NG5 | Persisting chronology into a session/resume file format | No file-format change in scope. Markers are per-`HistoryService`-instance and reconciled from whatever markers are present on restored items. |
| NG6 | A user-facing settings/config toggle for chronology | Stamping is unconditional and free (three integer fields); a toggle would add config surface for no benefit. |
| NG7 | Fixing the inconsistent `metadata.timestamp` population | Out of scope; `chronology.recordedAt` supplies a reliable time instead. |
| NG8 | Changing `HistoryService.clear()` to reset chronology counters | Non-reuse of `seq` is the point of the feature. Documented in AC2. |

## 4. Design

### 4.1 Data shape

Added to `packages/core/src/services/history/IContent.ts`:

```ts
/** Span of chronology sequence numbers that a summary entry replaced. */
export interface ChronologyReplacedSpan {
  readonly fromSeq: number;   // lowest seq destroyed by compression
  readonly toSeq: number;     // highest seq destroyed by compression
  readonly itemCount: number; // how many history items were destroyed
}

/** Client-side ordering marker. NEVER sent to a provider. */
export interface ChronologyMarker {
  readonly seq: number;       // 1-based, monotonic per HistoryService, never reused
  readonly userTurn: number;  // 0 before the first human turn, then 1-based
  readonly step: number;      // 1-based ordinal within the current userTurn
  readonly recordedAt: number;// epoch ms at the moment of insertion
}

export interface ContentMetadata {
  // ...existing fields...
  /** Client-side chronology marker. Never serialised to a provider. */
  chronology?: ChronologyMarker;
  /**
   * On a summary entry, the span of chronology sequence numbers that this
   * summary replaced. Never serialised to a provider.
   */
  chronologyReplaced?: ChronologyReplacedSpan;
}
```

`chronologyReplaced` is deliberately a **sibling** of `chronology`, not a field
inside `ChronologyMarker`. Compression constructs its summary entry before that
entry has ever entered `HistoryService`, so it has no marker yet; keeping the
span separate lets the span be attached by a pure function and the marker be
attached later by the stamper, with neither knowing about the other.

### 4.2 Stamping engine

New pure module `packages/core/src/services/history/historyChronology.ts`:

```ts
export class ChronologyStamper {
  constructor(now?: () => number);
  /** Returns content carrying a chronology marker, preserving any existing one. */
  stamp(content: IContent): IContent;
  /** Returns content carrying the given marker verbatim (used for replacements). */
  inherit(content: IContent, marker: ChronologyMarker): IContent;
}
```

Rules:

- **Fresh stamp** (`content.metadata.chronology` absent):
  - if `speaker === 'human'` → `currentUserTurn += 1`, `nextStep = 1`
  - `marker = { seq: nextSeq++, userTurn: currentUserTurn, step: nextStep++, recordedAt: now() }`
- **Preserve + reconcile** (marker already present — this is the compression
  write-back and restored-history case):
  - `currentUserTurn = max(currentUserTurn, marker.userTurn)`
  - `nextSeq = max(nextSeq, marker.seq + 1)`
  - if `marker.userTurn === currentUserTurn` → `nextStep = max(nextStep, marker.step + 1)`
  - content is returned unchanged (identity preserved where possible).
- Pure w.r.t. the caller's object: never mutates input; returns a shallow copy
  with merged metadata only when a marker is actually added.

Rationale for preserve-not-restamp: `CompressionHandler` applies results by
`clear()` + `add()` for every retained item. Restamping there would renumber the
entire surviving history on every compression, which is exactly the "munging"
the owner warned about.

### 4.3 Invariant

**INV-1: every item in `HistoryService`'s backing history array carries
`metadata.chronology`.**

Research identified 4 mutation paths that bypass `addInternal`. Each is handled:

| Path | Handling |
|---|---|
| `addInternal` (covers `add`/`addAll`/`recordTurn`/`merge`/`fromJSON`/compression write-back/queued ops) | `stamp()` before push |
| `validateAndFix` (splices synthetic tool messages) | `stamp()` the synthetic message before splice |
| `applyDensityResult` → `applyDensityMutations` (index replacement) | replacement **inherits** the replaced item's marker (same logical position) |
| `summarizeOldHistory` (whole-array replacement from a caller-supplied fn) | `stamp()` each item of the returned array (preserves markers on retained items, stamps the new summary) |
| `replaceToolResponseBlock` | already preserves `metadata` via `{ ...entry, blocks }` — no change, covered by test |

### 4.4 Compression span annotation (constraint C2)

New pure helper in core:
`packages/core/src/services/history/historyChronology.ts`

```ts
export function annotateCompressionSpan(
  previousHistory: readonly IContent[],
  newHistory: readonly IContent[],
): IContent[];
```

- Computes `destroyed` = the set of `metadata.chronology.seq` values present in
  `previousHistory` but absent from `newHistory` (the items the strategy
  destroyed). Entries without a marker are ignored on both sides.
- If `destroyed` is empty, returns `newHistory` items unchanged.
- Otherwise, for every entry with `metadata.isSummary === true` that does not
  already carry `metadata.chronologyReplaced`, returns a copy with
  `chronologyReplaced: { fromSeq: min(destroyed), toSeq: max(destroyed), itemCount: destroyed.size }`.
- If there is no summary entry (e.g. `TopDownTruncationStrategy`, which drops
  without summarising), returns items unchanged — the loss is still visible as a
  gap in the `seq` series.

Applied once, in `CompressionHandler`'s `applyResult` callback, immediately
before `clear()` + `add()`. The subsequent `add()` calls stamp `chronology` onto
the summary entry, so the finished entry carries both fields. One call site
covers OneShot, MiddleOut, TopDown and any future strategy.

### 4.5 Constraint C1 — provider isolation guard (400-safety)

The wire boundary is already safe by construction: every converter builds
provider messages by explicit field picks from `content.blocks`, never by
spreading `content` or `content.metadata`. Audit result:

| Converter | File | Metadata handling |
|---|---|---|
| OpenAI chat `buildMessagesWithReasoning` | `providers/src/openai/OpenAIRequestBuilder.ts` | no `metadata` reference at all |
| OpenAI Responses `buildResponsesInputFromContent` | `providers/src/openai-responses/buildResponsesInputFromContent.ts` | no `metadata` reference at all |
| OpenAI Responses legacy `buildResponsesRequest` | `providers/src/openai/buildResponsesRequest.ts:321` | explicit pick of `metadata.usage` only |
| Anthropic `convertToAnthropicMessages` | `providers/src/anthropic/AnthropicMessageNormalizer.ts:209` | reads `metadata.model` for a decision; never serialises |
| Gemini `convertHistoryToGeminiFormat` | `providers/src/gemini/GeminiMessageConverter.ts:129` | switches on `speaker`, reads `blocks` only |
| Vercel `convertToVercelMessages` | `providers/src/openai-vercel/messageConversion.ts:271` | reads `metadata.role` for a decision; builds messages from blocks |
| Gemini neutral `ContentConverters.toGeminiContent` | `core/src/services/history/ContentConverters.ts:266` | builds `{ role, parts }` from blocks |

`deepCloneWithoutCircularRefs` (`historyCloneUtils.ts:29-35`) shallow-copies
metadata, so chronology *does* travel with IContent right up to each converter —
which is exactly why the guard must be a test and not an assumption.

There is **no existing test guarding this**. We add a behavioural regression
guard that feeds chronology-bearing history through each of the seven real
converters above (the same functions the live request paths use) and asserts the
serialised output contains no `chronology` key and none of its scalar values.
The guard is written so that adding a new converter without updating the guard
is visible: it asserts against a named list of converters.

### 4.6 Constraint C3 — token-accounting isolation

Three sites serialize the whole `IContent` (metadata included) for estimation:

- `core/src/services/history/historyTokenEstimation.ts:238`
  (`fallbackEstimateForContent`)
- `agents/src/core/clientHelpers.ts:32` (`findCompressSplitPoint` char counts)
- `agents/src/compression/compressionBudgeting.ts:127`
  (`estimateFallbackContentTokens`)

Because metadata is never sent, counting it was always an over-estimate; adding
chronology makes the error material (~90 chars ≈ 20 tokens per history item).

Fix: export a single helper from `historyTokenEstimation.ts`

```ts
/** Serialize only the parts of an IContent that can reach a provider. */
export function serializeWireContentForEstimate(content: IContent): string;
```

returning `JSON.stringify({ speaker: content.speaker, blocks: content.blocks })`,
and use it at all three sites. This is the minimal correct fix and is required by
our change — it is not an opportunistic refactor.

`packages/providers/src/utils/contentPreview.ts:62` also stringifies content, but
only to build a debug log preview, so it is left alone.

### 4.7 Surfacing (debugging/tracing)

1. `HistoryService.getChronologyTrace(): ChronologyTraceEntry[]` — an ordered,
   compact, JSON-safe projection: `{ seq, userTurn, step, recordedAt, speaker,
   blockTypes, toolCallIds, toolResponseIds, isSummary, replaced }`. No message
   text, so the trace itself is safe to share.
2. `curationDebugLogger.logContentAdded` gains the chronology triple, so
   `LLXPRT_DEBUG=llxprt:history:*` shows insertion order including retries and
   tool round-trips.
3. `/dumpcontext now` writes the trace as a **sibling** key in the dump file
   (`DumpData.chronology`), never inside `request.body`. `dumpRequestContext`
   gains an optional `chronology` parameter; the CLI command supplies it.

## 5. Acceptance matrix

Every row is a required behaviour with a behavioural test. "Evidence" names the
test file that must fail without the production change.

| ID | Behaviour | Evidence file |
|---|---|---|
| AC1 | Adding content to `HistoryService` stamps `metadata.chronology` with `seq` starting at 1 and incrementing by 1 per item | `HistoryService.chronology.test.ts` |
| AC2 | `seq` is never reused: after `clear()`, the next added item's `seq` continues from the previous maximum | `HistoryService.chronology.test.ts` |
| AC3 | `userTurn` increments only on `human` items; the following `ai`/`tool` items share that `userTurn` | `HistoryService.chronology.test.ts` |
| AC4 | `step` is 1 for the human item of a turn and increments across the ai/tool round-trips of that turn, then resets on the next human item | `HistoryService.chronology.test.ts` |
| AC5 | `recordedAt` is populated with the insertion time on every item | `HistoryService.chronology.test.ts` |
| AC6 | Content already carrying a marker is re-added unchanged (marker preserved, not renumbered) | `historyChronology.test.ts` |
| AC7 | After preserving a marker, subsequently added fresh content gets a `seq` greater than every preserved `seq` (no collision) | `historyChronology.test.ts` |
| AC8 | INV-1: every item has a marker after `validateAndFix()` inserts synthetic tool messages | `HistoryService.chronology.test.ts` |
| AC9 | INV-1: every item has a marker after `applyDensityResult()`, and a density replacement inherits the replaced item's `seq`/`userTurn`/`step` | `HistoryService.chronology.test.ts` |
| AC10 | INV-1: every item has a marker after `summarizeOldHistory()`, with retained items keeping their original `seq` | `HistoryService.chronology.test.ts` |
| AC11 | `replaceToolResponseBlock()` preserves the entry's chronology marker | `HistoryService.chronology.test.ts` |
| AC12 | A compression result that destroys items annotates the summary entry with `chronologyReplaced: { fromSeq, toSeq, itemCount }` covering exactly the destroyed `seq` values | `historyChronology.test.ts` |
| AC13 | A compression result that destroys nothing leaves the summary entry without `chronologyReplaced` | `historyChronology.test.ts` |
| AC14 | A compression result with no summary entry (truncation-only) is returned unchanged | `historyChronology.test.ts` |
| AC15 | `CompressionHandler` write-back annotates the summary entry and preserves retained items' markers end-to-end | `CompressionHandler.chronology.test.ts` (agents) |
| AC16 | C1: OpenAI chat wire messages built from chronology-bearing history contain no chronology data | `chronologyProviderIsolation.test.ts` (providers) |
| AC17 | C1: OpenAI Responses wire input (both `buildResponsesInputFromContent` and legacy `buildResponsesRequest`) contains no chronology data | `chronologyProviderIsolation.test.ts` (providers) |
| AC18 | C1: Anthropic wire messages contain no chronology data | `chronologyProviderIsolation.test.ts` (providers) |
| AC19 | C1: Gemini wire contents contain no chronology data | `chronologyProviderIsolation.test.ts` (providers) |
| AC20 | C1: Vercel wire messages contain no chronology data | `chronologyProviderIsolation.test.ts` (providers) |
| AC21 | C1: `ContentConverters.toGeminiContent` output contains no chronology data | `ContentConverters.test.ts` (core, extend) |
| AC22 | C1: `buildProviderDumpBody` output for openai/anthropic/gemini contains no chronology data (it delegates to the real wire converters) | `chronologyProviderIsolation.test.ts` (providers) |
| AC23 | C3: token estimate for a chronology-bearing item equals the estimate for the same item without a marker, on all three fallback estimators | `historyTokenEstimation.test.ts` (core), `compressionBudgeting` + `clientHelpers` tests (agents) |
| AC24 | C3: `findCompressSplitPoint` returns the same split index for history with and without chronology markers | `clientHelpers` test (agents) |
| AC25 | `getChronologyTrace()` returns one ordered entry per history item with the marker fields and structural descriptors, and no message text, tool parameters or tool results | `HistoryService.chronology.test.ts` |
| AC26 | `/dumpcontext now` writes the chronology trace at the top level of the dump file and **not** inside `request.body` | `dumpcontextCommand` test (cli) + `dumpContext` test (providers) |

## 6. Bounded vertical slices

| Slice | Content | ACs |
|---|---|---|
| S1 | `ChronologyMarker`/`ChronologyReplacedSpan` types + `ChronologyStamper` + `annotateCompressionSpan` + `buildChronologyTrace` (pure module, core) | AC6, AC7, AC12, AC13, AC14 |
| S2 | `HistoryService` integration across all five mutation paths + `getChronologyTrace()` + debug logging | AC1–AC5, AC8–AC11, AC25 |
| S3 | C3 token-accounting isolation: `serializeWireContentForEstimate` + its three call sites | AC23, AC24 |
| S4 | `CompressionHandler` span annotation at write-back | AC15 |
| S5 | C1 provider isolation regression guard across all seven converters | AC16–AC22 |
| S6 | `/dumpcontext now` sidecar | AC26 |
| S7 | Docs (`docs/debug-logging.md` + `docs/troubleshooting.md` pointer) | — |

Ordering note: **S3 and S5 must land in the same commit as S1/S2 or earlier in
the branch than any release**, because S1/S2 alone introduce the C1 and C3
exposure that S5 and S3 respectively guard against.

## 7. Expected paths

Production:

- `packages/core/src/services/history/IContent.ts` (types)
- `packages/core/src/services/history/historyChronology.ts` (new)
- `packages/core/src/services/history/HistoryService.ts` (integration)
- `packages/core/src/services/history/densityValidation.ts` (inherit marker on replacement)
- `packages/core/src/services/history/curationDebugLogger.ts` (log chronology)
- `packages/core/src/services/history/historyTokenEstimation.ts` (C3 helper + use)
- `packages/core/package.json` (subpath export for the new module — no dependency change)
- `packages/agents/src/core/clientHelpers.ts` (C3)
- `packages/agents/src/compression/compressionBudgeting.ts` (C3)
- `packages/agents/src/compression/CompressionHandler.ts` (span annotation)
- `packages/providers/src/utils/dumpContext.ts` (optional sidecar field)
- `packages/cli/src/ui/commands/dumpcontextCommand.ts` (supply the sidecar)
- `docs/debug-logging.md`

Tests:

- `packages/core/src/services/history/historyChronology.test.ts` (new)
- `packages/core/src/services/history/HistoryService.chronology.test.ts` (new)
- `packages/core/src/services/history/historyTokenEstimation.test.ts` (new or extend)
- `packages/core/src/services/history/ContentConverters.test.ts` (extend)
- `packages/agents/src/compression/__tests__/CompressionHandler.chronology.test.ts` (new)
- `packages/agents/src/compression/__tests__/chronologyTokenNeutrality.test.ts` (new)
- `packages/providers/src/utils/chronologyProviderIsolation.test.ts` (new)
- `packages/providers/src/utils/dumpContext.test.ts` (extend)
- `packages/cli/src/ui/commands/dumpcontextCommand.test.ts` (extend)

Plan artefacts:

- `project-plans/20260731-issue1721/PLAN.md`
- `project-plans/20260731-issue1721/RESEARCH.md`

## 8. Scope ledger

| Metric | Budget | Planned |
|---|---|---|
| Files touched | ≤ 25 (review > 25, stop > 40) | ~24 |
| Net changed lines | ≤ 1500 (review > 1500, stop > 2500) | ~1200 |
| New public abstractions | approval required | `ChronologyMarker`, `ChronologyReplacedSpan`, `ChronologyStamper`, `annotateCompressionSpan`, `buildChronologyTrace`, `ChronologyTraceEntry`, `getChronologyTrace`, `serializeWireContentForEstimate` — all required by the accepted behaviour and declared here up front |
| New dependencies | none | none |
| Workflow / agent-memory / quality-tool changes | none | none |

Stop-for-approval triggers (restated for implementers):

- adding a subsystem or public abstraction not listed above
- any workflow, agent-memory, quality-tool or dependency change
- pulling an unrelated refactor or test move into scope
- implementing behaviour outside the acceptance matrix
- exceeding 40 files or 2500 net changed lines

## 9. Hard engineering constraints for implementers

- TDD: each AC gets a failing behavioural test first. No mock theatre; no
  mocking the component under test; no asserting that mocks were called.
- No `any`, no non-null assertions in new code; `unknown` + type guards.
- No new `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`.
- No loosening of any lint/complexity/size threshold and no ESLint severity
  downgrades. Fix the underlying issue instead.
- Immutability: never mutate an input `IContent`; return copies.
- Fail fast over defence in depth: do not wrap chronology logic in try/catch
  swallows or add speculative guards for internally-controlled data.
- Full verification before hand-back: `npm run test`, `npm run lint`,
  `npm run typecheck`, `npm run format`, `npm run build`, and the CLI smoke.
