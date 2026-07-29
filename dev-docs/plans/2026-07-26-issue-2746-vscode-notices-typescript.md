# Issue #2746 — Migrate all portable JavaScript to TypeScript (whole-issue delivery plan)

> **Decision-complete delivery plan for GitHub issue #2746 and PR #2757.**
> This plan supersedes the earlier bounded Tier-4 notices slice. The notices
> work is preserved below as a **completed slice** (Slice 0) and is not
> re-executed. All remaining portable JavaScript/MJS across the repository is
> now in scope.

## Explicit scope authorization

The user reviewed the full 192-file inventory and the original 40-file /
2,500-line hard budget, then gave explicit approval to deliver the entire
issue rather than a bounded partial slice. The user's words were, in substance:
"do the whole issue, finish the job." This authorization is recorded here in
professional terms and governs every section that follows.

### What the authorization permits

- Converting **all 156 remaining portable JS/MJS files** to TypeScript,
  exceeding the former 40-file / 2,500-line thresholds.
- Updating **workflow references** (`.github/workflows/*.yml`) and
  **`package.json` script entries** wherever a rename requires it.
- Making **quality-compliant type fixes** — adding domain types, narrowing
  signatures, and validating external input — without weakening any rule.

### What the authorization does NOT permit

- Adding **new dependencies** (runtime or dev).
- **Weakening** lint rules, complexity thresholds, or type-strictness settings.
- Introducing **type or lint suppressions** (`@ts-ignore`, `@ts-expect-error`,
  `eslint-disable`, `as any`, non-null assertions used to silence errors).
- Performing **unrelated refactors** or **behavior changes** beyond what strict
  typing and renames require.
- Modifying **agent memory** (`.llxprt/`) or any agent configuration.
- Creating **new public abstractions** or exported APIs.
- Converting any of the **25 exempt CJS files** or changing behavior in the
  **11 final-allowlist entries**. A reference-only edit to an exempt CJS bridge
  is permitted when its imported implementation is renamed to `.ts`.

## Goal

Convert every portable JavaScript and MJS file in the repository to strict
TypeScript, register all converted files under the repository's script
typecheck, update every consumer reference (workflows, `package.json` commands,
cross-file imports), and reduce the no-new-JS allowlist to exactly 11 exempt
entries — without changing runtime behavior, adding dependencies, or weakening
quality gates.

## Fresh inventory (authoritative)

All counts derived from `git ls-files` on the current branch head.

### Top-level reconciliation

| Category                    | Count   | Treatment                      |
| --------------------------- | ------- | ------------------------------ |
| Total tracked JS/MJS/CJS    | **192** | —                              |
| CJS files (exempt)          | **25**  | Never converted; remain as-is  |
| JS/MJS files total          | **167** | Current allowlist baseline     |
| Final allowlist target      | **11**  | Permanently exempt (see below) |
| **Remaining portable**      | **156** | Convert to TypeScript          |
| Already converted (notices) | **2**   | Done (Slice 0, preserved)      |
| **Grand total portable**    | **158** | 156 remaining + 2 done         |

### Remaining portable breakdown (156)

| Category                         | Count   | Detail                                     |
| -------------------------------- | ------- | ------------------------------------------ |
| Script behavioral tests          | 81      | `scripts/tests/*.test.js`                  |
| Script test helpers              | 6       | `scripts/tests/*helpers*.js`               |
| Active production scripts (.js)  | 21      | `scripts/**/*.js` (non-test, non-helper)   |
| Active production scripts (.mjs) | 38      | `scripts/**/*.mjs` (non-test, non-helper)  |
| VS Code esbuild build script     | 1       | `packages/vscode-ide-companion/esbuild.js` |
| Integration tests                | 6       | `integration-tests/*.test.js`              |
| Agents package scripts           | 2       | `packages/agents/**/*.{js,mjs}`            |
| GitHub Actions script            | 1       | `.github/scripts/*.mjs`                    |
| **Total**                        | **156** |                                            |

> The stale issue text cited different counts. The corrected counts above are
> authoritative: **87** files under `scripts/tests/` (81 behavioral tests +
> 6 helpers), **59** active production scripts (21 `.js` + 38 `.mjs`),
> **1** esbuild.js, **6** integration tests, **2** agents files, and **1**
> `.github` script — plus the **2** completed notices files.

### Final allowlist — 11 exempt entries

After all 156 conversions, `scripts/no-new-js-allowlist.json` must contain
exactly these 11 paths:

| #   | Path                                                                           | Exemption rationale                                       |
| --- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 1   | `eslint.config.js`                                                             | ESLint flat-config must be `.js` for toolchain resolution |
| 2   | `eslint-rules/ink-text-color-required.js`                                      | Custom ESLint rule loaded by config before TS compile     |
| 3   | `eslint-rules/no-inline-deps.js`                                               | Custom ESLint rule                                        |
| 4   | `eslint-rules/react-render-safety.js`                                          | Custom ESLint rule                                        |
| 5   | `packages/vscode-ide-companion/eslint.config.mjs`                              | Package-local ESLint config                               |
| 6   | `packages/cli/src/commands/extensions/examples/hooks/scripts/on-start.js`      | Extension example fixture (user-facing sample)            |
| 7   | `packages/cli/src/commands/extensions/examples/mcp-server/example.js`          | Extension example fixture (user-facing sample)            |
| 8   | `project-plans/issue1585/analysis/capture-pre-extraction-fixtures.mjs`         | Historical analysis artifact                              |
| 9   | `project-plans/issue1586/scripts/verify-auth-extraction-gate.js`               | Historical analysis artifact                              |
| 10  | `project-plans/issue2285/analysis/boundary-checker-characterization-proof.mjs` | Historical analysis artifact                              |
| 11  | `project-plans/issue2285/analysis/runtime-factory-single-source-proof.mjs`     | Historical analysis artifact                              |

### Exempt CJS files (25) — never converted

All 25 `.cjs` files retain CommonJS. They are consumed by toolchains that
require CommonJS at specific lifecycle points (postinstall, install-native,
release-pack smokes, windows-installed-command smokes). One bridge,
`scripts/ocr-canary-compare-2673.cjs`, receives a reference-only import update
because its comparator implementation moves from `.js` to `.ts`; its runtime
behavior and CommonJS entrypoint remain unchanged. The full list is in
[Appendix B](#appendix-b-exempt-cjs-files-25).

## Completed slice (Slice 0) — VS Code notices generator

This slice is **done** and preserved as evidence. It is not re-executed.

### What was delivered

- `packages/vscode-ide-companion/scripts/generate-notices.js` →
  `generate-notices.ts` — strict types added, Zod validation at all
  external-input boundaries, `tsc` exit 0, no `any`/assertions/suppressions.
- `packages/vscode-ide-companion/scripts/generate-notices.test.js` →
  `generate-notices.test.ts` — import updated to `.ts`, 9/9 tests pass
  (5 existing + 4 new behavioral tests).
- `packages/vscode-ide-companion/package.json` — `generate:notices` and
  `prepare` now `bun ./scripts/generate-notices.ts`.
- `tsconfig.scripts.json` — both paths registered, `tsc --project
tsconfig.scripts.json` exit 0.
- `scripts/no-new-js-allowlist.json` — two notices JS paths removed
  (169 → 167 entries).

### Same-state hash equivalence evidence (A5)

Ran the original JavaScript generator under Node and the TypeScript generator
under Bun against identical checked-in dependencies:

- **Node + `generate-notices.js`**: SHA-256
  `49306fd91b68d3adf072724466ed9d23c506130f39f8e4e4b173bf336b5309f3`,
  559,902 bytes.
- **Bun + `generate-notices.ts`**: SHA-256
  `49306fd91b68d3adf072724466ed9d23c506130f39f8e4e4b173bf336b5309f3`,
  559,902 bytes.
- **Result**: byte-for-byte identical. `git diff --exit-code --
packages/vscode-ide-companion/NOTICES.txt` passes.

### Review triage (Slice 0 — preserved for reference)

DeepThinker findings F1–F7: all Blocker-Fix and In-scope-Fix items remediated
(Zod schemas at root package/lockfile/dep-metadata/npm-time boundaries,
fail-fast year guard, `main()` guard). F7 (additional refactors) deferred.

Local OCR (two runs): OCR-1 through OCR2-5 triaged. Required fixes applied
(dead-code removal, temp-dir relocation, spawn-error surfacing, structured
assertions, Bun runtime in test wrappers, test-name cleanup). Repeated false
positives on nullable normalizer signature, original lockfile behavior, and
fail-fast infrastructure explicitly rejected with rationale.

## Acceptance matrix (whole issue)

| ID  | Accepted behavior                                                                                                                              | Evidence                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | All 156 remaining portable JS/MJS files are converted to `.ts`; no former portable `.js`/`.mjs` path remains.                                  | `git ls-files '*.js' '*.mjs' '*.cjs'` shows exactly 25 CJS + 11 allowlisted JS/MJS = 36 files. No portable JS/MJS remains.                                                                                                                    |
| W2  | The 2 completed notices files remain `.ts` and continue to pass (Slice 0 preserved).                                                           | `packages/vscode-ide-companion/scripts/generate-notices.ts` and `.test.ts` exist; notices test suite passes.                                                                                                                                  |
| W3  | Every converted file is covered by strict TypeScript typechecking.                                                                             | Each converted path appears in `tsconfig.scripts.json` (or the appropriate package `tsconfig.json`); `npm run typecheck` passes with exit 0.                                                                                                  |
| W4  | All behavioral tests continue to pass after conversion — no test dropped, weakened, or skipped.                                                | `npm run test` passes; converted `scripts/tests/*.test.ts` and `integration-tests/*.test.ts` run with the same assertions as their JS predecessors. Test count does not decrease.                                                             |
| W5  | Every consumer reference is updated to the `.ts` path: workflow invocations, `package.json` script entries, and cross-file imports.            | `grep -rn '\.js\b' .github/workflows/ package.json packages/*/package.json` returns no stale references to converted paths; converted imports use `.ts` extensions or extensionless specifiers that resolve under Bun.                        |
| W6  | `scripts/no-new-js-allowlist.json` contains exactly 11 entries (the final allowlist above).                                                    | `node -e "console.log(require('./scripts/no-new-js-allowlist.json').files.length)"` prints `11`; `bun scripts/check-no-new-js-files.ts` passes.                                                                                               |
| W7  | The 25 CJS files remain CommonJS and exempt; only a required reference-only bridge edit is allowed.                                            | Inventory shows exactly 25 CJS files; the sole CJS diff is `scripts/ocr-canary-compare-2673.cjs` importing its renamed `.ts` implementation, with comparator CLI tests passing.                                                               |
| W8  | `packages/vscode-ide-companion/esbuild.js` → `esbuild.ts`; the three package commands (`build:dev`, `build:prod`, `watch:esbuild`) invoke Bun. | `package.json` shows `bun esbuild.ts` for all three entries; `npm run build:prod --workspace llxprt-code-vscode-ide-companion` succeeds and produces the expected extension bundle.                                                           |
| W9  | No new dependencies, no lint/complexity weakening, no type/lint suppressions introduced.                                                       | `git diff package.json packages/*/package.json` shows no dependency additions; `npm run lint` and `npm run lint:eslint-guard` pass; `grep -rn '@ts-ignore\|@ts-expect-error\|eslint-disable\|as any'` in converted files returns nothing new. |
| W10 | Repository behavior remains green on the exact candidate head.                                                                                 | Full `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build`, configured smoke, and `lint:eslint-guard` pass; PR CI passes on the same head.                                                             |

## Explicit non-goals and exclusions

1. **No new dependencies** — do not add packages to `package.json`,
   `packages/*/package.json`, or any lockfile.
2. **No lint/complexity weakening** — `eslint.config.js` may receive only
   required renamed-path updates; do not change rule severity, `.eslintrc*`,
   `tsconfig*.json` strictness flags, ignores, or complexity thresholds.
3. **No suppressions** — no `@ts-ignore`, `@ts-expect-error`, `eslint-disable`,
   `as any`, or non-null assertions used to silence type errors.
4. **No unrelated refactors** — convert types and update references only; do
   not restructure logic, rename exports, or change algorithms.
5. **No behavior changes** — runtime output, exit codes, side effects, and
   error messages must be identical to the JavaScript originals.
6. **No agent-memory changes** — `.llxprt/` and agent configurations are
   off-limits.
7. **No new public abstractions** — no new exported classes, functions, types,
   or modules beyond file-local types needed for strict typing.
8. **No CJS conversion** — the 25 `.cjs` files remain exempt; only the
   reference-only comparator bridge import update described above may change.
9. **No allowlist growth** — the allowlist may only shrink (167 → 11).
10. **No source/config/workflow edits beyond reference updates** — workflows
    and `package.json` scripts may change only the path/runtime of an invocation
    that a rename requires; no logic, trigger, or step reordering.
11. **No test weakening** — do not convert a test to `.skip`, `.todo`, reduce
    assertions, or merge test cases to make typecheck pass.

## Migration rules

### R1 — Rename, do not rewrite

Every conversion is a **rename** (`foo.js` → `foo.ts`) followed by the
**minimum type annotations** needed for strict typecheck. The file's logic,
control flow, and side effects must not change.

### R2 — Register in typecheck

Every converted file must be added to `tsconfig.scripts.json` (for scripts)
or the relevant package `tsconfig.json` (for package files). A file is not
"converted" until `tsc` accepts it under strict mode.

### R3 — Preserve behavior with characterization

Before converting a file that has no existing test, capture its current output
or side effects as a characterization baseline. After conversion, verify the
baseline is unchanged. This is especially important for production scripts
invoked by workflows.

### R4 — Update every reference in the same batch

When a file is renamed, every consumer must be updated in the same commit
batch:

- `package.json` script entries that invoke the file by path.
- `.github/workflows/*.yml` steps that invoke the file.
- Cross-file imports (`.js`/`.mjs` extensions in import specifiers).
- The `no-new-js-allowlist.json` entry for the old path (remove it).

A rename that leaves a dangling reference is a failed batch.

### R5 — Use Bun for runtime invocations

Where a `package.json` script or workflow previously ran
`node path/to/script.js`, the converted invocation must use
`bun path/to/script.ts`. This applies to the esbuild commands and any
script that the repository executes directly. Test files continue to run under
the configured test runner (Vitest).

### R6 — No extensionless import ambiguity

Under Bun's TypeScript resolution, extensionless imports and `.ts` extensions
both resolve. Prefer `.ts` extensions in converted import specifiers to make
the migration explicit and auditable. When a converted module is imported by a
not-yet-converted module, use the `.ts` extension — Bun resolves it at runtime.

### R7 — Keep imports type-only where possible

When a converted file imports only types from another module, use
`import type { … }` to avoid runtime side-effect ordering issues and to satisfy
`verbatimModuleSyntax` if enabled.

### R8 — Zod at external boundaries (established pattern)

Follow the Slice 0 pattern: validate all external input (JSON files, HTTP
responses, environment variables, `process.argv`) with Zod schemas at the
boundary. The project already depends on Zod; no new dependency is needed.

## Reference-update classes

Every rename produces reference updates that fall into exactly one of these
classes. Each batch must account for all applicable classes before the batch
is declared complete.

### Class A — `package.json` script entries

Script commands that reference a file by path. Example:

```diff
- "build:dev": "npm run check-types && npm run lint && node esbuild.js",
+ "build:dev": "npm run check-types && npm run lint && bun esbuild.ts",
```

**Affected files**: root `package.json`, `packages/vscode-ide-companion/package.json`,
and any other `packages/*/package.json` with script entries pointing to `.js`/`.mjs`
files.

### Class B — `.github/workflows/*.yml` invocations

Workflow `run:` steps or `with:` inputs that invoke a script by path.
Example:

```diff
-      run: node scripts/lint.js
+      run: bun scripts/lint.ts
```

**Affected workflows** (16 files reference JS/MJS):
`ci.yml`, `e2e.yml`, `nightly.yml`, `release.yml`, `smoke-test.yml`,
`evals-nightly.yml`, `_evals-run.yml`, `pr-review.yml`, `ocr-review.yml`,
`ocr-infrastructure-notifier.yml`, `issue-planner.yml`, `luther.yml`,
`interactive-ui.yml`, `build-sandbox.yml`, `windows-installed-command.yml`,
`upstream-sync.yml`.

**High-value script references found in workflows**:
`scripts/lint.js`, `scripts/preflight-ci.js`, `scripts/ci-quota-check.js`,
`scripts/tmux-harness.js`, `scripts/update-homebrew-formula.js`,
`scripts/aggregate_evals.js`, `scripts/ocr-telemetry.js`,
`scripts/pr-review-walkthrough.mjs`, `scripts/bun-native-modules-smoke.mjs`,
`scripts/verify-bun-workspace-links.mjs`, `.github/scripts/issue-planner.mjs`.

### Class C — `tsconfig.scripts.json` includes

Each converted scripts-path must be added to the `include` array. The current
`tsconfig.scripts.json` already includes the two notices files and all existing
`.ts` scripts. New entries are added per batch.

### Class D — Cross-file imports

TypeScript or remaining-JS files that import a converted module by path.
Example:

```diff
- import { foo } from './bar.js';
+ import { foo } from './bar.ts';
```

**Known cross-file dependencies** (non-exhaustive, discover per batch):

- `scripts/telemetry.ts` references `'local_telemetry.js'` and
  `'telemetry_gcp.js'` as string literals (runtime module selection).
- `scripts/tests/*.test.js` import from `scripts/tests/*helpers*.js` and from
  production scripts.
- `scripts/check-eslint-guard.ts`, `scripts/run_bun_tests.ts`,
  `scripts/generate-keybindings-doc.ts` import JS modules.

### Class E — `no-new-js-allowlist.json` removal

Remove the old `.js`/`.mjs` path from the allowlist in the same batch as the
rename. The allowlist entry count must decrease by exactly the number of files
converted in that batch.

## Dependency-ordered vertical slices

Slices are ordered so that **leaf modules convert first**, then their
consumers, then their tests, then external references. Each slice is a
verifiable batch. Within a slice, convert the smallest dependency cluster that
can be independently typechecked and tested.

### Slice 0 — Notices generator (COMPLETED)

**Status**: Done. Evidence preserved above. Not re-executed.

**Paths converted (2)**:

- `packages/vscode-ide-companion/scripts/generate-notices.js` → `.ts`
- `packages/vscode-ide-companion/scripts/generate-notices.test.js` → `.ts`

### Slice 1 — Leaf production scripts with no internal JS dependencies

**Goal**: Convert standalone scripts that no other JS file imports. These are
the safest starting point because they have no downstream breakage risk.

**Paths (estimate ~20 files)** — the `.js` production scripts under `scripts/`
that are invoked directly by workflows or `package.json` and do not export
modules consumed by other scripts:

- `scripts/lint.js`
- `scripts/preflight-ci.js`
- `scripts/ci-quota-check.js`
- `scripts/check-settings-boundary.js`
- `scripts/local_telemetry.js`
- `scripts/telemetry_gcp.js`
- `scripts/telemetry_utils.js`
- `scripts/scrollback-load.js`
- `scripts/test-mcp-server.js`
- `scripts/test-windows-paths.js`
- `scripts/update-homebrew-formula.js`
- `scripts/tmux-harness.js`
- `scripts/aggregate_evals.js`
- `scripts/aggregate-evals-cardinality.js`
- `scripts/aggregate-evals-historical.js`
- `scripts/aggregate-evals-schema.js`
- `scripts/aggregate-ocr-telemetry.js`
- `scripts/ocr-telemetry.js`
- `scripts/ocr-telemetry-io.js`
- `scripts/ocr-telemetry-schema.js`
- `scripts/lib/ocr-concurrency-canary-2673-comparator.js`

**Reference updates**: Class B (workflows), Class C (tsconfig), Class D
(string-literal references in `scripts/telemetry.ts`), Class E (allowlist).

**Verification gate**: `npm run typecheck && npm run lint && npm run test`.

### Slice 2 — Production MJS script families (dependency-ordered clusters)

**Goal**: Convert the 38 `.mjs` production scripts, grouped by subsystem so
that each cluster is internally consistent.

#### Slice 2a — tmux-harness family (4 files)

- `scripts/tmux-harness-helpers.mjs`
- `scripts/tmux-harness-io.mjs`
- `scripts/tmux-harness-steps.mjs`
- (Note: `scripts/tmux-harness.js` converts in Slice 1 or here if dependency
  order requires it to follow the `.mjs` helpers.)

Convert helpers first, then `io`/`steps`, then the entry point.

#### Slice 2b — eslint-guard family (13 files)

- `scripts/eslint-guard/constants.mjs` → first (shared constants)
- `scripts/eslint-guard/git.mjs`
- `scripts/eslint-guard/diff-context.mjs`
- `scripts/eslint-guard/diff-state-tracking.mjs`
- `scripts/eslint-guard/rule-config.mjs`
- `scripts/eslint-guard/scanners.mjs`
- `scripts/eslint-guard/directive-scanner.mjs`
- `scripts/eslint-guard/config-scanner.mjs`
- `scripts/eslint-guard/cli-scanner.mjs`
- `scripts/eslint-guard/bypass-detector.mjs`
- `scripts/eslint-guard/violations.mjs`
- `scripts/eslint-guard/check-diff.mjs`
- `scripts/eslint-guard/added-config-checks.mjs` → last (top-level entry)

#### Slice 2c — codemods family (6 files)

- `scripts/codemods/apply-suggestions.mjs`
- `scripts/codemods/nce-try-unreachable.mjs`
- `scripts/codemods/no-conditional-expect.mjs`
- `scripts/codemods/pse-disable.mjs`
- `scripts/codemods/pse-fix.mjs`
- `scripts/codemod-import-type-annotations.mjs`

#### Slice 2d — pr-review family (4 files)

- `scripts/pr-review-llm-helpers.mjs`
- `scripts/pr-review-prompts.mjs`
- `scripts/pr-review-artifacts.mjs`
- `scripts/pr-review-walkthrough.mjs`

#### Slice 2e — remaining standalone MJS (11 files)

- `scripts/acp-logging-proxy.mjs`
- `scripts/bun-build.config.mjs`
- `scripts/bun-native-modules-smoke.mjs`
- `scripts/check-agents-api-surface.mjs`
- `scripts/issue2208-noninteractive-repro.mjs`
- `scripts/issue2208-tui-repro.mjs`
- `scripts/ocr-benchmark.mjs`
- `scripts/preflight-import-inventory.mjs`
- `scripts/setup-zed-agent.mjs`
- `scripts/test-acp-integration.mjs`
- `scripts/test-acp-zed-bugs.mjs`
- `scripts/verify-bun-workspace-links.mjs`

**Reference updates**: Class B (workflows for `bun-native-modules-smoke`,
`verify-bun-workspace-links`, `pr-review-walkthrough`), Class C, Class D,
Class E.

**Verification gate**: `npm run typecheck && npm run lint && npm run test`.

### Slice 3 — Script test helpers (6 files)

**Goal**: Convert the 6 test-helper modules before their consuming tests.

- `scripts/tests/aggregate-helpers.js`
- `scripts/tests/assign-helpers.js`
- `scripts/tests/ocr-concurrency-canary-2673-helpers.js`
- `scripts/tests/ocr-manifest-test-helpers.js`
- `scripts/tests/ocr-review-workflow-helpers.js`
- `scripts/tests/pr-mergeability-workflow-test-helpers.js`

**Reference updates**: Class C, Class D (tests import these), Class E.

**Verification gate**: Focused tests for each helper's consumers must still pass.

### Slice 4 — Script behavioral tests (81 files)

**Goal**: Convert the 81 `.test.js` files to `.test.ts`. These depend on the
production scripts (Slice 1–2) and helpers (Slice 3) being converted first.

Batch by subsystem to keep each commit reviewable:

- **Slice 4a** — aggregate/evals tests (12 files)
- **Slice 4b** — assign workflow tests (14 files)
- **Slice 4c** — OCR review/telemetry/canary tests (24 files)
- **Slice 4d** — pr-review/pr-mergeability tests (8 files)
- **Slice 4e** — remaining tests (23 files: ci-quota, cli-import-boundary,
  eslint-guard, evals config, get-release-version, issue-planner,
  loading-indicator, nightly, preflight-ci, providers-directive, release-process,
  runner-image, scrollback, session-browser, tmux-harness, ui-image,
  virtualized-list, workflow-quota, etc.)

**Reference updates**: Class C, Class D (import paths to helpers and
production scripts), Class E.

**Verification gate**: `npm run test` — test count must not decrease.

### Slice 5 — Integration tests (6 files)

- `integration-tests/run_shell_command.multibyte.test.js`
- `integration-tests/run_shell_command.qwen-script-call.test.js`
- `integration-tests/run_shell_command.windows.test.js`
- `integration-tests/todo-continuation.e2e.test.js`
- `integration-tests/todo-ui-integration.test.js`
- `integration-tests/web-search-provider.test.js`

**Reference updates**: Class C (add to `tsconfig.scripts.json` or the
integration-test tsconfig), Class E.

**Verification gate**: Integration test suite passes where locally runnable.

### Slice 6 — Packages/agents and .github/scripts (3 files)

- `packages/agents/scripts/verify-api-property-ratio.js`
- `packages/agents/src/api/apiSurfaceParser.mjs`
- `.github/scripts/issue-planner.mjs`

**Reference updates**: Class A (`packages/agents/package.json` if it invokes
the scripts), Class B (`issue-planner.yml` invokes
`.github/scripts/issue-planner.mjs` in 6 places — update all to `.ts` + Bun),
Class C, Class E.

**Verification gate**: `npm run typecheck && npm run lint` for agents package;
workflow YAML lint passes.

### Slice 7 — esbuild.js → esbuild.ts (1 file + 3 command updates)

**Goal**: Convert the VS Code companion build script and switch all three
package commands to Bun.

- `packages/vscode-ide-companion/esbuild.js` → `esbuild.ts`

**Reference updates (Class A)**:

```diff
- "build:dev": "npm run check-types && npm run lint && node esbuild.js",
+ "build:dev": "npm run check-types && npm run lint && bun esbuild.ts",
```

```diff
- "build:prod": "node esbuild.js --production",
+ "build:prod": "bun esbuild.ts --production",
```

```diff
- "watch:esbuild": "node esbuild.js --watch",
+ "watch:esbuild": "bun esbuild.ts --watch",
```

Also add `esbuild.ts` to the VS Code companion's `tsconfig.json` (not
`tsconfig.scripts.json`, since it lives in the package).

**Verification gate**:
`npm run build:prod --workspace llxprt-code-vscode-ide-companion` succeeds and
produces the expected extension bundle (compare `dist/` output to pre-conversion
baseline).

### Slice 8 — Final allowlist reduction + exact-head gates

**Goal**: Reduce `scripts/no-new-js-allowlist.json` from 167 entries to exactly
11 (the final allowlist). Remove every portable path that has been converted.

**Verification gate (exact head)**:

1. `npm run test`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run format:check`
5. `npm run build`
6. `npm run lint:eslint-guard`
7. `bun scripts/check-no-new-js-files.ts`
8. `node -e "console.log(require('./scripts/no-new-js-allowlist.json').files.length)"` → prints `11`
9. `git ls-files '*.js' '*.mjs' '*.cjs' | wc -l` → 36 (25 CJS + 11 allowlist)
10. Configured smoke command

## RED/GREEN strategy

Each file conversion within a slice follows RED → GREEN:

### RED — establish the failure

1. Rename `foo.js` → `foo.ts` (or `foo.mjs` → `foo.ts`).
2. Update all references (imports, workflows, package.json, allowlist) in the
   same change.
3. Add the `.ts` path to `tsconfig.scripts.json`.
4. Run `tsc --project tsconfig.scripts.json` and capture it as **RED** — the
   untyped JavaScript now fails strict typecheck. This proves the typecheck
   gate is real and catches the gap.

### GREEN — close the gap with types

1. Add the minimum file-local types, interfaces, and annotations needed for
   strict typecheck to pass.
2. Validate external input with Zod schemas where the module reads JSON, HTTP,
   `process.argv`, or `process.env` (R8).
3. Run `tsc --project tsconfig.scripts.json` → **GREEN** (exit 0).
4. Run the file's test (if any) → must pass with identical assertions.
5. Run `npm run lint` on the file → must pass with no new suppressions.

**If GREEN requires a behavior change, a new abstraction, or a suppression**:
stop. The conversion violates the migration rules. Re-examine the type gap and
find a type-only solution. If none exists, escalate (see Stop conditions).

## Verification requirements

### After each batch (slice or sub-slice)

1. `npm run typecheck` — exit 0.
2. `npm run lint` — exit 0, no new suppressions.
3. `npm run test` — all tests pass, count did not decrease.
4. `bun scripts/check-no-new-js-files.ts` — passes (allowlist is consistent
   with remaining JS/MJS files).

### After each slice

5. `npm run format:check` — no formatting drift.
6. Focused behavioral test for the converted subsystem — passes.

### Exact-head (final) verification

7. `npm run test` — full suite green.
8. `npm run lint` — green.
9. `npm run typecheck` — green.
10. `npm run format:check` — green.
11. `npm run build` — green.
12. `npm run lint:eslint-guard` — green.
13. `bun scripts/check-no-new-js-files.ts` — green; allowlist = 11.
14. `git ls-files '*.js' '*.mjs' '*.cjs' | wc -l` = 36.
15. Configured smoke command — green.
16. PR CI — green on the exact candidate head.

## Review limits

- **DeepThinker review**: at most **2 local runs** total across the whole
  delivery (not per slice). Run once mid-delivery (after Slice 4) and once at
  the exact head (before push).
- **Local Open Code Review (OCR)**: at most **2 local runs**. Run once after
  the major slices and once at the exact head. Pass `--timeout 20` and run
  detached; poll until complete.
- **PR OCR**: at most **2 runs** on the PR head.
- Reviewer suggestions **do not expand** the acceptance matrix or scope.
  Classify every finding as `Blocker-Fix`, `In-scope-Fix`, `Reject`, or
  `Defer`.

## Stop conditions

Stop immediately and escalate if any of the following occurs:

1. **A conversion requires a behavior change** to satisfy strict typecheck, and
   no type-only solution exists.
2. **A conversion requires a new dependency** (Zod is already available; nothing
   else may be added).
3. **A conversion requires a lint/type suppression** (`@ts-ignore`,
   `eslint-disable`, `as any`, non-null assertion to silence an error).
4. **A test cannot pass after conversion** without weakening assertions,
   skipping, or changing expectations.
5. **A workflow or `package.json` change** goes beyond updating a path/runtime
   to the renamed `.ts` file (e.g., requires reordering steps, changing
   triggers, or altering logic).
6. **The allowlist cannot reach 11** because a path that should be portable
   turns out to require JS for a legitimate toolchain reason not anticipated
   by this plan.
7. **Review limits are exhausted** without a clean review.
8. **Any CJS file or final-allowlist entry is accidentally converted or
   behaviorally modified** beyond the authorized comparator bridge reference.

## Mandatory scope-review record

The issue owner explicitly authorized the whole-issue migration after the
original hard budget was exceeded. Final candidate metrics, including the five
new regression-test paths before staging, are recorded here.

| Check                        | Candidate state                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| Total patch paths            | 226 (221 tracked-diff paths + 5 new regression tests)                                           |
| Patch line delta             | +19,822 / -11,768, net +8,054                                                                   |
| Total tracked JS/MJS/CJS     | 36 (25 CJS + 11 allowlisted JS/MJS)                                                             |
| Allowlist entries            | Exactly 11; `lint:no-new-js` passes                                                             |
| Converted portable files     | 158 (156 remaining + 2 notices done)                                                            |
| Required reference surfaces  | Workflows, package commands, docs, ESLint renamed-path selectors, allowlists, imports, tsconfig |
| New dependencies / lockfiles | None / none                                                                                     |
| New suppressions             | None                                                                                            |
| Lint/complexity weakening    | None; ESLint config edits are renamed-path selectors only                                       |
| Behavior changes             | None intended; semantic-preservation regressions found by tests/review were corrected           |
| CJS files modified           | 1 reference-only bridge: `ocr-canary-compare-2673.cjs` imports the renamed `.ts` comparator     |
| `.llxprt/` modified          | None                                                                                            |
| Public abstractions added    | None; new modules are private type/helper extractions required by source-size/complexity limits |
| Tests                        | No predecessor test dropped or weakened; five focused regression tests added                    |
| Review                       | DeepThinker and one detached OCR completed; all findings classified and valid in-scope fixed    |

## Scope ledger

| Entry                                      | Classification                     | Candidate record                                  |
| ------------------------------------------ | ---------------------------------- | ------------------------------------------------- |
| Notices generator + test (Slice 0)         | Accepted / in scope / done         | 2 converted paths                                 |
| Production scripts (Slices 1–2e)           | Accepted / in scope / done         | 59 converted paths                                |
| Script test helpers (Slice 3)              | Accepted / in scope / done         | 6 converted paths                                 |
| Script behavioral tests (Slices 4a–4e)     | Accepted / in scope / done         | 81 predecessors converted; large tests split      |
| Integration tests (Slice 5)                | Accepted / in scope / done         | 6 converted and registered with Vitest            |
| Agents + `.github` scripts (Slice 6)       | Accepted / in scope / done         | 3 converted paths                                 |
| VS Code esbuild script (Slice 7)           | Accepted / in scope / done         | 1 converted path; package commands use Bun        |
| Allowlist and strict typecheck (Slice 8)   | Accepted / in scope / done         | 11 retained JS/MJS; converted paths registered    |
| Workflow/package/config/docs references    | Required migration follow-through  | Paths/runtimes/imports/selectors updated          |
| Private helper/type module extraction      | In-scope quality compliance        | ESLint guard, PR review, tmux, typed-test helpers |
| Split and new behavioral tests             | In-scope quality/behavior evidence | 5 new regression files plus source-size splits    |
| Semantic-preservation remediation          | Blocker-Fix / In-scope-Fix         | Identity, live-state, malformed-input, skip fixes |
| CJS files                                  | Exempt — never converted           | 25 retained; 1 necessary reference-only edit      |
| Final allowlist entries                    | Exempt — permanently allowlisted   | 11 retained and unchanged behaviorally            |
| New dependencies / lockfile changes        | Reject / out of scope              | 0                                                 |
| Lint/complexity weakening or suppressions  | Reject / out of scope              | 0                                                 |
| Agent-memory changes                       | Reject / out of scope              | 0                                                 |
| Unrelated refactors / public abstractions  | Reject or defer                    | 0                                                 |
| Pre-existing hardening/timeout suggestions | Defer                              | 10 findings; not in the acceptance matrix         |

**Portable total**: 158 files (156 remaining + 2 notices).
**Exempt inventory**: 36 files (25 CJS + 11 JS/MJS allowlist entries).
**Candidate patch total**: 226 paths after required references, strict-typing
helpers, split tests, and regression evidence are included.

## Inventory appendix

### Appendix A — All 156 remaining portable paths (exhaustive)

#### A.1 — Script behavioral tests (81)

```
scripts/tests/aggregate-cardinality.test.js
scripts/tests/aggregate-cli.test.js
scripts/tests/aggregate-historical-isolation.test.js
scripts/tests/aggregate-historical-process.test.js
scripts/tests/aggregate-historical.test.js
scripts/tests/aggregate-malformed.test.js
scripts/tests/aggregate-missing-reports.test.js
scripts/tests/aggregate-ocr-telemetry.test.js
scripts/tests/aggregate-pagination.test.js
scripts/tests/aggregate-run-entry.test.js
scripts/tests/aggregate-schema.test.js
scripts/tests/aggregate-status-type.test.js
scripts/tests/assign-harness-diagnostics.test.js
scripts/tests/assign-remediation.test.js
scripts/tests/assign-remediation10.test.js
scripts/tests/assign-remediation11.test.js
scripts/tests/assign-remediation2.test.js
scripts/tests/assign-remediation3.test.js
scripts/tests/assign-remediation4.test.js
scripts/tests/assign-remediation5.test.js
scripts/tests/assign-remediation6.test.js
scripts/tests/assign-remediation7.test.js
scripts/tests/assign-remediation8.test.js
scripts/tests/assign-remediation9.test.js
scripts/tests/assign-workflow-behaviors.test.js
scripts/tests/assign-workflow.test.js
scripts/tests/ci-quota-check.test.js
scripts/tests/ci-secure-store-workflow.test.js
scripts/tests/cli-import-boundary.test.js
scripts/tests/eslint-guard.test.js
scripts/tests/evals-nightly-workflow.test.js
scripts/tests/evals-save-memory-assertion.test.js
scripts/tests/evals-typescript-compliance.test.js
scripts/tests/evals-vitest-config.test.js
scripts/tests/get-release-version.test.js
scripts/tests/issue-planner.test.js
scripts/tests/loading-indicator-nowrap.test.js
scripts/tests/nightly-bun-native-smoke.test.js
scripts/tests/nightly-notifier-repository.test.js
scripts/tests/ocr-auto-review-limit.test.js
scripts/tests/ocr-canary-compare-2673-cli.test.js
scripts/tests/ocr-concurrency-canary-2673-artifacts.test.js
scripts/tests/ocr-concurrency-canary-2673-comparator.test.js
scripts/tests/ocr-concurrency-canary-2673-evidence.test.js
scripts/tests/ocr-concurrency-canary-2673.test.js
scripts/tests/ocr-notifier-classification.test.js
scripts/tests/ocr-review-coverage-integration.test.js
scripts/tests/ocr-review-coverage.test.js
scripts/tests/ocr-review-incremental-checkpoint.test.js
scripts/tests/ocr-review-metadata-validation.test.js
scripts/tests/ocr-review-phase2.test.js
scripts/tests/ocr-review-phase3.test.js
scripts/tests/ocr-review-routing.test.js
scripts/tests/ocr-review-workflow-behaviors.test.js
scripts/tests/ocr-review-workflow-features.test.js
scripts/tests/ocr-review-workflow.test.js
scripts/tests/ocr-reviewed-range-manifest-wiring.test.js
scripts/tests/ocr-reviewed-range-manifest.test.js
scripts/tests/ocr-telemetry-cli.test.js
scripts/tests/ocr-telemetry-lifecycle.test.js
scripts/tests/ocr-telemetry-schema.test.js
scripts/tests/ocr-telemetry-workflow.test.js
scripts/tests/ocr-telemetry.test.js
scripts/tests/pr-mergeability-gate.test.js
scripts/tests/pr-mergeability-workflow-wiring.test.js
scripts/tests/pr-review-llm-helpers.test.js
scripts/tests/pr-review-walkthrough-prompts.test.js
scripts/tests/pr-review-walkthrough-workflow.test.js
scripts/tests/pr-review-walkthrough.test.js
scripts/tests/pr-workflow-concurrency.test.js
scripts/tests/preflight-ci.test.js
scripts/tests/providers-directive-guard.test.js
scripts/tests/release-process.test.js
scripts/tests/runner-image-consistency.test.js
scripts/tests/scrollback-regression.test.js
scripts/tests/session-browser-e2e.test.js
scripts/tests/tmux-harness-io.test.js
scripts/tests/tmux-harness.test.js
scripts/tests/ui-image-harness.test.js
scripts/tests/virtualized-list-scrolltop.test.js
scripts/tests/workflow-quota-selection.test.js
```

#### A.2 — Script test helpers (6)

```
scripts/tests/aggregate-helpers.js
scripts/tests/assign-helpers.js
scripts/tests/ocr-concurrency-canary-2673-helpers.js
scripts/tests/ocr-manifest-test-helpers.js
scripts/tests/ocr-review-workflow-helpers.js
scripts/tests/pr-mergeability-workflow-test-helpers.js
```

#### A.3 — Active production scripts — `.js` (21)

```
scripts/aggregate-evals-cardinality.js
scripts/aggregate-evals-historical.js
scripts/aggregate-evals-schema.js
scripts/aggregate_evals.js
scripts/aggregate-ocr-telemetry.js
scripts/check-settings-boundary.js
scripts/ci-quota-check.js
scripts/lib/ocr-concurrency-canary-2673-comparator.js
scripts/lint.js
scripts/local_telemetry.js
scripts/ocr-telemetry-io.js
scripts/ocr-telemetry-schema.js
scripts/ocr-telemetry.js
scripts/preflight-ci.js
scripts/scrollback-load.js
scripts/telemetry_gcp.js
scripts/telemetry_utils.js
scripts/test-mcp-server.js
scripts/test-windows-paths.js
scripts/tmux-harness.js
scripts/update-homebrew-formula.js
```

#### A.4 — Active production scripts — `.mjs` (38)

```
scripts/acp-logging-proxy.mjs
scripts/bun-build.config.mjs
scripts/bun-native-modules-smoke.mjs
scripts/check-agents-api-surface.mjs
scripts/codemod-import-type-annotations.mjs
scripts/codemods/apply-suggestions.mjs
scripts/codemods/nce-try-unreachable.mjs
scripts/codemods/no-conditional-expect.mjs
scripts/codemods/pse-disable.mjs
scripts/codemods/pse-fix.mjs
scripts/eslint-guard/added-config-checks.mjs
scripts/eslint-guard/bypass-detector.mjs
scripts/eslint-guard/check-diff.mjs
scripts/eslint-guard/cli-scanner.mjs
scripts/eslint-guard/config-scanner.mjs
scripts/eslint-guard/constants.mjs
scripts/eslint-guard/diff-context.mjs
scripts/eslint-guard/diff-state-tracking.mjs
scripts/eslint-guard/directive-scanner.mjs
scripts/eslint-guard/git.mjs
scripts/eslint-guard/rule-config.mjs
scripts/eslint-guard/scanners.mjs
scripts/eslint-guard/violations.mjs
scripts/issue2208-noninteractive-repro.mjs
scripts/issue2208-tui-repro.mjs
scripts/ocr-benchmark.mjs
scripts/preflight-import-inventory.mjs
scripts/pr-review-artifacts.mjs
scripts/pr-review-llm-helpers.mjs
scripts/pr-review-prompts.mjs
scripts/pr-review-walkthrough.mjs
scripts/setup-zed-agent.mjs
scripts/test-acp-integration.mjs
scripts/test-acp-zed-bugs.mjs
scripts/tmux-harness-helpers.mjs
scripts/tmux-harness-io.mjs
scripts/tmux-harness-steps.mjs
scripts/verify-bun-workspace-links.mjs
```

#### A.5 — VS Code esbuild build script (1)

```
packages/vscode-ide-companion/esbuild.js
```

#### A.6 — Integration tests (6)

```
integration-tests/run_shell_command.multibyte.test.js
integration-tests/run_shell_command.qwen-script-call.test.js
integration-tests/run_shell_command.windows.test.js
integration-tests/todo-continuation.e2e.test.js
integration-tests/todo-ui-integration.test.js
integration-tests/web-search-provider.test.js
```

#### A.7 — Agents package scripts (2)

```
packages/agents/scripts/verify-api-property-ratio.js
packages/agents/src/api/apiSurfaceParser.mjs
```

#### A.8 — GitHub Actions script (1)

```
.github/scripts/issue-planner.mjs
```

### Appendix B — Exempt CJS files (25)

```
packages/cli/scripts/install-native-launchers.cjs
packages/lsp/eslint.config.cjs
project-plans/20260624/_reconcile.cjs
scripts/detect-installer.cjs
scripts/lib/non-npm-release-packages.cjs
scripts/lib/npm-command.cjs
scripts/lib/tar-command.cjs
scripts/ocr-canary-compare-2673.cjs
scripts/ollama-logging-proxy.cjs
scripts/postinstall.cjs
scripts/preinstall.cjs
scripts/probe-ide-mcp.cjs
scripts/tests/issue-2603-release-install-smoke.cjs
scripts/tests/issue-2603-release-pack.cjs
scripts/tests/issue-2603-startup-benchmark.cjs
scripts/windows-installed-command-smoke.cjs
scripts/windows-installed-command-smoke/assert.cjs
scripts/windows-installed-command-smoke/bun-validation.cjs
scripts/windows-installed-command-smoke/checks.cjs
scripts/windows-installed-command-smoke/constants.cjs
scripts/windows-installed-command-smoke/install-helpers.cjs
scripts/windows-installed-command-smoke/launcher-invocation.cjs
scripts/windows-installed-command-smoke/package-layout.cjs
scripts/windows-installed-command-smoke/process-helpers.cjs
scripts/windows-installed-command-smoke/pwsh-resolver.cjs
```

### Appendix C — Final allowlist (11)

See the [Final allowlist table](#final-allowlist--11-exempt-entries) above.

### Appendix D — Completed notices files (2, preserved)

```
packages/vscode-ide-companion/scripts/generate-notices.ts
packages/vscode-ide-companion/scripts/generate-notices.test.ts
```
