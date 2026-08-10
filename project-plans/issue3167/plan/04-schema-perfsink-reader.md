# Phase 04: Schema + PerfSink + tolerant reader + record-size benchmark

Plan ID: PLAN-20260808-PERFTREND.P04
Prerequisites: P03.
Package: `telemetry`. @pseudocode: `01-schema-and-reader.md` lines 10-115,
`02-perfsink-and-interval-union.md` lines 50-108.

> **Decisions applied (D1/D4/D5/D6):** the v1 perf record carries **no**
> `prompt_ids`/`turn_ids`/true-count (D1). PerfSink does **not** inherit
> FileOutput's bounded/drop queue (D4). P04 first adds a **Bun record-size
> benchmark** for the actual schema (D5); P08 derives retention constants from it.
> fs-failure tests use a **package-private filesystem port / failing file handle**,
> never real-disk fill or chmod (D6).

## Stub
- `packages/telemetry/src/perf/perfRecords.ts`: Zod schemas (envelope, identity,
  build, dimensions, operation, memory_sample) + `PERF_SCHEMA_VERSION=1` +
  `deriveOperationId` + `joinKeyFromPromptId` (throws NotYetImplemented) +
  `parsePerfRecord` (returns null). **No** prompt_ids/turn_ids fields.
- `packages/telemetry/src/perf/PerfSink.ts`: constructible class; `write`/`dispose`
  no-op/throw. Serialized no-drop promise chain; does NOT inherit FileOutput.

## Step 0 — Bun record-size benchmark (D5, FIRST)
- `perfRecordSize.bench.ts` (Bun): serialize a representative `operation` record
  (incl. memory columns) and a `memory_sample` record; report the byte size of a
  single JSONL line. Output is the input P08 uses to derive max-bytes/max-files/
  maintenance-interval/diagnostic-rate-limit. No placeholders here.

## Integration TDD (Bun, REAL files — no vi.mock(fs))
- `perfSink.roundtrip.behavior.test.ts` (EVIDENCE-AC1):
  - Real PerfSink to a tmpdir; write N terminal-operation records; read the file
    with the real reader; assert each round-trips to identical field values and
    that **no** `prompt_ids`/`turn_ids` fields exist (D1).
  - Midnight UTC day-key roll: a record whose ts crosses midnight rolls to a new
    file on the next write; both files parse.
  - Empty operation set ⇒ no file created.
- `perfReader.tolerant.behavior.test.ts` (EVIDENCE-AC9 partial):
  - Unknown fields ignored (no version bump needed).
  - A line with `schema_version` > known ⇒ `parsePerfRecord` returns null
    (skip+count), never throws, never coerces.
  - Truncated final line (no newline / partial JSON) ⇒ counted, reader continues.
- `perfReader.join.behavior.test.ts` (EVIDENCE-AC3 read-time join, D1):
  - One perf `operation` record + N token-usage rows (one per continuation, each
    with its own `prompt_id`); the reader/report derives `operation_id` from each
    token row and joins all N to the single perf operation — multi-continuation
    rows join to one operation without child ids on the perf record.
- `perfSink.failopen.behavior.test.ts` (EVIDENCE-AC8, D6):
  - Inject EACCES/EROFS/ENOSPC via a package-private filesystem port / failing
    file handle (NOT chmod / NOT real-disk fill); assert write does not throw into
    the caller; diagnostics emitted at most once per rate-limit window.
- `perfSink.exclusive.behavior.test.ts` (EVIDENCE-AC1):
  - Two PerfSinks with distinct runUuids create distinct day files via exclusive
    `wx`; concurrent appends produce no torn lines.

## Impl (pseudocode)
- Schema: single Zod declaration (no child-id arrays — D1); writer & reader
  `z.infer` from it.
- PerfSink: does NOT inherit FileOutput; serialized no-drop promise chain (own
  back-pressure ⇒ no drop counter); stat-once + in-memory byte counter; one
  exclusive-create day file per run UUID (`perf-<YYYYMMDD>-<runUuid>.jsonl`); UTC
  roll on next record; no gzip, no size sub-rolling; drain on dispose (removes
  claim — D3); rate-limited diagnostics (filesystem errors only).
- Reader: discriminated union on `record_type`; tolerant normalise-to-v0 for
  unversioned; skip+count above known version; truncation tolerance; read-time
  join via `joinKeyFromPromptId` (D1).

## Verify
- [ ] Step-0 record-size benchmark committed (D5); its output recorded for P08.
- [ ] AC-1, AC-2(writer-half), AC-3(read-time join), AC-8 evidenced.
- [ ] No `vi.mock('fs')` anywhere in new tests; real files + package-private port.
- [ ] typecheck/lint clean; FileOutput reused via narrow primitives, not inherited.

## Note on REQ-3167-7 reduction (spec §9 / D4)
There is **no** `records_dropped` field and **no** retry-threshold self-disable.
PerfSink does not carry FileOutput's bounded queue. Fail-open + rate-limited
diagnostics for filesystem errors only; internal errors fail fast (D8).
