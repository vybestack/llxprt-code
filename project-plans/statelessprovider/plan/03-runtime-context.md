# Phase 03: Runtime Context Foundation

## Phase ID

`PLAN-20250218-STATELESSPROVIDER.P03`

## Prerequisites

- Required: Phase 02a completed.
- Verification: `grep -r "@plan:PLAN-20250218-STATELESSPROVIDER.P02a" project-plans/statelessprovider/analysis/verification/P02-pseudocode-report.md`
- Expected files from previous phase:
  - `analysis/pseudocode/base-provider.md`
  - `analysis/pseudocode/provider-invocation.md`
  - `analysis/pseudocode/cli-runtime.md`

## Implementation Tasks

- `packages/core/src/runtime/providerRuntimeContext.ts`
  - Define `ProviderRuntimeContext` interface bundling `SettingsService`, `Config`, and optional metadata (e.g., runtime id).
  - Export `createProviderRuntimeContext`/`setActiveProviderRuntimeContext`/`getActiveProviderRuntimeContext` helpers that default to the existing singleton-backed configuration for backward compatibility.
  - Support registration of externally created settings/config instances so the CLI can designate its runtime while future subagents pass their own.
  - MUST include plan/requirement markers referencing pseudocode lines.
- `packages/core/src/runtime/providerRuntimeContext.test.ts`
  - Cover context creation, default singleton fallback, and explicit injection scenarios.
  - Verify no behavioural change occurs when only the default context is used.

### Files to Modify

- `packages/core/src/settings/settingsServiceInstance.ts`
  - Refactor to resolve the instance through `getActiveProviderRuntimeContext()` while keeping `getSettingsService()` behaviour unchanged for existing callers.
  - Add `registerSettingsService` (or similar) that sets the active context’s settings service so bootstrap code can supply its own instance without touching globals.
- `packages/core/src/config/config.ts`
  - Introduce an optional constructor parameter to accept an existing `SettingsService`; default to `getSettingsService()` to avoid breaking usage.
  - Ensure `getSettingsService()` accessor now proxies through the injected instance (falling back to the active context).
- `packages/core/src/index.ts`
  - Re-export new context helpers for CLI/tests.
- `project-plans/statelessprovider/analysis/pseudocode/base-provider.md`
  - Append notes if additional context steps are required (satisfy traceability markers).

### Constraints

- No existing CLI or provider behaviour may regress during this phase.
- Keep all legacy APIs (provider setters/getters, singleton helpers) intact; new context utilities must co-exist without breaking changes.
- Unit tests must demonstrate the adapter path while retaining current defaults.

## Verification Commands

### Automated Checks

```bash
grep -r "PLAN-20250218-STATELESSPROVIDER.P03" packages/core/src/runtime packages/core/src/settings packages/core/src/config
npx vitest run packages/core/src/runtime/providerRuntimeContext.test.ts
npm run typecheck
```

### Manual Verification Checklist

- [ ] New helper exposes explicit injection entry points without altering existing singleton behaviour.
- [ ] Config constructor continues to work without changes to callers.
- [ ] Tests demonstrate both default and injected contexts.
- [ ] Documentation/comments reference relevant pseudocode and requirements.

## Success Criteria

- Runtime context helpers exist and can be exercised in isolation.
- No production functionality regresses; providers still operate through existing pathways.
- Project builds and unit tests added in this phase pass.

## Failure Recovery

1. Revert modified files using `git checkout -- <file>`.
2. Adjust context implementation to satisfy default-path compatibility before retrying.

## Phase Completion Marker

Create: `project-plans/statelessprovider/.completed/P03.md`

```markdown
Phase: P03
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/core/src/runtime/providerRuntimeContext.ts (new)
- packages/core/src/runtime/providerRuntimeContext.test.ts (new)
- packages/core/src/settings/settingsServiceInstance.ts
- packages/core/src/config/config.ts
- packages/core/src/index.ts
- project-plans/statelessprovider/analysis/pseudocode/base-provider.md (traceability note)
Verification:
- <paste outputs>
```
