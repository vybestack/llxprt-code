# Pseudocode: Verification

Plan ID: PLAN-20260603-ISSUE1584.P02

## Interface Contracts

**Inputs:** migrated source tree; provider package build artifacts; core package compilation; CLI package compilation; `anti-shim-policy.md` scan commands; `package-metadata-constraints.md` required checks; project memory verification requirements.

**Outputs:** evidence that behavior is unchanged and package boundaries are correct; command output logs; test results.

**Dependencies:** npm scripts, grep/rg, git status, smoke command.

**Contracts:**
- **C-V-01 (Behavioral/package-boundary tests):** Provider package tests pass for provider selection, provider switching, and representative provider generation through existing CLI/runtime paths — per REQ-TEST-001.1 and REQ-TEST-001.3. Tests MUST NOT use mock theater, reverse testing, or structure-only assertions.
- **C-V-02 (Forbidden import scans):** Three post-migration scans MUST return zero matches in production code: (a) core production imports from providers, (b) CLI deep imports into `core/src/providers/`, (c) core referencing non-existent `@vybestack/llxprt-code-providers` — per `anti-shim-policy.md` required scans and `core-import-remediation.md` Blocker verification.
- **C-V-03 (Package builds/typechecks):** Each workspace package (`core`, `providers`, `cli`) independently typechecks and builds after migration changes — per `phase-verification-matrix.md` expanded package-level checks.
- **C-V-04 (Full verification):** Root-level `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build` all pass — per project memory verification requirements and `phase-verification-matrix.md` P16 commands.
- **C-V-05 (Smoke test):** `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"` completes without error — per project memory smoke test requirement and REQ-API-001.3.
- **C-V-06 (Package metadata checks):** `packages/core/package.json` has no `@vybestack/llxprt-code-providers` dependency; `packages/providers/package.json` has `@vybestack/llxprt-code-core` dependency; `packages/cli/package.json` has both core and providers dependencies; root `package.json` workspaces includes `packages/providers` — per `package-metadata-constraints.md` required checks.
- **C-V-07 (Provider export correctness):** `packages/core/src/index.ts` does not re-export any provider-package symbol; no compatibility wrapper files exist under `packages/core/src/providers/` — per `anti-shim-policy.md` and `final-architecture.md` forbidden implementations.
- **C-V-08 (No implementation leftovers):** `find packages/core/src/providers -type f` returns only explicitly justified non-production artifacts recorded as P15a exceptions — per `anti-shim-policy.md` final core providers directory rule.

## Numbered Pseudocode

10: RUN provider package test: `npm run test --workspace @vybestack/llxprt-code-providers` — per C-V-01.
11: RUN provider package lint: `npm run lint --workspace @vybestack/llxprt-code-providers` — per C-V-03.
12: RUN provider package typecheck: `npm run typecheck --workspace @vybestack/llxprt-code-providers` — per C-V-03.
13: RUN provider package build: `npm run build --workspace @vybestack/llxprt-code-providers` — per C-V-03.

14: RUN core package test: `npm run test --workspace @vybestack/llxprt-code-core` — per C-V-01.
15: RUN core package lint: `npm run lint --workspace @vybestack/llxprt-code-core` — per C-V-03.
16: RUN core package typecheck: `npm run typecheck --workspace @vybestack/llxprt-code-core` — per C-V-03.
17: RUN core package build: `npm run build --workspace @vybestack/llxprt-code-core` — per C-V-03.

18: RUN CLI package test: `npm run test --workspace @vybestack/llxprt-code` — per C-V-01.
19: RUN CLI package lint: `npm run lint --workspace @vybestack/llxprt-code` — per C-V-03.
20: RUN CLI package typecheck: `npm run typecheck --workspace @vybestack/llxprt-code` — per C-V-03.
21: RUN CLI package build: `npm run build --workspace @vybestack/llxprt-code` — per C-V-03.

22: RUN root test: `npm run test` — per C-V-04.
23: RUN root lint: `npm run lint` — per C-V-04.
24: RUN root typecheck: `npm run typecheck` — per C-V-04.
25: RUN root format: `npm run format` — per C-V-04.
26: RUN root build: `npm run build` — per C-V-04.

27: RUN smoke test: `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"` — per C-V-05.

28: SCAN core source for forbidden provider exports: `rg -n "export .*providers|from ['\"].*providers/|from ['\"]@vybestack/llxprt-code-core/providers" packages/core/src/index.ts packages/core/src --glob '*.ts'` — per C-V-07.
29: SCAN core production source for forbidden imports from providers package: `rg -n "from ['\"].*providers/|from ['\"]@vybestack/llxprt-code-core/providers|from ['\"]@vybestack/llxprt-code-providers" packages/core/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts'` — per C-V-02 (a).
30: SCAN CLI production source for forbidden deep imports into core providers: `rg -n "from ['\"].*core/src/providers/|from ['\"]@vybestack/llxprt-code-core/providers" packages/cli/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts'` — per C-V-02 (b).

31: SCAN for compatibility shim files: `find packages/core/src -type f | rg -i "(V2|New|Copy|Compat).*Provider|Provider.*(V2|New|Copy|Compat)"` — per C-V-07 and `anti-shim-policy.md` forbidden shims.
32: SCAN for core package dependency on providers: `node -e "const p=require('./packages/core/package.json'); if ((p.dependencies||{})['@vybestack/llxprt-code-providers']) process.exit(1)"` — per C-V-06.
33: SCAN for core tsconfig reference to providers: `node -e "const c=require('./packages/core/tsconfig.json'); if ((c.references||[]).some(r => String(r.path).includes('providers'))) process.exit(1)"` — per C-V-06.
34: VERIFY workspace includes providers: `node -e "const p=require('./package.json'); if (!p.workspaces.includes('packages/providers')) process.exit(1)"` — per C-V-06.
35: VERIFY CLI depends on providers: `node -e "const p=require('./packages/cli/package.json'); const d=p.dependencies||{}; if (!d['@vybestack/llxprt-code-providers']) process.exit(1)"` — per C-V-06.

36: SCAN old core providers directory for implementation leftovers: `find packages/core/src/providers -type f 2>/dev/null | sort` — per C-V-08.

37: REVIEW changed tests for mock theater, reverse testing, and structure-only assertions: examine test diffs for fake implementations that merely verify structure rather than behavior — per C-V-01 and REQ-TEST-001.3.

38: FAIL if any check fails — all verification must pass before phase completion.

## Integration Points

- Lines 10–27 correspond to project memory verification requirements and `phase-verification-matrix.md` P16 commands.
- Lines 28–36 prove the refactoring objective (cycle-free boundary, no shims, clean exports), not just behavior preservation — per REQ-TEST-001.2.
- Line 37 ensures behavioral test quality per REQ-TEST-001.3.
- Lines 32–35 verify package metadata constraints per `package-metadata-constraints.md`.
- Line 36 enforces final core providers directory rule per `anti-shim-policy.md`.

## Anti-Pattern Warnings

[ERROR] DO NOT: claim unrelated CI failures without proof (verify same tests fail on main or other recent PRs using `gh`).
[ERROR] DO NOT: skip smoke test after package boundary changes.
[ERROR] DO NOT: omit command outputs from phase completion marker.
[ERROR] DO NOT: dismiss forbidden import scan hits as "acceptable" without documented exception in P15a.
[OK] DO: include complete command outputs in phase completion marker.
[OK] DO: run all three forbidden import scans (29, 30, and core→providers-package scan).
[OK] DO: verify each package builds independently before running root build.
