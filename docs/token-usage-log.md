# Token Usage Log

LLxprt Code writes a per-session JSONL file that records token usage for every
turn and significant lifecycle event. You can use this file to analyze token
consumption, audit cost, and correlate spending with specific conversation
turns.

## Where the file lives

```text
<projectTempDir>/token-usage/<sessionId>.jsonl
```

The `<projectTempDir>` is the `.llxprt/tmp` directory for the current project
(see [Application Directories](./reference/application-directories.md)). The
`<sessionId>` is the unique session identifier (for example
`a1b2c3d4-e5f6-...`). Each line in the file is a self-contained JSON object.

### Levels

The `token-usage-log` setting chooses how much each record holds.

| Property         | Value                          |
| ---------------- | ------------------------------ |
| **Scope**        | Per-profile or global settings |
| **Persistence**  | Persists to `settings.json`    |
| **Default**      | `summary`                      |
| **Valid values** | `off`, `summary`, `debug`      |

- `off` writes nothing. No file is created, and the work done only for this
  log is skipped: the request-shape split, the fingerprint, reading the system
  instruction, and the stream timing tracker with its raw token-delta sink.
- `summary` (the default) writes one line of scalar fields per model request:
  identity and lineage, provider and model, provider-reported usage, the
  estimate, timing, the fixed per-request overhead, and new versus carried
  tool-result totals. It contains no arrays. See
  [Summary fields](#summary-fields).
- `debug` writes everything `summary` writes plus the tool-result attribution
  array, the per-component prompt split, the prefix fingerprint and the
  estimator internals. See [Debug-only fields](#debug-only-fields).

Lifecycle records (compression, provider and model switches) are written at
both `summary` and `debug`.

The setting used to be a boolean. `true` and `false` are still accepted, in
settings files, profiles and `/set token-usage-log`, and mean `summary` and
`off`. Any other value is rejected with an error that lists the valid levels.

To turn logging off, add the following to your
[user settings](./reference/application-directories.md) or workspace
`.llxprt/settings.json`:

```json
{
  "token-usage-log": "off"
}
```

`/set token-usage-log debug` (or `off`) changes the level for the rest of the
run. The level is read again at the start of every model request, so an
existing chat switches from its next request. A request already in flight
finishes at the level it started with. Lifecycle records written between two
requests follow the level of the last request.

Switching to `off` and back loses nothing the log already holds, but the log
does not see the requests sent while it was off. The first request after
logging comes back on therefore cannot tell new tool results from carried ones
and omits `new_tool_result_count`, `new_tool_result_tokens`,
`carried_tool_result_tokens` and, at `debug`, `tool_calls`; its
`prefix_fingerprint_changed` is `null`. Every later request has the split
again. Switching between `summary` and `debug` keeps the split intact; the
first `debug` request after `summary` has `prefix_fingerprint_changed: null`,
because `summary` does not compute the fingerprint.

### Retention

The session janitor that cleans up chat recordings also cleans up token-usage
files, at every level:

- **Age.** A token-usage file older than `sessionRetention.maxAge` is deleted,
  the same age policy that applies to chat recordings. There is no default age
  limit.
- **Size.** When the token-usage files of all projects together exceed
  `sessionRetention.tokenUsageMaxTotalSizeMB` (default `1024`), the oldest files
  are deleted first until the total is under the budget. This budget is
  separate from the 4 GiB `sessionRetention.maxTotalSizeMB` budget for chat
  recordings.
- **Active sessions are never touched.** A subagent's file is named
  `<root session>::<child runtime>.jsonl` and belongs to its root session. A
  file is kept when its root session is the running session, when that session
  holds a live lock in the project's `chats/` directory, or when the file was
  written within `sessionRetention.minRetention` (default `1d`). Each deletion
  takes the root session's lock first, the same way chat recordings are
  reclaimed, and skips the file when the lock is held. Under the lock the file
  must still be the one that was scanned (same inode, size and modification
  time), so a session that starts, appends or recreates its log after the scan
  keeps it.
- `token-usage/` directories are kept even when empty. A starting session
  creates the directory and then appends to it without taking a lock, so
  removing an empty directory could make that session's writes fail.
- `sessionRetention.enabled: false` turns this cleanup off along with the rest
  of the janitor.

## Record types

Every record carries a `record_type` discriminator and a `schema_version`.
Records written before schema versioning (no `schema_version` and no
`record_type`) are read back as version `0` turn records, so existing files
remain readable.

| `record_type`        | Purpose                                                  |
| -------------------- | -------------------------------------------------------- |
| `turn`               | One billed API request within a conversation turn        |
| `compression`        | A context-compression event that reduced the token count |
| `provider_switch`    | A different provider began serving the session           |
| `model_switch`       | A different model began serving the session              |
| `session_resume`     | Reserved for session resume events                       |
| `context_truncation` | Reserved for context truncation events                   |

> **Note:** `session_resume` and `context_truncation` are defined in the schema
> and their serialization is fully tested, but they are not emitted from
> production code. See [Lifecycle records](#lifecycle-records) for why.

## Turn record fields

Each `turn` record captures the token economics of a single billed API request.
Which fields appear depends on the level. Levels add or omit fields; they never
rename one, and `schema_version` stays `1` at both levels.

### Summary fields

A `summary` record holds only these fields, all scalar. A field the provider
did not report, or a value that was not measured, is omitted rather than
written as zero.

| Group             | Fields                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Record            | `record_type`, `schema_version`                                                                                                        |
| Identity, lineage | `ts`, `session_id`, `turn_id`, `runtime_id`, `parent_runtime_id`, `subagent_name`, `prompt_id`, `attempt_index`, `attempt_outcome`     |
| Attempt end       | `finish_reason`, `raw_stop_reason` (only when reported; kept for #4036 refusal accounting)                                             |
| Model             | `provider`, `model`, `protocol`                                                                                                        |
| Usage             | `actual_prompt_tokens`, `cached_tokens`, `cache_write_tokens`, `output_tokens`, `reasoning_tokens` (only when the provider reports it) |
| Estimate          | `estimated_tokens`, `estimator_family`, `stateful_parent_used`                                                                         |
| Timing            | `ttft_ms`, `provider_request_ms`, `generation_ms`, `timing_source`                                                                     |
| Fixed overhead    | `fixed_tokens`                                                                                                                         |
| Tool results      | `new_tool_result_count`, `new_tool_result_tokens`, `carried_tool_result_tokens`                                                        |

A summary record is about 1 KB for a subagent request, most of it the field
names and the composite session, runtime and prompt identifiers. Timing fields
are written in whole milliseconds at both levels.

### Debug-only fields

A `debug` record holds every summary field and adds:

- `tool_calls`, listing only the tool results that are new in this request.
  Results carried over from earlier requests are counted in
  `carried_tool_result_tokens` and are not listed again.
- The per-component prompt split: `instructions_tokens`, `tools_schema_tokens`,
  `history_tokens`, `media_tokens`, `injected_tokens`.
- The prefix fingerprint: `prefix_fingerprint`, `prefix_fingerprint_changed`.
- Estimator internals: `estimator`, `estimator_method`, `estimator_version`,
  `asset_revision`, `projection_revision`, `tiktoken_tokens`,
  `tiktoken_estimation_failed`.
- Envelope detail: `transmitted_prompt_tokens`, `incremental_prompt_tokens`,
  `retained_context_tokens`, `effective_provider_context_tokens`,
  `chunk_count`.
- The remaining detail fields described below that the summary does not list:
  `effective_actual_tokens`, `user_turn`, `step`, `cache_read_tokens`,
  `tool_tokens`, `total_tokens`, `retry_reason`, `http_status`,
  `backend_profile`.

### Timing and aggregates

| Field                   | Type   | Description                                                                                                                                                |
| ----------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ttft_ms`               | number | Whole milliseconds from the start of the provider stream to the first token. Omitted when no token arrived.                                                |
| `provider_request_ms`   | number | Whole milliseconds the provider stream ran for this attempt.                                                                                               |
| `generation_ms`         | number | Whole milliseconds from the first token to the last; `ttft_ms + generation_ms` never exceeds `provider_request_ms`. Omitted when not measured.             |
| `timing_source`         | string | `raw` when raw provider token deltas set the token window, `visible` when it was measured from visible output chunks. Omitted when no token window exists. |
| `fixed_tokens`          | number | `instructions_tokens + tools_schema_tokens`: the overhead every request in the session pays before any conversation.                                       |
| `new_tool_result_count` | number | How many tool results enter the prompt for the first time on this request.                                                                                 |

The detailed tables below describe the individual fields.

### Identity and join keys

These fields let you connect a token-usage record to the corresponding turn in
the conversation log.

| Field               | Type           | Description                                                                                                                                                                                               |
| ------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt_id`         | string         | Unique identifier for the prompt that initiated this turn. Joins to `metadata.promptId` on the recorded conversation content.                                                                             |
| `session_id`        | string         | The session identifier. Matches the filename.                                                                                                                                                             |
| `turn_id`           | string \| null | Stable identifier for the turn this request served. Minted before the request is sent and stamped on the persisted turn, so the two always agree.                                                         |
| `user_turn`         | number \| null | User-turn index of the conversation state this request was built from — the newest turn already in history, **not** the turn being sent. `null` on the first request of a session. See the caution below. |
| `step`              | number \| null | Step index within that same prior user turn. Same caveat as `user_turn`.                                                                                                                                  |
| `runtime_id`        | string         | The runtime identifier for the agent that served this request.                                                                                                                                            |
| `parent_runtime_id` | string \| null | The parent runtime's identifier for subagent requests; `null` for the main agent.                                                                                                                         |
| `subagent_name`     | string \| null | The subagent name; `null` for the main agent.                                                                                                                                                             |

### Estimator and calibration

The 13 fields below, together with `ts`, `prompt_id`, `provider` and `model`
from the identity section above, are the original 17 token-estimation columns.
Their names and meanings are stable and will not change.

| Field                        | Type           | Description                                                                                   |
| ---------------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| `estimated_tokens`           | number         | The pre-send token estimate from the configured estimator.                                    |
| `estimator`                  | string         | Which estimator was used (`openai-tiktoken`, `anthropic-char`, `core-fallback`).              |
| `estimator_method`           | string         | Estimation method (`exact` or `calibrated`). Omitted when not applicable.                     |
| `estimator_family`           | string         | Model family the estimator is calibrated for. Omitted when not applicable.                    |
| `estimator_version`          | string         | Estimator asset version. Omitted when not applicable.                                         |
| `asset_revision`             | string         | Calibration asset revision. Omitted when not applicable.                                      |
| `projection_revision`        | number         | Projection revision number. Omitted when not applicable.                                      |
| `protocol`                   | string         | Provider protocol (for example `openai-chat`). Omitted when not applicable.                   |
| `tiktoken_tokens`            | number \| null | The tiktoken-based token count measured at send time. `null` when tiktoken was not available. |
| `tiktoken_estimation_failed` | boolean        | Whether the tiktoken measurement failed.                                                      |
| `actual_prompt_tokens`       | number         | The actual prompt token count reported by the provider.                                       |
| `cached_tokens`              | number         | The cached token count reported by the provider (legacy name, retained for compatibility).    |
| `effective_actual_tokens`    | number         | `actual_prompt_tokens - cached_tokens`, clamped to a minimum of 0.                            |

### Cost

These fields are present only when the provider reports them. Fields the
provider does not report are omitted — zero and "not reported" are
distinguishable.

| Field                | Type   | Description                                                |
| -------------------- | ------ | ---------------------------------------------------------- |
| `output_tokens`      | number | Output (completion) tokens billed.                         |
| `reasoning_tokens`   | number | Reasoning/thinking tokens billed.                          |
| `cache_write_tokens` | number | Tokens written to the provider cache on this request.      |
| `cache_read_tokens`  | number | Tokens read from the provider cache on this request.       |
| `tool_tokens`        | number | Tool-related tokens billed by the provider.                |
| `total_tokens`       | number | Total tokens for this request as reported by the provider. |

### Attempt

A single logical turn can produce multiple billed attempts (retries). Each
attempt gets its own record.

| Field             | Type   | Description                                                                          |
| ----------------- | ------ | ------------------------------------------------------------------------------------ |
| `attempt_index`   | number | 0-based index within the logical turn.                                               |
| `attempt_outcome` | string | `success`, `error`, `aborted`, or `abandoned`.                                       |
| `retry_reason`    | string | Why a retry was triggered, when known. Omitted when not applicable.                  |
| `http_status`     | number | HTTP status code from the response, when available. Omitted when not applicable.     |
| `backend_profile` | string | The load-balancer sub-profile that served this request. Omitted when not applicable. |

### Tool attribution

These fields attribute token cost to tool results present in the request.

| Field                        | Type   | Description                                                                                                                                                                                  |
| ---------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool_calls`                 | array  | Debug only. One entry per tool result that is new in this request: `{ call_id, tool_name, result_tokens, was_truncated }`. Only identifiers and counts — never the result body or arguments. |
| `new_tool_result_tokens`     | number | Total tokens from tool results entering the prompt for the first time on this send.                                                                                                          |
| `carried_tool_result_tokens` | number | Total tokens from tool results already present in a previous send.                                                                                                                           |

### Request shape

These fields describe the composition of the request prefix, measured at the
agents-layer send seam.

These are real token counts, produced by the same tiktoken-based estimator the
rest of the codebase uses — not character approximations. Each content is
tokenized once per session rather than once per request: measurements are cached
by the stable content id, falling back to the tool `call_id` for tool results
(whose content id the history pipeline does not preserve). A tool result carried
across sixty turns is therefore measured once, not sixty times.

Two caveats worth knowing:

- They are **local estimates, not provider billing**. Use `actual_prompt_tokens`
  for what you were actually charged; the buckets exist to apportion it.
- They will not sum exactly to `actual_prompt_tokens`, because providers add
  their own wire framing and because the estimator is not the provider's
  tokenizer. Treat the split as attribution, not reconciliation.

| Field                        | Type            | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instructions_tokens`        | number          | Token count of the system instruction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `tools_schema_tokens`        | number          | Token count of the tool schemas.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `history_tokens`             | number          | Token count of the conversation history, including tool calls and tool results (which are conversation, not injections). Excludes media and injected content.                                                                                                                                                                                                                                                                                                                                                                                      |
| `media_tokens`               | number          | Token count of media blocks (images, audio).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `injected_tokens`            | number          | Token count of genuinely injected content — synthetic content that carries no tool or media blocks. Note that `metadata.synthetic` alone is not the test: the provider pipeline stamps it on tool turns it merely re-ordered, so buckets are decided structurally first (media, then tool, then synthetic).                                                                                                                                                                                                                                        |
| `prefix_fingerprint`         | string          | First 16 hex characters of the SHA-256 of a stable serialization of the request prefix: the instructions and tool schemas in full, then the leading history identified by content id. Bounded on purpose — the prefix is the part a provider can cache, so a change there breaks the cache while a change at the tail cannot. Detects the changes that defeat caching (edited instructions, changed tool schemas, a head rewritten by compression, reordered or dropped turns). See the privacy section for what this does and does not guarantee. |
| `prefix_fingerprint_changed` | boolean \| null | Whether the fingerprint differs from the previous send in the same session. `null` on the first send.                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Lifecycle records

Beyond `turn` records, the log carries typed lifecycle records that mark
discontinuities in the token burn curve. Each carries `session_id` and, when
known, `turn_id`.

### Compression

Emitted once per completed compression. Without this record, a compression
appears as an unexplained drop in the token count.

| Field                       | Type            | Description                                                                                                                                           |
| --------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record_type`               | `"compression"` | Discriminator.                                                                                                                                        |
| `schema_version`            | number          | Schema version.                                                                                                                                       |
| `ts`                        | string          | ISO timestamp.                                                                                                                                        |
| `session_id`                | string          | Session identifier.                                                                                                                                   |
| `turn_id`                   | string \| null  | Turn identifier at compression time, when known.                                                                                                      |
| `tokens_before`             | number          | Total token count before compression.                                                                                                                 |
| `tokens_after`              | number          | Total token count after compression.                                                                                                                  |
| `compression_model`         | string \| null  | The model that served the compression.                                                                                                                |
| `compression_provider`      | string \| null  | The provider that served the compression.                                                                                                             |
| `compression_prompt_tokens` | number          | Prompt tokens of this compression's own LLM call, as the strategy reported them. Omitted when no LLM call was made or the provider reported no usage. |
| `compression_output_tokens` | number          | Output tokens of this compression's own LLM call. Omitted under the same conditions.                                                                  |
| `compression_strategy`      | string          | The strategy that produced the applied result (`middle-out`, `one-shot`, `high-density`, `top-down-truncation`).                                      |
| `llm_call_made`             | boolean         | Whether that strategy called a model.                                                                                                                 |
| `compression_attempts`      | number          | Strategy runs this compression took, counting retries and fallbacks.                                                                                  |

Usage comes from the result of the strategy that ran. It is never read from a
summary entry in history: from the second compression on, a strategy can keep
an earlier summary at the head of history, and that entry still carries the
earlier call's usage.

### Provider switch and model switch

A switch is recorded by **observing which provider and model actually served
each request**, not by watching the settings mutation that requested the change.
The settings layer that initiates a switch has no path to the per-session
logger, and observation at the send seam records the change that actually
affected billing — which is the question this log exists to answer.

A provider change is written as `provider_switch` (it necessarily carries a
model change too); a model change under the same provider is written as
`model_switch`. Each switch is written once, not once per subsequent request,
and the first request of a session is never a switch.

| Field                           | Meaning                                   |
| ------------------------------- | ----------------------------------------- |
| `from_provider` / `to_provider` | Provider before and after the switch      |
| `from_model` / `to_model`       | Model before and after the switch         |
| `provider`                      | On `model_switch`, the unchanged provider |

### Session resume and context truncation

These record types are defined in the schema and their serialization and
round-trip parsing are fully tested, but they are **not currently emitted** from
production code:

- **`session_resume`**: Session resume flows through the session-control layer,
  which restores history without touching the token-usage logger. Reaching the
  logger would require threading it through the client contract across package
  boundaries.

- **`context_truncation`**: In LLxprt Code, context truncation is performed by
  the compression pipeline (the `top-down-truncation` fallback strategy). It is
  already captured by the `compression` record. Emitting a separate
  `context_truncation` record would duplicate the same event.

When these records are wired in the future, their schemas will not change.

## Joining to conversation turns

The token-usage log and the conversation log live in the same project temp
directory but in different subdirectories:

```text
<projectTempDir>/token-usage/<sessionId>.jsonl   ← token usage
<projectTempDir>/chats/session-<timestamp>-<prefix>.jsonl  ← conversation
```

The conversation filename embeds only the first 12 characters of the session id,
so to go from a token-usage record to its recording: match that prefix against
`session_id`, then confirm the file's `session_start` record has
`payload.sessionId` equal to the full `session_id`.

### Join keys

| Token-usage field | Conversation content field                                           | Meaning                                      |
| ----------------- | -------------------------------------------------------------------- | -------------------------------------------- |
| `prompt_id`       | `metadata.promptId`                                                  | Links a billed request to the turn it served |
| `turn_id`         | `metadata.turnId`                                                    | Links to the stable turn identifier          |
| `session_id`      | filename prefix, confirmed against `session_start.payload.sessionId` | Scopes both streams to one session           |

> **Caution:** join on `prompt_id` or `turn_id`. Do **not** join on
> `user_turn`/`step`. The token-usage record is written before the turn it
> describes reaches history, so those two fields describe the conversation
> state the request was _built from_ — the preceding turn — rather than the
> turn being billed. They are useful for ordering and for seeing how much
> conversation preceded a request; they are not a turn identity.

### Worked example

Suppose the token-usage file contains:

```json
{"record_type":"turn","prompt_id":"p-abc123","session_id":"sess-001","turn_id":"t-42","user_turn":3,"step":1,"estimated_tokens":1200,"actual_prompt_tokens":1150,...}
```

To find the corresponding turn in the conversation log:

1. Open the `session-*.jsonl` file in `<projectTempDir>/chats/` for session
   `sess-001`.
2. Search for a content entry where `metadata.promptId === "p-abc123"`.
3. Alternatively, search for a content entry where
   `metadata.turnId === "t-42"`. Both keys resolve to the same turn.

To go the other direction — from a conversation turn to its cost:

1. Read the `metadata.promptId` from the conversation content entry.
2. Search the token-usage file for the matching `prompt_id`.

## Schema versioning

| `schema_version` | Description                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`              | Pre-versioning records. No `schema_version` or `record_type` field was written. The reader normalizes these to `schema_version: 0`, `record_type: "turn"`. |
| `1`              | Current schema. Every record carries `schema_version: 1` and a `record_type` discriminator.                                                                |

The tolerant reader (`parseTokenUsageLogRecord`) accepts records with or without
versioning. A record with neither `schema_version` nor `record_type` is treated
as a version-0 turn record. This ensures existing log files remain readable
after an upgrade.

## Privacy posture

The token-usage log contains **counts, identifiers, and hashes only**. It
explicitly does **not** contain:

- Prompt text or user messages
- Model output or AI responses
- Tool arguments or parameters
- Tool result bodies

The `prefix_fingerprint` field is the first 16 hex characters of the SHA-256 of
a stable serialization of the system instruction, tool schemas and conversation
history. It exists solely to detect when the request prefix changes between
sends.

It stores no prompt content, and SHA-256 is not invertible. It is **not** a
confidentiality guarantee: anyone who can guess a candidate prefix can hash it
and compare, so a low-entropy or already-known prefix can be confirmed. Treat a
fingerprint as an equality token for prefixes you already hold, not as a secret
about prefixes you do not. Truncation to 64 bits also makes collisions possible
in a large enough corpus.

### Fields deliberately not populated

| Field              | Reason                                                                                                                                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt_cache_key` | Declared in the schema but **never written** today. The key is derived and sanitized inside the provider executors, below the seam that writes this log, so a value produced here could differ from the one actually sent. Recording the real key means surfacing it from the transport layer. |

## Future work

Consuming surfaces — such as a `/stats burn` CLI view or an offline
cross-session analysis script — are planned as separate work. This document
covers the data format and the join model that those surfaces will build on.
