# Issue #2746 — Port the VS Code notices generator to TypeScript and Bun

Issue #2746 is an umbrella migration whose full 178-file inventory exceeds the
bounded issue-delivery budget. This delivery selects the complete Tier 4
`vscode-ide-companion` notices-generator vertical slice. The canonical policy
path named by the issue, `dev-docs/workflow/ISSUE-DELIVERY.md`, is still absent
from current `main` even after the rebase onto `origin/main` that brought in
companion PR #2751; it is also absent at the issue's GitHub contents path. This
plan applies the policy requirements stated directly in the issue and follows
the repository's prior bounded plan format.

## Goal

Port the VS Code companion's notices generator and its behavioral test from
JavaScript to strict TypeScript, place both files under the repository scripts
typecheck, and execute the generator with Bun without changing generated
notice behavior.

## Acceptance matrix

| #   | Accepted behavior                                                                                                                                                               | Behavioral evidence                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | The notices generator and its test exist as `.ts` files; the two former `.js` paths no longer exist.                                                                            | Git diff and a path-existence check show the two renames and no duplicate JS files.                                                                                                                                                                                                                                                                                                                                                                   |
| A2  | The generator continues to canonicalize deprecated `git://github.com/` repository URLs while preserving canonical, non-GitHub, sentinel, `null`, and `undefined` inputs.        | The converted `generate-notices.test.ts` runs its five existing behavioral cases against the real exported function.                                                                                                                                                                                                                                                                                                                                  |
| A3  | Both converted files are checked by strict TypeScript through `tsconfig.scripts.json`.                                                                                          | Both exact paths appear in `tsconfig.scripts.json`; `npm run typecheck` passes.                                                                                                                                                                                                                                                                                                                                                                       |
| A4  | Package notice generation and prepare lifecycle entries invoke the TypeScript generator with Bun.                                                                               | `package.json` contains `bun ./scripts/generate-notices.ts` for both entries; `npm run generate:notices --workspace llxprt-code-vscode-ide-companion` succeeds.                                                                                                                                                                                                                                                                                       |
| A5  | Notice generation remains deterministic for the checked-in dependency state.                                                                                                    | Same-state comparison: materialized HEAD's `generate-notices.js` as a temporary `.mjs` in the package scripts directory, ran it with Node to capture output (SHA-256 `49306fd9…309f3`, 559,902 bytes), restored NOTICES, ran the TypeScript generator with Bun (SHA-256 `49306fd9…309f3`, 559,902 bytes), verified byte-for-byte identical, removed the temporary `.mjs`. `git diff --exit-code -- packages/vscode-ide-companion/NOTICES.txt` passes. |
| A6  | The slice introduces no lint/complexity escape hatch or rule weakening.                                                                                                         | `npm run lint`, `npm run lint:eslint-guard`, and diff inspection pass with no new suppression directives or quality-config changes.                                                                                                                                                                                                                                                                                                                   |
| A7  | Repository behavior remains green on the exact candidate head.                                                                                                                  | Full test, lint, typecheck, format, build, and configured smoke commands pass; PR CI passes on the same head.                                                                                                                                                                                                                                                                                                                                         |
| A8  | After the rebase onto `origin/main` (which merged companion PR #2751), the two selected `.js` paths are removed from the baseline allowlist `scripts/no-new-js-allowlist.json`. | The allowlist drops exactly the two former notices JS paths (`generate-notices.js`, `generate-notices.test.js`); no other entries change. `bun scripts/check-no-new-js-files.ts` passes against the renamed `.ts` files. This allowlist data-file edit is explicitly required by issue #2746 and is the planned post-merge contingency for the companion #2745 guard, not authorization to modify the companion quality tool or workflow.             |

## Explicit non-goals

- Porting Tier 1 script tests/helpers, Tier 2 production scripts, or Tier 3
  integration tests. Those are separate bounded slices of umbrella #2746.
- Porting `packages/vscode-ide-companion/esbuild.js` or
  `eslint.config.mjs`; neither is one of the two Tier 4 paths named by the
  issue.
- Refactoring notice collection, license selection, output formatting, or
  package metadata behavior beyond changes required for strict typing.
- Adding a public abstraction, dependency, workflow change, agent-memory
  change, quality-tool change, or lint/type suppression.
- Changing or moving unrelated tests.
- Editing historical `project-plans` references.
- Editing the JavaScript baseline allowlist beyond the two issue-#2746-selected
  notices paths. Companion PR #2751 is merged into `origin/main`; the guard
  (`scripts/check-no-new-js-files.ts`) and its baseline
  (`scripts/no-new-js-allowlist.json`) are present. Removing the two selected
  `.js` paths from that baseline is the planned post-merge contingency and is
  recorded as accepted behavior A8 / in scope / done. The allowlist data-file
  change is not authorization to modify the companion quality tool, workflow,
  agent memory, or any other entry.

## Bounded vertical slices

1. **Typecheck RED:** Rename the generator and test, update their local import,
   and add both exact paths to `tsconfig.scripts.json`. Preserve the passing
   five-test behavioral baseline while demonstrating that strict typecheck
   initially fails on the untyped JavaScript implementation.
2. **Strict TypeScript GREEN:** Add the minimum domain types and annotations
   needed for strict typecheck and existing lint/complexity rules. Preserve
   runtime behavior and avoid new abstractions beyond file-local types.
3. **Bun entry points:** Change only the package's `generate:notices` and
   `prepare` commands from Node/JS to Bun/TS. Run the generator and prove the
   checked-in notices output is unchanged.
4. **Exact-head gates:** Run focused evidence, full local verification,
   reviews, scope review, then PR CI and review triage.

## Expected paths

- Focused test:
  `npm run test --workspace llxprt-code-vscode-ide-companion -- scripts/generate-notices.test.ts`
- Generator smoke:
  `npm run generate:notices --workspace llxprt-code-vscode-ide-companion`
- Script typecheck coverage: `npm run typecheck`, with both selected paths in
  `tsconfig.scripts.json`.
- Package lifecycle: `npm run prepare --workspace llxprt-code-vscode-ide-companion`
  invokes Bun on the TypeScript generator.
- Repository gates: `npm run test`, `npm run lint`, `npm run typecheck`,
  `npm run format`, `npm run build`, and the repository smoke command.

## Files to edit (scope ledger)

| Path                                                                                          | Planned change                                                                                                                                    | Status                                                                                                                                            |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/vscode-ide-companion/scripts/generate-notices.js` → `generate-notices.ts`           | Rename and add strict file-local types without behavior changes. Zod schemas replace shallow predicates at all external-input boundaries (F1–F4). | Done — strict types added, Zod validation at root package/lockfile/dep-metadata/npm-time boundaries, tsc exit 0, no `any`/assertions/suppressions |
| `packages/vscode-ide-companion/scripts/generate-notices.test.js` → `generate-notices.test.ts` | Rename and update the local import extension; retain behavioral coverage; add RED-first behavioral tests for F1–F5 findings.                      | Done — import updated to `.ts`, 9/9 tests pass (5 existing + 4 new behavioral tests using temp filesystem/process fixtures)                       |
| `packages/vscode-ide-companion/package.json`                                                  | Run the two notice lifecycle entries with Bun and the `.ts` path.                                                                                 | Done — `generate:notices` and `prepare` now `bun ./scripts/generate-notices.ts`                                                                   |
| `tsconfig.scripts.json`                                                                       | Add the two exact converted paths.                                                                                                                | Done — both paths registered, `tsc --project tsconfig.scripts.json` exit 0                                                                        |
| `dev-docs/plans/2026-07-26-issue-2746-vscode-notices-typescript.md`                           | Record this decision-complete bounded delivery including DeepThinker remediation and A5 same-state evidence.                                      | Done — A5 evidence updated with same-state SHA-256 comparison; F1–F7 triage recorded                                                              |
| `scripts/no-new-js-allowlist.json`                                                            | Remove the two former notices JS paths from the baseline after companion PR #2751 merged the guard onto `main`.                                   | Done — exactly the two selected paths removed (169 → 167 entries); `bun scripts/check-no-new-js-files.ts` passes; no other entries touched (A8).  |

Planned total: **6 logical paths** (two renames), with less than **1,500 net
changed lines**. This is below the 25-file / 1,500-line review threshold and
well below the 40-file / 2,500-line stop threshold.

## Scope ledger

| Entry                                                                   | Classification                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Tier 4 notices generator + test TypeScript conversion                   | Accepted / in scope                                                                                                 |
| Strict typecheck registration                                           | Accepted / in scope                                                                                                 |
| Bun package entry points                                                | Accepted / in scope                                                                                                 |
| Existing notices behavioral coverage and deterministic generation       | Accepted / in scope                                                                                                 |
| Tiers 1–3 and other JavaScript files                                    | Deferred to later bounded #2746 slices                                                                              |
| Companion #2745 allowlist reduction (two selected notices paths)        | Accepted / in scope / done (A8); PR #2751 merged onto `origin/main`, baseline is `scripts/no-new-js-allowlist.json` |
| Workflow, quality-tool, dependency, public API, or agent-memory changes | Out of scope; stop for approval                                                                                     |
| Unrelated refactors, test moves, and behavior changes                   | Out of scope; stop for approval                                                                                     |

Stop for approval before adding an unplanned path/subsystem or public
abstraction; making a workflow, agent-memory, quality-tool, or dependency
change; moving an unrelated refactor/test; implementing behavior outside A1–A8;
or crossing 25 files / 1,500 net lines. Stop without approval above 40 files or
2,500 net lines.

## TDD and verification plan

1. Establish the existing five-test behavioral baseline on the JS files.
2. Rename both files and register them in the scripts typecheck; run the
   focused test to preserve behavior and capture strict typecheck as RED.
3. Add only the types required to make strict typecheck and lint GREEN.
4. Update the two package commands, run Bun notice generation, and verify
   `NOTICES.txt` has no diff.
5. Run full local gates and the configured model smoke test.
6. Run one clean DeepThinker review and local Open Code Review. Classify every
   finding as `Blocker-Fix`, `In-scope-Fix`, `Reject`, or `Defer`; reviewer
   suggestions do not expand this matrix. Use no more than two local and two PR
   OCR runs.
7. Confirm exact-head evidence, clean scope ledger, correct ancestry,
   conflict-free PR, and green CI before declaring completion. Stop once A1–A8
   and required gates are complete; do not continue optional cleanup.

## Review finding triage

### DeepThinker review

| Finding                                                                                       | Classification | Resolution                                                                                                                           |
| --------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| F1 — root package.json schema should require `dependencies` (Zod non-optional)                | Blocker-Fix    | Fixed: `rootPackageSchema` declares `dependencies` as non-optional `z.record(z.string())`.                                           |
| F2 — external package.json metadata parsed without schema validation                          | In-scope-Fix   | Fixed: `packageJsonMetadataSchema` validates author/contributors/maintainers/license/repository/dependencies via Zod.                |
| F3 — lockfile package entries parsed without schema validation                                | In-scope-Fix   | Fixed: `lockfilePackageSchema` and `lockfileSchema` validate version/link/resolved/dependencies and the top-level `packages` record. |
| F4 — npm `time` JSON parsed without schema validation                                         | Blocker-Fix    | Fixed: `npmTimeSchema` validates the `created` field before extracting the year.                                                     |
| F5 — `getFirstPublishYear` returns current year on invalid date without surfacing the problem | In-scope-Fix   | Fixed: `isFiniteYear` guard throws on out-of-range years, surfaced as a warning with the raw date.                                   |
| F6 — module runs `main()` on import (breaks test isolation)                                   | Blocker-Fix    | Fixed: `main()` only invoked when `process.argv[1]` matches the module file path.                                                    |
| F7 — additional refactors to notice collection / license selection                            | Defer          | Deferred: out of scope for this bounded slice.                                                                                       |

### Local Open Code Review (first run)

| Finding                                                                                                      | Classification         | Resolution                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OCR-1 — dead `packageJson.dependencies ? … : []` ternary because `rootPackageSchema` requires `dependencies` | In-scope-Fix           | Fixed: replaced with `Object.keys(packageJson.dependencies)` directly.                                                                                                                                                |
| OCR-2 — `normalizeGitHubRepositoryUrl(fallbackRepo) ?? fallbackRepo` flagged as dead code                    | Reject                 | Not actionable: the function signature legitimately returns `string \| null \| undefined`; the nullish coalescing narrows the result without a type assertion and preserves the fallback string. No change.           |
| OCR-3 — fixture temp directory relies on root `tmp/` which may not exist on fresh clones                     | Blocker-Fix            | Fixed: fixture temp created under `packages/vscode-ide-companion/.notices-test-…` so Bun module resolution walks the package/root `node_modules` and cleanup removes it without symlinks.                             |
| OCR-4 — `spawnSync` result error not surfaced on failure                                                     | In-scope-Fix           | Fixed: if `result.error` exists after spawn, throw a descriptive `Error` so runtime/tooling failures are clear.                                                                                                       |
| OCR-5 — compound boolean assertions hide which sub-condition failed                                          | In-scope-Fix           | Fixed: converted to single structured object equality per behavior with named fields (`status`, `hasWarning`, `includesYear`, `excludesNaN`; `status`, `hasSentinel`), preserving the RULES.md single-assertion rule. |
| OCR-6 — duplicate/mispositioned comments for OCR-1 and OCR-5                                                 | (same classifications) | No additional changes.                                                                                                                                                                                                |

### Local Open Code Review (second run)

| Finding                                                                                                       | Classification   | Resolution                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OCR2-1 — repeated fallback `?? fallbackRepo` flagged as dead code (duplicate of OCR-2)                        | Reject           | Not actionable: the public union signature `string \| null \| undefined` requires narrowing without a type assertion; the nullish coalescing preserves the fallback string and the runtime behavior is correct. No change.                                                                                                                                                          |
| OCR2-2 — fail-fast throw on lockfile entries without a string version should skip entries / warn-and-continue | Reject (factual) | The OCR claim that the original JavaScript skipped entries without versions is factually incorrect: the original JS inserted `undefined` and emitted `package@undefined`. The new fail-fast throw is intentional correctness/safety for malformed external lockfile data, covered by a RED-first behavioral test and the fail-fast architecture. Do not change to warning/continue. |
| OCR2-3 — fake npm wrapper hardcodes `node` runtime instead of the project-required Bun runtime                | In-scope-Fix     | Fixed: the fake `npm` POSIX shell wrapper and the `npm.cmd` Windows wrapper now invoke `bun` (resolved from PATH) rather than `node`, with robust quoting and path escaping and no assertions. The child generator is executed by `bun`, and Vitest itself may run under Node, so `bun` from PATH is used instead of `process.execPath`.                                            |
| OCR2-4 — `spawnSync` failure should return a fabricated status instead of throwing                            | Reject           | Not actionable: the fail-fast throw on spawn infrastructure error surfaces runtime/tooling failures rather than hiding them behind a fabricated status, consistent with the fail-fast preference. No change.                                                                                                                                                                        |
| OCR2-5 — repository-string test name references "HEAD semantics"                                              | In-scope-Fix     | Fixed: renamed the test to plain behavioral language ("yields the 'No repository found' sentinel when package.json repository is a string rather than an object") without the misleading "HEAD semantics" framing.                                                                                                                                                                  |
