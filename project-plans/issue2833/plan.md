/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

# Issue #2833 — deterministic K3 TERM rollback test

Plan ID: `PLAN-20260804-ISSUE2833`

## Scope decision

This issue changes the existing K3 behavioral test in
`scripts/tests/assign-remediation11.bun.test.ts`, imports made unused by that
change, and the manifest/config references required to execute the touched test
with Bun's native test runner. The real production script, fake GitHub
implementation, shared test helpers, dependencies, and the PR-path CI workflow
remain unchanged.

Both touched test modules are converted from Vitest to `bun:test` as required by
the repository's TypeScript/Bun migration policy:

- `scripts/tests/assign-remediation11.bun.test.ts` — the K3 TERM module (the
  primary flaky target under repair).
- `scripts/tests/assign-remediation8b.bun.test.ts` — the sibling F14 TERM
  module ("rolls back bot-owned mutations when TERM arrives after assignee
  mutation"). This module shares the same deterministic `signal_parent` TERM
  harness and the same 30-second macOS boundary failure mode, so it is converted
  and registered alongside K3 to keep both issue-specific TERM modules on the
  Bun-native runner. The rename moves it out of the scripts vitest selection
  (`*.bun.test.ts` is excluded) into the `scripts-assignment` Bun manifest
  workspace, preserving its existing effective 30-second timeout via
  `setDefaultTimeout(30000)` (no increase, no per-test option — Bun has none).

Both files are registered together in a single `scripts-assignment` entry of
`scripts/bun-test-manifest.ts`, and `tsconfig.scripts.json` is updated to
typecheck the renamed files. Migration of untouched script tests remains owned
by #2847.

## Root cause

The existing test does not synchronize TERM with the mutation event. It starts
`assign-issue.sh` in a background shell, polls every 10 ms for a hook file, and
then races `kill -TERM` against a fixed 500 ms fake-`gh` pause. Process startup,
filesystem visibility, polling, and signal scheduling are therefore all tied to
wall-clock speed.

The cited macOS jobs provide direct evidence of the boundary failure:

- job `90466328919`: the test ran for 32.503 seconds and exceeded its 30-second
  limit;
- job `90469047085`: the test ran for 32.076 seconds and exceeded the same
  limit;
- job `90483893846`: the same test passed in 28.972 seconds, only narrowly under
  the limit, and the sibling pause/poll TERM test passed in 28.643 seconds.

The fake `gh` already has a deterministic `signal_parent` action. Because its
wrapper uses `exec python3`, the Python process directly signals the real
assignment Bash process at the configured request boundary. The sibling
assignment lifecycle test already uses this mechanism successfully.

## Accepted behavior

### REQ-2833-1: deterministic signal delivery

**Given** the marker-label POST applies but reports an error,
**when** the assignee POST has applied,
**then** fake `gh` sends `SIGTERM` directly to the real assignment Bash process
at that exact post-mutation boundary, without polling, hook files, sleeps,
background process choreography, or retries.

### REQ-2833-2: preserve TERM lifecycle semantics

**Given** TERM arrives after this run has added the marker and assignee,
**when** the production TERM trap executes,
**then** the real script exits with status 143 and rolls back both the `alice`
assignee and `auto-assigned` marker.

### REQ-2833-3: preserve compatibility and scope

The production assignment behavior and public/test helper APIs remain
unchanged. The test keeps its existing timeout; the fix must remove the race
rather than masking it with a larger timeout or retry.

## Relevant inputs and boundary cases

| Input or boundary | Accepted result |
| --- | --- |
| First marker-label POST returns `applied_error` after applying the label | Test continues through the ambiguous-success verification path. |
| First assignee POST applies successfully | TERM is delivered only at its `post` side-effect boundary. |
| TERM trap executes after both mutations | Script returns exactly 143. |
| Rollback state | Issue 42 contains neither `alice` nor `auto-assigned`. |
| Slow or loaded macOS runner | No synchronization depends on elapsed time or filesystem polling. |
| Existing non-signal K3 and sibling signal scenarios | Continue to pass unchanged. |

## Test-first implementation plan

1. Preserve the existing behavioral fixture that makes the marker POST an
   `applied_error`.
2. Replace the assignee POST `pause` side effect with `signal_parent` and
   `SIGTERM`, retaining `timing: 'post'` and `on_nth: 1`.
3. Execute the real script through the existing synchronous `repo.runAssign`
   harness with zero election delay.
4. Assert exact status 143 and final absence of both assignee and marker.
5. Remove only imports and local machinery that become unused; retain imports
   used by K4.

The existing flaky test is the behavioral test being repaired, so no parallel
new test is needed. Before the fix it has already demonstrated the required
failure in two exact CI job logs; after the fix it must prove the same real
rollback behavior without the nondeterministic harness.

## Verification evidence required

- Run the affected K3 test at least 10 consecutive times; every run must pass.
- Run the complete `assign-remediation11.bun.test.ts` file with `bun test`.
- Run the converted sibling F14 module `assign-remediation8b.bun.test.ts` with
  `bun test`.
- Run the `scripts-assignment` Bun manifest workspace
  (`bun scripts/run_bun_tests.ts --workspace scripts-assignment`) so both
  registered issue-specific TERM modules execute together under the manifest
  runner.
- Run the Bun manifest consistency test
  (`scripts/tests/bun-test-manifest.bun.test.ts`) to confirm both files resolve
  to verified on-disk paths and the workspace entry stays well-formed.
- Run the sibling deterministic assignment signal lifecycle test.
- Run the full project verification suite:
  - `npm run test`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run format`
  - `npm run build`
  - `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`
- Complete DeepThinker and Open Code Review gates, triaging every finding as
  `Blocker-Fix`, `In-scope-Fix`, `Reject`, or `Defer`.
- Require green macOS CI on the candidate PR head, conflict-free mergeability,
  and correct ancestry before declaring the PR ready.

## CI evidence — macOS Bun manifest coverage

Both issue-specific TERM modules exercise real bash scripts against fake-gh and
historically flaked against the macOS 30-second boundary. Because the conversion
moves `assign-remediation8b` out of the vitest scripts shard (vitest excludes
`*.bun.test.ts`), macOS coverage for it would otherwise be lost. To preserve
exact macOS coverage without duplication, the nightly `macos_ci` job runs the
`scripts-assignment` Bun manifest workspace once:

```
bun scripts/run_bun_tests.ts --workspace scripts-assignment --timeout 30000
```

This runs only the two registered `scripts-assignment` files, does not route
them back through Vitest, and adds the required macOS evidence alongside the
ubuntu `bun_native_test_parity` job (which runs the full manifest on Linux). The
smallest bounded workflow change is one new step in `macos_ci`, placed after the
existing script-harness and shell-script behavioral test steps.

## Explicit non-goals

- No production rollback changes.
- No timeout increase, retry, fake timer, or extra defensive fallback.
- No new abstraction or shared helper.
- No migration of untouched Vitest files or dependency change.
- No PR-path CI workflow change; the only CI change is the single bounded
  macOS nightly step that runs the `scripts-assignment` Bun manifest workspace.
  No test is routed back through Vitest or executed twice within either CI
  topology.
- No adjacent cleanup outside imports made unused by the K3 rewrite.
