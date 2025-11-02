# Phase 06: Integration Stub

## Phase ID
`PLAN-20251023-STATELESS-HARDENING.P06`

## Prerequisites
- Required: `.completed/P05a.md` captured.
- Verification: `test -f project-plans/20251023stateless4/.completed/P05a.md`
- Expected files from previous phase: Guard implementation for BaseProvider and passing unit tests.

## Implementation Tasks

### Files to Modify
- `packages/core/src/providers/ProviderManager.ts`
  - Introduce opt-in plumbing (feature flag or optional arguments) that allows ProviderManager to pass normalized runtime options without changing behaviour yet (pseudocode lines 10-12 in `provider-runtime-handling.md`, @requirement:REQ-SP4-004).
  - Add placeholder methods (e.g., `prepareStatelessProviderInvocation`) that currently throw `new NotYetImplementedError('PLAN-20251023-STATELESS-HARDENING.P06')` so downstream phases can remove them.
- `packages/core/src/providers/logging/LoggingProviderWrapper.ts`
  - Surface stub helper that records the active runtime context to be consumed later; do not mutate behaviour (pseudocode line 10 in `logging-wrapper-adjustments.md`).
- `packages/cli/src/runtime/runtimeSettings.ts`
  - Add guarded entry points (`ensureStatelessProviderReady`) that call the new ProviderManager stubs but still short-circuit to existing logic (pseudocode lines 10-11 in `provider-runtime-handling.md`).

### Activities
- Wrap stub sections with explanatory comments using the colon markers (`@plan:PLAN-20251023-STATELESS-HARDENING.P06`, `@requirement:REQ-SP4-004`) so implementation phases can easily locate them.
- Ensure the CLI runtime registry stores any additional metadata needed by future phases without enabling the new guard.

### Required Code Markers
- Insert inline comments of the form `/* @plan:PLAN-20251023-STATELESS-HARDENING.P06 (pseudocode line 10) */` next to each stubbed helper; avoid using the word “TODO”.

## Verification Commands

### Automated Checks
```bash
pnpm lint providers --filter ProviderManager
pnpm lint cli --filter runtime
```

### Manual Verification Checklist
- [ ] Stubs compile and log the plan markers without altering current runtime behaviour.
- [ ] NotYetImplemented guards are present with clear plan annotations.
- [ ] CLI runtime entry points safely no-op when the stateless feature flag is disabled.

## Success Criteria
- Integration scaffolding exists so later phases can wire stateless behaviour without touching unrelated files.

## Failure Recovery
1. If behaviour regresses, remove the stub helpers and re-run lint before retrying.
2. Rework guard conditions to ensure feature is dormant until integration TDD passes.

## Phase Completion Marker
- Create `.completed/P06.md` with timestamp, stub locations, and lint outputs per PLAN-TEMPLATE guidelines.
