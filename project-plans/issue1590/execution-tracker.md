# Execution Tracker: Extract packages/storage

Plan ID: PLAN-20260609-ISSUE1590

## Subagent Assignments

| Role | Subagent Name | Responsibility |
|---|---|---|
| Worker | `typescriptexpert` | Executes all implementation phases and subphases (P00a–P07) |
| Verifier | `typescriptreviewer` | Executes all verifier phases (P00a-V–P07-V) |

## Execution Status

| Phase | ID | Subagent | Status | Prerequisite Artifact Check | Started | Completed | Verified | Semantic? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 00a | P00a | typescriptexpert | completed | branch `issue1590` exists | 2026-06-09 | 2026-06-09 | - | N/A | Preflight inventory and scripts completed |
| 00a-V | P00a-V | typescriptreviewer | completed | `.completed/P00a.md` exists | 2026-06-09 | 2026-06-09 | PASS | [OK] | Preflight completeness verified |
| 01 | P01 | typescriptexpert | completed | `.completed/P00a.md` + P00a-V PASS | 2026-06-09 | 2026-06-09 | - | N/A | Package scaffold + logger + testing.ts completed |
| 01-V | P01-V | typescriptreviewer | completed | `.completed/P01.md` exists | 2026-06-09 | 2026-06-09 | PASS | [OK] | Scaffold verified |
| 02a | P02a | typescriptexpert | completed | `.completed/P01.md` + P01-V PASS | 2026-06-09 | 2026-06-09 | - | N/A | Path/file services stubs completed |
| 02a-V | P02a-V | typescriptreviewer | completed | `.completed/P02a.md` exists | 2026-06-09 | 2026-06-09 | PASS | [OK] | P02a stubs verified after remediation |
| 02b | P02b | typescriptexpert | completed | `.completed/P02a-V.md` + P02a-V PASS | 2026-06-09 | 2026-06-09 | - | N/A | Path/file services tests + RED capture completed |
| 02b-V | P02b-V | typescriptreviewer | completed | `.completed/P02b.md` exists | 2026-06-09 | 2026-06-09 | PASS | [OK] | P02b RED output verified after remediation |
| 02c | P02c | typescriptexpert | completed | `.completed/P02b-V.md` + P02b-V PASS | 2026-06-09 | 2026-06-09 | - | N/A | Path/file services implementation + GREEN completed |
| 02c-V | P02c-V | typescriptreviewer | completed | `.completed/P02c.md` exists | 2026-06-09 | 2026-06-09 | PASS | [OK] | P02c GREEN output verified |
| 03a | P03a | typescriptexpert | completed | `.completed/P02c-V.md` + P02c-V PASS | 2026-06-09 | 2026-06-09 | - | N/A | Secure/provider key stubs completed |
| 03a-V | P03a-V | typescriptreviewer | completed | `.completed/P03a.md` exists | 2026-06-09 | 2026-06-09 | PASS | [OK] | P03a stubs verified |
| 03b | P03b | typescriptexpert | completed | `.completed/P03a-V.md` + P03a-V PASS | 2026-06-09 | 2026-06-09 | - | N/A | Secure/provider key tests + RED capture completed |
| 03b-V | P03b-V | typescriptreviewer | completed | `.completed/P03b.md` exists | 2026-06-09 | 2026-06-09 | PASS | [OK] | P03b RED output verified after command-path remediation |
| 03c | P03c | typescriptexpert | completed | `.completed/P03b-V.md` + P03b-V PASS | 2026-06-09 | 2026-06-09 | - | N/A | Secure/provider key implementation + GREEN completed |
| 03c-V | P03c-V | typescriptreviewer | completed | `.completed/P03c.md` exists | 2026-06-10 | 2026-06-10 | PASS | [OK] | P03c GREEN output verified |
| 04a | P04a | typescriptexpert | completed | `.completed/P03c-V.md` + P03c-V PASS | 2026-06-10 | 2026-06-10 | - | N/A | Session/conversation stubs completed |
| 04a-V | P04a-V | typescriptreviewer | completed | `.completed/P04a.md` exists | 2026-06-10 | 2026-06-10 | PASS | [OK] | P04a stubs verified |
| 04b | P04b | typescriptexpert | completed | `.completed/P04a-V.md` + P04a-V PASS | 2026-06-10 | 2026-06-10 | - | N/A | Session/conversation tests + RED capture completed |
| 04b-V | P04b-V | typescriptreviewer | completed | `.completed/P04b.md` exists | 2026-06-10 | 2026-06-10 | PASS | [OK] | P04b RED output verified |
| 04c | P04c | typescriptexpert | completed | `.completed/P04b-V.md` + P04b-V PASS | 2026-06-10 | 2026-06-10 | - | N/A | Session types implementation + GREEN completed |
| 04c-V | P04c-V | typescriptreviewer | completed | `.completed/P04c.md` exists | 2026-06-10 | 2026-06-10 | PASS | [OK] | P04c GREEN output verified |
| 04d | P04d | typescriptexpert | completed | `.completed/P04c-V.md` + P04c-V PASS | 2026-06-10 | 2026-06-10 | - | N/A | ConversationFileWriter implementation + barrel/testing exports completed |
| 04d-V | P04d-V | typescriptreviewer | completed | `.completed/P04d.md` exists | 2026-06-10 | 2026-06-10 | PASS | [OK] | P04d GREEN output and exports verified |
| 05 | P05 | typescriptexpert | completed | `.completed/P04d-V.md` + P04d-V PASS | 2026-06-10 | 2026-06-10 | - | N/A | Core shims completed after root identity remediation |
| 05-V | P05-V | typescriptexpert | completed | `.completed/P05.md` exists | 2026-06-10 | 2026-06-10 | PASS | [OK] | Core compatibility verified after root identity remediation (13/13 functional checks) |
| 06 | P06 | typescriptexpert | completed | `.completed/P05.md` + P05-V PASS | 2026-06-10 | 2026-06-10 | - | - | Consumer integration + behavioral provider test; boundary script namespace fix + vitest storage resolution |
| 06-V | P06-V | typescriptexpert | completed | `.completed/P06.md` exists | 2026-06-10 | 2026-06-10 | PASS | [OK] | Consumer integration verified (9/9 checks); documented deviations confirmed |
| 07 | P07 | typescriptexpert | completed | `.completed/P06.md` + P06-V PASS | 2026-06-10 | 2026-06-10 | - | - | Full per-package verification + deterministic format + smoke; 10 lint errors in new files fixed |
| 07-V | P07-V | typescriptexpert | completed | `.completed/P07.md` exists | 2026-06-10 | 2026-06-10 | PASS | [OK] | Full repo verification independently re-run (11/11 checks); smoke haiku confirmed |

## Verifier Phase Details

Each verifier phase (`*-V`) must produce `.completed/P{NN}{a|b|c|d}-V.md` or `.completed/P{NN}-V.md` containing:
1. PASS or FAIL verdict.
2. Evidence for each semantic verification checklist item from the worker phase.
3. RED/GREEN output inspection results (for phases with subphases).
4. Pseudocode line comparison results.
5. Any issues found and their resolution.

For subphase verifiers (P02a-V, P02b-V, P02c-V, P03a-V, P03b-V, P03c-V, P04a-V, P04b-V, P04c-V, P04d-V):
- Confirm the specific subphase completion marker exists.
- For stub verifiers (P02a-V, P03a-V, P04a-V): confirm stubs exist and typecheck with full public API surface exported.
- For RED verifiers (P02b-V, P03b-V, P04b-V): explicitly inspect RED output and confirm it shows behavioral test failures (not import/type errors). If RED output shows missing-export or type errors instead of assertion failures, the verifier MUST return FAIL because the stub was incomplete.
- For GREEN verifiers (P02c-V, P03c-V, P04c-V, P04d-V): confirm all tests pass and typecheck succeeds.
- Only then write the subphase verifier result.

The `typescriptreviewer` subagent must:
- Read the worker phase file for the exact verification commands and checklist.
- Run all verification commands.
- Evaluate each checklist item explicitly (not just acknowledge).
- Write the result marker.

## Completion Markers

- [ ] All phases and subphases executed in order, with per-subphase verifier gates
- [ ] Every worker subphase has a completion marker in `.completed/` (P02a, P02b, P02c, P03a, P03b, P03c, P04a, P04b, P04c, P04d)
- [ ] Every subphase verifier has a result marker in `.completed/` (P02a-V, P02b-V, P02c-V, P03a-V, P03b-V, P03c-V, P04a-V, P04b-V, P04c-V, P04d-V)
- [ ] Every phase-level verifier has a result marker in `.completed/` (P00a-V, P01-V, P05-V, P06-V, P07-V)
- [ ] Storage package is a leaf package
- [ ] All moved behavior has tests in storage package
- [ ] Session types test verifies `SESSION_FILE_PREFIX` and record type availability
- [ ] ConversationFileWriter public signatures are backward-compatible (zero-arg, one-arg, logger-injection tested)
- [ ] ConversationFileWriter has NO existing tests in core — new tests created in P04b
- [ ] Provider logging integration test (`packages/providers/src/LoggingProviderWrapper.test.ts`) created in P06 with behavioral assertions against real JSONL output (no mock theater)
- [ ] `secure-store-integration.test.ts` split: storage copy has inline `maskKeyForDisplay` and zero core imports
- [ ] Non-core mock tests updated to mock storage instead of core
- [ ] Parser inventory detects static, namespace, import-equals, dynamic, and vi.mock import kinds
- [ ] P06 reconciliation against P00a-import-inventory.json recorded — hard STOP if mismatch
- [ ] Core test disposition: moved behavior tests deleted, utility tests kept, compat tests added
- [ ] Core export map: existing entries preserved, new entries added with rationale
- [ ] `SecureStoreErrorCode` included in secure-store shim re-export
- [ ] SessionPersistenceService import resolves through shim
- [ ] Representative core consumers compile with shim-relative imports
- [ ] Dependency removal backed by rg evidence in P05
- [ ] `resetConversationFileWriterForTesting` is NOT in barrel, NOT in core shims — only in `@vybestack/llxprt-code-storage/testing`
- [ ] Format: run format, review diff, run format again (determinism), verify no drift with format:check; no staging
- [ ] Per-package builds verified for storage, core, mcp, providers, cli, a2a-server
- [ ] Verification scripts (`check-storage-import-boundary.mjs`, `check-storage-package-cycle.mjs`) created in P00a
- [ ] `preflight-import-inventory.mjs` retained through P07
- [ ] `packages/storage` never deleted if it already exists — plan adapts instead
- [ ] No `git add`, `git add -A`, or `git commit` during any verification phase
- [ ] Full verification passes

## Semantic? Column Definition

Per `dev-docs/PLAN-TEMPLATE.md`, the `Semantic?` column tracks whether **semantic verification** (feature actually works — not just structural file-existence checks) was performed after each verifier phase. This column MUST be updated after every verifier phase completes.

| Value | Meaning |
|---|---|
| [OK] | Semantic verification performed: implementation was read, behavior verified against requirements, pseudocode lines compared, integration points traced. |
| [ERROR] | Semantic verification NOT yet performed. Must be completed before proceeding. |
| N/A | Phase is structural only (e.g., scaffold creation, file moves) with no behavioral requirements to verify semantically. |

**Rule**: Every verifier phase MUST set `Semantic?` to [OK] before the next worker phase begins. The verifier must explicitly:
1. Read the implementation code (not just check files exist).
2. Trace execution paths for at least one behavioral scenario.
3. Compare implementation to referenced pseudocode lines.
4. Confirm integration points work (caller passes correct types, callee processes correctly).

If a verifier phase returns PASS but leaves `Semantic?` as [ERROR], the phase is incomplete and must be re-run.
