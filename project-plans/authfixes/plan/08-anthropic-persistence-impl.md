# Phase 08: Anthropic Persistence Implementation

## Phase ID
`PLAN-20250823-AUTHFIXES.P08`

## Prerequisites
- Required: Phase 07 completed
- Verification: Tests exist and fail
- Expected: anthropic-oauth-provider.test.ts failing

## Implementation Tasks

### Files to Modify

1. **`/packages/cli/src/auth/anthropic-oauth-provider.ts`**
   - UPDATE to make ALL tests pass
   - MUST follow pseudocode from analysis/pseudocode/anthropic-oauth-provider.md
   - Reference pseudocode line numbers
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P08`

### Implementation Following Pseudocode

Follow lines 7-112 from anthropic-oauth-provider.md pseudocode exactly.

## Verification Commands

```bash
# All tests pass
npm test packages/cli/test/auth/anthropic-oauth-provider.test.ts
# Expected: All passing

# Verify pseudocode references
grep -c "@pseudocode" packages/cli/src/auth/anthropic-oauth-provider.ts
# Expected: 8+ references

# Mutation testing
npx stryker run --mutate packages/cli/src/auth/anthropic-oauth-provider.ts
# Expected: >80% mutation score
```

## Success Criteria

- All tests pass
- Pseudocode followed exactly
- >80% mutation score

## Phase Completion Marker

Create: `project-plans/authfixes/.completed/P08.md`