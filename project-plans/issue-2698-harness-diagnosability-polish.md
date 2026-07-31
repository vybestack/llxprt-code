# Issue #2698: Follow-ups from #2688 — harness diagnosability polish

Follow-up to #2688 / PR #2690. Three diagnosability items carried over from
OCR review that were valid but out of scope for the CI-platform fix.

## Acceptance Matrix

| # | Behavior | Evidence |
|---|----------|----------|
| A1 | A corrupt/partially-written state file surfaces its parse error (appended to returned stderr) instead of being silently swallowed | Test: `readFakeState` on a corrupt file returns non-empty `parseError` + empty default state |
| A2 | A missing state file still yields a usable empty default WITHOUT a parse-error diagnostic | Test: `readFakeState` on a nonexistent path returns empty default + empty `parseError` |
| A3 | `runRecordHistory` threads the surfaced parse error into the returned `stderr` | Code: `runRecordHistory` delegates state read to `readFakeState` and appends `parseError` to `result.stderr` |
| A4 | Env stubbing in diagnostics tests is consistent (no manual `process.env` manipulation mixed with `vi.stubEnv`) | Test: both CI-presence and CI-absence tests use `vi.stubEnv` + `vi.unstubAllEnvs()` |
| A5 | The script→harness message coupling is documented as an intentional contract | New `assign-script-contract.ts` with header comment + named marker constants used by the diagnostics assertions |
| A6 | All existing harness/diagnostics tests still pass | `npm run test:scripts` green; existing `runRecordHistory` callers unaffected (parseError empty in normal flows) |
| A7 | Full verification suite green | test / lint / typecheck / format / build + smoke all pass |

## Non-Goals

- Changing `createFakeRepo().readState()` behavior (it already surfaces errors by throwing — out of scope).
- Restoring the old `execFileSync` catch shape in `runAutomationScript` (the issue's "Explicitly not included" section confirms throwing is strictly better).
- Modifying the bash scripts themselves (their messages are the source of truth; only the TS harness side changes).
- Modifying `fake-gh.py` (no new corruption trigger added; item 1 is tested via the extracted `readFakeState` helper).
- Changing CI workflow structure.

## Decisions

- **D1 — `vi.unstubEnv` (singular) does not exist in vitest 3.2.x.** The issue
  suggested standardizing on `vi.stubEnv` / `vi.unstubEnv`, but only
  `vi.stubEnv(name, value)` and `vi.unstubAllEnvs()` exist. Verified in
  `node_modules/vitest/dist/chunks/vi.bdSIJ99Y.js`: `stubEnv` with `undefined`
  deletes the var, and `unstubAllEnvs` restores all stubbed vars. Since CI is
  the only env var stubbed in these tests, `unstubAllEnvs()` is effectively
  targeted here. Item 2 is implemented by replacing manual
  `delete process.env['CI']` + manual restore with `vi.stubEnv('CI', undefined)`
  + `vi.unstubAllEnvs()`, making both tests consistent.

- **D2 — Extract `readFakeState` for testability (item 1).** The
  corrupt-state path cannot be driven end-to-end through `runRecordHistory`
  because fake-gh always writes valid JSON via `json.dump`, and
  `runRecordHistory` pre-writes valid initial state. The parse-error-surfacing
  logic is extracted into a small exported helper `readFakeState(stateFile)`
  so it can be exercised directly with a real corrupt file. This is a bounded
  test-infra addition to a module (`assign-helpers.ts`) that already exports
  ~15 helpers — not a new subsystem or production public abstraction.

- **D3 — Dedicated contract file for item 3.** The bash scripts cannot import
  TS, so the "(where practical)" qualifier in the issue applies. A dedicated
  `scripts/tests/assign-script-contract.ts` documents the intentional coupling
  in a header comment and exports named marker constants used by the
  diagnostics assertions. This is the more robust of the two options the issue
  offered (comment vs shared constant).

## Bounded Vertical Slices

### Slice 1: Item 1 — corrupt vs absent state
- Extract `readFakeState(stateFile)` + `EMPTY_FAKE_STATE` constant in `assign-helpers.ts`.
- `runRecordHistory` delegates to it and appends `parseError` to returned stderr.
- Tests: corrupt file → non-empty parseError; missing file → empty parseError.

### Slice 2: Item 2 — consistent env stubbing
- Replace manual `process.env['CI']` manipulation in the "stays quiet outside CI" test with `vi.stubEnv('CI', undefined)` + `vi.unstubAllEnvs()`.

### Slice 3: Item 3 — document message coupling
- New `assign-script-contract.ts` with documented marker constants.
- Diagnostics test imports and uses the constants in its assertions.

## Expected Paths (files to change)

1. `scripts/tests/assign-helpers.ts` — extract `readFakeState`, use in `runRecordHistory`.
2. `scripts/tests/assign-script-contract.ts` — NEW: documented marker constants.
3. `scripts/tests/assign-harness-diagnostics.test.ts` — item 2 standardization, item 3 constants, item 1 tests.

## Scope Ledger

| File | Change | Lines (est.) |
|------|--------|-------------|
| scripts/tests/assign-helpers.ts | extract readFakeState + EMPTY_FAKE_STATE, use in runRecordHistory | +35 / -18 |
| scripts/tests/assign-script-contract.ts | NEW documented markers | +55 |
| scripts/tests/assign-harness-diagnostics.test.ts | item 2 + item 3 + item 1 tests | +45 / -15 |
| **Total** | **3 files** | **~100 net** |

Well within the 25-file / 1,500-line budget; no mandatory scope review triggered.
