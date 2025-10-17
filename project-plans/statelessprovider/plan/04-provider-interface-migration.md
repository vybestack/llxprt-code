# Phase 04: Provider Interface Migration

## Phase ID

`PLAN-20250218-STATELESSPROVIDER.P04`

## Prerequisites

- Required: Phase 03a completed.
- Verification: `grep -r "PLAN-20250218-STATELESSPROVIDER.P03a" project-plans/statelessprovider/analysis/verification/P03-context-report.md`
- Expected files from previous phases: Runtime context helpers introduced in P03.

## Implementation Tasks

### Files to Create

- `packages/core/src/providers/__tests__/providerInterface.compat.test.ts`
  - Cover new `generateChatCompletion` signature accepting runtime context while ensuring legacy two-argument form still routes correctly.
  - Include markers referencing pseudocode (`base-provider.md`, `provider-invocation.md`).

### Files to Modify

- `packages/core/src/providers/IProvider.ts`
  - Introduce `GenerateChatOptions` type that bundles `contents`, `tools`, `settings`, `config`, and optional extras.
  - Extend `generateChatCompletion` signature to accept either `(contents, tools?)` (legacy) or the new options object.
  - Retain legacy mutators during this phase but mark with deprecation JSDoc.
  - Preserve the existing tool argument shape (`Array<{ functionDeclarations: ... }>`); the options object should expose the same structure without additional conversions.
- `packages/core/src/providers/BaseProvider.test.ts`
  - Add tests verifying the adapter dispatches context-aware calls to provider implementations.
- `packages/core/src/providers/BaseProvider.ts`
  - Implement overload/adaptor that normalizes legacy arguments into the new options object without changing existing behaviour.
  - Ensure authentication and helper methods continue working with the normalized payload.
- `packages/core/src/providers/LoggingProviderWrapper.ts`
  - Update wrapper to forward the normalized options to the underlying provider.
- `packages/core/src/providers/{openai,anthropic,gemini,openai-responses}/*.ts`
  - Accept the new options object but maintain their current internal reliance on `getSettingsService()` for now; no functional change aside from signature compatibility and deprecation notices.
- `packages/core/src/providers/integration/multi-provider.integration.test.ts`
  - Extend/adjust tests to cover both call signatures.
- `packages/core/src/index.ts`
  - Export any new types added in this phase.

### Required Code Markers

Each updated function should reference the relevant pseudocode section:

```typescript
/**
 * @plan PLAN-20250218-STATELESSPROVIDER.P04
 * @requirement REQ-SP-001
 * @pseudocode base-provider.md lines X-Y
 */
```

## Verification Commands

### Automated Checks

```bash
npm run typecheck
npm test -- --runTestsByPath packages/core/src/providers/__tests__/providerInterface.compat.test.ts packages/core/src/providers/BaseProvider.test.ts packages/core/src/providers/integration/multi-provider.integration.test.ts
```

### Manual Verification Checklist

- [ ] Legacy callers compile without modification.
- [ ] Adapter normalizes both legacy and new signatures.
- [ ] No provider logic changes beyond signature handling and deprecation notes.
- [ ] Tool payload shape (`functionDeclarations` array) remains unchanged for all providers.
- [ ] Pseudocode references kept up to date.

## Success Criteria

- New interface is available and exercised via unit tests.
- Codebase builds without requiring downstream updates.
- Setters/getters remain available for later removal.

## Failure Recovery

1. Revert interface changes if compilation breaks.
2. Reapply adjustments ensuring adapters preserve existing behaviour.

## Phase Completion Marker

Create: `project-plans/statelessprovider/.completed/P04.md`

```markdown
Phase: P04
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/core/src/providers/IProvider.ts
- packages/core/src/providers/BaseProvider.ts
- packages/core/src/providers/LoggingProviderWrapper.ts
- packages/core/src/providers/{openai,anthropic,gemini,openai-responses}/*.ts
- packages/core/src/providers/BaseProvider.test.ts
- packages/core/src/providers/integration/multi-provider.integration.test.ts
- packages/core/src/providers/__tests__/providerInterface.compat.test.ts (new)
- packages/core/src/index.ts
Verification:
- <paste test outputs>
```
