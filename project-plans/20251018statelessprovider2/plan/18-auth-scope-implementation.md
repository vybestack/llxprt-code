# Phase 18: Auth Scope Implementation

## Phase ID

`PLAN-20251018-STATELESSPROVIDER2.P18`

## Prerequisites

- Required: Phase 17a completed
- Verification: `grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P17a" project-plans/20251018statelessprovider2/.completed`
- Expected files from previous phase:
  - Failing auth runtime scope tests
  - Pseudocode document `auth-runtime-scope.md`

## Implementation Tasks

### Files to Modify

- `packages/core/src/auth/precedence.ts`
  - Implement runtime-scoped cache keyed by runtime ID + provider name
  - Remove instance-level cached token usage from providers
  - Reference pseudocode lines for each block
  - Ensure OAuth manager interactions store tokens in a runtime-keyed map; legacy global cache must emit warnings if accessed without runtime ID

- `packages/core/src/providers/BaseProvider.ts`
  - Integrate with new runtime-scoped auth resolver APIs
  - Ensure no cached token remains on provider instance

- `packages/core/src/auth/__tests__/authRuntimeScope.test.ts`
  - Remove expected failures and ensure tests pass

- Update helper modules as required (e.g., `packages/core/src/test-utils/runtime.ts`)

### Required Code Markers

```typescript
/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P18
 * @requirement REQ-SP2-004
 * @pseudocode auth-runtime-scope.md lines X-Y
 */
```

## Verification Commands

### Automated Checks

```bash
npm test -- --run authRuntimeScope
npm run test:multi-runtime
npm run lint
npm run typecheck
```

### Manual Verification Checklist

- [ ] Auth scope tests pass
- [ ] No provider caches tokens locally
- [ ] Multi-runtime guardrail passes
- [ ] Pseudocode references present

## Success Criteria

- Authentication cache scoped per runtime and provider

## Failure Recovery

1. Revert modified files
2. Reapply changes following pseudocode blueprint

## Phase Completion Marker

Create: `project-plans/20251018statelessprovider2/.completed/P18.md`

```markdown
Phase: P18
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/core/src/auth/precedence.ts
- packages/core/src/providers/BaseProvider.ts
- packages/core/src/auth/__tests__/authRuntimeScope.test.ts
- packages/core/src/test-utils/runtime.ts
Verification:
- <paste command outputs>
```
