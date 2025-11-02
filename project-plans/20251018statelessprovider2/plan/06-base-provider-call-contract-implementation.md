# Phase 06: Base Provider Call Contract Implementation

## Phase ID

`PLAN-20251018-STATELESSPROVIDER2.P06`

## Prerequisites

- Required: Phase 05a completed
- Verification: `grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P05a" project-plans/20251018statelessprovider2/.completed`
- Expected files from previous phase:
  - Failing stateless tests (`baseProvider.stateless.test.ts`)
  - Pseudocode document

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/BaseProvider.ts`
  - Remove instance-level model/base URL/auth caches per pseudocode steps
  - Ensure `GenerateChatOptions` provides all call-specific state
  - Reference pseudocode lines in comments for each major block

- `packages/core/src/providers/IProvider.ts`
  - Update interface documentation to clarify stateless requirements
  - Ensure deprecated mutators removed/flagged as errors

- `packages/core/src/providers/LoggingProviderWrapper.ts`
  - Adjust wrapper to forward normalized options without relying on provider state

- `packages/core/src/providers/ProviderManager.ts`
  - Update provider registration to refuse providers lacking stateless support
  - Synchronize with new BaseProvider contract

- `packages/core/src/auth/precedence.ts`
  - Accept runtime-scoped settings provided in call context

- `packages/core/src/providers/__tests__/baseProvider.stateless.test.ts`
  - Remove expected failures; ensure tests pass

- Additional downstream files impacted by signature changes (e.g., `OpenAIProvider`, `AnthropicProvider`, `GeminiProvider`, `OpenAIResponsesProvider`) may require temporary shims until later phases—update only as needed to satisfy current tests while leaving TODO markers for upcoming provider-specific phases.

### Required Code Markers

```typescript
/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P06
 * @requirement REQ-SP2-001
 * @pseudocode base-provider-call-contract.md lines X-Y
 */
```

## Verification Commands

### Automated Checks

```bash
# Verify stateless tests now pass
npm test -- --run baseProvider.stateless

# Run regression guardrail
npm run test:multi-runtime

# Full lint/typecheck
npm run lint
npm run typecheck
```

### Manual Verification Checklist

- [ ] All stateless tests pass
- [ ] No legacy mutator usage remains in BaseProvider
- [ ] Comments reference pseudocode line numbers
- [ ] Regression guardrail still passes

## Success Criteria

- BaseProvider no longer stores provider-specific state
- Tests confirm stateless behavior
- Lint/typecheck succeed

## Failure Recovery

1. Revert modified files
2. Reapply changes following pseudocode exactly

## Phase Completion Marker

Create: `project-plans/20251018statelessprovider2/.completed/P06.md`

```markdown
Phase: P06
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/core/src/providers/BaseProvider.ts
- packages/core/src/providers/IProvider.ts
- packages/core/src/providers/LoggingProviderWrapper.ts
- packages/core/src/providers/ProviderManager.ts
- packages/core/src/auth/precedence.ts
- packages/core/src/providers/__tests__/baseProvider.stateless.test.ts
Verification:
- <paste command outputs>
```
