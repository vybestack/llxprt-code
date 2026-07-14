# Phase 01: Core mutation tooling provisioning (tooling-only; NO production code)

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P01`

> **Numbering note (Minor 1):** The canonical PLAN.md Phase 01 (analysis) and Phase 02 (pseudocode)
> for this feature were completed OUT-OF-BAND and are represented by `analysis/domain-model.md` and
> `analysis/pseudocode/*.md` (not executable phases). The P01/P02 phase SLOTS in THIS plan are reused
> for the two provisioning gates that MUST exist before any implementation phase runs: P01 (core
> mutation tooling, this file) and P02 (early AST-gate skeleton). This keeps phase numbering fully
> contiguous (01, 02, 03 … 33) with no gaps. See `00-overview.md` header note.

## Prerequisites
- Required: Phase 0.5 (preflight) AND Phase 0.6 (analysis/pseudocode immutability, Minor 1) completed and PASS.
- Verification: `test -f project-plans/issue2349/.completed/P0.5.md && test -f project-plans/issue2349/.completed/P0.6.md`
- Preflight verification: Phase 0.5 completed; Phase 0.6 completed.
- This phase provisions the Stryker mutation tooling for `packages/core` that P05's mutation gate
  (verification-template.md §8) depends on. It is a DEDICATED tooling phase: it adds NO production
  `.ts` code and modifies NO `src/**` file, so tooling changes never mix with a production slice (C3).

## Requirements Implemented (Expanded)

### REQ-012.4: Core mutation tooling exists and is runnable before the first core slice
**Full Text**: The `packages/core` package MUST carry the same Stryker mutation tooling that
`packages/agents` already has (`@stryker-mutator/core`, `@stryker-mutator/vitest-runner`, a
`stryker.conf.json`, and a `test:mutation` npm script) so that P05's ≥80% mutation gate over the
changed `packages/core/src/llm-types/*` files is an EXECUTABLE command, not an aspiration.
**Behavior**:
- GIVEN a developer runs `npm --prefix packages/core run test:mutation -- --mutate "src/llm-types/agentMessageInput.ts"`;
- WHEN Stryker is invoked against a changed `llm-types` file;
- THEN it mutates that file, runs the core vitest suite, writes `reports/mutation/mutation.json`, and
  exits non-zero below the 80% break threshold.
**Why This Matters**: P05 modifies `packages/core/src/llm-types/*` and its NNa verification runs a
scoped mutation gate. Today `packages/core` has NO Stryker config or devDeps (`packages/core/package.json`
scripts are only `build/lint/format/test/test:ci/typecheck`, no `@stryker-mutator/*`), so that gate is
unrunnable. Provisioning it here (before P03/P05) makes the gate real.

## Implementation Tasks

### Files to Create
- `packages/core/stryker.conf.json`
  - Marker note: JSON tooling files carry NO source markers (a JSON comment is not valid JSON, and npm
    scripts are plain strings with NO description field). The `@plan:PLAN-20260707-AGENTNEUTRAL.P01` /
    `@requirement:REQ-012.4` markers for this phase live ONLY in the Phase Completion Marker
    (`.completed/P01.md`) and are referenced from P01a — the config file stays pure JSON.
  - Mirror the STRUCTURE of `packages/agents/stryker.conf.json` (verified fields: `$schema`,
    `mutate`, `testRunner: "vitest"`, `inPlace: true`, `vitest.configFile: "vitest.config.ts"`,
    `coverageAnalysis: "perTest"`, `reporters: ["json","clear-text","progress"]`,
    `jsonReporter.fileName: "reports/mutation/mutation.json"`, `thresholds: {high:80, low:60, break:80}`).
  - Set `mutate` to the CHANGED-SLICE scope (the llm-types gap files), NOT the whole package:
    ```json
    {
      "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
      "mutate": [
        "src/llm-types/agentMessageInput.ts",
        "src/llm-types/modelEnvelope.ts",
        "!src/llm-types/**/__tests__/**",
        "!src/llm-types/**/*.spec.ts",
        "!src/llm-types/**/*.test.ts"
      ],
      "testRunner": "vitest",
      "inPlace": true,
      "vitest": { "configFile": "vitest.config.ts" },
      "coverageAnalysis": "perTest",
      "reporters": ["json", "clear-text", "progress"],
      "jsonReporter": { "fileName": "reports/mutation/mutation.json" },
      "thresholds": { "high": 80, "low": 60, "break": 80 }
    }
    ```
  - The default `mutate` is a SANE FLOOR; P05 passes explicit `--mutate` overrides for the exact files
    it changed (so the scope is always the slice, never the whole package).
  - Confirm `packages/core/vitest.config.ts` exists (it is referenced by `vitest.configFile`); if the
    core vitest config filename differs, use the ACTUAL filename verified by `ls packages/core/vitest.config.*`.

### Files to Modify
- `packages/core/package.json`
  - Add devDependencies (pin to the SAME versions `packages/agents/package.json` uses — verified
    `@stryker-mutator/core: ^9.6.1`, `@stryker-mutator/vitest-runner: ^9.6.1`):
    ```json
    "@stryker-mutator/core": "^9.6.1",
    "@stryker-mutator/vitest-runner": "^9.6.1"
    ```
  - Add a `test:mutation` script alongside the existing `test`/`test:ci` scripts (mirroring
    `packages/agents/package.json`'s `"test:mutation:api": "stryker run stryker.conf.json"`):
    ```json
    "test:mutation": "stryker run stryker.conf.json"
    ```
  - Plan markers: package.json is JSON (no comment/description field for scripts), so the
    `@plan:PLAN-20260707-AGENTNEUTRAL.P01` / `@requirement:REQ-012.4` markers are recorded ONLY in the
    Phase Completion Marker; package.json stays valid JSON. Do NOT attempt to add a "script description".

- `package-lock.json` (repo root — single lockfile for the npm workspaces monorepo)
  - Adding the two `@stryker-mutator/*` devDeps to `packages/core/package.json` REQUIRES a lockfile update
    so `npm ls @stryker-mutator/core --prefix packages/core` (P01a) resolves. This repo is an npm
    workspaces monorepo with ONE root `package-lock.json` (verified: `workspaces` array in root
    `package.json`; no per-package lock). After editing `packages/core/package.json`, run the standard
    workspace install FROM THE REPO ROOT to update the single root lockfile and link the workspace deps:
    ```bash
    npm install
    ```
    (`packages/agents` already carries the same `@stryker-mutator/*` devDeps at `^9.6.1` and is kept in
    sync via this same root `npm install` — mirror that.) The updated `package-lock.json` MUST be part of
    this phase's committed diff; without it, the P01a `npm ls` checks cannot pass.

### Required Code Markers
Because this phase touches only JSON tooling files (no `.ts`), the `@plan`/`@requirement` markers are
recorded in the Phase Completion Marker and referenced from the P01a verification. No source markers apply.

## Verification Commands

### Automated Checks (Structural)
```bash
# Config + scripts exist
test -f packages/core/stryker.conf.json && echo "core stryker config present"
grep -n '"test:mutation"' packages/core/package.json
grep -nE '@stryker-mutator/(core|vitest-runner)' packages/core/package.json   # both present

# Update the single root lockfile + link workspace deps (MANDATORY before npm ls can resolve)
npm install   # run from repo root; updates the one root package-lock.json (npm workspaces)
git status --porcelain package-lock.json   # the lockfile MUST show as modified (part of this phase's diff)

# Additional Risk 2 — LOCKFILE DRIFT REVIEW: the lockfile diff MUST be confined to the @stryker-mutator/*
# family (+ their transitive deps) and MUST NOT churn unrelated dependency families (no eslint/typescript/
# vitest/etc version bumps). Inspect the diff and assert every changed package name is stryker-related:
git diff package-lock.json | grep -E '^\+ *"node_modules/' | grep -vE '@stryker-mutator|/stryker|mutation' \
  && echo "REVIEW: non-stryker node_modules paths changed — inspect for unrelated drift" \
  || echo "OK: lockfile changes confined to the stryker family"
# Belt-and-suspenders: confirm no lint/type/test toolchain family drifted (the known float hazard):
git diff package-lock.json | grep -E '^[+-] *"(eslint|typescript|@typescript-eslint/[a-z-]+|vitest|prettier)":' \
  && echo "FAIL: unrelated lint/type/test toolchain version drift in lockfile — pin/reset before proceeding" \
  || echo "OK: no lint/type/test toolchain drift"

# Dependency resolves (AFTER the install above)
npm ls @stryker-mutator/core --prefix packages/core 2>/dev/null | head
npm ls @stryker-mutator/vitest-runner --prefix packages/core 2>/dev/null | head

# The tooling actually runs end-to-end against a real llm-types file and emits a JSON report.
# (Runs the EXISTING core llm-types tests; a nonzero score is fine here — this proves the tooling works,
#  not the P05 gate. P05 enforces ≥80% on its changed files.)
npm --prefix packages/core run test:mutation -- --mutate "src/llm-types/modelEnvelope.ts"
test -f packages/core/reports/mutation/mutation.json && echo "mutation.json emitted"
```

### Deferred Implementation Detection
```bash
# This is a tooling phase: assert NO production src change slipped in.
git status --porcelain packages/core/src | grep -vE '^\?\?' && echo "UNEXPECTED src change" || echo "no src changes (expected)"
```

## Success Criteria
- `packages/core/stryker.conf.json` exists mirroring the agents config structure, scoped to the
  `llm-types` slice.
- `packages/core/package.json` has `@stryker-mutator/core` + `@stryker-mutator/vitest-runner` devDeps
  (pinned to the agents versions) and a `test:mutation` script.
- The root `package-lock.json` is updated by `npm install` (from repo root) and is part of this phase's
  committed diff, so `npm ls @stryker-mutator/core --prefix packages/core` RESOLVES.
- **Additional Risk 2:** the lockfile diff is CONFINED to the `@stryker-mutator/*` family (+ its transitive
  deps); the drift-review greps prove NO unrelated dependency-family churn (esp. no eslint/typescript/
  typescript-eslint/vitest/prettier version bumps). If unrelated drift appears, pin/reset it before proceeding.
- `npm --prefix packages/core run test:mutation -- --mutate "src/llm-types/modelEnvelope.ts"` runs to
  completion and writes `reports/mutation/mutation.json`.
- NO production `packages/core/src/**` code was modified in this phase (tooling-only; the only non-src
  changes are `packages/core/package.json`, `packages/core/stryker.conf.json`, and root `package-lock.json`).
- No lint/complexity loosening; no suppression directives.

## Failure Recovery
If this phase fails (config missing, deps unresolved, or the mutation run cannot emit a JSON report):
1. Revert the tracked file non-destructively: `git checkout -- packages/core/package.json package-lock.json`.
   For `packages/core/stryker.conf.json`: it is NEWLY CREATED by this phase and therefore UNTRACKED, so
   `git checkout` cannot restore it — remove it explicitly ONLY because it is a new, untracked tooling
   file with no prior version: `git clean -f packages/core/stryker.conf.json` (or delete the single new
   file). Do NOT run a broad `git clean`/`rm -rf`; touch ONLY this one new file. (Minor 3 — prefer
   non-destructive `git checkout` for tracked files; the config is safe to remove solely because it is
   new/untracked.)
2. Re-add the config/devDeps/script mirroring `packages/agents` EXACTLY (verified versions `^9.6.1`).
3. Re-run `npm install` (from repo root, per `.llxprt/LLXPRT.md`) so the deps resolve, then re-run the
   end-to-end mutation command.
4. Cannot proceed to Phase 02 until `test:mutation` runs and emits `reports/mutation/mutation.json`.

## Phase Completion Marker
Create `project-plans/issue2349/.completed/P01.md` containing:
- The pasted output of every Verification Command above (config/scripts present, `npm ls` resolves,
  the mutation run's tail + `mutation.json` emitted).
- Confirmation that NO `packages/core/src/**` file changed.
- The `@plan:PLAN-20260707-AGENTNEUTRAL.P01` / `@requirement:REQ-012.4` markers.
