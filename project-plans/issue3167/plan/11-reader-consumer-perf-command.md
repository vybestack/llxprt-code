# Phase 11: Reader/consumer + report + /perf + inspect + delete

Plan ID: PLAN-20260808-PERFTREND.P11
Prerequisites: P04, P09.
Packages: `telemetry` (reader/report), `cli` (command). @pseudocode:
`08-consumer-and-perf-command.md` lines 30-99.

> **Decisions applied (D1/D7):** the report joins multi-continuation token/session
> rows to a perf operation by deriving `operation_id` at read time (D1).
> `--baseline` accepts an exact `llxprt_version` or `git_sha`; without it the
> report prints grouped matched-dimension p50/sample/self-health and no delta, and
> with it unmatched groups are reported as unmatched, never pooled (D7). `/perf` is
> a current-process snapshot; the report is longitudinal. `inspect` shows
> path/schema/privacy/record counts; `delete` respects live claims (D3).

## Stub
- `perfReader`/`buildReport`/`perfInspect`/`perfDelete` throw/empty; `/perf`
  SlashCommand skeleton registered in `BuiltinCommandLoader`.

## Integration TDD (Bun, REAL files)
- `report.behavior.test.ts` (EVIDENCE-AC9):
  - Real multi-version fileset (v0 unversioned, v1 known, v999 unknown, one
    malformed line, one truncated final line): known records parse; unknown-version
    skipped+counted; malformed skipped+counted; truncated tail counted; report
    includes counts and self-health (skipped/truncated/last write error/evictions).
  - **D7 baseline:** without `--baseline` → grouped matched-dimension
    p50/sample/self-health, no delta; with `--baseline <version|sha>` →
    matched-dimension delta vs baseline rows only (provider/model/render-mode/
    terminal-geometry buckets); unmatched groups reported as unmatched, never pooled.
  - Groups by version/commit within matched dimensions; contamination via
    `concurrent_instances >= 2` (NOT contended).
  - **D1 read-time join:** N continuation token-usage rows derive the same
    `operation_id` and join to the single perf operation.
  - Cross-platform path handling (no shell pipeline).
- `perfCommand.behavior.test.ts` (EVIDENCE-AC9):
  - `/perf inspect` ⇒ dir, schema version, privacy, file count, total bytes,
    operation/memory-sample record counts.
  - `/perf report` ⇒ longitudinal report output.
  - `/perf delete` ⇒ removes JSONL files AND stale claims WITH live-writer safety
    (today + recent mtime / fresh claims survive); failures counted, fail-open.
  - `/perf` (no subcommand) ⇒ snapshot of THIS process (live MemoryRing + current op).

## Impl (pseudocode 08 lines 30-99)
- Streaming reader (one file at a time; no gzip; tolerant); report groups +
  matched-dimension p50 + optional exact baseline (D7) + read-time join (D1);
  inspect/delete follow the SlashCommand convention; delete respects live claims
  (reuses `isLiveWriter` / fresh-claim check — pseudocode 06).

## Verify
- [ ] AC-9 evidenced; no gzip; no contended; no records_dropped.
- [ ] Baseline semantics (D7); unmatched groups never pooled.
- [ ] delete respects live claims (D3).
- [ ] Command registered in BuiltinCommandLoader; subcommands work.
- [ ] typecheck/lint clean; no new JS/Vitest tests.
