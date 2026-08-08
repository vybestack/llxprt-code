# Issue #3130 — Conversation-aligned, cost-complete token-usage telemetry

## 1. Accepted behavior (shaped from the issue's acceptance criteria)

The per-session token-usage JSONL at `<projectTempDir>/token-usage/<sessionId>.jsonl`
must become **joinable to the conversation** and **sufficient to compute cost**.

### AC-1 — Join keys on every turn record

Every token-usage turn record carries:

| Field | Source of truth |
| --- | --- |
| `session_id` | `AgentRuntimeContext.state.sessionId` (explicit, not parsed from `prompt_id`) |
| `turn_id` | `ContentMetadata.turnId` of the turn being sent |
| `user_turn` | `ChronologyMarker.userTurn` of the latest history item at send time |
| `step` | `ChronologyMarker.step` of the latest history item at send time |
| `runtime_id` | `AgentRuntimeContext.state.runtimeId` |
| `parent_runtime_id` | Parent runtime's `runtimeId`; `null` for the main agent |
| `subagent_name` | Subagent name; `null` for the main agent |

Boundary cases: history empty at send time (no chronology yet) → `user_turn`/`step`/`turn_id`
are `null`, never invented, never `0`-as-unknown. Logger disabled → nothing written.

### AC-2 — Reciprocal join key on recorded content

`ContentMetadata` gains `promptId`. It is stamped on the content persisted for a turn so a
recording entry locates its cost, and a token-usage record locates its turn.

Boundary cases: content created outside a prompt (synthetic, resumed, compression summary)
has no `promptId` and the field is absent (not `null`, not empty string).

### AC-3 — Cost completion

Turn records carry, when the provider reports them:
`output_tokens`, `reasoning_tokens`, `cache_write_tokens`, `cache_read_tokens`,
`tool_tokens`, `total_tokens`.

- `cache_read_tokens` is the clarified name; the legacy `cached_tokens` **remains emitted
  unchanged** so existing calibration consumers (#2254) do not regress.
- `cache_write_tokens` maps from `cacheCreationTokens` / `cache_creation_input_tokens`.
- Fields the provider does not report are **omitted**, not zero-filled — zero and
  "not reported" must remain distinguishable for retrospective analysis.

### AC-4 — Attempt-level truth

Turn records carry `attempt_index` (0-based within the logical turn), `attempt_outcome`
(`success` | `error` | `aborted` | `abandoned`), and, when known, `retry_reason`,
`http_status`, `backend_profile`.

Boundary cases: a turn with no retry records `attempt_index: 0`, `attempt_outcome: 'success'`.
An abandoned/discarded attempt (#3048) is recorded as its own record with
`attempt_outcome: 'abandoned'` and does **not** overwrite the successful attempt.

### AC-5 — Tool-call attribution

Turn records carry `tool_calls: Array<{ call_id, tool_name, result_tokens, was_truncated }>`
for tool results present in this request, plus `new_tool_result_tokens` and
`carried_tool_result_tokens`.

"New" = the tool result entered the prompt for the first time on this send within this
session. "Carried" = it was already present in a previous send. Only counts and identifiers
are recorded — never the tool result body or arguments.

### AC-6 — Request-shape provenance

Turn records carry `instructions_tokens`, `tools_schema_tokens`, `history_tokens`,
`media_tokens`, `injected_tokens`, `prompt_cache_key`, `prefix_fingerprint`, and
`prefix_fingerprint_changed`.

Buckets are measured at the agents-layer send seam from the neutral request
(system instruction + tool schemas + history contents) using the runtime's configured
estimator. `prompt_cache_key` is recorded only where the provider actually sends one
(OpenAI family today); otherwise the field is omitted. `prefix_fingerprint` is a hash of a
stable serialization of the request prefix; `prefix_fingerprint_changed` compares against
the previous send in the same session and is `null` on the first send.

### AC-7 — Lifecycle events in the same stream

Records are discriminated by `record_type`. Beyond `turn`, the stream carries typed
`compression`, `provider_switch`, `model_switch`, `session_resume`, and
`context_truncation` records, each with `session_id` and (when known) `turn_id`.
`compression` records tokens before, tokens after, the model that served the compression,
and the token cost of the compression call itself.

### AC-8 — Subagent attribution

A subagent's turn records carry its own `runtime_id`, its invoking `parent_runtime_id`, and
its `subagent_name`, so subagent burn rolls up to the caller.

### AC-9 — Schema version and backward compatibility

Every newly written record carries `schema_version`. The reader accepts pre-existing
records that have no `schema_version` and no `record_type` (treated as version `0`,
`record_type: 'turn'`). No existing corpus becomes unreadable.

### AC-10 — Privacy posture unchanged

No prompt text, no tool arguments, no tool result bodies. Counts, identifiers, hashes, and
metadata only. Enforced by an explicit regression test.

### AC-11 — Estimator fields preserved

`estimated_tokens`, `estimator`, `estimator_method`, `estimator_family`,
`estimator_version`, `asset_revision`, `projection_revision`, `protocol`,
`tiktoken_tokens`, `tiktoken_estimation_failed`, `actual_prompt_tokens`, `cached_tokens`,
`effective_actual_tokens` keep their exact names, meanings, and values.

### AC-12 — Behavioral tests

Behavioral coverage per `dev-docs/RULES.md` for: the bidirectional join, a retry turn, a
compression turn, a subagent turn, and a cached turn.

### AC-13 — Documentation

The record schema, the join, and the privacy posture are documented.

## 2. Explicitly OUT of scope

Design section 8 of the issue ("Analysis surface") proposes a `/stats burn` CLI view and an
offline cross-session analysis script. **Neither appears in the issue's acceptance
criteria.** They are not implemented here. This PR delivers the data and its documented
schema; consuming surfaces are separate work.

Also out of scope: changing any provider's usage extraction to report fields it does not
already report, and adding per-component buckets to the provider-implemented
`projectPromptEnvelope` contract (buckets are measured agents-side instead).

## 3. Design

### 3.1 Record model

New module `packages/agents/src/core/tokenUsageRecords.ts`:

- `TOKEN_USAGE_SCHEMA_VERSION = 1`
- `SerializedTokenUsageTurnRecord` — the existing 17 fields, unchanged, plus
  `schema_version`, `record_type: 'turn'`, and the AC-1/3/4/5/6 additions.
- `SerializedTokenUsageLifecycleRecord` — discriminated union over
  `compression | provider_switch | model_switch | session_resume | context_truncation`.
- `SerializedTokenUsageLogRecord` = turn | lifecycle.
- `parseTokenUsageLogRecord(unknown): SerializedTokenUsageLogRecord | null` — tolerant
  reader that normalizes legacy records (absent `schema_version` → `0`, absent
  `record_type` → `'turn'`).

Zod is the repo's schema-first tool; the reader is Zod-based.

### 3.2 Turn context

New value object `TokenUsageTurnContext` carrying the join keys, request-shape buckets,
tool attribution, and cache key. It is captured **once per send attempt** at the send seam
and attached to the pending estimate, so the actual-usage completion writes a single
complete record.

`TokenUsageLogger` gains:
- `attachTurnContext(promptId, context)` — merges context into the pending estimate.
- `recordActual(promptId, actual)` — `actual` widened with the cost + attempt fields.
- `recordLifecycleEvent(event)` — writes a typed lifecycle record immediately.

Existing `recordEstimate` / `refineEstimate` signatures stay source-compatible.

### 3.3 Join-key sourcing

- `HistoryService` gains `getCurrentTurnMarker(): { turnId, userTurn, step, seq } | null`,
  derived from the newest history item carrying a chronology marker. This is a read-only
  accessor over existing state — no new stamping.
- `ContentMetadata.promptId?: string` added in core; stamped where `turnId` is already
  stamped for the AI turn.
- `AgentRuntimeState` gains optional `parentRuntimeId` and `subagentName`, populated when a
  subagent runtime is constructed from a parent runtime.

### 3.4 Request-shape measurement

New module `packages/agents/src/core/tokenUsageRequestShape.ts`:

- Input: system instruction, tool schemas, request contents, and a token-count function.
- Output: the five buckets, the tool attribution array, the new/carried split, and the
  prefix fingerprint.
- Media blocks are counted into `media_tokens`; synthetic/injected contents
  (`metadata.synthetic === true`) into `injected_tokens`; everything else into
  `history_tokens`.
- The new/carried split needs per-session memory of previously-sent tool `call_id`s. That
  memory lives on the logger instance (already per session) and is bounded.

### 3.5 Attempt sourcing

`attempt_index` and `attempt_outcome` come from the existing attempt loop in
`TurnProcessor._createStreamGenerator` and the retry wrapper in `StreamProcessor`. No new
retry machinery is introduced; the existing counters are threaded to the logger.
`backend_profile` comes from the load-balancer sub-profile already selected per request.

## 4. Test-first plan

RED tests are written before each implementation slice. All tests use `bun:test`, are
co-located as `*.test.ts`, and assert on **written JSONL output**, not on mock call shapes,
except where the unit under test is itself a pure adapter.

| Test file | Behavior proven |
| --- | --- |
| `tokenUsageRecords.test.ts` | Legacy record (no `schema_version`, no `record_type`) parses as v0 turn record; v1 turn and each lifecycle type round-trip; malformed record rejected |
| `TokenUsageLogger.test.ts` (extend) | `schema_version` and `record_type` on every write; turn context merged into the written record; lifecycle records written to the same file; estimator fields byte-identical to before |
| `TokenUsageLogger.integration.test.ts` (extend) | **Bidirectional join**: a written turn record's `turn_id`/`session_id` locate the turn, and the recorded content carries the matching `promptId`; **cached turn**: cache read/write tokens recorded; **retry turn**: two records, `attempt_index` 0 and 1, outcomes distinguishable |
| `tokenUsageActualLogger.test.ts` (extend) | Output/reasoning/tool/total/cache-write pass through; unreported fields omitted rather than zero-filled |
| `tokenUsageRequestShape.test.ts` | Buckets sum consistently; tool attribution lists each tool result once; new-vs-carried split flips on the second send; fingerprint stable for identical prefixes and changed otherwise |
| `tokenUsageSubagent.test.ts` | **Subagent turn**: subagent record carries own `runtime_id`, parent's `parent_runtime_id`, and `subagent_name`; main-agent record carries `null` for both |
| `tokenUsageLifecycle.test.ts` | **Compression turn**: a `compression` record with before/after/model/cost; provider switch, model switch, resume, truncation each emit their typed record |
| `tokenUsagePrivacy.test.ts` | Given prompts, tool arguments, and tool results containing known sentinel strings, no sentinel appears anywhere in the written JSONL |

## 5. Verification gate (run after every slice)

    npm run test
    npm run lint
    npm run lint:eslint-guard
    npm run typecheck
    npm run format
    npm run build
    bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"

## 6. Constraints binding every slice

- No `eslint-disable`, no `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`, no lint
  severity downgrade, no complexity/size threshold increase, no new lint ignores. Fix the
  underlying design instead.
- Fail fast over defense in depth. Telemetry writes are already fail-open at the I/O
  boundary; do not add further swallowing guards inside the computation path.
- Strict TypeScript: no `any`, no type assertions.
- No new `.js` files, no Vitest/Node test suites — `bun:test` only.
