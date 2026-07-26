# Issue #2705 — CLI per-file test setup cost

## Policy status

`dev-docs/workflow/ISSUE-DELIVERY.md` is not present on `main`, in any local Git
history, or at the GitHub `main` contents endpoint as of this branch creation.
This ledger applies the bounded policy requirements supplied in issue #2705
directly. `dev-docs/RULES.md` remains authoritative for behavioral TDD.

## Acceptance matrix

| ID  | Accepted behavior                                                                                                                                                                 | Behavioral evidence                                                                                                                                                | Completion gate                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| AC1 | Node-only CLI test files run without a jsdom environment.                                                                                                                         | Routing test proves representative and discovered node-only files are assigned to a node project; a node-project behavior test observes no `window` or `document`. | Full suite passes and post-change project listing has no jsdom-required file in the pure-node group. |
| AC2 | Pure node files do not load React or `ink-testing-library`; React/Ink rendering tests use full setup under node; DOM tests use full setup under jsdom.                            | RED-first grouping tests prove the three disjoint groups from source requirements, and full-suite execution proves setup behavior.                                 | Groups are exhaustive and disjoint; full suite passes.                                               |
| AC3 | Shared setup retains storage isolation, provider-alias/Ink mocks, custom matchers, process-listener restoration, logger cleanup, cleanup-state reset, and provider-runtime reset. | Existing suite plus focused node-environment behavior tests for setup state where needed.                                                                          | No setup-dependent regressions in targeted and full tests.                                           |
| AC4 | Global setup no longer evaluates the core barrel for two reset symbols.                                                                                                           | Source/config review and passing tests with the two supported narrow export subpaths.                                                                              | `test-setup-base.ts` contains no root `@vybestack/llxprt-code-core` import.                          |
| AC5 | Test isolation remains enabled.                                                                                                                                                   | Config behavior test and config review.                                                                                                                            | No `isolate: false` or `--no-isolate`; default isolation retained.                                   |
| AC6 | The executing test-file set is unchanged.                                                                                                                                         | Authoritative `npx vitest list --filesOnly --no-color` before/after sorted diff. Baseline is 464 files.                                                            | After union is exactly the 464-file baseline, with no duplicates; full result remains 464 files.     |
| AC7 | Setup CPU is less than 10 times test CPU for the CLI package.                                                                                                                     | Before/after `npx vitest run --reporter=dot --no-color` Duration lines locally and authoritative CI Duration line on the candidate head.                           | CI setup/tests ratio is below 10; issue comment records phases and file/test counts.                 |
| AC8 | Existing special selection semantics remain intact, including excluded React-19 tests and the multi-runtime integration carve-out.                                                | Grouping behavior tests cover exclusion/re-inclusion and argv-dependent integration inclusion; list diff covers normal mode.                                       | Tests and list evidence pass without changing the intended selected set.                             |

## Baseline evidence

- GitHub CI run 30167877866: 464 files; setup 1254.71s, collect 102.14s,
  tests 78.04s, environment 324.62s; duration 702.90s.
- Candidate-machine pre-change file listing: 464 files, captured at
  `/tmp/issue2705-before-files.txt`.
- Candidate-machine pre-change run: 464 files, 5593 tests (5390 passed,
  199 failed, 4 skipped); setup 2267.93s, collect 204.80s, tests 124.49s,
  environment 524.23s; duration 259.94s. The failures exist on the untouched
  `origin/main` candidate ancestor and are retained as diagnostic evidence;
  candidate-head local verification must still satisfy the repository gate or
  be backed by exact upstream CI evidence before completion.

## Bounded vertical slices

1. **Selection and routing contract (RED):** add private configuration grouping
   tests proving the selected set is exhaustive/disjoint, explicit re-includes
   work, jsdom dependencies route to jsdom, rendering dependencies route to a
   node React/Ink group, and pure tests route to base node.
2. **Setup split (GREEN):** extract node-safe setup, narrow the two core imports,
   and leave the existing full setup as a compatibility layer over the base.
3. **Project split (GREEN):** configure pure-node, React/Ink-node, and jsdom
   projects from the tested private grouping helper while preserving common
   aliases, coverage, reporters, timeouts, pool limits, isolation, exclusions,
   and multi-runtime behavior.
4. **Measurement and evidence:** prove pre/post file-set equality, run targeted
   and full suites, record phase timings locally and in CI, and post the results
   to issue #2705.

## Expected paths

- `project-plans/issue-2705-cli-test-setup-cost.md` — this acceptance/scope ledger
- `packages/cli/vitest.config.ts` — project wiring and unchanged shared settings
- `packages/cli/vitest.test-groups.ts` — private, config-only file discovery and routing
- `packages/cli/vitest.test-groups.test.ts` — RED-first grouping behavior tests
- `packages/cli/test-setup-base.ts` — node-safe shared setup
- `packages/cli/test-setup.ts` — full React/Ink layer over shared setup

No other path is authorized without updating this ledger and checking the stop
conditions below. Adding an unplanned subsystem/public abstraction, dependency,
workflow, agent memory, quality-tool change, unrelated refactor/test move, or
behavior outside this matrix requires user approval before implementation.

## Explicit non-goals

- No `isolate: false`, `--no-isolate`, or other semantic weakening.
- No thread-count tuning, sharding, coverage reduction, skipped/removed tests,
  or test-file relocation.
- No React 19 repair, removal of the currently inert internals compatibility
  code, cleanup rewrite, or expansion of the runnable React test set.
- No core export-surface refactor (#2618), dependency changes, workflow changes,
  lint/type suppressions, or complexity/source-size threshold changes.
- No changes to sibling Vitest configs beyond preserving their current behavior
  through `test-setup.ts` composition.
- No optional hardening or cleanup after accepted behavior and gates pass.

## Scope ledger

### Approved scope

| Slice                                          | Paths                                                                                                                          | Status                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| Acceptance and scope record                    | `project-plans/issue-2705-cli-test-setup-cost.md`                                                                              | Done                   |
| Routing contract                               | `packages/cli/vitest.test-groups.ts`, `packages/cli/vitest.test-groups.test.ts`                                                | Done                   |
| Setup split                                    | `packages/cli/test-setup-base.ts`, `packages/cli/test-setup.ts`                                                                | Done                   |
| Project wiring                                 | `packages/cli/vitest.config.ts`                                                                                                | Done                   |
| Cleanup state extraction (Finding 8 expansion) | `packages/cli/src/utils/cleanup-state.ts` (new), `packages/cli/src/utils/cleanup.ts`, `packages/cli/src/utils/cleanup.test.ts` | In progress (approved) |

### Scope expansion approval (Finding 8)

User approved a bounded scope expansion on 2026-07-25 to fully resolve
Finding 8 (setup ratio >10x caused by transitive core barrel evaluation
through `cleanup.ts`). The expansion adds three paths to the ledger:

- `packages/cli/src/utils/cleanup-state.ts` — new private lightweight state
  module with NO `@vybestack/llxprt-code-core`, React, ink, or cleanup.ts
  imports. Owns cleanup registration state and its state operations.
- `packages/cli/src/utils/cleanup.ts` — refactored to consume/re-export
  from `cleanup-state.ts` for backward compatibility. Retains all existing
  exports (`registerCleanup`, `registerSyncCleanup`, `runExitCleanup`,
  `__resetCleanupStateForTesting`, `cleanupCheckpoints`).
- `packages/cli/src/utils/cleanup.test.ts` — behavioral tests for reset and
  queue/draining semantics that protect the extraction.

Design constraints (per approval):

- Immutable state reassignment and explicit queue operations; no mutable
  arrays exposed from the private state module.
- The lightweight module must actually own the state it resets (not merely
  move the test reset while leaving state in cleanup.ts).
- No defensive fallbacks or swallowed internal errors; preserve only the
  existing external cleanup tolerance behavior.
- Production cleanup still destroys PTYs and disposes FileOutput as before.

### Budget

- Local target: at most 8 files and 800 net changed lines.
- Mandatory scope review above 25 files or 1,500 net changed lines.
- Hard stop without approval above 40 files or 2,500 net changed lines.
- Pre-expansion ledger: 6 files, 1563 added / 312 deleted (net 1251).
- Post-expansion ledger (approved 2026-07-25): 9 paths (adds
  cleanup-state.ts, cleanup.ts, cleanup.test.ts).
- Final scope counts: 9 paths. Tracked changes: 373 added / 351 deleted.
  New files: cleanup-state.ts (115), test-setup-base.ts (217),
  vitest.test-groups.ts (477), vitest.test-groups.test.ts (386), and this
  project ledger. The code/test/config net is 1,195 lines; the complete diff
  including this evidence ledger remains above the 1,500-line review trigger.
- **Note:** The mandatory scope review below covers the user-approved nine-path
  expansion. The change remains far below the 40-file / 2,500-line hard stop,
  and no further scope expansion is planned.

## Review-finding classifications

Every finding must be recorded as one of:

- **Blocker-Fix:** accepted behavior, safety, data loss, or required gate failure.
- **In-scope-Fix:** defect or maintainability issue wholly inside approved paths/behavior.
- **Reject:** factually incorrect, already satisfied, or harmful suggestion.
- **Defer:** valid but outside this matrix/budget; no implementation without approval.

Reviewer suggestions never authorize scope expansion. Local OCR is limited to two
runs and PR OCR is limited to two runs for this issue/PR effort.

## Review finding dispositions

| Finding                                            | Classification | Resolution/evidence                                                                                                                                     |
| -------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render-helper tests received base-only setup       | Blocker-Fix    | Runtime imports of `test-utils/render.js` now route to React/Ink-node; behavioral routing tests pass.                                                   |
| Discovery depended on `process.cwd()`              | Blocker-Fix    | Package root derives from `import.meta.url`; package-root, repository-root, and unrelated-cwd listings match.                                           |
| Main projects leaked into sibling configs          | Blocker-Fix    | Projects attach only for main config; focused agentStream/mutation listings retain HEAD behavior.                                                       |
| Regex classification matched comments/strings      | Blocker-Fix    | TypeScript AST classifies runtime imports; type-only imports and text false positives are ignored.                                                      |
| Environment tests asserted unused metadata         | Blocker-Fix    | Pure-node tests observe no React globals and an independent file-selection oracle cross-checks discovery.                                               |
| Include/exclude contracts were duplicated          | In-scope-Fix   | One exported contract is consumed by discovery and config.                                                                                              |
| New type/non-null assertions                       | In-scope-Fix   | Removed from grouping/config/base-setup changes; structural searches found none.                                                                        |
| Setup still loaded the core barrel through cleanup | Blocker-Fix    | Approved private cleanup-state extraction removes that dependency; cleanup tests pass and final local setup/tests is 0.934x. CI evidence remains required. |
| Native absolute-path slicing                       | In-scope-Fix   | Project paths remain normalized package-relative paths.                                                                                                 |

## Mandatory scope review

The approved nine paths form one vertical slice: test routing/setup, cleanup-state
extraction required to remove the remaining setup barrel import, behavioral
tests, and this ledger. No dependency, workflow, public API, test move, quality
configuration, or unrelated production behavior was added. The file count is
well below the hard budget. Net changed lines crossed 1,500 only because the
ledger and behavior tests record the bounded policy and preserve cleanup/routing
semantics; optional work is excluded. Scope is accepted with no further paths.

## Candidate-head evidence (local, post-remediation)
## Open Code Review dispositions

Local OCR run `20260726T025013Z-ef16ed9b` reviewed all eight changed code/test
files with StepFun `step-3.7-flash`; coverage was `complete_best_effort`.
Duplicate comments were grouped by root cause.

- **In-scope-Fix:** cache grouping results to eliminate repeated full-tree parses;
  use `os.tmpdir()` in the cwd test; verify asynchronous rejection continuation;
  rename the inaccurate pre-drain reset test; classify TSX with `ScriptKind.TSX`;
  ignore type-only re-exports; recognize React subpaths; remove the inaccurate
  dynamic-import comment; and detect any explicit sibling config rather than two
  hardcoded filenames. Focused lint and 56 behavioral tests pass afterward.
- **Reject:** cleanup reset re-export (pre-existing compatibility contract),
  one-shot cleanup behavior (intentional until explicit test reset), project
  coverage duplication (root config is required by sibling configs), hard startup
  file-count assertion (would fail normal test additions), fallible internal
  `onError` defense, and per-reset `try/catch` wrappers (contrary to fail-fast).
- **Defer:** cross-type registration during draining and concurrent reset semantics
  would define new production behavior outside this issue. Extensionless render
  imports are not used by the selected suite and project imports require `.js`.
- **Duplicate groups:** reset re-export (2), one-shot behavior (2), cleanup error
  wrappers (2), base/full teardown wrappers (2), and classifier findings repeated
  in the OCR output were dispositioned once per root cause.

Artifacts: `/Users/acoliver/Library/Logs/llxprt-code/opencodereview/runs/20260726T025013Z-ef16ed9b`.


### File-set preservation (AC6)

- `npx vitest list --filesOnly --no-color | sort | uniq` → 465 unique paths
  (464 baseline +1 new `vitest.test-groups.test.ts`); zero duplicates.
- `diff <(sort /tmp/issue2705-before-files.txt) <(sort after)` → only
  `464a465 > vitest.test-groups.test.ts`. No baseline file added, removed, or
  duplicated.

### Project distribution (post-remediation)

- `npx vitest list --filesOnly --no-color` project prefixes:
  `[pure-node]` 359 files, `[react-ink-node]` 68 files, `[jsdom]` 38 files.
  Total 465.

### Full run (post-remediation, local)

- Command: `npx vitest run --reporter=dot --no-color --no-coverage`
- Result: **465 test files passed (465), 5622 tests passed, 4 skipped, 0 failed.**
  1 unhandled error (vitest-worker timeout calling `onTaskUpdate`, not a test
  failure).
- Duration 421.57s; transform 130.97s, setup 3513.61s, collect 487.21s,
  tests 272.22s, environment 61.20s, prepare 94.16s.
- Setup/tests ratio: 12.90x (was 15.09x pre-remediation; still above 10x gate,
  see Finding 8).

### Final full run (local, coverage enabled)

- Command: `npx vitest run --reporter=dot --no-color`
- Result: 465 test files selected; 464 passed and the unchanged
  `AppContainer.mount.test.tsx` suite failed during collection. All 5627
  collected tests passed, with 4 skipped. Running that file with the exact
  `HEAD` Vitest config reproduces the same `node:process` mock failure, proving
  it is not caused by project routing.
- Duration 167.14s; transform 41.23s, setup 120.40s, collect 1265.40s,
  tests 128.94s, environment 32.33s, prepare 53.71s.
- Setup/tests ratio: **0.934x** (was 12.90x before the cleanup-state
  extraction). The pure-node base setup no longer evaluates the core barrel
  through cleanup.ts.
- Project-level duplicate coverage settings were removed after they caused a
  V8 coverage aggregation `ENOENT`; the root coverage configuration remains
  authoritative and the corrected run had no coverage-provider error.

### RED→GREEN evidence (round 2)

- RED: `vitest.test-groups.test.ts` (33 tests) run against pre-remediation
  helper → 24 failed, 9 passed. Failures caused by missing exports
  (`PACKAGE_ROOT`, `SELECTED_FILE_COUNT`, `EXPLICIT_INCLUDE_PATTERNS`),
  render-helper routing not detected, and jsdom false-positive on the
  meta-test itself.
- GREEN: after remediation, all 33 behavioral tests pass:
  `npx vitest run vitest.test-groups.test.ts --no-color --no-coverage` →
  33/33 passed, duration 77.90s.

### Narrow core subpaths (AC4)

- `test-setup-base.ts` imports `@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js`
  and `@vybestack/llxprt-code-core/debug/DebugLogger.js` — both verified as
  supported package.json exports; no root barrel import remains.
- `test-setup-base.ts` now imports `__resetCleanupStateForTesting` from
  `./src/utils/cleanup-state.js` (the new lightweight state module), NOT
  from `./src/utils/cleanup.js`. The base setup no longer transitively
  loads the core root barrel via cleanup. See Finding 8 (RESOLVED).

### Isolation (AC5)

- No `isolate: false`, no `--no-isolate`; default Vitest isolation retained.
- `poolOptions.threads.singleThread: true, maxThreads: 2` preserved per project.

### Sibling config compatibility

- `npx vitest list --config vitest.agentStream.config.ts` → 465 files, no
  project prefixes. Sorted set identical to HEAD (pre-change).
- `npx vitest list --config vitest.config.mutation.ts` → 4 files, unchanged.

### Verification commands

| Command                                                          | Result                                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npx vitest run vitest.test-groups.test.ts`                      | 33/33 passed                                                                                                                         |
| Focused cleanup, quit, and grouping suites                        | 56/56 passed                                                                                                                         |
| `npx vitest run --reporter=dot --no-color` (full, with coverage) | 465 selected; 464 passed, 1 HEAD-reproducible collection failure; all 5627 collected tests passed; setup/tests ratio 0.934x          |
| `npx vitest list --filesOnly --no-color`                         | 465 unique files; no baseline file missing; only new routing test added                                                              |
| `npx eslint <changed files>`                                     | Pass                                                                                                                                 |
| `npm run lint`                                                   | Pass                                                                                                                                 |
| `npm run typecheck`                                              | Pass                                                                                                                                 |
| `npm run format`                                                 | Pass                                                                                                                                 |
| `npm run lint:eslint-guard`                                      | Pass                                                                                                                                 |
| `npm run build`                                                  | Pass                                                                                                                                 |
| `npm run test`                                                   | All workspaces completed; CLI retained the HEAD-reproducible collection failure plus one external clipboard timeout                 |
| StepFun smoke test                                               | Pass; returned a three-line haiku                                                                                                    |
| Ollama Kimi smoke test                                           | Not runnable because `scripts/start.js` is absent in this checkout                                                                   |

### Baseline-reproduced local failures

- `AppContainer.mount.test.tsx` mocks `node:process` without `cwd`; the exact
  `HEAD` Vitest config reproduces `default.cwd is not a function`.
- The root-suite run also observed a platform clipboard probe timeout in
  `clipboardUtils.test.ts`; no changed path participates in that external OS
  command.
- These failures remain transparent. Exact-head CI is the authoritative
  completion gate and must pass before completion is declared.
