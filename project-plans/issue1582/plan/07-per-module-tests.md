# Phase 7: Per-Module Unit Tests

**Subagent:** `typescriptexpert`
**Prerequisite:** Phase 6 orchestrator wiring passes verification
**Verification:** `npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

## Goal

Add focused unit tests for each extracted pure module. These test the modules in isolation (not through the orchestrator), following `dev-docs/RULES.md` behavioral TDD principles. Also add one orchestrator-order integration test.

## What To Read First

- `project-plans/issue1582/plan/00-overview.md` — module structure, ordering guarantees
- The new extracted modules from Phases 2-5
- `packages/cli/src/config/config.test.ts` — existing test patterns to follow
- `dev-docs/RULES.md` — TDD conventions (behavioral tests, no mock theater)

## New Test Files

| New Test File | Tests For |
|---------------|-----------|
| `approvalModeResolver.test.ts` | All approval mode precedence/override combinations |
| `providerModelResolver.test.ts` | All provider/model precedence chain combinations |
| `toolGovernance.test.ts` | Tool normalization, exclusion filters, governance policy, shell special-case, defaultDisabledTools |
| `mcpServerConfig.test.ts` | MCP merge, allow/exclude precedence interactions |
| `interactiveContext.test.ts` | IDE mode, interactive detection, include dir resolution, file filtering |
| `configBuilder.test.ts` | Config constructor shape assertions, sub-builder outputs |
| `profileResolution.test.ts` | Profile resolution chain, inline vs file-based, --provider skipping |

## Orchestrator-Order Integration Test

Add one integration test in `config.test.ts` (or a new `config.ordering.test.ts`) that:

- Spies on the key side-effect functions:
  - `setCliRuntimeContext`
  - `registerCliProviderInfrastructure`
  - `applyProfileSnapshot` (or the wrapper `applyProfileToRuntime`)
  - `switchActiveProvider`
  - `applyCliArgumentOverrides`
- Asserts they are called in the correct order (matching the 17-step ordering guarantees from the overview)
- This protects against future reorder regressions

## Test Guidelines

- **Behavioral tests only** — test inputs/outputs, not implementation details
- **No mock theater** — don't just verify mocks were called; verify actual computed values
- **Pure module tests don't need mocks** — `resolveApprovalMode`, `resolveProviderAndModel`, `computeToolGovernancePolicy`, `filterMcpServers` are all pure functions
- **Each test describes WHAT the function does**, not HOW:
  ```typescript
  // GOOD: behavioral
  it('forces DEFAULT approval when folder is untrusted', () => {
    const result = resolveApprovalMode({ ...base, trustedFolder: false, cliYolo: true });
    expect(result).toBe(ApprovalMode.DEFAULT);
  });

  // BAD: implementation detail
  it('calls checkTrust before checking yolo', () => { ... });
  ```
- Follow existing test file patterns (vitest, describe blocks, etc.)

## Constraints

- No file >800 lines, no function >80 lines
- No production code changes in this phase — tests only
- All existing tests must continue to pass
- New tests must import from the new canonical module locations (not config.ts)
