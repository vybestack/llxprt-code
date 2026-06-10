# Revision Summary: Review-03 Issues to Plan File Changes

Plan ID: PLAN-20260608-ISSUE1588
Review: review-03.md (Verdict: FAIL)
Revision Date: 2026-06-08

## Files Modified

| # | File | Change Summary |
|---|------|---------------|
| 1 | `plan/03b-minimal-adapter-wiring.md` | **NEW**: Phase for minimal production adapter/config wiring stubs before P04b |
| 2 | `plan/03b-minimal-adapter-wiring-verification.md` | **NEW**: Verification phase for P03b |
| 3 | `plan/04b-vertical-slice-integration-tdd.md` | Prerequisites updated to reference P03b; sequencing clarification rewritten; CLI test path made explicit; test commands use workspace-relative paths; checklist items added |
| 4 | `plan/04b-vertical-slice-integration-tdd-verification.md` | Phase ID typo documented as correct; CLI scan added; workspace-relative path check added; CLI checklist items added |
| 5 | `plan/04-settings-package-tdd.md` | Test ownership boundary added; singleton helpers test description updated; ProviderRuntimeContext scan added to verification; checklist items added |
| 6 | `plan/05-settings-package-impl.md` | Temporary duplicate policy section added; verification commands updated with workspace-relative paths and ProviderRuntimeContext scan; checklist item added |
| 7 | `plan/05a-settings-package-impl-verification.md` | P04b pass gate reruns added; ESM dynamic import replaces require(); settings test ownership and duplicate policy checklist items added |
| 8 | `plan/06-core-integration-stub.md` | P04b pass gate reruns added; adapter idempotency/call-count tests (TEST-ADAPTER-06/07/08) and single-owner rule added; verification commands updated; checklist items added |
| 9 | `plan/06a-core-integration-stub-verification.md` | P04b pass gate reruns added; P04b checklist item added |
| 10 | `plan/07-consumer-migration-tdd.md` | Test commands corrected to workspace-relative; deep dynamic import scan added |
| 11 | `plan/08-consumer-migration-impl.md` | Refreshed full import inventory prerequisite added; lsp scan added; deep dynamic import scan added; checklist items added |
| 12 | `plan/08a-consumer-migration-impl-verification.md` | P04b pass gate reruns added; ESM dynamic import replaces require(); import inventory checklist added; built-runtime verification added |
| 13 | `plan/09-cleanup-no-shims.md` | Deep dynamic import scan, lsp scan, .llxprt check added |
| 14 | `plan/09a-cleanup-no-shims-verification.md` | lsp scan, deep dynamic import scan, .llxprt check added |
| 15 | `plan/10-full-verification.md` | ESM dynamic import replaces require(); .llxprt explicit git check; deep dynamic import scan added |
| 16 | `plan/10a-final-semantic-review.md` | ESM dynamic import replaces require for package.json read; .llxprt checklist item added |
| 17 | `plan/00-overview.md` | P03b execution model note; integration-first TDD references P03b; key behavioral contracts expanded with duplicate policy, export map convention, adapter idempotency, P04b pass gates, import inventory refresh npm/pnpm evidence |
| 18 | `plan/00a-preflight-verification.md` | npm/pnpm stance evidence commands; workspace test path verification; lsp scan consideration |
| 19 | `analysis/package-metadata-constraints.md` | Export map paths corrected to `dist/src/...`; source layout vocabulary section; ESM dynamic import replaces require(); "only if needed" replaced with scan-plus-metadata assertions; lsp added to downstream dep table; test workspace-relative path |
| 20 | `analysis/final-architecture.md` | Source layout convention section; export map with `dist/src/...` paths |
| 21 | `analysis/anti-shim-policy.md` | Temporary duplicate vs shim distinction table added; allowed-during-intermediate expanded |
| 22 | `analysis/behavioral-regression-matrix.md` | BVE-06c test ownership clarified (core only, not settings); BVE-06d expanded with adapter idempotency/call-count scenarios; test ownership clarified |
| 23 | `analysis/call-site-migration-matrix.md` | Adapter idempotency/call-count tests (ADAPTER-06/07/08) added; single-owner rule defined; test ownership boundary defined; test location table clarified |
| 24 | `analysis/consumer-import-matrix.md` | Lsp row added to consumer groups; deep dynamic import scan added; root import preference made prescriptive; verification matrix rows added |
| 25 | `analysis/dependency-audit.md` | Deep dynamic import scan commands; lsp scan; forbidden import scans expanded; require() note |
| 26 | `analysis/phase-verification-matrix.md` | ESM dynamic import replaces require(); P03b/P03ba rows; P05a pass gate row; P06a pass gate row; P08a row with import inventory; deep dynamic import scan; .llxprt check; npm/pnpm evidence; lsp scan; STUB grep exemption for P03b; workspace-relative path instructions |
| 27 | `analysis/preflight-results-template.md` | Lsp consumer scan; deep dynamic import scan; npm/pnpm stance section; workspace test command verification section |
| 28 | `analysis/integration-contract.md` | Settings test ownership constraint added; single-owner rule and adapter idempotency added to IC-02 |
| 29 | `analysis/pseudocode/verification.md` | ESM dynamic import; .llxprt check; deep dynamic import scan; lsp scan; npm/pnpm evidence |
| 30 | `analysis/pseudocode/package-boundary.md` | Subpath export `dist/src/...` convention noted |
| 31 | `analysis/pseudocode/settings-service.md` | Settings-package test ownership boundary added (line 16) |
| 32 | `execution-tracker.md` | P03b/P03ba rows; updated notes for P05a/P06a/P08a; duplicate policy, adapter idempotency, single-owner, .llxprt, import inventory, temporary duplicate policy checklist items |
| 33 | `specification.md` | P03b/P03ba files added to project structure |

## Material Issue Mapping

| Review Issue | Fix Summary | Files Changed |
|-------------|------------|---------------|
| **M1**: P04b/P06 sequencing contradiction | New phase P03b creates minimal adapter/config wiring stubs before P04b; P06 provides full implementation after P05. P04b prerequisites and sequencing clarification updated. | `plan/03b-*.md` (new), `plan/04b-vertical-slice-integration-tdd.md`, `plan/00-overview.md`, `execution-tracker.md`, `specification.md` |
| **M2**: Export map paths don't match build conventions | All export map paths corrected from `./dist/settings/...` / `./dist/profiles/...` to `./dist/src/settings/...` / `./dist/src/profiles/...` matching `packages/providers` convention. Source layout vocabulary standardized. | `analysis/package-metadata-constraints.md`, `analysis/final-architecture.md`, `analysis/pseudocode/package-boundary.md` |
| **M3**: require() for ESM-only built-runtime verification | All built-runtime import verification commands changed from `node -e "require(...)"` to `node --input-type=module -e "await import(...)"`. | `analysis/package-metadata-constraints.md`, `analysis/phase-verification-matrix.md`, `plan/05a-*.md`, `plan/08a-*.md`, `plan/10-*.md`, `analysis/pseudocode/verification.md` |
| **M4**: Workspace test commands use wrong paths | All `--run packages/core/src/...` patterns from workspace commands corrected to workspace-relative `--run src/...` paths. Preflight validates correct paths. | `plan/04b-*.md`, `plan/05-*.md`, `plan/05a-*.md`, `plan/06-*.md`, `plan/06a-*.md`, `plan/07-*.md`, `plan/00a-*.md`, `analysis/phase-verification-matrix.md`, `analysis/preflight-results-template.md` |
| **M5**: P04b missing CLI vertical slice | CLI test location made explicit: `packages/cli/src/__tests__/settings-integration/profile-startup.integration.test.ts`. CLI scan commands and checklist items added. | `plan/04b-*.md`, `plan/04b-vertical-slice-integration-tdd-verification.md` |
| **M6**: P04b integration tests not rerun as pass gates | P04b integration tests added as pass gates in P05a, P06a, and P08a verification phases with explicit "must pass" expectations. | `plan/05a-*.md`, `plan/06a-*.md`, `plan/08a-*.md`, `analysis/phase-verification-matrix.md` |
| **M7**: P05 move semantics ambiguous | Explicit temporary duplicate policy defined distinguishing temporary duplicate (original code, no forwarding) from forbidden shim. Duplicate-vs-shim table added. | `plan/05-settings-package-impl.md`, `analysis/anti-shim-policy.md`, `plan/00-overview.md` |
| **M8**: Settings tests assert core runtime | Test ownership boundary defined: settings tests verify ONLY settings-owned state. ProviderRuntimeContext assertions belong in core tests. Scan command for ProviderRuntimeContext references in settings added. | `plan/04-settings-package-tdd.md`, `plan/05-*.md`, `plan/05a-*.md`, `analysis/behavioral-regression-matrix.md`, `analysis/call-site-migration-matrix.md`, `analysis/integration-contract.md`, `analysis/pseudocode/settings-service.md` |
| **M9**: Import inventory incomplete (92 providers deep imports) | Refreshed full import inventory required as explicit P08 prerequisite. Providers deep import scan and lsp scan added. Deep dynamic import scan added everywhere. | `plan/08-*.md`, `plan/08a-*.md`, `analysis/consumer-import-matrix.md`, `analysis/dependency-audit.md`, `analysis/preflight-results-template.md`, `analysis/phase-verification-matrix.md` |
| **M10**: Adapter double-registration risk | Single-owner rule defined: only `settingsRuntimeAdapter.ts` bridges both register + setActiveProviderRuntimeContext. Idempotency tests (ADAPTER-06/07) and call-count tests added. Double-deactivation safety test added. | `plan/06-*.md`, `analysis/call-site-migration-matrix.md`, `analysis/behavioral-regression-matrix.md`, `analysis/integration-contract.md` |

## Pedantic Improvement Mapping

| Review Issue | Fix Summary | Files Changed |
|-------------|------------|---------------|
| **P1**: P04b verification phase ID typo | Phase ID `P04ba` explicitly documented as correct (suffix "a" for verification sub-phase). Completion marker clarified. | `plan/04b-vertical-slice-integration-tdd-verification.md` |
| **P2**: Inconsistent source layout vocabulary | Source layout vocabulary section added to `package-metadata-constraints.md` and `final-architecture.md`. All docs use consistent `src/` / `dist/src/` terminology. | `analysis/package-metadata-constraints.md`, `analysis/final-architecture.md` |
| **P3**: Root vs subpath import preference unclear | Root imports explicitly labeled as preferred; subpath imports allowed for tree-shaking. Made prescriptive in `consumer-import-matrix.md`. | `analysis/consumer-import-matrix.md` |
| **P4**: Weak dynamic import scans | Deep dynamic import scan for `import('@vybestack/llxprt-code-core/settings/...')` and `import('@vybestack/llxprt-code-core/config/(storage|profileManager)')` added to all verification phases. | `analysis/dependency-audit.md`, `analysis/consumer-import-matrix.md`, `analysis/phase-verification-matrix.md`, `analysis/preflight-results-template.md`, `plan/07-*.md`, `plan/08-*.md`, `plan/09-*.md`, `plan/09a-*.md`, `plan/10-*.md`, `analysis/pseudocode/verification.md` |
| **P5**: Expected-failing TDD commands verify module resolution not behavior | Not changed — existing plan already specifies tests fail naturally against stubs (behavioral assertion failures, not module resolution). Review concern is already addressed. | N/A |
| **P6**: No explicit .llxprt status check | `git status --short .llxprt` added to P09a, P10, P10a verification commands and checklists. | `plan/09a-*.md`, `plan/10-*.md`, `plan/10a-*.md`, `analysis/pseudocode/verification.md`, `analysis/phase-verification-matrix.md` |
| **P7**: No npm/pnpm preflight evidence | Preflight (P0.5) now requires recording `package-lock.json` existence, `pnpm-lock.yaml` absence, and `npm run test` success. | `plan/00a-*.md`, `analysis/preflight-results-template.md`, `plan/00-overview.md`, `analysis/phase-verification-matrix.md`, `analysis/pseudocode/verification.md` |
| **P8**: "Only if needed" dependency language | Replaced with concrete scan-plus-metadata assertion: `rg -n "@vybestack/llxprt-code-settings" packages/<workspace>/src --glob '*.ts'` must return matches before adding dependency. Evidence recorded in phase completion marker. | `analysis/package-metadata-constraints.md` |
| **P9**: packages/lsp missing from downstream scan | `packages/lsp` explicitly added to consumer groups, preflight scans, dependency table, verification scans, and P08 prerequisite. | `analysis/consumer-import-matrix.md`, `analysis/dependency-audit.md`, `analysis/preflight-results-template.md`, `analysis/phase-verification-matrix.md`, `plan/08-*.md`, `plan/09-*.md`, `plan/09a-*.md` |
| **P10**: Complex verification regexes not standardized on tested rg commands | All scan commands use the same consistent `rg -n` patterns tested in dependency-audit.md and consumer-import-matrix.md. Deep dynamic import pattern uses escaped parens consistent with ripgrep. | All verification command blocks reviewed for consistency |