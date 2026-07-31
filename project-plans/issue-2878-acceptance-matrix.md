# Issue #2878: ci: reduce forced-full test runs — trim sharedInputs and narrow fail-closed triggers

## Acceptance Matrix

| # | Behavior | Evidence |
|---|----------|----------|
| A1 | Replay forcedFull rate drops from ~27% toward under 15% | `--replay 120` output shows forcedFull ≤ 18 |
| A2 | Graph checker (`check-affected-test-shards.ts`) passes | `npm run lint:affected-shards` exit 0 |
| A3 | Each sharedInputs removal validated: removed entries now select scripts shard (or no shard) instead of full run | Test: each removed entry selects scripts shard |
| A4 | Integration-tests fixture data no longer forces full run; harness logic still does | Test: `.responses` fixture → scripts shard; `.test.ts` → full run |
| A5 | Unknown-path classification improved for common repo paths | Test: `.allstar/`, `shell-scripts/`, etc. → noShards |
| A6 | All existing tests still pass | `npm run test --workspace scripts` green |
| A7 | Lint/typecheck/format/build pass | Full verification suite green |

## Non-Goals

- Changing the selector algorithm (reverse closure, observer rules, etc.)
- Adding new package edges to the import graph
- Modifying the lint-target selector behavior beyond what sharedInputs changes imply
- Changing CI workflow structure (ci.yml job layout)
- Re-running the `affected-lint-targets.ts` selector logic beyond sharedInputs consistency

## Bounded Vertical Slices

### Slice 1: Trim sharedInputs
- Remove 8 entries from `sharedInputs` in data JSON
- Update checker `REQUIRED_SHARED_INPUTS` to remove `.github/workflows/ci.yml`
- Add `.npmrc` to `NO_TEST_METADATA` in both selectors
- Tests: update shared-inputs tests, add new tests for scoped behavior

### Slice 2: Narrow integration-tests fail-closed
- `.ts` files under `integration-tests/` → still full run (harness/logic)
- Non-`.ts` files (fixtures, responses, etc.) → scripts shard only
- Tests: split integration-tests protection test cases

### Slice 3: Improve unknown-path classification
- Add common repo paths to classification: `.allstar/`, `.claude/`, `.gcp/`, `.gemini/`, `shell-scripts/`, `test-scripts/`, `.llxprt/`, `bunfig.toml`, `junit-integration.xml`
- Tests: add classification tests

## Expected Paths (files to change)

1. `scripts/affected-test-shards.data.json` — trim sharedInputs
2. `scripts/affected-test-shards.ts` — narrow integration-tests, add unknown-path classifications, add `.npmrc` to NO_TEST_METADATA
3. `scripts/check-affected-test-shards.ts` — remove `.github/workflows/ci.yml` from REQUIRED_SHARED_INPUTS
4. `scripts/affected-lint-targets.ts` — add `.npmrc` to NO_TEST_METADATA for consistency
5. `scripts/tests/affected-test-shards.test.ts` — update tests
6. `scripts/tests/affected-lint-targets.test.ts` — update tests if needed

## Scope Ledger

| File | Change | Lines (est.) |
|------|--------|-------------|
| scripts/affected-test-shards.data.json | Remove 8 sharedInputs entries | -8 |
| scripts/affected-test-shards.ts | Narrow int-tests, add classifications | +30 |
| scripts/check-affected-test-shards.ts | Remove ci.yml from required | -1 |
| scripts/affected-lint-targets.ts | Add .npmrc to NO_TEST_METADATA | +1 |
| scripts/tests/affected-test-shards.test.ts | Update tests | +60 |
| scripts/tests/affected-lint-targets.test.ts | Update tests | +10 |
| **Total** | **6 files** | **~90 net** |

## Measurement

**Before:** forcedFull = 32/120 (26.7%)
**After:** forcedFull = 23/120 (19.2%) — 28% reduction in forced-full runs

The remaining forced-full triggers are genuinely shared inputs that affect all
shards: `package.json` (12x), `bun.lock` (7x), `scripts/test.ts` (1x),
`package-lock.json` (1x), plus 2 integration-tests `.ts` harness files.
These cannot be safely removed without creating coverage gaps.

### Removed from sharedInputs (19 entries → 8 entries)
- `.github/workflows/ci.yml` → `.github/` prefix rule → scripts shard
- `tsconfig.scripts.json` → NO_TEST_METADATA → no shard
- `eslint.config.js` → NO_TEST_METADATA → no shard
- `vitest.coverage.ts` → NO_TEST_METADATA → no shard
- `.npmrc` → NO_TEST_METADATA → no shard
- `scripts/build*.ts` (5 files) → `scripts/` prefix → scripts shard
- `scripts/test-shards.ts` → `scripts/` prefix → scripts shard
- `scripts/check-test-shards.ts` → `scripts/` prefix → scripts shard
- `scripts/run_bun_tests.ts` → `scripts/` prefix → scripts shard
- `scripts/bun-test-manifest.ts` → `scripts/` prefix → scripts shard
- `scripts/preinstall.cjs` → `scripts/` prefix → scripts shard
- `scripts/copy_bundle_assets.ts` → `scripts/` prefix → scripts shard
- `scripts/affected-test-shards.ts` → `scripts/` prefix → scripts shard
- `scripts/affected-test-shards.data.json` → `scripts/` prefix → scripts shard
- `scripts/check-affected-test-shards.ts` → `scripts/` prefix → scripts shard

### Narrowed integration-tests fail-closed
- `integration-tests/*.ts` → still fail closed (harness/logic)
- `integration-tests/*` non-`.ts` (fixtures) → scripts shard only
