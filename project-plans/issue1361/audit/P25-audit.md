# P25 Audit

## Plan Requirements
The plan requires full integration coverage for `PLAN-20260211-SESSIONRECORDING.P25`, including:

- Core REQs:
  - REQ-INT-FULL-001 end-to-end record/replay lifecycle
  - REQ-INT-FULL-002 end-to-end resume restoring history
  - REQ-INT-FULL-003 resume + continue with monotonic seq append
  - REQ-INT-FULL-004 compression behavior across replay/resume
  - REQ-INT-FULL-005 config integration for `--continue` handling
- Behavioral test catalog (1–16)
- Property tests (17–23) with minimum 7 tests / >=30%
- Addendum scenarios for corruption/crash and mixed `.json` + `.jsonl`
- Additional architecture-review scenarios (24–29): signal/cancel/partial turns, crash tail append, concurrent continue lock behavior, interactive vs `--prompt` parity
- Integration policy: real filesystem and real components; avoid over-mocking

## What Was Actually Done
`packages/core/src/recording/integration.test.ts` includes:

- 29 numbered tests (`1..29`), plus 3 addendum tests at end.
- Property tests:
  - Required 17–23 are present.
  - Additional property tests P1–P4 are present.
  - Property ratio/quantity exceeds minimum.
- Core lifecycle coverage present:
  - record → replay, resume, continue append, sequence monotonicity, compression, rewind, provider switch, directories changed, deferred materialization, discovery, latest/specific resume, delete, lock behavior.
- Addendum corruption coverage present:
  - truncated trailing line handling,
  - mid-file malformed line skipping,
  - `.json` ignored by discovery.
- Uses real FS (`fs`, temp dirs), real services (`SessionRecordingService`, `replaySession`, `SessionDiscovery`, `resumeSession`, `SessionLockManager`, `deleteSession`), no `vi.mock` usage.

## Gaps
1. **REQ-INT-FULL-005 is not actually integrated with Config class**
   - Plan explicitly says config integration and includes behavior for `Config.isContinueSession()` / `getContinueSessionRef()`.
   - Tests 14–16 explicitly avoid real `Config` and test local boolean/string expressions instead.
   - This does not validate integration wiring from CLI/config object to resume flow.

2. **Mismatch vs plan for bare `--continue` expectation**
   - Plan text says for bare `--continue` (`true`), `getContinueSessionRef()` should return `null`.
   - Test 15 asserts bare `true` maps to `CONTINUE_LATEST`.
   - This is a direct requirement inconsistency unless the plan is outdated and intentionally superseded.

3. **Signal-handling scenario (24) is approximated, not signal-driven**
   - Plan scenario calls for SIGINT delivery and flush handler behavior verification.
   - Test 24 verifies flush persistence but does not simulate/process actual signal delivery (`process.emit('SIGINT')` etc.).

4. **Mid-file corruption warning specificity is weaker than plan**
   - Plan expects a specific summarized warning shape (e.g., skipped malformed lines with first line number).
   - Test checks only that at least one parse warning exists, not summary format/line index semantics.

5. **Mixed `.json` + `.jsonl` addendum only partially covered**
   - Discovery filtering is tested.
   - Plan also calls out `resolveSessionRef("old1")` should fail specifically due to `.json` non-discoverability; this is not tested.

6. **Interactive vs `--prompt` parity test uses same direct service path**
   - Test 29 labels paths as interactive/`--prompt` but drives both through equivalent direct `SessionRecordingService` usage.
   - It does not exercise actual non-interactive command path (`runNonInteractive`) mentioned in plan.

## Severity
- **High**
  - Gap #1 (Config integration not truly tested)
  - Gap #2 (requirement contradiction on bare `--continue` behavior)
- **Medium**
  - Gap #3 (no real signal simulation for scenario 24)
  - Gap #6 (cross-mode parity not validated via distinct real code paths)
- **Low–Medium**
  - Gap #4 (warning format detail not asserted)
  - Gap #5 (`resolveSessionRef` negative case omitted)

## Summary Verdict
**Partial pass (substantial coverage, but not full conformance).**

The test file is strong on core lifecycle and property-based integration breadth, and it meaningfully covers most P25 behaviors with real components/filesystem. However, it does **not** fully satisfy all plan-specified integration intents due to missing true Config integration coverage, a direct behavioral mismatch for bare `--continue`, and partial/approximate handling of several addendum architecture scenarios.