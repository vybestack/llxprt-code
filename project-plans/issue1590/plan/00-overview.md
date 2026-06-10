# Plan: Extract packages/storage

Plan ID: PLAN-20260609-ISSUE1590
Generated: 2026-06-09
Executable Phase Count: 30 phases total (15 worker phases + 15 verifier phases)
Requirements: REQ-PKG-001, REQ-LEAF-001, REQ-STORAGE-001, REQ-FILES-001, REQ-SECURE-001, REQ-PROVIDERKEY-001, REQ-SESSIONTYPES-001, REQ-CONVLOG-001, REQ-COMPAT-001, REQ-INT-001, REQ-NOCYCLE-001, REQ-TEST-001

## Critical Reminders

1. Follow `dev-docs/COORDINATING.md` for execution.
2. Execute every phase sequentially; do not skip phase numbers.
3. Each worker phase has exactly one verifier phase and must not proceed until verifier returns PASS.
4. Create todos for every worker and verifier phase before execution.
5. Preserve compatibility through core re-export shims.
6. Keep `packages/storage` as a leaf package with no llxprt workspace dependencies.
7. Do not touch `.llxprt/`.
8. This is a package extraction/refactor. Existing behavioral tests move before or with the implementation they already cover; new untested behavior (ConversationFileWriter) must be tested before final implementation changes.
9. Mock only infrastructure in tests. Use real observable output (disk reads, array contents) instead of mock call verification.
10. `resetConversationFileWriterForTesting` is a Tier 3 test-only export from `@vybestack/llxprt-code-storage/testing` — NOT from the barrel, NOT from core shims.

## Phase Sequence

The following table lists the exact executable phase sequence. Each row is exclusively either a worker phase (executed by `typescriptexpert`) or a verifier phase (executed by `typescriptreviewer`). Phases execute strictly in table order; no phase may begin until the preceding phase has completed and produced its completion marker. The sequence is:

**P00a → P00a-V → P01 → P01-V → P02a → P02a-V → P02b → P02b-V → P02c → P02c-V → P03a → P03a-V → P03b → P03b-V → P03c → P03c-V → P04a → P04a-V → P04b → P04b-V → P04c → P04c-V → P04d → P04d-V → P05 → P05-V → P06 → P06-V → P07 → P07-V**

| # | Phase ID | Type | Subagent | Title |
|---|---|---|---|---|
| 1 | P00a | Worker | typescriptexpert | Preflight: parser inventory + export map baseline + verification scripts |
| 2 | P00a-V | Verifier | typescriptreviewer | Verify preflight completeness |
| 3 | P01 | Worker | typescriptexpert | Package scaffold + logger + testing.ts |
| 4 | P01-V | Verifier | typescriptreviewer | Verify scaffold |
| 5 | P02a | Worker | typescriptexpert | Path/file services: create stubs |
| 6 | P02a-V | Verifier | typescriptreviewer | Verify P02a stubs typecheck with complete public API surface |
| 7 | P02b | Worker | typescriptexpert | Path/file services: create tests, capture RED |
| 8 | P02b-V | Verifier | typescriptreviewer | Verify P02b RED output (behavioral failures, not import errors) |
| 9 | P02c | Worker | typescriptexpert | Path/file services: copy implementations, GREEN |
| 10 | P02c-V | Verifier | typescriptreviewer | Verify P02c GREEN output, all tests pass |
| 11 | P03a | Worker | typescriptexpert | Secure/provider key: create stubs |
| 12 | P03a-V | Verifier | typescriptreviewer | Verify P03a stubs typecheck with complete public API surface |
| 13 | P03b | Worker | typescriptexpert | Secure/provider key: create tests, capture RED |
| 14 | P03b-V | Verifier | typescriptreviewer | Verify P03b RED output (behavioral failures, not import errors) |
| 15 | P03c | Worker | typescriptexpert | Secure/provider key: copy implementations, GREEN |
| 16 | P03c-V | Verifier | typescriptreviewer | Verify P03c GREEN output, all tests pass |
| 17 | P04a | Worker | typescriptexpert | Session/conversation: create stubs |
| 18 | P04a-V | Verifier | typescriptreviewer | Verify P04a stubs typecheck with complete public API surface |
| 19 | P04b | Worker | typescriptexpert | Session/conversation: create tests, capture RED |
| 20 | P04b-V | Verifier | typescriptreviewer | Verify P04b RED output (behavioral failures, not import errors) |
| 21 | P04c | Worker | typescriptexpert | Session types: copy implementation, GREEN |
| 22 | P04c-V | Verifier | typescriptreviewer | Verify P04c GREEN output, session tests pass |
| 23 | P04d | Worker | typescriptexpert | ConversationFileWriter: copy implementation + barrel export update + GREEN |
| 24 | P04d-V | Verifier | typescriptreviewer | Verify P04d GREEN output, CFW tests pass, barrel updated |
| 25 | P05 | Worker | typescriptexpert | Core compatibility shims (literal exact shim contents) |
| 26 | P05-V | Verifier | typescriptreviewer | Verify core compatibility |
| 27 | P06 | Worker | typescriptexpert | Direct consumer integration + behavioral provider logging test |
| 28 | P06-V | Verifier | typescriptreviewer | Verify consumer integration |
| 29 | P07 | Worker | typescriptexpert | Full per-package verification + deterministic format + smoke |
| 30 | P07-V | Verifier | typescriptreviewer | Verify full completion |

### Verifier Phase Instructions

Every `*-V` verifier phase (both subphase-level and phase-level) must:

1. **Read the worker phase file** to understand the exact requirements and verification commands.
2. **Check prerequisite artifacts**: confirm completion markers exist from the worker subphase or phase.
3. **Inspect RED/GREEN outputs**: explicitly verify that RED output shows test failures (not import errors) and GREEN output shows all tests passing.
4. **Run verification commands** listed in the worker phase.
5. **Execute the semantic verification checklist** — each checklist item must be explicitly evaluated.
6. **Compare implementation** to the referenced pseudocode lines.
7. **Write verifier result** to `.completed/P{NN}{a|b|c|d}-V.md` or `.completed/P{NN}-V.md` with PASS or FAIL and evidence.
8. On FAIL: describe the specific failure and the remediation action needed.

### Subphase Verifier Sequence

For phases with subphases (P02, P03, P04), the execution sequence is:

```
P02a (worker) → P02a-V (verifier) → P02b (worker) → P02b-V (verifier) → P02c (worker) → P02c-V (verifier)
P03a (worker) → P03a-V (verifier) → P03b (worker) → P03b-V (verifier) → P03c (worker) → P03c-V (verifier)
P04a (worker) → P04a-V (verifier) → P04b (worker) → P04b-V (verifier) → P04c (worker) → P04c-V (verifier) → P04d (worker) → P04d-V (verifier)
```

Each subphase verifier must PASS before the next subphase worker begins. Per `dev-docs/COORDINATING.md`: worker → verifier → next worker.

### Subphase Completion Markers

For phases with subphases (P02, P03, P04), the completion markers and verifier markers are:
- P02: `P02a.md`, `P02a-V.md`, `P02b.md`, `P02b-V.md`, `P02c.md`, `P02c-V.md`
- P03: `P03a.md`, `P03a-V.md`, `P03b.md`, `P03b-V.md`, `P03c.md`, `P03c-V.md`
- P04: `P04a.md`, `P04a-V.md`, `P04b.md`, `P04b-V.md`, `P04c.md`, `P04c-V.md`, `P04d.md`, `P04d-V.md`

## Subagent Assignment Rationale

- **typescriptexpert**: Executes all worker phases and subphases.
- **typescriptreviewer**: Executes all verifier phases.

## Success Criteria

- `packages/storage` exists as a workspace package.
- Storage package source does not import from `packages/core` or any llxprt workspace package.
- Moved storage/file APIs have behavioral tests in the new package.
- Core root exports and core deep exports continue to work.
- Direct non-core consumers use `@vybestack/llxprt-code-storage` for moved storage APIs.
- No package dependency cycle involving storage exists.
- Full project verification and smoke test pass.

## Execution Notes

- `SessionPersistenceService` remains in core unless preflight produces contrary evidence.
- Core files for moved APIs become compatibility shims with **literal exact contents** specified in P05.
- Core `gitIgnoreParser.ts` and `gitUtils.ts` remain for non-storage core utilities; storage receives local internal copies.
- **P02/P03/P04 are split into atomic subphases** (stub → test/RED → implementation/GREEN) with **per-subphase verifier gates**. Each subphase has its own verifier phase (P02a-V, P02b-V, P02c-V, P03a-V, P03b-V, P03c-V, P04a-V, P04b-V, P04c-V, P04d-V). The per-subphase verifier must inspect RED output before the GREEN subphase proceeds. Per `dev-docs/COORDINATING.md`: worker → verifier → next worker.
- **Provider logging test in P06** must use behavioral assertions against real observable output (JSONL files on disk, array contents), NOT mock call verification.
- **`resetConversationFileWriterForTesting`** is exported only from `@vybestack/llxprt-code-storage/testing` deep export (Tier 3). The barrel does NOT re-export it. Core shims do NOT re-export it. Tests import it as: `import { resetConversationFileWriterForTesting } from '@vybestack/llxprt-code-storage/testing';`
- **Verification scripts** (`check-storage-import-boundary.mjs`, `check-storage-package-cycle.mjs`) are created in P00a and available for P06/P07.
- **P00a import inventory script** (`preflight-import-inventory.mjs`) is retained through P07.
- **P04/P05 barrel export updates**: The barrel export for session types and ConversationFileWriter is an explicit task inside P04d (not a free-floating instruction). P05 updates `packages/core/src/index.ts` to add `SecureStoreErrorCode` to the existing `export type` block. Both barrel updates are verified by their respective verifier phases (P04d-V and P05-V).
- **P07 format verification**: formatting drift MUST fail the phase. Verified precondition: root `package.json` contains `"format:check": "prettier --check ."` and `"format": "prettier --experimental-cli --write ."`. Run `npm run format`, then `npm run format:check` — if `format:check` exits non-zero, the phase FAILS (formatting drift detected). If `npm run format` produces changes on first run, those changes are applied but NOT staged or committed; then `npm run format:check` must pass. No command should succeed while merely printing changed files — the exit code determines PASS/FAIL.
- **P07 per-package builds**: build each affected package individually (storage, core, mcp, providers, cli, a2a-server), then run root `npm run build`.
- **Package scaffold devDependencies**: all workspace packages declare their own `typescript`, `vitest`, and `@types/node` in devDependencies. Storage must follow this convention — read exact versions from `packages/core/package.json` (`typescript: ^5.3.3`, `vitest: ^3.1.1`, `@types/node: ^24.2.1`).
- **Preflight (P00a) uses TypeScript parser-based import inventory** instead of grep. If the parser inventory finds consumers not listed in P06, hard STOP.
- **SecureStoreErrorCode** is included in secure-store shim re-export as `export type`.
- **ConversationFileWriter** public signatures are preserved exactly with additive optional logger parameter.
- **`secure-store-integration.test.ts`** is split (not moved) — storage copy has inline `maskKeyForDisplay` and zero core imports.
- **Non-core mock tests** updated in P06 to mock storage instead of core.
- **P05 dependency cleanup** requires rg evidence before removing packages.
- **P07 no staging rule**: verification phases must NOT run `git add`, `git commit`, or any staging command.
