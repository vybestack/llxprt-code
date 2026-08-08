# Plan Overview — Config Decomposition

Plan ID: PLAN-20260808-ISSUE2615
Issue: #2615
Branch: `issue2615`
PR: #3118

## What is already on the branch

Seven narrowing chains landed before this plan was written. They are consistent
with it and are not reverted, but they are **not** the plan: they moved ~40 of
160 consumer files onto ad-hoc, consumer-owned capability interfaces. This plan
consolidates those into core-owned roles and finishes the remaining ~120 files.

Already established and reused as input:

- `scripts/api-census.ts`, `scripts/config-contract.ts`,
  `scripts/config-narrow-candidates.ts`
- The composition-root finding: `client.ts`, `zedIntegration.ts`,
  `subagentOrchestrator.ts`, `createChatSessionSafe`, `cli.tsx` build the object
  `fromConfig` adopts. Under this plan they take `RuntimeDependencies` instead,
  which is what makes them narrowable where previous attempts failed.

## Phase sequence

Every phase is gated. A phase may not start until its predecessor's
verification file exists and passes.

| Phase | Name | Artifact |
|---|---|---|
| P00a | Preflight verification | `analysis/preflight-results.md` |
| P01 | Analysis: complete Config member census by role | `analysis/role-assignment.json` |
| P01a | Analysis verification | `analysis/01a-verification.md` |
| P02 | Role interface pseudocode + member budget | `analysis/pseudocode/roles.md` |
| P02a | Pseudocode verification | `analysis/02a-verification.md` |
| P03 | Boundary guard: TDD | `scripts/tests/check-config-boundary.test.ts` |
| P04 | Boundary guard: implementation, wired to CI in report-only mode | `scripts/check-config-boundary.ts` |
| P05 | Role interfaces in core + member-budget test | `packages/core/src/config/roles/` |
| P06 | `RuntimeDependencies` + adapter; first root migrated | record + 1 root |
| P06b | Gap resolution: setters, lifecycle, instanceof | `RuntimeMutations`, `RuntimeLifecycle` |
| P07 | Migrate agents (53 files) | — |
| P08 | Migrate providers (22 files) | — |
| P09 | Migrate cli (14 files) | — |
| P10 | Migrate mcp + a2a-server (2 files) | — |
| P11 | Delete the 4 consumer capability modules | — |
| P12 | Flip guard to enforcing; full verification; CI green | — |

## Migration direction — corrected after P06

The original premise here was that migrating roots first would free the leaves.
P06 disproved it: a root cannot drop `Config` while it still passes `Config`
into a downstream function that demands one. `mcp-client-manager` migrated
cleanly precisely because its downstream was already clear.

**Migration runs bottom-up.** Leaves first, intermediates next, roots last, per
package. The `RuntimeDependencies` record is still the thing that makes roots
migratable at all — it just cannot be applied until the cascade beneath a root
is gone.

## Subagent assignment

| Phase | Subagent | Why |
|---|---|---|
| P01, P02 | `codeanalyzer` | census and clustering, read-only |
| P03 | `typescriptexpert` | behavioural tests first |
| P04, P05 | `typescriptexpert` | guard + role interfaces |
| P06 | `typescriptexpert` | highest-risk phase, smallest scope |
| P07–P10 | `typescriptexpert` | mechanical per-package migration |
| P11, P12 | `typescriptexpert` | deletion + verification |
| after P06, after P12 | `deepthinker` | review gates |

Each launch passes: the phase file, the specification, `dev-docs/RULES.md`, the
constraint list, and the requirement that the phase ends green with the full
verification suite run.

## Definition of done

All of REQ-001 through REQ-007 in `specification.md`, plus:

- `bun scripts/check-config-boundary.ts` exits 0 in enforcing mode
- `grep -rl "import type { Config }" packages/*/src --include=*.ts | grep -v packages/core` returns nothing for production files
- CI green on PR #3118
- PR body states "Closes #2615"
