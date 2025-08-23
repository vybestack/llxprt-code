# Phase 06: Anthropic Persistence Stub

## Phase ID
`PLAN-20250823-AUTHFIXES.P06`

## Prerequisites
- Required: Phase 05 completed
- Verification: `grep -r "@plan:PLAN-20250823-AUTHFIXES.P05" .`
- Expected: Qwen implementation complete

## Implementation Tasks

### Files to Modify

1. **`/packages/cli/src/auth/anthropic-oauth-provider.ts`**
   - UPDATE constructor to accept optional TokenStore
   - ADD initializeToken stub method
   - UPDATE getToken to use tokenStore
   - UPDATE refreshIfNeeded logic
   - ADD logout stub method
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P06`
   - MUST include: `@requirement:REQ-001.1`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250823-AUTHFIXES.P06
 * @requirement REQ-001.1
 * @pseudocode lines 7-10
 */
constructor(private tokenStore?: TokenStore) {
  // Stub implementation
  throw new Error('NotYetImplemented');
}
```

### Stub Implementation Guidelines

- Methods can throw `new Error('NotYetImplemented')` OR return empty values
- Maintain existing authCancelled logic
- Must compile with strict TypeScript
- NO TODO comments

## Verification Commands

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250823-AUTHFIXES.P06" packages/cli/src/auth/ | wc -l
# Expected: 5+ occurrences

# Check TypeScript compiles
npm run typecheck
# Expected: Success

# Check for TODO comments
grep -r "TODO" packages/cli/src/auth/anthropic-oauth-provider.ts
# Expected: No results
```

## Success Criteria

- AnthropicOAuthProvider constructor accepts TokenStore
- All persistence methods stubbed
- TypeScript compiles successfully
- No TODO comments

## Phase Completion Marker

Create: `project-plans/authfixes/.completed/P06.md`