# Phase 12: Logout Command Stub

## Phase ID
`PLAN-20250823-AUTHFIXES.P12`

## Prerequisites
- Required: Phase 11 completed (Gemini implementation)
- Verification: `grep -r "@plan:PLAN-20250823-AUTHFIXES.P11" .`
- Expected: All provider implementations complete

## Implementation Tasks

### Files to Modify

1. **`/packages/cli/src/auth/oauth-manager.ts`**
   - ADD logout method stub
   - ADD logoutAll method stub
   - ADD isAuthenticated method stub
   - UPDATE registerProviders to pass TokenStore
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P12`
   - MUST include: `@requirement:REQ-002`

2. **`/packages/cli/src/ui/commands/authCommand.ts`**
   - UPDATE execute method to handle logout action
   - ADD logoutProvider method stub
   - UPDATE showProviderStatus for token expiry
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P12`
   - MUST include: `@requirement:REQ-002.3`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250823-AUTHFIXES.P12
 * @requirement REQ-002.1
 * @pseudocode lines 4-37
 */
async logout(providerName: string): Promise<void> {
  throw new Error('NotYetImplemented');
}
```

## Verification Commands

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250823-AUTHFIXES.P12" packages/cli/src/ | wc -l
# Expected: 6+ occurrences

# Check TypeScript compiles
npm run typecheck
# Expected: Success
```

## Success Criteria

- Logout methods stubbed in OAuthManager
- Auth command updated for logout action
- TypeScript compiles successfully

## Phase Completion Marker

Create: `project-plans/authfixes/.completed/P12.md`