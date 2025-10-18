# Phase 15: CLI Runtime Isolation Implementation

## Phase ID

`PLAN-20251018-STATELESSPROVIDER2.P15`

## Prerequisites

- Required: Phase 14a completed
- Verification: `grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P14a" project-plans/20251018statelessprovider2/.completed`
- Expected files from previous phase:
  - Failing runtime isolation tests
  - Pseudocode document `cli-runtime-isolation.md`

## Implementation Tasks

### Files to Modify

- `packages/cli/src/runtime/runtimeSettings.ts`
  - Implement runtime-scoped storage for provider manager, OAuth manager, and settings service
  - Remove module-level singletons replaced by context map keyed by runtime ID
  - Reference pseudocode line numbers

- `packages/cli/src/runtime/runtimeContextFactory.ts`
  - Integrate with new runtime isolation APIs

- `packages/cli/src/ui/commands/*`
  - `/provider`, `/model`, `/set`, `/profile`, `/baseurl`, `/key`, `/keyfile`, `/status`, `/auth` commands updated to use injected runtime context

- `packages/cli/src/ui/components` / `hooks` as necessary to pass runtime through React context
  - Introduce a dedicated `RuntimeContextProvider` (per pseudocode) that supplies the active runtime via React context
  - Update hooks such as `useProviderDialog`, `useProviderModelDialog`, `useAuthCommand`, etc., to consume the new context rather than calling global helpers

- `packages/cli/src/runtime/__tests__/runtimeIsolation.test.ts`
  - Remove expected failures; ensure tests pass

- Update documentation comments referencing pseudocode

### Required Code Markers

```typescript
/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P15
 * @requirement REQ-SP2-003
 * @pseudocode cli-runtime-isolation.md lines X-Y
 */
```

## Verification Commands

### Automated Checks

```bash
npm test -- --run runtimeIsolation
npm run test:multi-runtime
npm run lint
npm run typecheck
```

### Manual Verification Checklist

- [ ] Runtime isolation tests pass
- [ ] CLI commands operate on scoped runtime context
- [ ] Multi-runtime guardrail passes
- [ ] Plan and pseudocode markers present

## Success Criteria

- CLI runtime infrastructure is stateless per runtime

## Failure Recovery

1. Revert affected files
2. Reapply changes using pseudocode blueprint

## Phase Completion Marker

Create: `project-plans/20251018statelessprovider2/.completed/P15.md`

```markdown
Phase: P15
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/cli/src/runtime/runtimeSettings.ts
- packages/cli/src/runtime/runtimeContextFactory.ts
- packages/cli/src/ui/commands/* (list commands touched)
- packages/cli/src/ui/components/* (list components)
- packages/cli/src/runtime/__tests__/runtimeIsolation.test.ts
Verification:
- <paste command outputs>
```
