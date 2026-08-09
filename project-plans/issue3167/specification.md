# Specification: Client-Side Performance Telemetry

Plan ID: PLAN-20260808-PERFTREND
Issue: #3167
Status: **settled.** Schema, placement, delivery shape and memory trend are all decided; see §9 for the one
remaining process question.

Companions: [`PLAN.md`](./PLAN.md) (phases, requirements, rejected approaches) ·
[`decision.html`](./decision.html) (plain-language explainer) · [`design.html`](./design.html) (evidence)

This document exists because the plan named "define the record schema" as a task and never did it. The schema is
the contract between the writer and the reader, and #3164 is what happens when those two drift: a cleanup reader
matched `.json` while the writer produced `.jsonl`, so it deleted nothing for months — with passing tests,
because the fixtures encoded the old shape. That is 3.8 GB of accumulated files.

Scope note: all accepted work for #3167 — including the memory trend in §7 — ships as **one PR**. Fields that
were considered and excluded are recorded in §1.7 so they are not silently reintroduced.

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

**Memory, sampled at operation end:**

| Field                     | Type   | Notes                                                                 |
| ------------------------- | ------ | --------------------------------------------------------------------- |
| `rss_bytes`               | number |                                                                       |
| `heap_used_bytes`         | number |                                                                       |
| `external_bytes`          | number | First-class, not an afterthought — under Bun/JSC this is where the mass hid in #3112 |
| `array_buffers_bytes`     | number | Same                                                                  |
| `session_operation_index` | number | Monotonic per session. The x-axis for the per-**operation** slope     |
| `uptime_ms`               | number | `performance.now()` at sample time. The x-axis for the per-**minute** slope |

Do **not** store a computed slope. Slopes are derived at read time from these columns, so a fix to the
regression maths does not require re-collecting data, and a single record is never asked to describe a trend it
cannot see.

### 1.7 Excluded fields, and why

Both were considered and are **not** in the schema. Recorded so they are not reintroduced without new argument.

| Field             | Excluded because                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contended`       | Requires a ~10 Hz drift probe. At an observed peak of 182 concurrent instances that is ≈1,820 timer wakeups/second machine-wide — the measurement would materially contribute to the contention it reports. `concurrent_instances` (§1.5) carries the signal at zero timer cost. |
| `records_dropped` | Meaningless without a bounded queue with a drop policy, and there is no burst to absorb: one record per operation, written through a serialized chain that provides its own back-pressure. |

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

## 7. Memory trend

In scope for this issue and this PR, not deferred. It shares the schema, the sink and the retention, and is
disableable on its own (§7.4).

### 7.1 Why two slopes rather than one number

Absolute memory tells you nothing: a 400k-token context legitimately uses a lot of it. What is diagnostic is
**what the growth tracks**.

| Signature                                     | Reading                                                      |
| --------------------------------------------- | ------------------------------------------------------------ |
| Grows per operation, flattens while idle       | Normal. More work, more memory.                              |
| Grows per minute **while idle**                | Leak. Something is retained by uptime, not by activity.       |

The second is exactly #3114, where memory climbed with how long llxprt had been running rather than with how
much it had been asked to do. One RSS number can never show that; two slopes make it obvious. This is the live
in-session equivalent of the offline plateau gate in `scripts/issue-2852-memory-runner.ts`, which already
evaluates JSC heap, `external` and dirty WebKit Malloc independently.

### 7.2 Two sample sources, one discriminated record stream

The `record_type` discriminator from §1.1 earns its keep here:

- `record_type: "operation"` — carries the memory columns from §1.6, giving the **per-operation** axis for free.
  No extra sampling; it rides the record already being written.
- `record_type: "memory_sample"` — a bare sample carrying only the four memory values, `uptime_ms` and
  `ms_since_last_operation`, giving the **per-minute** axis. `ms_since_last_operation` is what makes an *idle*
  sample identifiable, and idle samples are the ones that expose the #3114 signature.

A reader that ignores unknown `record_type` values (§2) tolerates this addition without a version bump.

### 7.3 Zero new timers — the performance answer

`useMemoryMonitor` **already** runs an unconditional 60-second interval calling `process.memoryUsage().rss`
(`MEMORY_CHECK_INTERVAL_MS = 60 * 1000`). 60 s is exactly the right cadence for an uptime slope. Extend that
existing interval; do **not** add one.

Two things must be fixed in that hook, both improvements in their own right:

1. It calls `clearInterval(intervalId)` **immediately after warning once**, so today it stops monitoring
   precisely when memory is known to be a problem. Separate the warn-once latch from the sampling loop.
2. Give the sample a bounded in-memory ring for the live `/perf` view. It would be absurd for the leak detector
   to leak; the ring must be fixed-capacity with overwrite, never a growing array.

**Do not** piggyback `Footer.tsx`'s 2-second interval. It is gated on the `showMemoryUsage` setting and on the
component being mounted, so telemetry hung off it would silently collect nothing depending on unrelated UI
configuration.

Measured cost (`darwin-arm64`, both runtimes) — and critically, measured on a **large fragmented heap** rather
than an idle one, because idle is not the operating condition:

| Runtime | idle heap | 233 MB fragmented heap | ratio |
| ------- | --------- | ---------------------- | ----- |
| Bun 1.3.14 | `full` 0.43 µs · `rss()` 0.39 µs | `full` 0.44 µs · `rss()` 0.38 µs | **1.03×** |
| Node 25.2.1 | `full` 0.67 µs · `rss()` 0.44 µs | `full` 0.65 µs · `rss()` 0.43 µs | **0.98×** |

The cost is **independent of heap size and fragmentation**, which is the property that matters — a leak
investigation runs precisely when the heap is large, and the probe must not get more expensive exactly then. One
full sample per 60 s is on the order of 1e-6 % of wall time. The earlier 0.42 µs figure was taken on an idle
heap and was rightly flagged as unrepresentative; re-measured under load, it holds.

### 7.4 Its own off switch

Two independent settings, both defaulting to **false** (REQ-3167-8 requires the whole subsystem be opt-in per
`docs/telemetry-privacy.md`):

| Setting                 | Effect                                                                    |
| ----------------------- | ------------------------------------------------------------------------- |
| `telemetry.perf`        | Master. Off means nothing is collected and no file is opened.              |
| `telemetry.perf.memory` | Memory columns and `memory_sample` records. Off means the memory columns are omitted and the 60 s hook reverts to its warn-only behaviour. |

Semantics: memory requires the master to be on, and can be turned off while leaving timing collection running.
The reverse is not offered — there is no configuration that collects memory without the perf record, because the
memory columns live on that record.

Turning memory off must **remove the fields**, not write zeros. A zero is indistinguishable from a real
measurement; an absent field is unambiguous, and §2 already requires readers to tolerate absent fields.

## 8. Claim verification

Every load-bearing claim above was checked against source rather than taken from a review. Earlier revisions of
this plan propagated a finding that turned out to be a test artifact, so the evidence is recorded here to stop
that recurring.

**Dependency edges** — from the internal `dependencies` in each `package.json`:

```
agents    -> auth, core, ide-integration, policy, providers, settings, tools     <- no telemetry
telemetry -> storage                                                              <- lowest layer
core      -> auth, ide-integration, mcp, policy, settings, storage, telemetry, tools
cli       -> agents, auth, core, ide-integration, mcp, providers, settings, storage, telemetry, tools
```

Confirms §4: `telemetry` sits below `core`, and `agents` genuinely has no telemetry edge.

**`superseded` really is unreachable via the ownership release** — `useSubmitQuery.ts:650-659`:

```ts
} finally {
  // Guard against stale cleanup: a terminal error/idle-timeout event
  // may have already released interactive ownership ... (issue #2954)
  if (isCurrentTurn(current, turnSignal)) {
    current.activeTurnRef.current = false;
    current.scheduleNextQueuedSubmission();
  }
}
```

The release is inside the guard, so a superseded turn never reaches it. There is also a **second** release site
at `:293`, and the acquire at `:620` is unconditional. Confirms that finalisation needs its own registry and
sweep rather than hanging off ownership.

**`IntervalUnion` is private and quadratic** — `sessionMetricsAggregator.ts`: `add()` calls
`recomputeDuration()`, which walks the entire interval list on every insertion. The file's only exports are
`ApiAttemptRecord`, `ModelBreakdown`, `SessionMetricsSnapshot` and `SessionMetricsAggregator` — the class itself
is not exported. Confirms §5: extract, export, and make the duration incremental.

**`FileOutput` never deletes** — `grep -c 'unlink|rm(|rmSync'` over
`packages/telemetry/src/debug/FileOutput.ts` returns **0**, alongside `private static instance`,
`maxFileSize = 10 * 1024 * 1024`, `maxQueueSize = 1000`, `batchSize = 50`, `flushInterval = 1000`, and an
unguarded `console.error`. Confirms §5.

**Ink exposes render timing** — `ink/build/render.d.ts:44` declares
`onRender?: (metrics: RenderMetrics) => void`, `ink.d.ts:9` exports the type, and `ink.js:74-76` throttles the
callback so it fires per actual render pass. Confirms that `ink_render_ms` is a pure accumulate.

**A 60 s memory interval already exists, and it self-terminates** — `useMemoryMonitor.ts`:
`MEMORY_CHECK_INTERVAL_MS = 60 * 1000`, the effect has no conditional guard, and the callback calls
`clearInterval(intervalId)` inside the warning branch. Confirms §7.3: there is a host timer to extend, and its
self-termination is a real defect to fix rather than a behaviour to preserve.

**`Footer.tsx`'s 2 s interval is not a viable host** — `setInterval(updateMemory, 2000)` lives inside
`ResponsiveMemoryDisplay`, which is gated on the `showMemoryUsage` setting and only samples while mounted.
Confirms §7.3's exclusion.

**`process.memoryUsage()` is heap-size independent** — measured full-call and `rss()` cost at an idle heap and
again at a 233 MB fragmented heap with 900k live objects, punched holes and 75 MB of external buffers. Ratios
1.03× (Bun) and 0.98× (Node). Confirms §7.3.

## 9. Still open

| Item                                                                                                     | Blocks                                            |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Full `dev-docs/PLAN.md` structure (`analysis/pseudocode/`, numbered phase files) vs a recorded deviation  | `@pseudocode` traceability at implementation time |

### Decided

- **Scope shape — one issue, one PR.** All accepted work for #3167 ships together, including the memory trend
  (§7). Splitting a single issue across issues or stacked PRs is not the default here.
- **Memory trend is in scope**, first-class rather than a separable trailing phase. Sampling design and its
  independent off switch are specified in §7.
- **Delivery is the reduced shape.** `contended` and `records_dropped` are dropped along with the ~10 Hz drift
  probe, the bounded queue with drop policy, the retry-threshold self-disable, gzip and sub-rolling.
  `concurrent_instances` carries the contention signal instead, and `operation_id` is derived from the prompt-id
  prefix (§3) rather than plumbed through `packages/agents`. The deciding factor is the dependency direction
  verified in §8: keeping a measurement concern out of the agent loop outweighs every feature dropped.
