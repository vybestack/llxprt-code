# Specification: Client-Side Performance Telemetry

Plan ID: PLAN-20260808-PERFTREND
Issue: #3167
Status: **schema and placement settled; two fields pending the full-vs-halved decision** (marked below)

Companions: [`PLAN.md`](./PLAN.md) (phases, requirements, rejected approaches) ·
[`decision.html`](./decision.html) (plain-language explainer) · [`design.html`](./design.html) (evidence)

This document exists because the plan named "define the record schema" as a task and never did it. The schema is
the contract between the writer and the reader, and #3164 is what happens when those two drift: a cleanup reader
matched `.json` while the writer produced `.jsonl`, so it deleted nothing for months — with passing tests,
because the fixtures encoded the old shape. That is 3.8 GB of accumulated files.

Everything specified here is independent of the outstanding full-vs-halved decision except the two fields
explicitly tagged **DECISION**.

---

## 1. Record schema

One record per completed top-level operation. One JSON object per line.

**Authoring rule:** this table is the source of truth for the *shape*; the implementation must declare it once as
a Zod schema (`dev-docs/RULES.md` mandates schema-first with Zod) and both the writer and the report reader must
derive their types from that single declaration. No hand-authored fixture may stand in for a real record in
tests — the round-trip test asserts against output produced by the actual writer.

### 1.1 Envelope

| Field            | Type   | Notes                                                             |
| ---------------- | ------ | ----------------------------------------------------------------- |
| `schema_version` | number | Starts at 1. Compatibility rules in §2.                           |
| `record_type`    | string | `operation` for now; discriminator so lifecycle rows can be added |
| `ts`             | string | ISO 8601, operation end                                           |

### 1.2 Identity — reuses #3130's shipped key names verbatim

Adopting these character-for-character is what makes the perf log joinable to the token-usage log and the
session recording. Inventing parallel names would produce three logs that cannot be joined.

| Field               | Type              | Notes                                                                     |
| ------------------- | ----------------- | ------------------------------------------------------------------------- |
| `session_id`        | string            |                                                                           |
| `operation_id`      | string            | Groups the sends belonging to one user submission. See §3.                |
| `prompt_ids`        | string[] (capped) | The child sends this operation covers. **Must be capped or hashed** — see §1.7 |
| `turn_ids`          | string[] (capped) | Same, and nullable per record in the token log                            |
| `runtime_id`        | string            |                                                                           |
| `parent_runtime_id` | string \| null    | `null` for the main agent                                                 |
| `subagent_name`     | string \| null    | `null` for the main agent                                                 |
| `project_hash`      | string            | Project identity as a field, so the file path can stay global             |

**Do not join on `user_turn` or `step`.** `docs/token-usage-log.md` documents that both name the newest turn
*already in history* rather than the turn being sent, and are `null` on a session's first request.

### 1.3 Terminal status

| Field    | Type   | Values                                                                                                                              |
| -------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `status` | string | `completed` · `error` · `cancelled_before_send` · `cancelled_during_api` · `cancelled_during_tool` · `cancelled_during_approval` · `superseded` |

`superseded` is load-bearing: the ownership release in `useSubmitQuery` is guarded by `isCurrentTurn`, so a
superseded operation never reaches it. Without an explicit finalisation sweep those operations are silently
dropped, and the trend would under-sample exactly the pathological cases worth measuring.

### 1.4 Build identity — the x-axis

| Field            | Type   | Source                                                                     |
| ---------------- | ------ | -------------------------------------------------------------------------- |
| `llxprt_version` | string | `getCliVersion()`; `CLI_VERSION` baked at build time                       |
| `git_sha`        | string | `getGitCommitInfo()` — already exists, no build change. Stale on plain `npm run build`; correct for released and nightly artifacts |
| `runtime`        | string | e.g. `bun-1.3.14` / `node-25.2.1`                                          |
| `platform`       | string | e.g. `darwin-arm64`                                                        |

### 1.5 Comparison dimensions — compare like with like, never pooled

| Field                  | Type   | Why it is required                                                       |
| ---------------------- | ------ | ------------------------------------------------------------------------ |
| `provider`             | string | Never compare a fast model's operation against a slow one                |
| `model`                | string |                                                                          |
| `context_tokens`       | number | Cost scales with it; the primary normaliser                              |
| `output_tokens`        | number | Normaliser for render-side cost                                          |
| `terminal_cols`        | number | Render cost scales with geometry                                         |
| `terminal_rows`        | number |                                                                          |
| `render_mode`          | string | `alt-buffer` · `incremental` · `plain` · `screen-reader` — changes frame and byte counts independently of our code |
| `concurrent_instances` | number | Other llxprt processes active. With 2+ concurrent 98.9% of observed time, self-contention is the dominant noise source |

### 1.6 Measurements

**Client work — directly measured, additive among themselves:**

| Field                  | Type   | Notes                                                              |
| ---------------------- | ------ | ------------------------------------------------------------------ |
| `client_prepare_ms`    | number | Before the first send                                              |
| `stream_handler_ms`    | number | Our synchronous CPU inside delta handling                          |
| `ink_render_ms`        | number | From Ink's `onRender` — Ink computes it, so this is a pure accumulate |
| `ink_render_count`     | number | Actual render passes, not stdout writes                            |
| `stdout_bytes`         | number | Encoded bytes (`Buffer.byteLength` / `Uint8Array.byteLength`), never string length |
| `stdout_write_calls`   | number | Distinct from `ink_render_count`; one write is not one frame        |
| `stdout_write_sync_ms` | number | Synchronous invocation only — excludes drain and terminal flush. Candidate to defer; the wrapper is the riskiest edit in the design |
| `client_finalize_ms`   | number | After the last send                                                |

**Provider and tool work — explicitly overlapping, NOT additive with the above or each other:**

| Field                     | Type   | Notes                                              |
| ------------------------- | ------ | -------------------------------------------------- |
| `provider_attempt_sum_ms` | number | Σ of attempt durations. Answers "how much provider work" |
| `provider_union_ms`       | number | Merged intervals. Answers "how much elapsed time was covered" |
| `provider_attempts`       | number | Retries and failover each count                    |
| `tool_call_sum_ms`        | number | Σ of tool durations                                |
| `tool_union_ms`           | number | Merged intervals                                   |
| `tool_calls`              | number |                                                    |
| `agent_activity_union_ms` | number | Union of provider and tool together               |

**Elapsed:**

| Field                     | Type   | Notes                                                            |
| ------------------------- | ------ | ---------------------------------------------------------------- |
| `operation_elapsed_ms`    | number | Wall time from operation start to terminal status                |
| `approval_wait_ms`        | number | Time blocked on tool confirmation — human time, measured at the confirmation seam, not from `useStreamingState` |
| `unclassified_elapsed_ms` | number | Elapsed minus everything attributed. **Reported honestly, never labelled "llxprt time" and never clamped.** A large value here is a finding, not an error to hide |

**The record must not claim these sum.** That assumption is precisely what made rev.1 invalid.

### 1.7 Pending the full-vs-halved decision

| Field            | Type    | Present in                                                     |
| ---------------- | ------- | -------------------------------------------------------------- |
| `contended`      | boolean | **DECISION** — FULL only. Requires the ~10 Hz drift probe. If halved, `concurrent_instances` is the contention covariate and no timer is added |
| `records_dropped`| number  | **DECISION** — FULL only. Meaningless without a bounded queue; if halved, the serialized write chain provides back-pressure and nothing is dropped |

`operation_id` is present in **both** versions. Only how it is *produced* differs — derived from the prompt-id
prefix (halved) or minted and propagated (full). See §3.

### 1.8 Size

The rev.2 "688 B" figure is withdrawn: it priced a rejected field set. The set above is larger, and
`prompt_ids` / `turn_ids` make the record **variable length** — ids look like
`${sessionId}#agentic-loop#${uuid}#continuation#${n}` at roughly 80–110 bytes each with no natural bound. A
30-continuation operation would add kilobytes, which breaks the fixed-size arithmetic the eviction budget rests
on.

**Therefore:** cap the arrays at a documented maximum and record the true count separately, or store a hash of
the set plus the count. Then measure the real record size and derive the retention budget from that — as a Bun
benchmark under the owning package, not a throwaway script.

---

## 2. Compatibility rules

Every llxprt version on a machine writes into one shared directory, so an old build reading a new record is
routine, not exceptional. Dispatching on `schema_version` is not by itself a policy. The two rules:

1. **Readers MUST ignore unknown fields.** Adding a field is therefore *not* a version bump. Without this rule
   every future field addition breaks every older llxprt reading the same directory.
2. **A bump means a field changed meaning or was removed.** A reader encountering a version above what it knows
   must **skip the record and count it**, never coerce it.

Reuse the mechanism that already exists rather than inventing one: `tokenUsageRecords.ts` has
`TOKEN_USAGE_SCHEMA_VERSION`, a `record_type` discriminator, and tolerant normalisation of unversioned legacy
records to `{schema_version: 0}` rather than throwing.

Readers must additionally tolerate a **truncated final line** — guaranteed whenever a process is SIGKILLed
mid-append — and count it rather than aborting. This is the justified kind of defensive handling: files on disk
are genuinely external input.

---

## 3. `operation_id`

One user submission produces several model sends: `useSubmitQuery` handles one new prompt while the agent drives
continuation internally, and `AgenticLoop` derives a new prompt id per continuation. So a single perf record
covers multiple `prompt_id` / `turn_id` values, and "one record joins on one turn_id" is false.

The grouping identity **already exists in the data**:

```
send 1   abc123#agentic-loop#f7e2
send 2   abc123#agentic-loop#f7e2#continuation#1
send 3   abc123#agentic-loop#f7e2#continuation#2
         └──────── shared prefix ────────┘
```

`AgenticLoop.generateContinuationPromptId()` returns `${initialPromptId}#continuation#${n}` and `run()` threads
`initialPromptId` through every continuation.

- **Halved:** `operation_id = promptId.split('#continuation#')[0]`, computed at read time. Zero plumbing,
  `packages/agents` untouched.
- **Full:** mint an id at submission and propagate it to every child send. Requires a new
  `agents → telemetry` dependency (see §4).

**Either way**, add a behavioural test asserting the prefix invariant, so a future change to
`generateContinuationPromptId` fails loudly instead of silently un-grouping the data.

Subagents are the one case where the prefix genuinely breaks, because a separate runtime restarts the namespace.
Use the existing `runtime_id` / `parent_runtime_id` / `subagent_name` keys rather than inventing new ones.

---

## 4. Placement

Verified dependency edges (from the `file:../` entries in each `package.json`):

```
storage    -> (none)
settings   -> storage
telemetry  -> storage ONLY
core       -> telemetry, storage, settings, auth, policy, mcp, tools, ide-integration
agents     -> core, providers, tools, policy, settings, auth, ide-integration     <- NO telemetry edge
cli        -> core, agents, telemetry, providers, settings, storage, tools, ...
```

Layering is `storage < telemetry < core < agents < cli`. **`packages/telemetry` sits below `core`**, so anything
placed there is reachable from everything above while itself importing only `storage`.

| Package     | Owns                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `telemetry` | The schema, the JSONL sink, directory retention, and the extracted interval-union helper               |
| `core`      | Only the stdout byte/duration counter hook — `utils/stdio.ts` lives here and cannot move               |
| `cli`       | Operation lifecycle and finalisation registry, Ink `onRender` wiring, the opt-in setting, `/perf` and the report command |
| `agents`    | **Nothing.** It has no telemetry dependency and must not acquire one for this feature                 |

This is the only arrangement that adds no new edges. Placing the writer in `cli` would make it unreachable from
`core`'s stdout seam; threading ids through `agents` inverts the dependency direction to carry a measurement
concern through business logic.

If agents-side emission ever becomes genuinely necessary, copy `TokenUsageLogger`'s pattern — it writes gated
JSONL from inside `agents` *without* a telemetry dependency by taking `enabled` and `logFilePath` as constructor
parameters. Inject a narrow port; do not import the subsystem.

---

## 5. Reuse, not reinvention

`packages/telemetry/src/debug/FileOutput.ts` already implements most of the proposed writer, in the package that
should own it:

| Capability                      | Where                                            |
| ------------------------------- | ------------------------------------------------ |
| JSONL append into the global log dir | `debugDir`, `currentLogFile`                |
| Unique run id in the filename   | `debugRunId`                                     |
| Size rolling                    | `maxFileSize = 10 * 1024 * 1024`                 |
| Bounded queue                   | `maxQueueSize = 1000`                            |
| Batch + interval flush          | `batchSize = 50`, `flushInterval = 1000`         |
| Serialized-write guard          | `isWriting`                                      |
| Drain on dispose                | `dispose()` / `disposeInstance()`                |

**Extend it into a reusable JSONL sink rather than writing a parallel one** — and fix its real defects instead
of reproducing them:

1. It is a **singleton** (`private static instance`). A perf sink needs its own instance, so the reusable form
   must be constructible, not singleton-only.
2. It calls `fs.stat` on **every flush**. Stat once at open and count bytes in memory thereafter.
3. It `console.error`s unbounded on every failure. Diagnostics must be rate-limited.
4. **It never deletes anything.** `llxprt-debug-*.jsonl` grows forever — the same unbounded-growth bug as
   #3164, sitting in the package this feature would join. Adding retention here fixes two problems at once.

Directory retention should follow `errorReporting.ts`'s `rotateReports()` shape — bound on file **count and
total bytes simultaneously**, oldest first — but not its guarantees: it protects only in-process paths and
decrements its accounting even when `unlink` fails.

`IntervalUnion` in `sessionMetricsAggregator.ts` has the correct merge semantics but is **private** and
recomputes the whole duration on every insert (quadratic over a session, which bites the 24/7 workload
specifically). Extract it, export it, fix it to maintain the duration incrementally, and have both the session
aggregator and the perf recorder use the one implementation.

---

## 6. Live-writer safety

Retention must never delete or archive a file a live writer still holds: unlinking it makes already-written
records vanish while the next append silently recreates the path.

**Rule, requiring no lock:** treat a file as potentially live — and skip it — when its day-key is today **and**
its mtime falls within the maintenance interval. That is a pure function of the filename plus one `stat`, it is
testable without spawning processes, and it deliberately avoids adding a lock. #3164 reports 417 stale lock
files; `reconcileLock` has no PID-liveness reclaim and `CredentialWriteLock` is far more machinery than a log
file warrants.

The retention guarantee is therefore an **eventual bound with documented overshoot**, not an instantaneous
ceiling. A hard cap, zero record loss, and no cross-process coordination cannot all hold at once. On a read-only
or full volume the guarantee degrades to "no further growth", because eviction itself cannot run.

---

## 7. Still open

| Item                                                                    | Blocks                          |
| ----------------------------------------------------------------------- | ------------------------------- |
| Full vs halved (`contended`, `records_dropped`, retry threshold, gzip, sub-rolling, id plumbing) | §1.7, §3, and Phase ordering |
| Memory trend as its own issue                                            | Whether Phase 6 belongs here    |
| Full `dev-docs/PLAN.md` structure (`analysis/pseudocode/`, numbered phase files) vs a recorded deviation | `@pseudocode` traceability at implementation time |
