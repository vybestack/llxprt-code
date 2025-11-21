# Phase 06: Profile Parsing Helpers Stub

## Phase ID
`PLAN-20251118-ISSUE533.P06`

## Prerequisites
- Phase 05 completed (argument parsing working)

## Implementation Tasks

### Files to Modify: `packages/cli/src/config/profileBootstrap.ts`

#### Add Stub Functions

```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P06
 * @requirement REQ-PROF-002.1
 * Parse inline profile JSON (STUB)
 * 
 * Returns BootstrapRuntimeState (same as prepareRuntimeForProfile at profileBootstrap.ts:237)
 */
function parseInlineProfile(jsonString: string): BootstrapRuntimeState {
  // STUB: Returns empty profile (will fail validation)
  return {
    providerName: '',
    modelName: '',
    warnings: []
  };
}

/**
 * @plan PLAN-20251118-ISSUE533.P06
 * @requirement REQ-PROF-003.3
 * Calculate max nesting depth (STUB)
 */
function getMaxNestingDepth(obj: any, currentDepth = 0): number {
  // STUB: Always returns 0
  return 0;
}

/**
 * @plan PLAN-20251118-ISSUE533.P06
 * @requirement REQ-PROF-003.2
 * Format validation errors (STUB)
 */
function formatValidationErrors(errors: any[]): string {
  // STUB: Returns empty string
  return '';
}
```

## Stub Behavior
- Functions return EMPTY VALUES (not throwing errors)
- Will fail validation in Phase 07 tests (natural failure)
- Type signatures must be correct

## Note on Validation Approach
This implementation uses basic TypeScript validation against the Profile interface from 
`packages/core/src/types/modelParams.ts`. No Zod schema is required. Validation is performed
with runtime checks for required fields and type checking for optional fields.

## Verification
```bash
# Verify stubs exist
grep -n "function parseInlineProfile" packages/cli/src/config/profileBootstrap.ts
grep -n "function getMaxNestingDepth" packages/cli/src/config/profileBootstrap.ts
grep -n "function formatValidationErrors" packages/cli/src/config/profileBootstrap.ts

# Verify TypeScript compiles
npm run typecheck
```
