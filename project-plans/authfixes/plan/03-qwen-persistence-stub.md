# Phase 03: Qwen Persistence Stub

## Phase ID
`PLAN-20250823-AUTHFIXES.P03`

## Prerequisites
- Required: Phase 02 completed
- Verification: `test -d project-plans/authfixes/analysis/pseudocode`
- Expected files: analysis/pseudocode/qwen-oauth-provider.md

## Implementation Tasks

### Files to Modify

1. **`/packages/cli/src/auth/qwen-oauth-provider.ts`**
   - UPDATE constructor to accept optional TokenStore
   - ADD initializeToken stub method
   - UPDATE getToken to return empty/null
   - UPDATE refreshIfNeeded to return empty/null
   - ADD logout stub method
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P03`
   - MUST include: `@requirement:REQ-001.1`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250823-AUTHFIXES.P03
 * @requirement REQ-001.1
 * @pseudocode lines 6-15
 */
constructor(private tokenStore?: TokenStore) {
  // Stub implementation
  throw new Error('NotYetImplemented');
}
```

### Stub Implementation Guidelines

- Methods can throw `new Error('NotYetImplemented')` OR return empty values
- If returning empty: objects `{}`, arrays `[]`, promises `Promise.resolve()`
- Maximum 150 lines total for the file
- Must compile with strict TypeScript
- NO TODO comments

## Verification Commands

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250823-AUTHFIXES.P03" packages/cli/src/auth/ | wc -l
# Expected: 5+ occurrences

# Check TypeScript compiles
npm run typecheck
# Expected: Success

# Check for TODO comments
grep -r "TODO" packages/cli/src/auth/qwen-oauth-provider.ts
# Expected: No results

# Verify no duplicate files created
find packages -name "*V2*" -o -name "*New*" -o -name "*Copy*"
# Expected: No results
```

## Success Criteria

- QwenOAuthProvider constructor accepts TokenStore
- All new methods stubbed
- TypeScript compiles successfully
- No TODO comments
- No duplicate file versions

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/auth/qwen-oauth-provider.ts`
2. Re-run Phase 03 with corrected implementation

## Phase Completion Marker

Create: `project-plans/authfixes/.completed/P03.md`