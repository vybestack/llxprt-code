# Phase 13: Final verification

Plan ID: PLAN-20260808-PERFTREND.P13
Prerequisites: P03–P12 all complete.

## Whole-suite verification
- `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
  `npm run build` — all green.
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`
  — smoke run.
- Deferred-implementation detection across changed packages (no TODO/HACK/STUB/
  placeholder/empty-returns in implemented code).
- No `eslint-disable` / `@ts-ignore` / `@ts-expect-error` / severity downgrades /
  complexity threshold increases / ignore exclusions introduced.
- `packages/agents` diff is empty for this feature (no telemetry edge added).
- No dependency/workflow/quality-tool/setting-unrelated-to-perf changes.

## AC coverage sign-off
- AC-1 single-schema round trip ✔ (P04)
- AC-2 default-off no files ✔ (P09, P12)
- AC-3 identity joins + continuation grouping ✔ (P06)
- AC-4 every terminal status incl. superseded ✔ (P06)
- AC-5 direct phase measurement + overlap ✔ (P07)
- AC-6 Ink render/write distinction + stdout correctness ✔ (P05)
- AC-7 retention under concurrency/24×7/clock/live/unlink ✔ (P08)
- AC-8 fail-open + rate-limited diagnostics under EACCES/EROFS/ENOSPC ✔ (P04)
- AC-9 cross-platform consumer + inspect/delete + /perf ✔ (P11)
- AC-10 memory omitted when off; two slopes when on ✔ (P10)
- AC-11 fixed-capacity ring + continued monitor ✔ (P10)
- AC-12 observer-effect harness p50/p95/p99 no wall-clock gate ✔ (P12)

## Out-of-scope confirmation
- gzip / size sub-rolling: deferred (not implemented).
- contended / records_dropped / retry-threshold: excluded (not implemented).
- `prompt_ids`/`turn_ids` arrays + true-count/cap on the perf record: excluded
  (D1 — child ids do not arrive via AgentEvent; join at read time).
- PerfSink inheriting FileOutput's bounded/drop queue: excluded (D4).
- agents→telemetry edge / operation_id propagation: excluded.

## Completion marker
Write `project-plans/issue3167/.completed/P13.md` with the verification output.
