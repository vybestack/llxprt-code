# Phase 09: Legacy API Decommission

## Phase ID

`PLAN-20250218-STATELESSPROVIDER.P09`

## Prerequisites

- Required: Phase 08a completed.
- Verification: `grep -r "PLAN-20250218-STATELESSPROVIDER.P08a" project-plans/statelessprovider/analysis/verification/P08-test-report.md`
- Expected files: Core/CLI running solely through runtime helpers with comprehensive tests.

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/IProvider.ts`
  - Remove deprecated setter/getter signatures (`setModel`, `getCurrentModel`, `setBaseUrl`, etc.).
  - Update documentation to reflect stateless contract only.
- `packages/core/src/providers/{BaseProvider,openai,anthropic,gemini,openai-responses}/*.ts`
  - Delete compatibility shims that delegated to legacy mutators.
  - Trim cached fields now redundant (e.g., `currentModel`, `modelParams`).
- `packages/cli/src/providers/providerManagerInstance.ts`
  - Remove fallback singleton factory/export; expose only explicit context-based APIs.
- `packages/core/src/settings/settingsServiceInstance.ts`
  - Replace legacy `getSettingsService()` export with a deprecated wrapper that throws informative error unless explicitly enabled via feature flag (for external consumers with transition period).
- `packages/core/src/index.ts`
  - Update exports to surface new factories while removing deprecated APIs.
- `packages/cli/src/ui/commands` & hooks
  - Delete any remaining guards used to bridge legacy behaviour.
- `scripts/benchmark/*`, `test-scripts/*`, `packages/a2a-server/*`, `docs/cli/**`
  - Migrate helper usage away from legacy provider setters/signatures so external tooling stays compatible.
- `packages/docs/settings-and-profiles.md`
  - Update guidance to reflect stateless providers and new CLI helper usage.

### Files to Update / Tests

- `packages/core/test/settings/SettingsService.spec.ts`
  - Ensure tests construct services via factory helpers.
- `packages/core/src/providers/providerInterface.compat.test.ts`
  - Remove legacy-path assertions; keep context-based tests.
- `packages/cli/src/integration-tests/*`
  - Clean up expectations referencing removed APIs.
- Smoke-test ancillary tooling (benchmarks, A2A agent, doc snippets) under the new contract.

### Deprecation Notices

- Add CHANGELOG/release note entries documenting API removals and migration steps for external consumers.
- Provide codemod guidance (if applicable) in docs.

## Verification Commands

```bash
npm run typecheck
npm run test
rg "setModel" packages/core/src/providers -g"*.ts"
rg "getSettingsService" packages -g"*.ts"
```

## Manual Verification Checklist

- [ ] Codebase free of legacy provider mutators and singleton helpers (except optional throw helper for external consumers).
- [ ] Documentation updated with new architecture explanation.
- [ ] Release notes prepared for publishing.

## Success Criteria

- All deprecated APIs removed or gated, and documentation reflects final architecture.

## Failure Recovery

1. Revert affected files if regressions surface.
2. Reapply deprecation removals incrementally and rerun verification commands.

## Phase Completion Marker

Create: `project-plans/statelessprovider/.completed/P09.md`

```markdown
Phase: P09
Completed: YYYY-MM-DD HH:MM
Files Modified:
- <list>
Verification:
- <paste outputs>
```
