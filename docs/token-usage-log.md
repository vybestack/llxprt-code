# Token Usage Log

LLxprt Code writes a per-session JSONL file that records token usage for every
turn and significant lifecycle event. You can use this file to analyze token
consumption, audit cost, and correlate spending with specific conversation
turns.

## Where the file lives

```
<projectTempDir>/token-usage/<sessionId>.jsonl
```

The `<projectTempDir>` is the `.llxprt/tmp` directory for the current project
(see [Application Directories](./reference/application-directories.md)). The
`<sessionId>` is the unique session identifier (for example
`a1b2c3d4-e5f6-...`). Each line in the file is a self-contained JSON object.

### Enabling and disabling

Token usage logging is controlled by the `token-usage-log` setting.

| Property         | Value                          |
| ---------------- | ------------------------------ |
| **Scope**        | Per-profile or global settings |
| **Persistence**  | Persists to `settings.json`    |
| **Default**      | `true` (enabled)               |
| **Valid values** | `true`, `false`                |

To disable logging, add the following to your
[user settings](./reference/application-directories.md) or workspace
`.llxprt/settings.json`:

```json
{
  "token-usage-log": false
}
```

When disabled, no file is created and no records are written.

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
Fields are grouped by purpose.

### Identity and join keys

These fields let you connect a token-usage record to the corresponding turn in
the conversation log.

| Field               | Type           | Description                                                                                                                   |
| ------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `prompt_id`         | string         | Unique identifier for the prompt that initiated this turn. Joins to `metadata.promptId` on the recorded conversation content. |
| `session_id`        | string         | The session identifier. Matches the filename.                                                                                 |
| `turn_id`           | string \| null | Stable identifier for the conversation turn. `null` when no chronology marker exists yet (for example, the very first send).  |
| `user_turn`         | number \| null | The user-turn index (1-based) of the latest history item at send time.                                                        |
| `step`              | number \| null | The step index within the user turn.                                                                                          |
| `runtime_id`        | string         | The runtime identifier for the agent that served this request.                                                                |
| `parent_runtime_id` | string \| null | The parent runtime's identifier for subagent requests; `null` for the main agent.                                             |
| `subagent_name`     | string \| null | The subagent name; `null` for the main agent.                                                                                 |

### Estimator and calibration

These 17 fields are the original token-estimation columns. Their names and
meanings are stable and will not change.

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

| Field                        | Type   | Description                                                                                                                                                          |
| ---------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool_calls`                 | array  | One entry per tool result in this request: `{ call_id, tool_name, result_tokens, was_truncated }`. Only identifiers and counts — never the result body or arguments. |
| `new_tool_result_tokens`     | number | Total tokens from tool results entering the prompt for the first time on this send.                                                                                  |
| `carried_tool_result_tokens` | number | Total tokens from tool results already present in a previous send.                                                                                                   |

### Request shape

These fields describe the composition of the request prefix, measured at the
agents-layer send seam.

| Field                        | Type            | Description                                                                                                                             |
| ---------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `instructions_tokens`        | number          | Token count of the system instruction.                                                                                                  |
| `tools_schema_tokens`        | number          | Token count of the tool schemas.                                                                                                        |
| `history_tokens`             | number          | Token count of the conversation history (excluding media and injected content).                                                         |
| `media_tokens`               | number          | Token count of media blocks (images, audio).                                                                                            |
| `injected_tokens`            | number          | Token count of synthetic/injected content (`metadata.synthetic === true`).                                                              |
| `prefix_fingerprint`         | string          | A hash of a stable serialization of the request prefix. Because it is a one-way hash, the original content cannot be recovered from it. |
| `prefix_fingerprint_changed` | boolean \| null | Whether the fingerprint differs from the previous send in the same session. `null` on the first send.                                   |

## Lifecycle records

Beyond `turn` records, the log carries typed lifecycle records that mark
discontinuities in the token burn curve. Each carries `session_id` and, when
known, `turn_id`.

### Compression

Emitted once per completed compression. Without this record, a compression
appears as an unexplained drop in the token count.

| Field                       | Type            | Description                                                               |
| --------------------------- | --------------- | ------------------------------------------------------------------------- |
| `record_type`               | `"compression"` | Discriminator.                                                            |
| `schema_version`            | number          | Schema version.                                                           |
| `ts`                        | string          | ISO timestamp.                                                            |
| `session_id`                | string          | Session identifier.                                                       |
| `turn_id`                   | string \| null  | Turn identifier at compression time, when known.                          |
| `tokens_before`             | number          | Total token count before compression.                                     |
| `tokens_after`              | number          | Total token count after compression.                                      |
| `compression_model`         | string \| null  | The model that served the compression.                                    |
| `compression_provider`      | string \| null  | The provider that served the compression.                                 |
| `compression_prompt_tokens` | number          | The compression call's own prompt token usage. Omitted when not reported. |
| `compression_output_tokens` | number          | The compression call's own output token usage. Omitted when not reported. |

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

```
<projectTempDir>/token-usage/<sessionId>.jsonl   ← token usage
<projectTempDir>/chats/session-<timestamp>-<prefix>.jsonl  ← conversation
```

### Join keys

| Token-usage field                   | Conversation content field                                  | Meaning                                        |
| ----------------------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| `prompt_id`                         | `metadata.promptId`                                         | Links a billed request to the turn it served   |
| `turn_id`                           | `metadata.turnId`                                           | Links to the stable turn identifier            |
| `session_id` + `user_turn` + `step` | `metadata.chronology.userTurn` + `metadata.chronology.step` | Locates the exact position in the conversation |

### Worked example

Suppose the token-usage file contains:

```json
{"record_type":"turn","prompt_id":"p-abc123","session_id":"sess-001","turn_id":"t-42","user_turn":3,"step":1,"estimated_tokens":1200,"actual_prompt_tokens":1150,...}
```

To find the corresponding turn in the conversation log:

1. Open the `session-*.jsonl` file in `<projectTempDir>/chats/` for session
   `sess-001`.
2. Search for a content entry where `metadata.promptId === "p-abc123"`.
3. Alternatively, locate the entry at `metadata.chronology.userTurn === 3` and
   `metadata.chronology.step === 1`.

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

The `prefix_fingerprint` field is a one-way hash of the request prefix. The
hash is computed from a stable serialization of the system instruction, tool
schemas, and conversation history structure. Because it is a cryptographic hash,
the original content cannot be recovered from the fingerprint. It exists solely
to detect when the request prefix changes between sends.

### Fields deliberately not populated

| Field              | Reason                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt_cache_key` | Only populated where the provider actually sends one (OpenAI family). For providers that do not expose a cache key, the field is omitted rather than fabricated. |

## Future work

Consuming surfaces — such as a `/stats burn` CLI view or an offline
cross-session analysis script — are planned as separate work. This document
covers the data format and the join model that those surfaces will build on.
