# Review Triage Policy: Issue #2846

This policy governs how PR review findings are classified during the
implementation and review of the Bun test migration PR.

## Classification Categories

### Blocker-Fix

A finding that MUST be resolved before the PR can merge. The PR is
incorrect or incomplete without it.

**Criteria**:
- A test file that imports from `vitest` in tools/mcp/storage is missing
  from the manifest (REQ-003 violation)
- A test that passed under vitest fails under bun due to a migration defect
  (not a pre-existing failure)
- A test was newly `.skip`'d that was not already skipped under vitest
  (REQ-003 violation)
- vi.resetModules / vi.doUnmock / vi.unmock remains in a migrated test file
  without being wrapped in a pattern that works under Bun
- resolves.not.toThrow remains un-rewritten
- The `secure_store_backend` CI job no longer runs the native-keyring or
  fallback-behavior tests (REQ-008 violation)
- package.json `test` script does not use `bun run_bun_tests.ts`
- `test:vitest` fallback script is missing from any of the three workspaces
- TypeScript compilation errors introduced by the migration
- Lint errors introduced by the migration

**Action**: Fix immediately. Block merge until resolved.

### In-scope-Fix

A finding that is within the scope of this issue and should be fixed in
this PR, but does not block if it's a minor refinement.

**Criteria**:
- A vi.mock factory uses `await import()` instead of `importActual` and
  deadlocks under Bun (must refactor — this is REQ-006)
- JUnit XML output path inconsistency between workspaces
- Missing `--junit` flag on a `test:ci` script that other migrated workspaces
  have
- A bunfig.toml preload path that doesn't match the established pattern
- Test count parity discrepancy (Bun reports different count than vitest for
  a workspace — must investigate and resolve)

**Action**: Fix in this PR. May require a review iteration but not a
fundamental rework.

### Reject

A finding that is out of scope and must NOT be addressed in this PR.

**Criteria**:
- Suggestions to add/remove/change dependencies
- Suggestions to refactor production source code (this is a test-only
  migration)
- Suggestions to create public abstractions or shared utilities beyond what
  the established migration pattern already provides
- Suggestions to clean up unrelated code, formatting, or imports in files
  not touched by the migration
- Suggestions to change other workspaces' test configurations
- Suggestions to modify the `test-d.ts` typecheck files or vitest typecheck
  configuration (these are vitest typecheck-only, not runtime tests)
- Suggestions to add ESLint disable comments or `@ts-ignore`/`@ts-expect-error`
  directives
- Suggestions to loosen complexity/source-size rules
- Suggestions to split the PR into multiple PRs (the issue explicitly
  requires a single PR)
- Suggestions to defer any test file to a future sub-issue
- Suggestions to change CI workflows beyond the exact execution needed for
  these three workspaces
- Suggestions to modify the shard map in test-shards.ts (the `rest` shard
  already owns tools/mcp/storage)

**Action**: Acknowledge and explicitly reject with rationale: "Out of scope
for #2846. This PR migrates test execution infrastructure only."

### Defer

A finding that is valid but should be addressed in a separate follow-up
issue, not this PR.

**Criteria**:
- Bun fake-timer incompatibilities on specific platforms (like the providers
  manifest exclusions for Linux CI) — these are runtime bugs in Bun, not
  migration defects; if encountered, document and create a follow-up issue,
  but DO NOT exclude the test from this PR's manifest (the issue requires
  every test file)
- Performance improvements to the test runner (e.g., parallelization)
- Consolidation of vitest.config.ts files across workspaces
- Migration of test-d.ts typecheck tests to a Bun-native equivalent
- Improvements to augment-bun-vi.ts compatibility surface

**Action**: Create a follow-up issue. Note in the PR description. Do not
block this PR on it.

## Special Case: Bun Runtime Bugs

If a test file fails under Bun due to a genuine Bun runtime bug (not a
Vitest API incompatibility), the resolution depends on severity:

1. **If the bug has a workaround**: Apply the workaround in the test file
   (minimal change, documented with a comment citing the Bun issue).
2. **If the bug has no workaround**: This is a Blocker. The issue requires
   every test file. Document the blocker, investigate the Bun issue, and
   if it cannot be resolved, escalate rather than excluding the file.

**Under no circumstances** may a test file be excluded from the manifest or
newly skipped to work around a Bun bug. This violates REQ-003.

## Special Case: SecureStore CI Tests

The `secure-store.native-keyring.test.ts` and
`secure-store.fallback-behavior.test.ts` (+ `provider-key-storage.fallback.test.ts`)
run in a dedicated CI job with dbus/gnome-keyring on Linux. They use
vitest config-file selection (`--config vitest.config.native-keyring.ts`).

These tests MUST continue to run in CI. The migration approach:
- They ARE included in the bun-test-manifest (they're vitest-importing test
  files in packages/storage)
- The `secure_store_backend` CI job continues to use vitest for these
  specific tests via the `test:vitest` fallback (the config-file selection
  mechanism is vitest-specific)
- The storage package.json needs a script entry that supports
  `--config vitest.config.X.ts` passthrough on the vitest path

If during migration these tests are found to work under Bun (without the
dbus/gnome-keyring env they'll skip or test the fallback path), they should
also be added to the manifest. But the CI job must still run them via
vitest with the special environment.

## Pre-existing Skips

Tests that are ALREADY `.skip`'d or `it.skipIf`'d under vitest are
preserved as-is. These are not "newly skipped" tests. The parity check
accounts for them: Bun will report the same skip count.
