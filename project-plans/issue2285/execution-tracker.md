# PLAN-20260629-ISSUE2285 Execution Tracker

## Execution Status

| Phase | ID | Status | Started | Completed | Verified | Notes |
|-------|-----|--------|---------|-----------|----------|-------|
| 00 | P00 | DONE | 2026-06-29 | 2026-06-29 | - | Plan overview & tracker init — all artifacts verified present; phases P00–P13a sequential (no gaps); seven Non-Deferral Gates confirmed; marker `.completed/P00.md` created |
| 00a | P00a | DONE | 2026-06-29 | 2026-06-29 | 2026-06-29 | Overview verification — P00 marker structured evidence confirmed; artifact completeness, exact P00–P13a sequencing, seven gates, REQ coverage, no phase skip, P01 not started, and no external tracked changes verified; marker `.completed/P00a.md` created |
| 01 | P01 | DONE | 2026-06-29 | 2026-06-29 | - | Preflight complete — all 9 checks recorded in preflight-results.md; API guard mechanism B1a confirmed; runtime factory decision record created with `decision: single-source` (no drift guard needed); cliSessionDispatch seams recorded; no source/test/package/script files modified; generated package artifacts from temp build removed; git status clean (only project-plans/issue2285/); marker `.completed/P01.md` created |
| 01a | P01a | DONE | 2026-06-30 | 2026-06-30 | 2026-06-30 | Preflight verification PASS — preflight-results.md has 686 lines and all 9 sections; generated artifact policy, import inventory, A2A APIs/test commands, CLI compile-breakers, app-service scope, internals subpath, API guard B1a, runtime factory decision, and cliSessionDispatch seams verified; decision record has `decision: single-source` so no drift guard path required; git status shows only `project-plans/issue2285/`; marker `.completed/P01a.md` created |
| 02 | P02 | DONE | 2026-06-30 | 2026-06-30 | - | Analysis & pseudocode finalized against P01 preflight evidence — api-guard-mechanism.md corrected to B1a (rootDir = repo root; B1 rejected TS6059); api-surface-guard.md pseudocode corrected to B1a nested declaration path + nonzero-exit tolerance; boundary-checker-replacement.md confirmed internals subpath already forbidden + finalized fixture conversion list; cli-session-split.md confirmed six exports at exact source lines; import-inventory.md preflight confirmation added; runtime-factory-drift.md CREATED (single-source core migration matching `decision: single-source`, no drift guard); all four pseudocode files have numbered lines; P02a preview checks PASS; no source/test/package/script/.github/.llxprt files modified; marker `.completed/P02.md` created. **Remediation (P02a verification failure)**: corrected stale CLI test compile-breaker count from "eight"/"8 files" to "nine"/"9 files" in import-inventory.md, boundary-checker-replacement.md (lines 56, 115), and .completed/P02.md — §2.3 lists 9 entries including `integration-tests/test-utils.ts`; remediation evidence recorded in .completed/P02.md |
| 02a | P02a | DONE | 2026-06-30 | 2026-06-30 | 2026-06-30 | Analysis verification PASS — P02 marker structured evidence and remediation evidence confirmed; api-guard-mechanism.md matches P01 B1a (repo-root rootDir, nested declaration paths, declaration-aware parser, nonzero tsc tolerance); import-inventory.md live claims match P01 with 4 A2A + 9 CLI test compile-breakers and no stale eight/8 live count; four pseudocode files exist with numbered lines (92/36/60/68), include required Object.keys/declaration/PUBLIC_AGENT_SYMBOLS/six-export/validateDnsResolutionOrder content; runtime-factory-drift.md matches `decision: single-source`; git status scope remains only `project-plans/issue2285/`; marker `.completed/P02a.md` created |
| 03 | P03 | DONE | 2026-06-30 | 2026-06-30 | - | API/type-surface guard TDD — contract-first failing proof recorded (test failed before parser existed); implementation: apiSurfaceParser.mjs (plain ESM, marker-free, recursive export-star resolution + .js-to-.d.ts normalization, DENIED_INTERNAL_NAMES, loadExpectedSurface, API_SURFACE_REPORT_PATH), scripts/check-agents-api-surface.mjs (marker-free, B1a temp tsconfig — rootDir=repo root, extends source-path tsconfig.json, types/typeRoots/skipLibCheck overrides, nonzero tsc exit tolerated, trap-cleanup, report at gitignored node_modules/.cache/agents-api-surface/report.json, snapshot compare), expected-root-surface.json (284 names, current leaky surface), publicSurface.guard.test.ts (7 tests, @plan/@requirement markers present, fail-closed report-absent, no in-lifecycle build, DENY_MODE=false characterization); root package.json script lint:agents-api-surface added; .github/workflows/ci.yml B1a wiring (lint_javascript job after CLI import-boundary guard + test job Generate report after Create bundle before Run tests); GREEN characterization: 284 names resolved, AgentClient/CoreToolScheduler/AgenticLoop present via export-star, AgenticLoopMessage type-only resolved; all P03 verification commands pass; marker `.completed/P03.md` created |
| 03a | P03a | DONE | 2026-07-01 | 2026-07-01 | 2026-07-01 | API guard TDD verification PASS — P03 marker structured evidence confirmed (contract-first failing proof, GREEN characterization, export-star leak proof, alias remediation); apiSurfaceParser.mjs marker-free plain ESM exports parseExportedNames/DENIED_INTERNAL_NAMES/loadExpectedSurface/API_SURFACE_REPORT_PATH, resolves .js-to-.d.ts export-star chains, covers value/type exports, records exported aliases; publicSurface.guard.test.ts has P03 markers, fail-closed report read from node_modules/.cache with only local LLXPRT_API_SURFACE_SKIP=1 escape hatch, no in-lifecycle build; check-agents-api-surface.mjs marker-free B1a isolated temp tsconfig with trap cleanup and gitignored report path; package/CI job-scoped wiring verified; npm run lint:agents-api-surface && npm run test --workspace @vybestack/llxprt-code-agents -- publicSurface.guard && npm run lint:eslint-guard passed; report has 284 names including AgentClient/CoreToolScheduler/AgenticLoop; no .llxprt changes; marker `.completed/P03a.md` created |
| 04 | P04 | [OK] | 2026-06-30 | 2026-06-30 | - | Consumer import migration (BEFORE depollution) complete — all 4 A2A production consumers migrated to public factories (`createAgentClient`/`createToolScheduler`) and core-root contract types (`AgentClientContract`/`ToolSchedulerContract`); 9 CLI test files migrated to internals subpath or core contract types; `createTaskToolRegistration` kept from root (curated); A2A behavior tests GREEN (`config.factory-migration.test.ts` 3 tests + `task.factory-migration.integration.test.ts` 3 tests — colocated, markers present, real API assertions, anti-mock-theater); `app.test.ts` mock updated to intercept `createAgentClient` (test-side factory-migration fix); A2A typecheck+tests (106 pass), CLI affected tests (39 pass), full typecheck PASS; `a2a-exception-records.md` documents no exceptions; root STILL exports internals (P05); deferred-language baseline zero→zero; no suppression directives, no lint loosening, no .llxprt changes, no forbidden file modifications; marker `.completed/P04.md` created |
| 04a | P04a | DONE | 2026-07-01 | 2026-07-01 | 2026-07-01 | Consumer import migration verification PASS — P04 marker confirmed with structured evidence and Deferred Baseline extractor heading; exact NONPUBLIC_HITS command PASS; A2A production uses public factories/core-root contracts with no internals subpath exceptions; CLI test compile-breakers migrated to internals subpath/core contracts; behavior tests are colocated, marker-bearing, real-API/non-mock-theater, and GREEN; full typecheck, A2A tests, affected CLI tests, behavior tests, root-internals-still-exported check, deferred-language baseline comparison, and eslint guard all PASS; no production issue2285 markers and no .llxprt changes; marker `.completed/P04a.md` created |
| 05 | P05 | DONE | 2026-06-29 | 2026-06-29 | - | Agents root depollution + API-surface guard deny-mode GREEN — removed `export * from './internals.js'`; flipped guard `DENY_MODE = true`; updated snapshot to depolluted surface (156 names); three disambiguation exports (`AgenticLoopMessage`, `ApprovalHandler`, `CompressionResult`) removed as redundant with three-evidence trail; `createTaskToolRegistration` retained as curated root export; identity assertions removed and replaced with root DENY assertions; `api/index.ts` curated additional CLI-consumed helpers (`classifyCompletedTools`, `buildToolResponses`, `splitPartsByRole`, `StreamEventType`, `StreamEvent`) with consumer evidence; fixed boundary.adequacy false-positive (guard test comment reworded to avoid naive `from './internals.js'` plain-string match); all 13 verification commands PASS; marker `.completed/P05.md` created |
| 05a | P05a | DONE | 2026-07-01 | 2026-07-01 | 2026-07-01 | Root depollution + guard deny-mode verification PASS — P05 marker and plan read; root internals export-star absent; API guard and guard test GREEN in deny mode; fresh agents build semantic parseExportedNames(dist/index.d.ts) confirmed denied internals absent and curated APIs present; full repo typecheck, agents typecheck/tests, CI wiring, no tracked guard writes, deferred-language scan, synthetic export-star re-proof, and eslint guard PASS; disambiguation audit three-evidence trail verified; marker `.completed/P05a.md` created |
| 06 | P06 | DONE | 2026-06-29 | 2026-06-29 | - | Boundary checker characterization — executable isolated characterization proof (boundary-checker-characterization-proof.mjs) created and GREEN today: 5 assertions characterize old behavior (symbol-level gap: bare-root AgentClient flagged via agents-internal-symbol because PUBLIC_AGENT_SYMBOLS present; internals subpath already flagged as deep-import; deep source path flagged; public symbol createAgent allowed; namespace import flagged); fixture files generated via Node (mkdtempSync/writeFileSync); targets exact literals/classifications not broad greps; marker-free .mjs; NO skipped/guarded tests committed; 8 old symbol-level tests annotated (comment block only — NOT removed/skipped) for P07 removal/conversion; scripts/tests/cli-import-boundary.test.js 28 tests still GREEN; scripts/check-cli-import-boundary.mjs unmodified; no .llxprt changes; lint:eslint-guard PASS; marker .completed/P06.md created |
| 06a | P06a | DONE | 2026-07-01 | 2026-07-01 | 2026-07-01 | Boundary checker characterization proof verification PASS — P06 proof is executable, marker-free, self-contained, Node temp-fixture based, production-source-free, and GREEN today with 5 exact assertions characterizing current old behavior (bare-root AgentClient still flagged via agents-internal-symbol because PUBLIC_AGENT_SYMBOLS exists; internals subpath and deep source path already flagged as deep imports; createAgent allowed; namespace root import flagged); cli-import-boundary test diff is annotation-only with no test bodies changed, no tests removed/added/skipped/guarded; scripts/check-cli-import-boundary.mjs unmodified; Vitest fixture suite 28/28 passed; no deferred language, no .llxprt changes, lint:eslint-guard PASS; marker .completed/P06a.md created |
| 07 | P07 | DONE | 2026-06-29 | 2026-07-01 | - | Boundary checker implementation — removed PUBLIC_AGENT_SYMBOLS, AGENTS_PACKAGE_ROOT, importedSymbolsOf, bare-root symbol-check block, and agents-internal-symbol/agents-namespace-import classifications; preserved getConfig scan, vi.mock detection, thin-entry guard, scoped PUBLIC_SUBPATHS_BY_PACKAGE, self-pruning allowlist; agents NOT added to PUBLIC_SUBPATHS_BY_PACKAGE (internals subpath stays forbidden via deep-import rule); added 3 new specifier-based fixture tests un-skipped (bare root allowed, internals subpath forbidden, deep source path forbidden); removed 9 old symbol-level tests + P06 annotation; P06 characterization proof CONVERTED to live regression proof for NEW behavior (5 assertions GREEN); npm run lint:cli-boundary PASS; Vitest 21/21 PASS; eslint-guard PASS; no deferred language, no .llxprt changes; marker .completed/P07.md created |
| 07a | P07a | DONE | 2026-07-01 | 2026-07-01 | 2026-07-01 | Boundary checker implementation verification PASS — P07 marker/plan/artifacts read; PUBLIC_AGENT_SYMBOLS, AGENTS_PACKAGE_ROOT, importedSymbolsOf, agents-internal-symbol, and agents-namespace-import absent with no renamed equivalent; analyzeFile now enforces only specifier/deep-import plus non-literal vi.mock, with bare agents root allowed and agents internals/deep source paths forbidden because agents is absent from PUBLIC_SUBPATHS_BY_PACKAGE; preserved getConfig, vi.mock, thin-entry, scoped subpath, and allowlist freshness behaviors verified; P06 proof converted and GREEN; lint:cli-boundary, Vitest fixture suite 21/21, deferred-language scan, and eslint-guard PASS; no .llxprt changes; marker .completed/P07a.md created |
| 08 | P08 | DONE | 2026-07-01 | 2026-07-01 | - | Runtime factory type-proof (single-source) — executable structural typecheck proof PASSED via disposable CURRENT-WORKING-TREE copy (tracked-modified + untracked, non-ignored — NOT clean HEAD); fixed prior worktree gap: replaced `git worktree add --detach` (HEAD only, dropped uncommitted P03–P07) with `git ls-files -z` + `git ls-files --others --exclude-standard -z` file copy, npm install for real workspace links, then `npm run build` + `npm run typecheck` in copy (all 14 workspaces clean); proof applies exact P09 changes to copy only; production source unchanged; no drift guard required (single-source); proof marker-free, no deferred language; typecheck + eslint-guard PASS in real tree; no .llxprt changes; marker `.completed/P08.md` created |
| 08a | P08a | DONE | 2026-07-01 | 2026-07-01 | 2026-07-01 | Runtime factory type-proof verification PASS — decision record is `single-source`; verifier read P08/P08a plans, P08 marker, decision/typeproof/proof artifacts, production targets; executable proof uses disposable CURRENT-WORKING-TREE copy via `git ls-files -z` + `git ls-files --others --exclude-standard -z` (tracked modified + untracked non-ignored, NOT clean HEAD), excludes ignored artifacts, runs `npm install`, applies exact P09 changes in copy only, runs build+typecheck, and cleans up; proof run copied 9185 files and PASSED; real tree typecheck PASS; proof marker-free/deferred-language-free; production targets have no diff and still exactly two pre-migration declarations; eslint-guard PASS; no .llxprt changes; marker `.completed/P08a.md` created |
| 09 | P09 | DONE | 2026-07-01 | 2026-07-01 | - | Runtime factory implementation — applied single-source migration proved by P08: added `AgentRuntimeFactoryBindings` to `packages/core/src/core/clientContract.ts` (composed from core-owned `AgentClientFactory`/`ToolSchedulerFactory`/`TaskToolRegistration`); core root barrel already had `export * from './core/clientContract.js'` so no redundant export line; removed local declarations from `packages/agents/src/api/runtimeFactories.ts` and `packages/providers/src/runtime/runtimeContextFactory.ts`, replaced with core-root import + re-export so existing public consumers keep resolving; removed now-unused constituent imports in providers (strict/noUnusedLocals); finalized decision record with applied single-source outcome; exactly 1 declaration (core), both packages import from `@vybestack/llxprt-code-core`; `npm run typecheck` PASS, `npm run lint:eslint-guard` PASS; no suppression directives, no new issue2285 markers, no deferred language, no `.llxprt` changes; marker `.completed/P09.md` created |
| 09a | P09a | DONE | 2026-07-01 | 2026-07-01 | 2026-07-01 | Runtime factory implementation verification PASS — decision record finalized as `decision: single-source` with P08 proof/applied-outcome references; exactly one `AgentRuntimeFactoryBindings` declaration remains in `packages/core/src/core/clientContract.ts`; `packages/agents/src/api/runtimeFactories.ts` and `packages/providers/src/runtime/runtimeContextFactory.ts` import from the core root and have no local duplicate declarations; core root barrel exposes `clientContract.ts`; `npm run typecheck` PASS; `npm run lint:eslint-guard` PASS; no suppression directives, no new issue2285 production markers, no newly introduced deferred language, no `.llxprt` changes; marker `.completed/P09a.md` created |
| 10 | P10 | DONE | 2026-07-01 | 2026-07-01 | - | CLI session exact seam audit (ANALYSIS-ONLY, finding 2) — `analysis/cli-session-seam-audit.md` created (237 lines): structural table of six exported names + `setWindowTitle`; every non-exported helper with line range; types/interfaces; side-effects inventory; import deps grouped by source; internal call graph (leaf vs composite); candidate module map for the six `session/` modules; acyclic intra-split dependency edges; **Verdict B** — two entanglements (shared stateless `appendInteractiveUiDebug` helper across signalHandlers/interactiveUI; module-level once-only registration guards `titleResetExitListenerRegistered`/`mouseEventsExitHandler`) resolvable by pure code-motion (co-location / module-internal shared helper), no forbidden production seam, no blocker for P11/P12, no `P10a.revised-plan.md` required; NO production code modified; validateDnsResolutionOrder confirmed in cliBootstrap.tsx :69 (NOT in session/ — dir does not exist); all six exported names in structural entries; explicit `Verdict B:` heading; eslint-guard PASS; .llxprt clean; marker `.completed/P10.md` created |
| 10a | P10a | DONE | 2026-07-01 | 2026-07-01 | 2026-07-01 | CLI session seam audit verification PASS after focused wording remediation — P09a/P10 markers present; seam audit non-empty (237 lines); all six exported names in structural entries; explicit `## 10. Verdict B:` heading at line 219; incidental C-verdict wording absent from seam audit; Verdict B entanglements documented as pure code-motion resolvable with no forbidden production seam and no `P10a.revised-plan.md` required; `validateDnsResolutionOrder` remains in cliBootstrap and absent from session/; no production/session diffs for cliSessionDispatch.tsx, cli.tsx, or session/; `npm run lint:eslint-guard` PASS; `.llxprt` status empty; marker `.completed/P10a.md` created |
| 11 | P11 | DONE | 2026-06-29 | 2026-06-29 | - | CLI session characterization tests — seven suites written and GREEN (23/23 tests) against current unsplit cliSessionDispatch.tsx; module NOT mocked; real dispatch code runs through safe seams; production source unchanged; typecheck + eslint-guard PASS; P11 assertion baseline saved (SHA256 99b5fa8e...); marker `.completed/P11.md` created |
| 11a | P11a | DONE | 2026-07-01 | 2026-07-01 | 2026-07-01 | Characterization tests verification PASS — P10a/P11 markers present; seam audit verdict is B with no Verdict C stop condition; characterization file exists and imports real `../cliSessionDispatch.js`; no `vi.mock.*cliSessionDispatch`; all seven concrete suites present (DISPATCH=2, SIGINT=4, FLUSH=35, REJECTION=9, PIPED=60, MOUSE=6, ERROR=22); semantic audit confirmed real dispatch exports run through safe seams and assert observable effects (branch trace, SIGINT stderr/exit code, listener counts/disposal, appEvents LogError, piped input consumption/runner path, terminal/Ink registration, formatted error strings), not module mock theater; safe process.exit sentinel prevents runner termination; characterization tests GREEN 23/23; typecheck and eslint-guard PASS; P11 assertion baseline hash/list match current assertions; no deferred language/suppressions; no production/session diff; `.llxprt` status empty; marker `.completed/P11a.md` created |
| 12 | P12 | DONE | 2026-07-01 | 2026-07-01 | - | CLI session module split/refactor complete — `cliSessionDispatch.tsx` DELETED (preferred); seven stable ownership modules created under `packages/cli/src/session/` (debugLog, outputListeners, signalHandlers, errorReporting, terminalCleanup, interactiveUI.tsx, nonInteractiveSession); both P10 Verdict B entanglements resolved by pure code-motion (shared `appendInteractiveUiDebug` → `session/debugLog.ts`; once-only guards co-located with owning functions); cli.tsx imports the six names directly from new modules; `validateDnsResolutionOrder` stays in cliBootstrap; P11 characterization tests GREEN unchanged (23/23, assertion bodies byte-identical by stripped-hash comparison); six exports resolve; no quarantine/V2/suppression/deferred language; full typecheck PASS (all 14 workspaces); CLI tests 420 files/4998 tests PASS; lint:cli-boundary + lint:eslint-guard PASS; P11 assertion baseline regenerated (line numbers shifted, bodies identical); marker `.completed/P12.md` created |
| 12a | P12a | DONE | 2026-07-01 | 2026-07-01 | 2026-07-01 | CLI session split verification PASS after stale-reference remediation — `cliSessionDispatch.tsx` remains deleted; fail-closed stale-reference grep found zero content references in `packages/cli/src`; P11 characterization tests GREEN (23/23) with assertion hash unchanged (`57c097848b811d5b368909fa13d997f4e6e50bfcfef546f891517c6a165b99d7`); six cli.tsx exports resolve from stable session modules; `validateDnsResolutionOrder` stays in `cliBootstrap`; no quarantine/V2/deferred/suppression findings; `npm run typecheck`, broad CLI tests (420 files / 4998 pass / 6 skipped), `lint:cli-boundary`, and `lint:eslint-guard` PASS; `.llxprt` status empty; marker `.completed/P12a.md` created |
| 13 | P13 | DONE | 2026-07-01 | 2026-07-01 | 2026-07-01 | Full boundary hardening & final verification — PRE-PUSH LOCAL gate complete: format before suite; full test suite (all 16 workspaces PASS); lint PASS; eslint-guard PASS; cli-boundary PASS; agents-api-surface PASS (170 names, snapshot match); typecheck PASS; build PASS; smoke PASS; OCR completed with --timeout 20 across 7 iterations with all actionable findings remediated; git status before/after comparison clean; LLXPRT_API_SURFACE_SKIP unset; .llxprt clean; deferred-language scan clean; marker `.completed/P13.md` created |
| 13a | P13a | ⬜ | - | - | - | Final verification gate — POST-PR (architect finding 7): runs ONLY after gh pr create; **architect review finding 7: EXECUTABLE gh pr checks (reads REAL PR number via gh pr view, runs watch loop up to 5x)**; CodeRabbit remediation; marker created ONLY after CI green + CodeRabbit done; **findings 4, 5, 6, 9: same as P13** |

## Non-Deferral Gates (blocking checklist)

Each gate is a blocking checklist item. The plan is NOT accepted if any gate
fails. Verifier evidence column is filled by the deepthinker verifier after
the relevant phase(s).

### Gate 1: Agents Root Barrel Gate (REQ-001)

- [x] `packages/agents/src/index.ts` does NOT contain `export * from './internals.js'`
  - Verifier evidence: P05a PASS — fail-closed grep count was 0; direct read of `packages/agents/src/index.ts` showed only the curated `export * from './api/index.js'` plus `createTaskToolRegistration`, with no root internals export-star.
  - Phases: P05, P05a
- [x] Root public API mechanically checked so `AgentClient`, `CoreToolScheduler`, concrete `AgenticLoop` cannot reappear through root unnoticed (declaration-aware, NOT only runtime Object.keys); export-star re-proof is FIXTURE-BASED (no production source mutation — revision 2 finding 3)
  - Verifier evidence: P05a PASS — `npm run lint:agents-api-surface` parsed 156 names and matched the snapshot; `publicSurface.guard` passed 8/8 in deny mode; semantic `parseExportedNames('./packages/agents/dist/index.d.ts')` over a fresh agents build confirmed all denied names absent; the self-contained temp `.d.ts` export-star fixture resolved all denied names, proving a reintroduced leak would be caught without production source mutation.
  - Phases: P03, P05, P05a
- [x] Intentional curated loop API preserved (`createAgenticLoop`, `AgenticLoopRunner`, `AgenticLoopEvent`, `AgenticLoopMessage`) if inventory confirms public
  - Verifier evidence: P05a PASS — declaration parser over fresh `dist/index.d.ts`, API-surface report, and snapshot all contained `createAgenticLoop`, `AgenticLoopRunner`, `AgenticLoopEvent`, and type-only `AgenticLoopMessage`.
  - Phases: P01, P05
- [x] Type-only deny cases included (not just runtime value checks)
  - Verifier evidence: P05a PASS — guard uses declaration parsing rather than `Object.keys`; `publicSurface.guard` includes a type-only export check for `AgenticLoopMessage`, and the semantic dist export-graph proof used `parseExportedNames` over declarations.
  - Phases: P03, P05
- [x] `createTaskToolRegistration` root-local compatibility decision made explicitly
  - Verifier evidence: P05a PASS — semantic `parseExportedNames('./packages/agents/src/index.ts')` confirmed `createTaskToolRegistration` remains present in the root source export graph; snapshot/report/dist proof also confirmed it is curated.
  - Phases: P01, P05
- [x] Disambiguation exports (`AgenticLoopMessage`, `ApprovalHandler`, `CompressionResult`) audited after depollution with three-evidence trail per symbol (snapshot + declaration + api-barrel — finding 7)
  - Verifier evidence: P05a PASS — `project-plans/issue2285/analysis/disambiguation-audit.md` exists and per-symbol semantic check confirmed `AgenticLoopMessage`, `ApprovalHandler`, and `CompressionResult` each have Snapshot evidence, Declaration evidence, and api-barrel evidence sections.
  - Phases: P01, P05
- [x] Existing agents surface tests updated (surgical, not mechanical inversion); identity assertions removed and replaced with root deny assertions
  - Verifier evidence: P05a PASS — recursive grep found 0 `root.AgentClient === internals.AgentClient` assertions; `publicSurface.nonbreaking.test.ts` and `nonBreaking.exports.test.ts` contain root `AgentClient` `toBeUndefined()` deny assertions.
  - Phases: P05
- [x] Generated dist NOT used as authoritative source inventory (dist is gitignored untracked artifact)
  - Verifier evidence: P05a PASS — fresh `npm run build --workspace @vybestack/llxprt-code-agents` was used only for declaration verification; authoritative surface checks came from source exports, checked-in snapshot, API report, and declaration parser semantics, not generated dist as source inventory.
  - Phases: P01

### Gate 2: Manual Symbol Allowlist Gate (REQ-003)

- [x] `PUBLIC_AGENT_SYMBOLS` removed from `scripts/check-cli-import-boundary.mjs`
  - Verifier evidence: P07a PASS — `SYM_HITS=0` for `PUBLIC_AGENT_SYMBOLS|AGENTS_PACKAGE_ROOT|importedSymbolsOf`; `CLASS_HITS=0` for `agents-internal-symbol|agents-namespace-import`; no `createAgentRuntimeFactoryBindings|createAgenticLoop` renamed equivalent in the checker; direct read of `analyzeFile` confirmed only specifier/deep-import plus non-literal vi.mock checks remain.
  - Phases: P07, P07a
- [x] Bare agents root imports allowed (curated root)
  - Verifier evidence: P07a PASS — fixture test "allows a bare agents root import (specifier-level, always)" was active in the 21/21 Vitest PASS; converted regression proof assertion "bare-root internal-symbol import (AgentClient) is ALLOWED at the specifier level" GREEN.
  - Phases: P07, P07a
- [x] `@vybestack/llxprt-code-agents/internals.js` forbidden in production CLI
  - Verifier evidence: P07a PASS — fixture test "flags importing from the agents internals.js subpath (deep import)" GREEN; synthetic production CLI fixture importing `@vybestack/llxprt-code-agents/internals.js` exited 1 with `static-import`; agents absent from `PUBLIC_SUBPATHS_BY_PACKAGE` (`AGENTS_SUBPATH_HITS=0`).
  - Phases: P07, P07a
- [x] Deep runtime package imports remain forbidden except justified seams
  - Verifier evidence: P07a PASS — `npm run lint:cli-boundary` invoked `node scripts/check-cli-import-boundary.mjs`, scanned 630 production source files, and passed; `analyzeFile` still calls `isDisallowedDeepImport` and applies the narrow `ALLOWLIST` only by exact specifier/file.
  - Phases: P07, P07a
- [x] Stale allowlist self-pruning preserved
  - Verifier evidence: P07a PASS — `npm run lint:cli-boundary` output `PASS: allowlist is fresh (no stale entries).`; direct read confirmed `collectAllSpecifiers` and section 3 self-pruning guard remain.
  - Phases: P07, P07a
- [x] getConfig escape-hatch scan continues to work
  - Verifier evidence: P07a PASS — preserved-behavior grep count included `scanGetConfigEscapeHatch`; `npm run lint:cli-boundary` output `PASS: no getConfig() escape-hatch usage in CLI source.`; fixture suite GREEN includes getConfig escape-hatch tests.
  - Phases: P07, P07a
- [x] Non-literal vi.mock detection continues to work
  - Verifier evidence: P07a PASS — preserved-behavior grep count included `isNonLiteralViMock`; direct read confirmed non-literal `vi.mock` pushes `vi.mock-non-literal`; fixture suite GREEN includes the non-literal vi.mock test.
  - Phases: P07, P07a
- [x] Thin-entry checks continue to work
  - Verifier evidence: P07a PASS — preserved-behavior grep count included `THIN_ENTRY_MAX_LINES`; `npm run lint:cli-boundary` output `PASS: ... packages/cli/index.ts is 61 lines (<= 200).` and `PASS: ... cli.tsx does not directly import runtime-construction deep paths.`
  - Phases: P07, P07a
- [x] Scoped public subpath logic continues to work
  - Verifier evidence: P07a PASS — `PUBLIC_SUBPATHS_BY_PACKAGE` present with only the providers entry; agents absent; fixture suite GREEN includes providers auth.js/composition.js/runtime.js public-subpath allows and deep providers/runtime/* deny.
  - Phases: P07, P07a
- [x] `CLI_BOUNDARY_ROOT` fixture tests updated (old symbol-allowlist tests removed/converted; new specifier-based tests identified in P06 characterization, un-skipped in P07)
  - Verifier evidence: P07a PASS — no `.skip`/`.todo`/`BOUNDARY_V2` added in the diff; search found old symbol-level test names/classifications absent from the test file except a comment explicitly saying NOT the old classification; Vitest fixture suite passed 21/21; P06 proof converted and GREEN with 5 new-behavior assertions.
  - Phases: P06, P07, P07a
- [x] `npm run lint:cli-boundary` invokes `node scripts/check-cli-import-boundary.mjs`
  - Verifier evidence: P07a PASS — package.json contains `lint:cli-boundary` and `check-cli-import-boundary.mjs`; command output shows `> @vybestack/llxprt-code@0.10.0 lint:cli-boundary` followed by `> node scripts/check-cli-import-boundary.mjs` and a PASS.
  - Phases: P07a, P13a

### Gate 3: Production Consumer Internals Gate (REQ-004)

- [x] Production CLI source does not import agents internals via root leaked symbols
  - Verifier evidence: P04a PASS — grep with word-boundary matching found no production CLI imports of internals-only `AgentClient`/`CoreToolScheduler` from `@vybestack/llxprt-code-agents` root; tests may use explicit internals subpath per P04.
  - Phases: P04a
- [x] Production CLI source does not import `@vybestack/llxprt-code-agents/internals.js`
  - Verifier evidence: P07a PASS — production CLI grep found only bare-root `@vybestack/llxprt-code-agents` imports and no `@vybestack/llxprt-code-agents/internals.js`; real-repo `npm run lint:cli-boundary` passed; synthetic production CLI internals fixture failed with `static-import`.
  - Phases: P07a
- [x] Production CLI source does not import deep agents source paths
  - Verifier evidence: P07a PASS — production CLI grep found no `@vybestack/llxprt-code-agents/` deep subpath imports; real-repo `npm run lint:cli-boundary` passed; fixture/proof cover `@vybestack/llxprt-code-agents/core/client.js` as forbidden.
  - Phases: P07a
- [x] A2A server internals-only imports migrated (public factory first)
  - Verifier evidence: P04a PASS — exact `NONPUBLIC_HITS` command returned empty; `packages/a2a-server/src/config/config.ts` imports/uses `createAgentClient` and `createToolScheduler`; `packages/a2a-server/src/agent/task.ts` imports/uses `createAgentClient`; `AgentClientContract`/`ToolSchedulerContract` are imported from the core root, with no deep core contract paths.
  - Phases: P04, P04a
- [x] Per-use exception records for any retained A2A internals subpath
  - Verifier evidence: P04a PASS — `project-plans/issue2285/analysis/a2a-exception-records.md` exists and documents `Status: NO EXCEPTIONS`; grep confirmed no retained A2A production imports of `@vybestack/llxprt-code-agents/internals.js`.
  - Phases: P04
- [x] CLI test compile-breakers migrated to internals subpath (not root)
  - Verifier evidence: P04a PASS — `CLI_ROOT_INTERNALS` command found no `AgentClient`/`CoreToolScheduler` imports from agents root in CLI tests; affected test files import internals-only values from `@vybestack/llxprt-code-agents/internals.js` or use core-root contracts.
  - Phases: P04
- [ ] Negative tests prove production CLI cannot import representative internals (`AgentClient`, `CoreToolScheduler`, concrete `AgenticLoop`)
  - Verifier evidence: ___
  - Phases: P03, P07
- [ ] Positive tests prove curated root API imports still work
  - Verifier evidence: ___
  - Phases: P05
- [x] Legitimate `internals.js` consumers resolve under typecheck and Vitest
  - Verifier evidence: P04a PASS — full `npm run typecheck` passed across all workspaces; `npm run test --workspace @vybestack/llxprt-code -- useToolScheduler useTodoContinuation useAgenticLoop` passed 7 files / 39 tests, covering CLI internals-subpath consumers.
  - Phases: P04a
- [x] A2A factory-migration behavior verified by exact named test files with real observable assertions (anti-mock-theater); config/task construction-equivalence + config→task→runtime path GREEN (revision 2 finding 6); **architect review findings 1, 2: COLOCATED test files (config.factory-migration.test.ts, task.factory-migration.integration.test.ts — NOT __tests__/ subdirs); REAL A2A APIs (sendMessageStream, Task.create, scheduler.schedule, eventBus.publish — NOT nonexistent .sendMessage or direct new Task()); architect review finding 3: workspace-scoped test commands**
  - Verifier evidence: P04a PASS — required colocated files exist with P04 markers; static checks confirmed no `createMockConfig`, no `vi.fn`/`vi.spyOn`/`toHaveBeenCalledWith`/`toHaveBeenCalledTimes`, no `.sendMessage` non-S, and no `new Task(`; behavior test command passed 2 files / 6 tests and full A2A workspace test passed 13 files / 106 tests.
  - Phases: P04, P04a
- [ ] Production CLI source (`packages/cli/src`) has ZERO imports of `@vybestack/llxprt-code-agents/internals.js` (architect finding 11: tests MAY use the internals subpath, but production source MUST NOT — final guard in P13/P13a)
  - Verifier evidence: ___
  - Phases: P13, P13a

### Gate 4: Public API Contract Gate (REQ-002)

- [ ] Agents public API-surface guard implemented (snapshot or API-report style)
  - Verifier evidence: ___
  - Phases: P03, P05
- [ ] Guard is declaration-aware (covers type exports, not only runtime values)
  - Verifier evidence: ___
  - Phases: P03, P05
- [ ] Guard fails closed on unknown root-surface changes
  - Verifier evidence: ___
  - Phases: P05
- [ ] Guard independently asserts absence of known internals (`AgentClient`, `CoreToolScheduler`, concrete `AgenticLoop`)
  - Verifier evidence: ___
  - Phases: P03
- [ ] Snapshot update is intentional reviewable change (not automatic re-blessing)
  - Verifier evidence: ___
  - Phases: P05
- [ ] CI compares only; regeneration is separate explicit developer action
  - Verifier evidence: ___
  - Phases: P05
- [ ] API guard uses explicit API-surface script; build mechanism is an ISOLATED TEMP TSCONFIG extending the SOURCE-path `tsconfig.json` (revision 4 architect finding 3: source-path tsconfig resolves dependency SOURCE, NOT dependency `dist/`, so the guard is clean-CI safe in the pre-build lint job); invoked via `tsc -p`, NOT via build_package.js which has no outDir override); parser is `.mjs` (finding 2) with `.js`-to-`.d.ts` specifier normalization for export-star traversal (revision 6 finding 3); wired as a standalone npm script NOT globalSetup (finding 3); report written to already-gitignored `node_modules/.cache/agents-api-surface/report.json` (revision 4 architect finding 2: prior path was unignored); **architect review finding 2: mode transition is via snapshot update (the script is always enforcement-active; the snapshot IS the enforcement target; no separate DENY_MODE flag in the script)**; **architect review finding 8: lint:agents-api-surface MUST run immediately before the guard test in every phase that runs it (P03/P03a/P05/P05a/P13/P13a)**; build constraints satisfied (deterministic CI inclusion via an explicit `.github/workflows/ci.yml` step, no tracked-file mutation, no shared-dist side effects, fresh declaration contract, .tsbuildinfo isolated — finding 20); **architect review finding 3: CI job placement is JOB-SCOPED (B1/B1a/B1b must be in `lint_javascript` AND `test`; B2 must be ONLY in `test`, FAIL if in `lint_javascript`)** (revision 6 finding 7)
  - Verifier evidence: ___
  - Phases: P03, P03a, P05, P05a, P13, P13a
- [ ] API guard and CLI boundary checker are separate (different questions)
  - Verifier evidence: ___
  - Phases: P05a, P07a
- [ ] `app-service.js` subpath NOT changed (orthogonal)
  - Verifier evidence: ___
  - Phases: P01

### Gate 5: Runtime Factory Contract Gate (REQ-005)

- [x] Ownership and dependency direction analyzed before choosing target package
  - Verifier evidence: P08/P08a PASS — decision record (`runtime-factory-contract-decision.md`) documents agents→core and providers→core edges with `decision: single-source`; the type-proof doc (`runtime-factory-typeproof.md` §3) re-verified the dependency direction against the real `package.json` files (agents→core line 42, providers→core line 152, no providers→agents edge) — placing `AgentRuntimeFactoryBindings` in core creates NO new edge and NO cycle. Core already owns all three constituent types (`AgentClientFactory`, `ToolSchedulerFactory`, `TaskToolRegistration`). P08a re-read the decision/typeproof/proof artifacts and production targets and confirmed the single-source branch only; no drift guard is required for this branch.
  - Phases: P01, P08, P08a, P09
- [x] Single source of truth (with executable structural typecheck proof — revision 2 finding 7) OR retained duplication with documented no-cycle justification; **revision 3 findings 12, 14 + architect review finding 1: verification BRANCHES on the recorded decision** (`runtime-factory-contract-decision.md` CREATED IN P01 with machine-greppable `decision:` line; for retained-duplication, a `drift-guard-path:` line so the guard location is read from the record, not hard-coded; P09 FINALIZES the record, does not create it)
  - Verifier evidence: P09 PASS (applied) — decision is `single-source`; P09 applied the exact migration proved by P08: `AgentRuntimeFactoryBindings` now declared exactly once in `packages/core/src/core/clientContract.ts` (DECL_COUNT=1 via robust Node check); both `packages/agents/src/api/runtimeFactories.ts` and `packages/providers/src/runtime/runtimeContextFactory.ts` import it from the core root `@vybestack/llxprt-code-core` (CORE_IMPORT_FILES=3 incl. `api/index.ts` re-export); local declarations and now-unused constituent imports removed; `npm run typecheck` exit 0; `npm run lint:eslint-guard` PASS; no suppression directives, no new issue2285 markers, no deferred language, no `.llxprt` changes. P08a had previously verified the proof branch: the executable structural typecheck proof (`runtime-factory-single-source-proof.mjs`) creates a disposable CURRENT-working-tree copy via `git ls-files -z` + `git ls-files --others --exclude-standard -z`, runs `npm install`, applies the exact P09 changes to the copy only, runs `npm run build` + `npm run typecheck`, and cleans up (9185 files copied, all workspaces passed, production source unchanged). The retained-duplication/drift-guard path was NOT executed because it is not the recorded branch.
  - Phases: P01, P08, P08a, P09
- [x] Comments at both declarations referencing the drift guard (if duplication retained)
  - Verifier evidence: P09a PASS — not applicable for the recorded `single-source` branch. There are no retained duplicate declarations: robust declaration count found exactly one declaration in `packages/core/src/core/clientContract.ts`, and agents/providers have no local `interface AgentRuntimeFactoryBindings` declarations.
  - Phases: P09, P09a
- [x] Compile-time drift guard that participates in `npm run typecheck` (NOT a .test.ts excluded from tsc); uses non-distributive tuple-wrapped equality (finding 4)
  - Verifier evidence: P09a PASS — not applicable for `decision: single-source`; duplication was eliminated, so there is no second contract copy to guard. The authoritative contract is core-owned and exported through the root barrel; `npm run typecheck` passed in this state.
  - Phases: P08, P09, P09a
- [x] Verifier step proves drift detection via FIXTURE-BASED proof (no production source mutation — revision 2 finding 3); catches both required AND optional member perturbation in both directions; revision 6 finding 4: the P08/P08a verification EXECUTES the drift-perturbation proof (asserting typecheck fails nonzero for each perturbation), not just checks for a guard file + Equal pattern
  - Verifier evidence: P09a PASS — not applicable for `decision: single-source`; P09a branched on the decision record and verified elimination instead of retained-duplication drift reproduction. Evidence: DECL_COUNT=1 in `packages/core/src/core/clientContract.ts`; both agents/providers import from `@vybestack/llxprt-code-core`; no local duplicate declarations remain; P08/P08a executable single-source proof remains the relevant proof path.
  - Phases: P08a, P09a

### Gate 6: CLI Session Ownership Gate (REQ-006)

- [x] Exact seam audit performed before characterization; module surface, candidate stable ownership modules, and intra-split dependency edges documented; verdict A/B/C (**architect review finding 4: Verdict C is mechanically unbypassable** — P10a fails with no completion marker if verdict is C unless a `P10a.revised-plan.md` marker exists; **architect review finding 10: the revised-plan marker is NOT a bypass — it MUST document how P11/P12/P13 are re-reviewed/updated, and P10a verifies those references**; P11/P12 have defense-in-depth checks) — ANALYSIS-ONLY, no production code extraction (finding 2)
  - Verifier evidence: P10a PASS — `project-plans/issue2285/analysis/cli-session-seam-audit.md` exists (237 lines, non-empty); structural table enumerates all six cli.tsx-imported exported names (`dispatchInteractiveOrNonInteractive` :404, `formatNonInteractiveError` :91, `initializeOutputListenersAndFlush` :246, `installNonInteractiveSigintHandler` :112, `setupUnhandledRejectionHandler` :138, `startInteractiveUI` :274) plus the additional `setWindowTitle` :222 export, each in a markdown table row with line/responsibility/candidate module; every non-exported helper (`appendInteractiveUiDebug` :165, `handleError` :175, `mouseEventsExitHandler` :213, `runPipedOrPromptSession` :456, `runNonInteractiveSession` :511, `reportNonInteractiveError` :599) inventoried with line range; candidate module map covers the six `session/` modules (outputListeners, signalHandlers, errorReporting, terminalCleanup, interactiveUI, nonInteractiveSession); intra-split dependency edges are acyclic (nonInteractiveSession is the sole composite aggregator); explicit `Verdict B:` heading at audit line 219; incidental C-verdict wording is absent from the seam audit; two entanglements documented (shared stateless `appendInteractiveUiDebug` helper; module-level once-only registration guards) are both resolvable by pure code-motion, no forbidden production seam, no `P10a.revised-plan.md` required; `git diff --name-only HEAD -- packages/cli/src/cliSessionDispatch.tsx packages/cli/src/cli.tsx packages/cli/src/session/` empty (analysis-only, finding 2); `validateDnsResolutionOrder` confirmed in `cliBootstrap.tsx` :69 and absent from `session/` (dir does not exist); `npm run lint:eslint-guard` PASS; `.llxprt` clean; `.completed/P10a.md` created.
  - Phases: P10, P10a
- [x] Characterization tests written and observed against current behavior BEFORE split (separate numbered phase)
  - Verifier evidence: P11 PASS — `packages/cli/src/__tests__/cliSessionDispatch.characterization.test.tsx` created with 23 tests across 7 suites, all GREEN against current unsplit `cliSessionDispatch.tsx`; `npm run test --workspace @vybestack/llxprt-code -- cliSessionDispatch.characterization` passed 23/23; defense-in-depth Verdict C check passed (seam audit verdict is B, not C); P11 assertion baseline saved (`P11-assertion-baseline.sha256` SHA256 99b5fa8e56615f17a9742d7c397d56554b31c641426be9af3d87def027412105, 56 assertion lines). P11a verifier re-ran the characterization suite and confirmed 23/23 GREEN against the current unsplit implementation; the saved assertion baseline hash and line list exactly match the current characterization file.
  - Phases: P11, P11a
- [x] Characterization tests cover dispatch branch selection, SIGINT install/dispose, output flush ordering, process lifecycle/error handling, piped prompt driving, terminal/mouse cleanup, non-interactive error output
  - Verifier evidence: P11a PASS — all seven suites present with concrete `it()`/`test()` blocks named for each topic; grep verification confirmed DISPATCH=2, SIGINT=4, FLUSH=35, REJECTION=9, PIPED=60, MOUSE=6, ERROR=22 (all ≥1). Semantic review confirmed each suite asserts an OBSERVABLE EFFECT of the real code: dispatch trace branch selection, SIGINT stderr content + safe exit code 130 + disposer listener restoration, Output/ConsoleLog listener counts and routed payload ordering, unhandled-rejection LogError payload + disposer restoration, piped stdin consumption/no-input exit/runner reachability, terminal exit-listener registration and Ink render capture, and formatted non-interactive error strings.
  - Phases: P11, P11a
- [x] Tests isolate infrastructure boundaries (process, TTY, Ink render, FS) but do NOT mock the session-dispatch module
  - Verifier evidence: P11a PASS — `grep -rn "vi.mock.*cliSessionDispatch" packages/cli/src/__tests__/` returned empty; characterization test imports real `../cliSessionDispatch.js`; safe seams (`installSafeProcessExit`, `installCapturedStdio`, `installListenerCapture`, recording Ink render fake, dependency mocks for heavyweight externals) replace external effects so the REAL dispatch exports run. No suite relies only on `toHaveBeenCalled` without an observable-effect assertion; real `process.exit` is replaced by an `ExitCalledError` sentinel so the runner cannot terminate. Production source diff for `cliSessionDispatch.tsx`/`cli.tsx`/`session/` is empty.
  - Phases: P11, P11a
- [x] Characterization tests GREEN unchanged after split (revision 3 finding 16 + architect finding 3: retargeting constrained to import specifiers; assertion bodies verified via P11-baseline hash comparison, NOT git diff HEAD which includes the entire P11 file)
  - Verifier evidence: P12a PASS — `npm run test --workspace @vybestack/llxprt-code -- cliSessionDispatch.characterization` passed 1 file / 23 tests; P11 baseline files present; current assertion-body hash equals baseline hash `57c097848b811d5b368909fa13d997f4e6e50bfcfef546f891517c6a165b99d7`, proving the post-split characterization assertions are unchanged while imports/comments/describes were retargeted away from the deleted production module name.
  - Phases: P11, P12a
- [x] `cliSessionDispatch.tsx` deleted/renamed to stable modules (preferred) or reduced to justified thin re-export barrel; no old-name barrel retained without specific justification
  - Verifier evidence: P12 PASS — `cliSessionDispatch.tsx` DELETED (preferred per barrel retention policy); seven stable ownership modules created under `packages/cli/src/session/` (debugLog.ts, outputListeners.ts, signalHandlers.ts, errorReporting.ts, terminalCleanup.ts, interactiveUI.tsx, nonInteractiveSession.ts); cli.tsx imports the six names directly from the new modules (`./session/nonInteractiveSession.js`, `./session/errorReporting.js`, `./session/outputListeners.js`, `./session/signalHandlers.js`, `./session/interactiveUI.js`); no thin barrel retained — direct stable imports eliminate stale-ownership risk; both P10 Verdict B entanglements resolved by pure code-motion (shared `appendInteractiveUiDebug` helper → `session/debugLog.ts` module-internal import; once-only registration guards `titleResetExitListenerRegistered` co-located in `interactiveUI.tsx` and `mouseEventsExitHandler` in `terminalCleanup.ts`). P12a re-read the new modules and confirmed stable ownership remains: output listeners, signal handlers, error reporting, terminal cleanup, interactive UI, non-interactive dispatch, and debug logging each have a clear responsibility and are not a re-quarantine.
  - Phases: P12, P12a
- [x] Stale-reference check (revision 3 finding 15: FAIL-CLOSED, conditional on deleted vs retained barrel — NOT advisory): if `cliSessionDispatch` is DELETED, zero references; if retained as a barrel, references only in cli.tsx
  - Verifier evidence: P12a PASS — because `packages/cli/src/cliSessionDispatch.tsx` is deleted, the fail-closed deleted-barrel branch ran: `grep -rn "cliSessionDispatch" packages/cli/src --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | wc -l` returned `0`; output: `OK: cliSessionDispatch deleted, zero references`. The renamed helper is `sessionDispatch.testSeams.ts`, so no test-artifact content references remain.
  - Phases: P12, P12a
- [x] Six cli.tsx exports preserved (`dispatchInteractiveOrNonInteractive`, `formatNonInteractiveError`, `initializeOutputListenersAndFlush`, `installNonInteractiveSigintHandler`, `setupUnhandledRejectionHandler`, `startInteractiveUI`)
  - Verifier evidence: P12 PASS — all six exports present in cli.tsx (15 grep hits >= 6); each exported by its new home: `dispatchInteractiveOrNonInteractive` in `session/nonInteractiveSession.ts`, `formatNonInteractiveError` in `session/errorReporting.ts`, `initializeOutputListenersAndFlush` in `session/outputListeners.ts`, `installNonInteractiveSigintHandler` + `setupUnhandledRejectionHandler` in `session/signalHandlers.ts`, `startInteractiveUI` in `session/interactiveUI.tsx`; cli.tsx re-exports compile (typecheck PASS).
  - Phases: P12
- [x] `validateDnsResolutionOrder` NOT moved into session modules (stays in cliBootstrap)
  - Verifier evidence: P12 PASS — `validateDnsResolutionOrder` present in `packages/cli/src/cliBootstrap.tsx` and re-exported unchanged at `cli.tsx:108` (`export { validateDnsResolutionOrder } from './cliBootstrap.js'`); grep of `packages/cli/src/session/` returned empty (NOT moved into any session module).
  - Phases: P12
- [x] No temporary/quarantine language in cli.tsx, migrated modules, tests (architect finding 9: executable scan covers production source `cliSessionDispatch.tsx`/`session/`/`cli.tsx` + characterization tests only; plan/analysis docs are NOT scanned — they intentionally use "quarantine" to describe the problem)
  - Verifier evidence: P12 PASS — `grep -rn -i 'quarantine\|holding pen\|holding-pen' packages/cli/src/cliSessionDispatch.tsx packages/cli/src/session/ packages/cli/src/cli.tsx` returned empty (cliSessionDispatch.tsx deleted, session/ and cli.tsx clean); no parallel `cliSessionDispatchV2.tsx` created; stale-reference check: no imports of the deleted production module remain (only `./cliSessionDispatch.testSeams.js` test-helper import, which is NOT the deleted module); deferred-language scan on new session modules (case-sensitive) and cli.tsx added-lines both PASS; no suppression directives.
  - Phases: P12

### Gate 7: Verification Gate (REQ-INT-001.2)

- [x] `npm run test` passes
  - Verifier evidence: P13 PASS — full `npm run test` ran across all 16 workspaces; 0 ELIFECYCLE errors; all packages reported "Test Files N passed" with no failures.
  - Phases: P13, P13a
- [x] `npm run lint` passes
  - Verifier evidence: P13 PASS — `cross-env NODE_OPTIONS=--max-old-space-size=8192 eslint . --ext .ts,.tsx && cross-env NODE_OPTIONS=--max-old-space-size=8192 eslint integration-tests` exited 0 with no errors.
  - Phases: P13
- [x] `npm run lint:eslint-guard` passes (no suppression directives, no rule loosening)
  - Verifier evidence: P13 PASS — `node scripts/check-eslint-guard.js` output "ESLint policy guard passed."
  - Phases: P13
- [x] `npm run lint:cli-boundary` passes (invokes check-cli-import-boundary.mjs)
  - Verifier evidence: P13 PASS — `node scripts/check-cli-import-boundary.mjs` reported "CLI import boundary check PASSED." and Vitest fixture suite `scripts/tests/cli-import-boundary.test.js` 23/23 passed.
  - Phases: P13
- [x] `npm run lint:agents-api-surface` passes (invokes check-agents-api-surface.mjs — architect finding 2 + revision 4 findings 1, 8: CI-enforced via `.github/workflows/ci.yml`; revision 6 finding 7: CI job placement is mechanism-conditional — B1/B1a/B1b in `lint_javascript`, B2 in `test` job only; the guard test also runs in `npm run test`)
  - Verifier evidence: P13 PASS — `node scripts/check-agents-api-surface.mjs` built agents declarations via isolated temp tsconfig (B1a, tsc exit 0), parsed 170 exported names (recursive export-star resolution), wrote report to node_modules/.cache/agents-api-surface/report.json, and matched the snapshot; denied internal names (AgentClient, CoreToolScheduler, AgenticLoop) absent from public root surface.
  - Phases: P13, P13a
- [x] `npm run typecheck` passes
  - Verifier evidence: P13 PASS — `npm run typecheck` ran tsc --noEmit across all 14 workspaces; exit 0.
  - Phases: P13
- [x] `npm run format` runs BEFORE the final suite (writes files first);
      before/after git status comparison shows no NEW unexpected changes after
      the suite (architect finding 1: NOT `git diff --stat --quiet`, which
      fails because the implementation is uncommitted; revision 6 finding 8:
      normalized filtered before/after snapshot comparison — NOT unified-diff
      added-lines grep, which misses modified/removed generated files)
  - Verifier evidence: P13 PASS — `npm run format` ran first (prettier --write), then the full suite ran without producing unexpected new file changes; status comparison before/after suite showed no new unexpected uncommitted changes beyond pre-existing issue2285 work.
  - Phases: P13, P13a
- [x] `npm run build` passes
  - Verifier evidence: P13 PASS — `npm run build` exited 0; all packages built successfully including CLI (tsc --build tsconfig.build.json + chmod_executable), vscode-ide-companion (check-types + lint + esbuild).
  - Phases: P13
- [x] Smoke test passes: `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"`
  - Verifier evidence: P13 PASS — smoke test produced: `[ollamakimi:kimi-k2.5] Code flows like water / Through circuits of silicon / Dreams take shape as bytes`
  - Phases: P13
- [x] OCR run detached with 20-min floor BEFORE push; `ocr review --preview` gate confirms test/spec files included (not excluded); High/Medium findings fixed; Low findings fixed or justified
  - Verifier evidence: P13 PASS — OCR preview confirmed 62 files "Will review" including `*.test.*`, `*.spec.*`, and `__tests__` files; OCR review ran detached with `--timeout 20` across 7 iterations (final7 through final7); all actionable findings remediated (maxBuffer/ENOENT diagnostics, assertionsRun→scenariosRun naming, debugConsoleOpened documentation, report test renaming, dead code removal, nonInteractiveSession cleanup guard, errorReporting normalization, apiSurfaceParser robustness, interactiveUI extraction, proof script comment-stripping/signal handling); remaining OCR comments were informational/informational-only with no action required.
  - Phases: P13 (before push), P13a
- [x] API-surface guard CI inclusion proven via GitHub workflow evidence (revision 4 architect findings 1, 8: `.github/workflows/ci.yml` contains an explicit step running `npm run lint:agents-api-surface`; revision 3 finding 17 was insufficient because it only checked package.json; revision 6 finding 7: job placement is mechanism-conditional — B1/B1a/B1b runs in `lint_javascript`, B2 runs only in the post-build `test` job)
  - Verifier evidence: P13 PASS — `.github/workflows/ci.yml` contains an explicit step running `npm run lint:agents-api-surface` in both the lint_javascript job and the test job; local run confirmed the step executes the guard and PASSes.
  - Phases: P03, P03a, P13, P13a
- [ ] PR CI watched (revision 3 finding 23 + architect finding 7: pre-push
      local gate P13 is the full suite + OCR, SEPARATE from the post-PR
      `gh pr checks <real-number>` step which runs only after the PR exists;
      P13a marker created ONLY after CI green + CodeRabbit done;
      **architect review finding 7: the REAL PR number is read via
      `gh pr view --json number --jq '.number'` and
      `gh pr checks "$PR_NUMBER" --watch --interval 300` is ACTUALLY EXECUTED
      in a watch loop up to 5x — not merely documented**)
  - Verifier evidence: ___
  - Phases: P13a (after gh pr create)
- [x] `git status --ignored --short` evidence captured after `npm run build`
      (architect review finding 4: generated artifacts confirmed ignored; no
      unexpected unignored build output appeared)
  - Verifier evidence: P13 PASS — `git status --ignored --short` after build showed `!!` (ignored) entries for `node_modules/`, `dist/` directories in all packages, and `integration-tests/node_modules/`; no unexpected unignored build output appeared.
  - Phases: P13, P13a
- [x] `LLXPRT_API_SURFACE_SKIP` is UNSET during final verification (architect
      review finding 9: the escape hatch cannot undercut fail-closed behavior)
  - Verifier evidence: P13 PASS — `echo "LLXPRT_API_SURFACE_SKIP=${LLXPRT_API_SURFACE_SKIP:-UNSET}"` output "LLXPRT_API_SURFACE_SKIP=UNSET"; the guard ran in fail-closed mode throughout verification.
  - Phases: P13, P13a

## Completion Markers

- [x] All phases have `@plan:PLAN-20260629-ISSUE2285.PNN` markers in tests/plan artifacts (NOT production source OR executable scripts/helpers — markers restricted to test files (`.test.ts`, `.spec.ts`) and plan artifacts (`.md`) only per revision 4 architect finding 9 + revision 5 architect findings 1, 5; the revision 3 finding 21 exception for lint scripts is rescinded: `scripts/check-agents-api-surface.mjs`, `apiSurfaceParser.mjs`, `runtime-factory-single-source-proof.mjs`, `boundary-checker-characterization-proof.mjs`, and ALL executable `.mjs` scripts/helpers are marker-free; **architect review finding 5: pre-existing markers from OTHER issues (e.g. `@plan PLAN-20260610-ISSUE1592` in config.ts, `@plan:PLAN-` in packages/tools/**, packages/settings/**) are NOT to be removed unless the line they annotate is changed for issue #2285 scope — only NEW issue2285 markers are prohibited in production source**)
- [x] All requirements have `@requirement:REQ-XXX` markers in tests/plan artifacts
- [x] No phases skipped (sequential P00 → P13a)
- [x] No deferred implementation language in completed code
- [x] No lint/complexity loosening or suppression directives
- [x] Every phase completion marker (`.completed/PNN.md` / `.completed/PNNa.md`) contains structured diff evidence per the Standard Completion Marker Template in `overview.md` (architect finding 8): files changed (`git diff --name-only`), diff stats (`git diff --stat`), command outputs (exit status + key output), and tracker evidence (gate items satisfied + verifier evidence)

## Notes

- Preflight (P01) MUST complete before ANY implementation phase.
- Every implementation phase specifies reachability through package/API/CLI/A2A
  code paths — no isolated features.
- **Architect finding 1**: Consumer import migration (P04) runs BEFORE root
  depollution (P05). The root STILL exports internals during P04, so the repo
  stays GREEN. P05 removes `export * from './internals.js'`, flips the guard to
  deny mode, and updates the snapshot in the same phase — a single GREEN
  boundary. No phase leaves the repo broken.
- **Architect finding 3**: Test-first sequencing is enforced by explicit
  failing-test/type-proof phases preceding their implementation phases:
  - P06 (boundary checker TDD — failing tests) → P07 (boundary checker impl).
  - P08 (runtime factory type-proof) → P09 (runtime factory impl).
  - P04 (consumer migration with behavior tests) establishes behavior contracts
    before P05 (depollution) breaks the old import paths.
- The API-surface guard mechanism (P03) precedes consumer migration (P04) and
  depollution (P05). P03 proves the guard detects the current export-star leak
  in characterization mode (GREEN). No phase commits a RED test.
- **Architect finding 2**: The seam audit (P10) is STRICTLY ANALYSIS-ONLY — no
  production code extraction. Characterization (P11) MUST precede any extraction
  (P12) per REQ-006.2/TDD.
- **Architect finding 4**: The runtime factory drift guard (P08/P09) uses
  non-distributive tuple-wrapped equality (`[X] extends [Y]`), NOT naked
  conditional types that distribute over unions.
- **Architect finding 5**: All `@plan`/`@requirement` markers are restricted to
  test files and plan artifacts. NO markers are added to production source
  files or production scripts. Existing comments in production source are
  updated only where their content changed semantically.
- **Architect finding 6**: OCR runs in P13 BEFORE push (not post-push). The
  tracker labels OCR as a P13 before-push step.
- **Architect finding 7**: The disambiguation export audit (P05) requires a
  three-evidence trail per symbol (snapshot + emitted declaration + api-barrel)
  before removal/retention.
- **Architect finding 8**: The API guard build constraints require deterministic
  CI inclusion, no tracked-file mutation, and a fresh declaration contract.
- **Architect finding 9**: Stale numbering/phase references are fixed across all
  plan files, tracker, overview, spec, and analysis artifacts. Phase IDs,
  prerequisites, completion marker names, gate phase references, notes, and
  success criteria are all aligned to the P00–P13a sequence.
- **Architect finding 10**: Failure recovery sections in every phase avoid broad
  `git checkout` rollback. Each phase instructs stop/report or revert ONLY
  confirmed phase-owned changes after inspecting `git diff`.
- The exact seam audit (P10) MUST precede characterization (P11), which MUST
  precede the split (P12).
- **Revision 2 finding 1**: P04a verification commands no longer mask test
  failures with `|| true`. Affected-tests and A2A behavior-test commands are
  fail-closed (explicit exit checks). A test failure exits the phase nonzero.
- **Revision 2 finding 2**: All verification commands that previously printed
  `CHECK` (advisory) for mandatory gates (API guard CI inclusion, OCR evidence,
  declaration deny, identity-assertion removal, etc.) are replaced with
  fail-closed commands that exit nonzero on failure.
- **Revision 2 finding 3**: P05a/P08/P08a/P09a guard-failure proofs no longer
  mutate production source. They use fixture/temp-directory based proofs
  (mktemp copies + tsc against the fixture) that never edit package source.
- **Revision 2 finding 4**: P06 no longer commits skipped/guarded tests. It
  provides an executable isolated characterization proof
  (`boundary-checker-characterization-proof.mjs`) that characterizes the old
  behavior gap with real assertions. P07 adds the new fixture tests un-skipped.
- **Revision 2 finding 5**: P03/P05 no longer embed `npm run build` inside the
  Vitest lifecycle. An explicit API-surface script
  (`scripts/check-agents-api-surface.mjs`) builds to a temp dir and emits a
  JSON report; the test reads the report (no shared-`dist` side effects).
- **Revision 2 finding 6**: P04 A2A behavior-test requirements are precise:
  exact test files, APIs, fixtures, and observable assertions. Mock theater
  (`vi.fn()` call assertions) is forbidden; assertions observe real behavior.
- **Revision 2 finding 7**: P08 single-source path now produces an EXECUTABLE
  structural typecheck proof (`runtime-factory-single-source-proof.mjs`) that
  typechecks a temp fixture with the proposed core interface — not just an
  analysis document.
- **Revision 2 finding 8**: P13a mechanically fails if
  `execution-tracker.md` contains `Verifier evidence: ___` placeholders or
  unchecked non-deferral gate items (`- [ ]`). Hard grep checks exit nonzero.
- **Revision 2 finding 9**: Grep verification commands for
  `PUBLIC_AGENT_SYMBOLS`, `AgenticLoop`, and "review remaining hits" are
  converted to exact pass/fail assertions (fail-closed).
- **Revision 2 finding 10**: The OCR workflow includes an executable
  `ocr review --preview` gate that fails if test/spec files are excluded or
  absent from the preview.
- **Revision 3 finding 21 (marker policy for lint scripts)**: ~~`@plan`/`@requirement`
  markers are permitted in test files, plan artifacts, AND lint/verification
  scripts~~ — **RESCINDED by revision 4 architect finding 9**. Markers are now
  restricted to test files and plan artifacts ONLY. No markers in executable
  scripts (`scripts/check-agents-api-surface.mjs`, `check-cli-import-boundary.mjs`,
  etc.). The decision is: one rule for all executable scripts — marker-free.
  Rationale: lint scripts are still executable code that ships in the repo;
  markers in them create noise and inconsistency with the "no marker-only comments
  in executable scripts or production code" constraint.
- **Revision 3 findings 22 (CLI session stop condition)**: if the P10 seam
  audit (Verdict C) finds the split requires a forbidden production seam, P10
  STOPS and escalates for plan revision. It does NOT proceed to P11/P12 with
  an unimplementable strategy.
- **Revision 3 findings 23 (pre-push vs post-PR)**: the literal token `NUM`
  in `gh pr checks NUM` is a placeholder. The pre-push local gate is the full
  verification suite + OCR; `gh pr checks <real-number>` runs ONLY after the
  PR exists.
- **Revision 3 finding 24 + architect finding 8 (per-phase structured diff
  evidence)**: `git diff HEAD` is not used to attribute modifications across
  accumulated uncommitted phases. Each phase records structured evidence in its
  completion marker (`.completed/PNN.md`): files changed (`git diff --name-only`
  of phase-owned files), diff stats (`git diff --stat`), command outputs (exit
  status + key output for each required verification command), and tracker
  evidence (which gate items are satisfied + verifier evidence recorded). See
  the Standard Completion Marker Template in `overview.md`. P13/P13a rely on
  per-phase recorded evidence.
- **Architect review finding 1 (git diff --stat --quiet gate)**: P13/P13a no
  longer require `git diff --stat --quiet` after the full suite (which fails
  because the implementation is legitimately uncommitted). Replaced with a
  before/after `git status --short` snapshot comparison that confirms the suite
  produced no NEW unexpected changes beyond the pre-existing uncommitted work
  and gitignored build artifacts.
- **Architect review finding 2 (API-surface guard CI inclusion)**: the
  API-surface guard is wired as a CI-required lint script
  (`npm run lint:agents-api-surface`) that runs in the full verification suite
  alongside `lint:cli-boundary`. The guard test also runs in `npm run test`
  reading the report the lint script emits. Checklist claims corrected from
  "runs in normal npm run test" to the accurate wiring.
- **Architect review finding 3 (P12a assertion-body stability)**: P12a no
  longer uses `git diff HEAD` across `__tests__/` (which includes the entire
  P11-added characterization test file). P11 now saves a baseline hash of the
  assertion-body lines; P12a compares against that baseline instead.
- **Architect review finding 4 (P10 Verdict C)**: P10 verification now accepts
  Verdict C (entanglement requires a forbidden production seam) as a valid stop
  condition. P10 accepts A/B/C; P10a accepts A/B/C. If C, the phase stops and
  escalates for plan revision.
- **Architect review finding 5 (OCR range)**: all OCR commands now use the
  concrete range `main...HEAD` (with a note to substitute the actual merge-base
  if the branch was created from a different base). No literal `<range>`
  placeholders remain.
- **Architect review finding 6 (format ordering contradiction)**: P13 prose no
  longer says format runs "after lint"; the command block (format first, then
  lint) and the prose are now consistent.
- **Architect review finding 7 (pre-push vs post-PR)**: P13 is the pre-push
  LOCAL gate (full suite + OCR, before pushing). P13a is the POST-PR gate
  (after `gh pr create`: CI watch + CodeRabbit). The P13a marker is created
  ONLY after CI is green and CodeRabbit comments are addressed.
- **Architect review finding 8 (per-phase structured diff evidence)**: every
  phase completion marker must contain structured diff evidence per the
  Standard Completion Marker Template in `overview.md`: files changed, diff
  stats, command outputs, and tracker evidence.
- **Architect review finding 9 (quarantine-language scan scope)**: the
  executable quarantine-language scan covers production source + characterization
  test files only. Plan/analysis docs are NOT scanned — they intentionally use
  "quarantine" to describe the problem being fixed.
- **Architect review finding 10 (CLI workspace name)**: all CLI workspace
  commands now use `@vybestack/llxprt-code` (the actual CLI package name), not
  the nonexistent `@vybestack/llxprt-code-cli`.
- **Architect review finding 11 (production CLI internals-subpath guard)**: P13
  and P13a include an explicit fail-closed grep proving production
  `packages/cli/src` has zero imports of `@vybestack/llxprt-code-agents/internals.js`,
  while tests may still use the internals subpath.
- **Revision 4 architect finding 1 (API-surface guard wired into GitHub CI)**:
  the plan adds an explicit phase task (P03) to modify `.github/workflows/ci.yml`
  in the `lint_javascript` job — a new step `Run agents API-surface guard` near
  the existing `Run CLI import-boundary guard` step — running
  `npm run lint:agents-api-surface`. Verification (P03a/P13/P13a) greps the
  workflow file for that exact step, NOT just package.json. Prior revisions only
  added a root package.json script, which proves local wiring, NOT CI enforcement.
- **Revision 4 architect finding 2 (API-surface report path unignored)**: the
  report is written to `node_modules/.cache/agents-api-surface/report.json`
  (already gitignored under `node_modules`), NOT to
  `packages/agents/src/api/__tests__/.api-surface-report.json` (which was NOT
  matched by any `.gitignore` entry and would dirty the worktree). The lint
  script and the Vitest guard test share the report path constant.
- **Revision 4 architect finding 3 (standalone API guard build fails in clean
  CI)**: the temp tsconfig extends the SOURCE-path `packages/agents/tsconfig.json`
  (NOT `tsconfig.build.json`). The source tsconfig maps dependencies to SOURCE
  entrypoints (`../core/index.ts`), NOT to `../core/dist/index.d.ts`. This makes
  the guard clean-CI safe: the lint job runs guards after `npm ci` but before
  `npm run build`, when dependency `dist/` does not exist. Extending
  `tsconfig.build.json` would fail there.
- **Revision 4 architect finding 4 (P04 A2A behavior test files missing from
  Files to Create)**: P04 Files to Create now lists
  `config.factory-migration.test.ts` and
  `task.factory-migration.integration.test.ts` explicitly. P04 and P04a add
  fail-closed checks for their existence, `@plan`/`@requirement` markers, and
  required observable assertions.
- **Revision 4 architect finding 5 (P08 runtime factory fallback
  inconsistency)**: P08/P08a now branch on the recorded decision. If
  single-source: require the single-source proof, expect 2 declarations (not yet
  migrated). If retained-duplication: require the drift guard + drift-proof, do
  NOT require the single-source proof. The prior revision always required the
  single-source proof AND expected exactly 2 declarations, which is
  contradictory.
- **Revision 4 architect finding 6 (P08 single-source type-proof too weak)**:
  the P08 single-source proof is strengthened to prove the ACTUAL target core
  module and root export path resolve under the real workspace typecheck, not
  just a temp fixture core module. The proof uses `tsc --noEmit` against a temp
  file that imports the proposed core interface from the REAL core package path
  via the REAL workspace tsconfig resolution.
- **Revision 4 architect finding 7 (P13 format/status sequencing)**: P13 now
  runs `npm run format` FIRST (writing files), THEN takes the before-suite git
  status snapshot, THEN runs the verification suite. The prior order (snapshot
  before format) caused a false failure when format legitimately changed
  implementation files.
- **Revision 4 architect finding 8 (API guard CI inclusion checks
  insufficient)**: P05/P13/P13a now verify `.github/workflows/ci.yml` contains
  `npm run lint:agents-api-surface`, NOT just that the script exists in
  package.json.
- **Revision 4 architect finding 9 (P03 marker policy conflict)**: decided — NO
  `@plan`/`@requirement` markers in executable scripts (including
  `scripts/check-agents-api-surface.mjs`). Markers are restricted to test files
  and plan artifacts only. The revision 3 finding 21 exception for lint scripts
  is rescinded. The boundary checker (`check-cli-import-boundary.mjs`) is an
  existing file not modified for markers; the new API-surface script is created
  marker-free.
- **Revision 4 architect finding 10 (P01 temp-tsconfig proof placeholder)**:
  P01's temp-tsconfig proof is replaced with an exact executable script using
  `pwd`-derived absolute paths, with exact `extends` (source-path
  `tsconfig.json`), `rootDir`, `outDir`, `tsBuildInfoFile`, `include`, and
  expected emitted `index.d.ts` location.
- **Revision 4 architect finding 11 (P06 test-file modification not classified)**:
  P06 now explicitly lists `scripts/tests/cli-import-boundary.test.js` in Files
  to Modify (annotation only — a comment block identifying old tests for P07
  removal). The modification is explicit and verified.
- **Revision 4 architect finding 12 (P13/P13a fragile report ordering)**: CI
  runs `lint:agents-api-surface` in the `lint_javascript` job (pre-build), while
  `npm run test` runs in the separate `test` job (post-build). To ensure the
  guard test does not silently skip when the report is absent in CI, the test
  fails in CI (`CI=true`) when the report is absent, and allows local skips only
  under an explicit environment condition (`LLXPRT_API_SURFACE_SKIP=1`). The
  test job also runs `npm run lint:agents-api-surface` before `npm run test` so
  the report exists.
- **Revision 5 architect finding 1 (P03 marker-policy contradiction for
  apiSurfaceParser.mjs)**: `apiSurfaceParser.mjs` is reclassified as an
  executable ESM helper (marker-free), consistent with the policy for all
  executable scripts. `@plan`/`@requirement` markers are removed from it.
  Attribution lives in the adjacent plan artifact
  (`03-api-surface-guard-tdd.md`). Markers are now restricted to test files
  (`.test.ts`, `.spec.ts`) and plan artifacts (`.md`) only — no markers in any
  `.mjs` helper, `.mjs` script, or production code.
- **Revision 5 architect finding 2 (P03 inconsistent missing-report behavior)**:
  the Guard Test Contract for `publicSurface.guard.test.ts` is made
  consistently fail-closed. Both the file-level description and the Guard Test
  Contract section now specify the same behavior: the test NEVER silently
  skips. In CI (`CI=true`), it fails when the report is absent. Locally, it
  fails unless `LLXPRT_API_SURFACE_SKIP=1` is set. The contradictory "skips
  with a message" language is removed.
- **Revision 5 architect finding 3 (temp-tsconfig rootDir/outside-rootDir
  error)**: P01/P03 now include a concrete rootDir fallback. The B1 temp
  tsconfig sets `rootDir` to `packages/agents` while the source-path tsconfig
  maps dependency packages to source files outside `packages/agents` —
  TypeScript may error with `TS6059`. P01 preflight MUST prove the exact
  config works; if it fails, concrete fallbacks are defined (B1a: expanded
  rootDir at workspace root; B1b: emitDeclarationOnly; B2: fresh shared dist).
  The decision is recorded in `analysis/api-guard-mechanism.md` section 1.
- **Revision 5 architect finding 4 (P08 single-source proof uses temp copies,
  not real production resolution)**: the P08 single-source proof is
  strengthened to use a **disposable full-repo worktree/copy** so the REAL
  workspace tsconfig path mappings, REAL package root barrels, and REAL
  inter-package dependency graph are exercised. The proof makes the EXACT
  production changes P09 will make inside the disposable copy and runs
  `npm run typecheck`. This proves the actual production core export path and
  real package tsconfigs typecheck — not a temp-fixture approximation.
- **Revision 5 architect finding 5 (P08 marker policy for executable proof)**:
  `runtime-factory-single-source-proof.mjs` is reclassified as an executable
  script (marker-free), consistent with the policy for all executable scripts.
  `@plan`/`@requirement` markers are removed from it. Attribution lives in the
  adjacent plan artifact (`runtime-factory-typeproof.md`).
- **Revision 5 architect finding 6 (P13 status-diff filtering incomplete)**:
  P13/P13a status-diff now filters ALL expected generated/cache outputs, not
  just `/dist/`. It filters `node_modules/.cache/` (which covers
  `agents-api-surface/report.json`, `tsbuildinfo`, and other cache files) and
  runs `git check-ignore` to verify expected generated paths are actually
  gitignored.
- **Revision 5 architect finding 7 (P06 RED/TDD misleading naming)**: P06 is
  renamed from "Boundary Checker Replacement TDD — Failing Tests (RED)" to
  "Boundary Checker Replacement — Current-Behavior Characterization Proof".
  The proof file is renamed from `boundary-checker-red-proof.mjs` to
  `boundary-checker-characterization-proof.mjs`. All active RED/TDD language
  is replaced with "characterization" language. Historical revision notes
  describing prior RED/TDD approaches are retained as decision history.
  Workers will no longer create or expect committed failing tests.
- **Revision 6 architect finding 1 (P01 B1a-fallback control-flow bug)**: the
  prior temp-tsconfig proof script used `grep ... && { ... }` for the B1a
  fallback, which after a successful B1a removed `TMPDIR_BUILD` but then fell
  through into the B1 success branch checking `$TMPDIR_BUILD/index.d.ts` in the
  deleted temp dir. The revised script uses a `MECHANISM` variable and an
  `if/else` so the B1 branch is only reached when B1a was NOT taken.
- **Revision 6 architect finding 2 (P01 rootDir detection misses stdout)**: the
  prior script redirected only `stderr` (`2>`) while TypeScript diagnostics may
  appear on `stdout`. The revised script redirects both streams to a combined
  log (`> ... 2>&1`) and greps that, ensuring no diagnostic is missed.
- **Revision 6 architect finding 3 (P03 parser omits .js-to-.d.ts specifier
  normalization)**: the API-surface parser requirements now explicitly require
  `.js`-to-`.d.ts` specifier normalization for export-star traversal. The
  actual package root (`packages/agents/index.ts`) uses
  `export * from './src/index.js'`, so the parser must resolve `.js` specifiers
  to `.d.ts` declaration files. Fixtures now include both the root-to-src
  barrel pattern and nested `./internals.js`.
- **Revision 6 architect finding 4 (P08/P08a retained-duplication drift proof
  not executed)**: the prior P08 verification commands only checked for a guard
  file and tuple-wrapped Equal pattern, then ran normal typecheck — without
  actually perturbing declarations and proving typecheck fails. The revised P08
  verification now EXECUTES the fixture-based drift-perturbation proof (required
  AND optional member drift) as a concrete verification step, asserting
  typecheck fails (nonzero exit) for each perturbation.
- **Revision 6 architect finding 5 (P08 retained-duplication path unconditionally
  references single-source proof artifact)**: the prior P08 deferred-language
  and marker-free checks unconditionally scanned
  `runtime-factory-single-source-proof.mjs`, which does not exist when
  retained-duplication is chosen. The revised checks build a decision-dependent
  artifact set (`PROOF_FILES`), scanning only the artifacts that exist for the
  recorded decision.
- **Revision 6 architect finding 6 (P08a repeats unconditional single-source
  artifact checks)**: the same decision-dependent artifact-set fix from finding
  5 is applied to P08a. Deferred-language scans, suppression-directive scans,
  and marker-free checks now branch on the recorded decision.
- **Revision 6 architect finding 7 (P03/P05 CI fallback contradictory for B2)**:
  the prior revision unconditionally required `lint:agents-api-surface` in the
  pre-build `lint_javascript` job, which is correct for B1/B1a/B1b (source-path
  resolution) but contradictory for B2 (which reads `dist/` and MUST run
  post-build). The revised CI wiring is mechanism-conditional: B1/B1a/B1b runs
  in both `lint_javascript` and the `test` job; B2 runs ONLY in the `test` job
  (post-build).
- **Revision 6 architect finding 8 (P13/P13a status-diff only inspects added
  lines)**: the prior unified-diff `grep '^+[^+]'` approach only catches added
  lines, missing modified/removed generated files. The revised approach
  NORMALIZES both before/after `git status --short` snapshots by filtering out
  gitignored paths via `git check-ignore`, then compares the normalized sorted
  sets. Any difference in the normalized sets is an unexpected change.
- **Revision 6 architect finding 9 (deferred-language scans hit planning
  vocabulary in .md docs)**: deferred-language scans that targeted plan/analysis
  `.md` artifacts (P10, P10a, P09) are restricted to executable/source files
  only. Plan docs legitimately contain words like "placeholder" and "for now"
  when describing what to detect. `.mjs` proof scripts remain scanned (they are
  executable artifacts).
- **Revision 6 architect finding 10 (P06 characterization proof not true TDD)**:
  P06's characterization proof is clarified as the RED-equivalent artifact in
  the test-first sequence (not true committed-failing-test TDD). The proof
  ASSERTS the old behavior exists (GREEN today); P07 converts its assertions to
  assert the new behavior (GREEN after P07). The filename retains the `tdd`
  suffix for phase-sequence stability (P00→P13a). No unskipped failing fixture
  outside CI is needed — the characterization proof's GREEN-today assertions of
  the old behavior gap ARE the test-first evidence.
- **Architect review finding 1 (runtime factory decision record created in
  P01, not P09)**: `runtime-factory-contract-decision.md` is CREATED in P01
  with machine-greppable `decision:` and (for retained-duplication) optional
  `drift-guard-path:` lines. P08/P08a read it before P09, so it MUST exist by
  P01. P09 FINALIZES the record with the applied outcome; it does NOT create
  it. P01 section 8 and P09's Files-to-Create are updated accordingly.
- **Architect review finding 2 (API-surface guard mode transition
  underspecified)**: the standalone script is ALWAYS enforcement-active — it
  compares the report against the snapshot and exits nonzero on mismatch. The
  mode transition is via SNAPSHOT UPDATE (P03: snapshot = leaky surface →
  passes; P05: snapshot = depolluted surface → enforces deny). There is no
  separate `DENY_MODE` flag in the script. The Vitest test's `DENY_MODE` flag
  controls only the test's assertion direction. P03 and P05 are updated to
  document this explicitly.
- **Architect review finding 3 (B2 API-guard CI placement not
  job-scoped)**: P03a verification now extracts the enclosing JOB for each
  `lint:agents-api-surface` occurrence in ci.yml and verifies exact
  job-scoped placement: B1/B1a/B1b must appear in BOTH `lint_javascript` AND
  `test`; B2 must appear ONLY in `test` and FAIL if present in
  `lint_javascript`. The prior loose grep (anywhere in ci.yml + echo OK for
  both paths) is replaced.
- **Architect review finding 4 (CLI seam audit Verdict C stop condition can
  be bypassed)**: P10a now FAILS (no completion marker) when the seam audit
  verdict is C, UNLESS a human coordinator creates a
  `.completed/P10a.revised-plan.md` marker. Without the P10a marker, P11's
  prerequisite fails, blocking the entire downstream chain. P11 and P12 also
  have defense-in-depth checks that fail if the verdict is C without a
  revised-plan marker.
- **Architect review finding 5 (P10 Verdict C coordinator decision sentence
  malformed)**: the malformed/ambiguous options sentence in P10 is rewritten
  as explicit bullets: (a) revise the plan to permit the seam, (b) accept a
  smaller-scope split, (c) defer remaining entanglement to a follow-up with
  recorded debt.
- **Architect review finding 6 (P10a checklist contradicts revision 6)**: the
  P10a checklist no longer says "no deferred language in the audit" (the
  commands intentionally do not scan .md for deferred vocabulary per revision
  6 finding 9). Instead, the checklist requires substantive audit content and
  NO executable/source artifacts produced by the analysis-only phase.
- **Architect review finding 7 (P04 references wrong artifact for A2A
  fixture evidence)**: P04's fixture-builder evidence reference is corrected
  from `import-inventory.md` section 7 to `preflight-results.md` (where P01
  records the exact builder/API/stub-seam/dispatch-method evidence).
  `preflight-results.md` is authoritative for P04 fixture details.
- **Architect review finding 8 (guard test cache-report ordering fragile)**:
  `publicSurface.guard.test.ts` reads `node_modules/.cache/agents-api-surface/report.json`
  and fails closed when absent. EVERY phase that runs that test (P03, P03a,
  P05, P05a, P13, P13a) MUST run `npm run lint:agents-api-surface`
  immediately before it. P13 and P13a commands now use
  `npm run lint:agents-api-surface` (not `node scripts/...`) and include
  explicit ordering notes.
- **Architect review finding 9 (grep-count structural checks can pass on
  prose/comments)**: P10/P10a audit checks now require concrete structural
  entries (exported names in list/table/heading/code contexts, explicit
  "Verdict X:" labels, "Side Effects" heading with >= 3 enumerated types).
  P11 suite checks now require concrete `it()`/`test()` blocks named for each
  of the seven characterization topics, not keyword hits. P02a runtime-factory
  pseudocode checks now branch on the ACTUAL `decision:` line from the record
  and require concrete code blocks and decision-specific structural content.
- **Architect review finding 10 (P13/P13a git status algorithm must be
  inline)**: P13 and P13a already contain the complete normalized filtered
  git status snapshot algorithm inline (including `git check-ignore`
  filtering and modified/removed generated-file detection via `diff -u` on
  normalized sorted sets). A note is added referencing this architect review
  finding so workers do not revert to weaker prior diff checks
  (e.g. unified-diff added-lines grep).

---

## Architect Review Revision 5 Findings (1–11)

- **Architect review finding 1 (P04 A2A test file paths do not match codebase
  layout)**: the A2A package uses COLOCATED tests (`config.test.ts`,
  `task.test.ts`, `testing_utils.test.ts` — all alongside source), NOT
  `__tests__/` subdirectories. P04/P04a now mandate COLOCATED test files:
  `packages/a2a-server/src/config/config.factory-migration.test.ts` and
  `packages/a2a-server/src/agent/task.factory-migration.integration.test.ts`.
  No `__tests__/` directories are introduced.
- **Architect review finding 2 (P04 over-specifies A2A behavior tests against
  nonexistent APIs)**: the actual Task code uses `agentClient.sendMessageStream(...)`
  (async generator), has a PRIVATE constructor (`Task.create(...)` async factory),
  obtains the scheduler via `config.getOrCreateScheduler(...)`, dispatches via
  `scheduler.schedule(...)`, and publishes events via `this.eventBus?.publish(...)`.
  P04/P04a now reference these REAL methods and explicitly PROHIBIT references
  to nonexistent `.sendMessage`, direct `new Task(...)` construction, or
  "representative dispatch" abstractions that don't map to the codebase.
- **Architect review finding 3 (P04 test command examples unreliable)**: root
  `npm run test` runs ALL workspaces (`npm run test --workspaces --if-present`).
  Root path arguments like `npm run test -- packages/a2a-server` do NOT
  reliably filter. P04/P04a now use workspace-scoped commands
  (`npm run test --workspace @vybestack/llxprt-code-a2a-server -- <pattern>`)
  and require P01 preflight to record exact working test commands before P04/P04a
  rely on them.
- **Architect review finding 4 (P13 build/status verification must capture
  ignored artifacts)**: P13/P13a now explicitly capture
  `git status --ignored --short` after `npm run build` so unexpected unignored
  build output is not hidden by gitignore assumptions. The normalized comparison
  handles ignored files, but the explicit `--ignored` snapshot provides a
  human-readable audit trail proving build artifacts are correctly ignored.
- **Architect review finding 5 (marker policy conflicts with existing production
  source marker debt)**: production source files across the repo ALREADY contain
  `@plan`/`@requirement` markers from prior issues (e.g.
  `@plan PLAN-20260610-ISSUE1592` in `config.ts`, widespread `@plan:PLAN-` in
  `packages/tools/` and `packages/settings/`). The marker policy now
  consistently prohibits only NEW `@plan:PLAN-20260629-ISSUE2285` markers in
  production source — it does NOT imply existing markers must be removed unless
  the line they annotate is changed for issue #2285 scope. All phase marker
  scans now grep for the `PLAN-20260629-ISSUE2285` prefix (not broader
  `@plan:PLAN-`) so pre-existing markers don't cause false failures.
- **Architect review finding 6 (deferred-language scans fail on pre-existing
  debt)**: deferred-language scans that grep whole issue-owned files can fail
  on pre-existing TODO/FIXME/HACK/STUB/TEMPORARY/placeholder/for-now debt.
  P04/P04a/P05/P05a/P09/P12/P12a/P13/P13a now use pre-phase baselines or
  git-diff added-lines approaches so only NEWLY INTRODUCED deferred language
  FAILS. For existing files, `git diff` added lines are scanned; for NEW files,
  the whole file is scanned (all content is newly introduced). The anti-deferral
  intent is preserved: any newly introduced debt still causes a failure.
- **Architect review finding 7 (P13a does not actually run gh pr checks)**:
  P13a now makes the PR CI check step EXECUTABLE. The REAL PR number is read
  via `gh pr view --json number --jq '.number'` and
  `gh pr checks "$PR_NUMBER" --watch --interval 300` is ACTUALLY RUN in a watch
  loop up to 5 times max, with remediation between iterations. The P13a
  completion marker is created ONLY after CI is green.
- **Architect review finding 8 (P03 combines too many concerns for strict TDD)**:
  P03 now includes an internal TDD sequencing section with explicit sub-steps:
  (1) contract-first: write the guard test before the parser (records a failing
  proof that would fail if export-star/type-only leak detection were absent);
  (2) implementation: implement the parser + script + CI wiring;
  (3) GREEN characterization: the test passes with the parser detecting the
  current leak. The completion marker records both the failing proof and the
  GREEN result. Phase sequence P00→P13a is preserved (no phase split needed).
- **Architect review finding 9 (LLXPRT_API_SURFACE_SKIP escape hatch undercuts
  fail-closed)**: P13/P13a now include an explicit gate asserting
  `LLXPRT_API_SURFACE_SKIP` is UNSET before running API-surface guard
  verification. If set, the phase FAILS immediately — the final gate must run
  with the guard in full fail-closed mode.
- **Architect review finding 10 (P10/P10a Verdict C escape hatch needs
  downstream sequencing)**: if Verdict C is accepted via `P10a.revised-plan.md`,
  the downstream phases MUST be RE-REVIEWED and UPDATED before continuing. The
  revised-plan marker is NOT a bypass — it is a RE-PLANNING artifact consumed
  by P11/P12/P13. P10a now verifies the marker references P11/P12/P13 changes;
  P11/P12/P13 each verify the revised plan applies to their scope.
- **Architect review finding 11 (historical revision annotations make phase
  files harder to execute)**: historical rationale is consolidated into
  `project-plans/issue2285/plan/appendix-revision-history.md` AND this tracker
  Notes appendix. Executable phase instructions are kept focused on current
  requirements. Cross-references to revision history are retained where they
  explain WHY a requirement exists, but the main instructions are streamlined
  for execution.
