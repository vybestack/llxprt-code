# Problems Found — Round 2

## 28 Issues Identified

1. `specification.md` vs `plan/00-overview.md`: requirements mismatch. Spec defines REQ-RPL-006/007/008, but overview only lists REQ-RPL-001..005, creating traceability gaps.
2. `plan/00-overview.md`: integration checklist marks "Created integration tests ... (Phase 25)" as already done before Phase 25, contradictory process state.
3. `plan/00a-preflight-verification.md`: assumes `HistoryServiceEvents` in `HistoryEvents.ts`; real typed emitter contract is in `HistoryService.ts`, so checks are mis-targeted.
4. `plan/00a-preflight-verification.md`: brittle hardcoded line/location assumptions and grep gates likely to drift and block valid implementations.
5. `analysis/pseudocode/recording-integration.md`: assumes compression lifecycle events and payloaded `compressionEnded` exist; real `HistoryService.ts` currently exposes only `tokensUpdated`.
6. `analysis/pseudocode/recording-integration.md`: flush placement in `useGeminiStream submitQuery finally` is not reconciled with all early-return/error paths; potential missed durability points.
7. `analysis/pseudocode/concurrency-lifecycle.md`: 48h age rule can treat still-live sessions as stale and allow lock stealing, violating single-writer guarantees.
8. `analysis/pseudocode/concurrency-lifecycle.md`: PID liveness check via `process.kill(pid, 0)` lacks ownership validation; PID reuse remains a correctness risk.
9. `analysis/pseudocode/concurrency-lifecycle.md`: lock release swallows all errors (best-effort) with no observability, hiding lock leaks.
10. `analysis/pseudocode/replay-engine.md` vs `plan/08-replay-engine-impl.md`: API contract mismatch (`ok:true/false` union vs single result with optional error).
11. `analysis/pseudocode/replay-engine.md` vs `plan/08-replay-engine-impl.md`: malformed-rate calculation rules differ (denominator/counting), so 5% warning behavior is inconsistent.
12. `plan/07-replay-engine-tdd.md` vs replay spec/pseudocode: truncated last-line handling conflicts ("silent discard" vs test expecting warning mention).
13. `plan/08-replay-engine-impl.md`: pseudocode reads payload fields at top-level (`event.sessionId`, etc.) despite envelope contract requiring `event.payload.*`; likely implementation bug if followed literally.
14. `plan/08-replay-engine-impl.md`: session_event severity enum uses `warn` while spec uses `warning`; schema mismatch.
15. `plan/04-core-types-writer-tdd.md`: "no mock theater" policy conflicts with required ENOSPC test that explicitly mocks fs failures.
16. `plan/04-core-types-writer-tdd.md`: heavy grep/count marker requirements are non-functional and brittle, likely to fail good tests.
17. `plan/13-recording-integration-tdd.md`: several delegation tests are hard/impossible to prove cleanly under strict "no mocks/spies" constraints.
18. `plan/13-recording-integration-tdd.md`: test 33 (empty session produces JSONL with session_start) contradicts deferred materialization requirement (no file before first content).
19. `plan/14-recording-integration-impl.md`: changing `HistoryService.endCompression(summary, itemsCompressed)` has broad caller/test impact; plan does not fully inventory/update all call paths.
20. `plan/14-recording-integration-impl.md` vs real source `packages/cli/src/nonInteractiveCli.ts`: plan assumes `recordingService` param in `RunNonInteractiveParams`, but current API lacks it; integration wiring scope/risk under-specified.
21. `plan/25-integration-tdd.md`: puts CLI/config/lock behavior assertions into core integration test file, causing scope mismatch and awkward/non-representative tests.
22. `plan/25-integration-tdd.md`: "all provider switches captured" can conflict with replay contract that returns only latest metadata unless raw-file assertions are specified.
23. `plan/27-old-system-removal.md` vs `specification.md` transition notes: removal guidance conflicts with note that old `.json` cleanup behavior is preexisting/untouched.
24. `plan/27-old-system-removal.md`: smoke commands inconsistent with project memory-required keyfile usage (`--keyfile ~/.llxprt/keys/.synthetic2_key`), risking quota-related verification failures.
25. `plan/14-recording-integration-impl.md` / `analysis/pseudocode/recording-integration.md`: history-service replacement handling is under-specified given multiple `startChat` call sites in `packages/core/src/core/client.ts`.
26. Overall plan (writer phases): no concrete backpressure/queue bound strategy for sync enqueue + async drain; risk of unbounded memory growth under slow I/O.
27. Overall error model (writer/replay): ENOSPC is specified, but other persistent fs failures (EIO/EPERM/EMFILE, etc.) are under-defined, risking retry loops or silent loss.
28. Overall testing strategy across phases (04/07/13/25): excessive fixed test quotas and percentage constraints encourage checklist gaming and can stall implementation without improving correctness.
