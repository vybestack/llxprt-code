# Phase 13: Logout Command TDD

## Phase ID
`PLAN-20250823-AUTHFIXES.P13`

## Prerequisites
- Required: Phase 12 completed
- Verification: `grep -r "@plan:PLAN-20250823-AUTHFIXES.P12" .`
- Expected: Logout stubs exist

## Implementation Tasks

### Files to Create

1. **`/packages/cli/test/auth/oauth-manager-logout.test.ts`**
   - Test logout for each provider
   - Test logoutAll functionality
   - Test isAuthenticated checks
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P13`

2. **`/packages/cli/test/ui/commands/auth-command-logout.test.ts`**
   - Test /auth [provider] logout command
   - Test error handling
   - Test status with expiry display
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P13`

### Behavioral Test Examples

```typescript
/**
 * @plan PLAN-20250823-AUTHFIXES.P13
 * @requirement REQ-002.2
 * @scenario Logout removes token from storage
 * @given User is authenticated with provider
 * @when logout() is called
 * @then Token is removed from storage
 */
it('should remove token from storage on logout', async () => {
  const token: OAuthToken = {
    access_token: 'test-token',
    expiry: Date.now() / 1000 + 3600,
    token_type: 'Bearer'
  };
  
  const tokenStore = new MultiProviderTokenStore();
  await tokenStore.saveToken('qwen', token);
  
  const manager = new OAuthManager(tokenStore);
  await manager.logout('qwen');
  
  const remaining = await tokenStore.getToken('qwen');
  expect(remaining).toBeNull();
});
```

### Command Test Examples

```typescript
/**
 * @plan PLAN-20250823-AUTHFIXES.P13  
 * @requirement REQ-002.3
 * @scenario Logout command success message
 * @given User authenticated with Anthropic
 * @when /auth anthropic logout executed
 * @then Success message returned
 */
it('should return success message for logout command', async () => {
  const authCommand = new AuthCommand(oauthManager);
  const result = await authCommand.execute(['anthropic', 'logout']);
  
  expect(result.type).toBe('message');
  expect(result.messageType).toBe('info');
  expect(result.content).toContain('Successfully logged out');
});
```

## Verification Commands

```bash
# Check for behavioral assertions
grep -E "toBe\(|toEqual\(|toContain\(" packages/cli/test/auth/oauth-manager-logout.test.ts
# Expected: 10+ occurrences

# Run tests - should fail
npm test packages/cli/test/auth/oauth-manager-logout.test.ts
# Expected: Tests fail naturally
```

## Success Criteria

- 10+ tests for logout functionality
- Tests for command integration
- All behavioral assertions
- 30% property-based tests

## Phase Completion Marker

Create: `project-plans/authfixes/.completed/P13.md`