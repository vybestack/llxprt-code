# Phase 10: Gemini OAuth TDD

## Phase ID
`PLAN-20250823-AUTHFIXES.P10`

## Prerequisites
- Required: Phase 09 completed
- Verification: `grep -r "@plan:PLAN-20250823-AUTHFIXES.P09" .`
- Expected: Gemini stub exists (not placeholder)

## Implementation Tasks

### Files to Create

1. **`/packages/cli/test/auth/gemini-oauth-provider.test.ts`**
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P10`
   - MUST include: `@requirement:REQ-001, REQ-003`
   - Test Google OAuth flow
   - Test token persistence
   - Test logout

### Special Gemini Test Requirements

Google OAuth tokens have specific characteristics:
- Start with `ya29.` prefix
- Include specific scopes
- May not always have refresh tokens

### Behavioral Test Examples

```typescript
/**
 * @plan PLAN-20250823-AUTHFIXES.P10
 * @requirement REQ-001.1
 * @scenario Load Google OAuth token on init
 * @given Valid Google token in storage
 * @when GeminiOAuthProvider constructed
 * @then Token loaded and available
 */
it('should load persisted Google OAuth token', async () => {
  const googleToken: OAuthToken = {
    access_token: 'ya29.a0AfH6SMBx...',
    refresh_token: 'refresh-google-123',
    expiry: Date.now() / 1000 + 3600,
    token_type: 'Bearer',
    scope: 'https://www.googleapis.com/auth/generative-language.retriever'
  };
  
  const tokenStore = new MultiProviderTokenStore();
  await tokenStore.saveToken('gemini', googleToken);
  
  const provider = new GeminiOAuthProvider(tokenStore);
  const loaded = await provider.getToken();
  
  expect(loaded?.access_token).toBe('ya29.a0AfH6SMBx...');
  expect(loaded?.scope).toContain('generative-language');
});

/**
 * @requirement REQ-003.4
 * @scenario Remove magic strings
 * @given Provider initialized
 * @when initiateAuth called
 * @then No USE_LOGIN_WITH_GOOGLE thrown
 */
it('should not use magic strings', async () => {
  const provider = new GeminiOAuthProvider();
  
  // Should not throw USE_EXISTING_GEMINI_OAUTH
  await expect(provider.initiateAuth()).rejects.not.toThrow('USE_EXISTING_GEMINI_OAUTH');
});
```

### Property-Based Tests

```typescript
test.prop([fc.string({ minLength: 10, maxLength: 100 })])(
  'should validate Google token format',
  (tokenString) => {
    const isGoogleToken = tokenString.startsWith('ya29.');
    const provider = new GeminiOAuthProvider();
    
    if (isGoogleToken) {
      // Should be treated as OAuth token
      expect(provider.isOAuthToken(tokenString)).toBe(true);
    } else {
      // Should be treated as API key
      expect(provider.isOAuthToken(tokenString)).toBe(false);
    }
  }
);
```

## Verification Commands

```bash
# Check for behavioral assertions
grep -E "toBe\(|toEqual\(|toContain\(" packages/cli/test/auth/gemini-oauth-provider.test.ts
# Expected: 15+ occurrences

# Check no magic strings tested
grep -r "USE_LOGIN_WITH_GOOGLE\|USE_EXISTING_GEMINI_OAUTH" packages/cli/test/auth/gemini-oauth-provider.test.ts
# Expected: Only in "should not use" test

# Run tests - should fail
npm test packages/cli/test/auth/gemini-oauth-provider.test.ts
# Expected: Tests fail naturally
```

## Success Criteria

- 15-20 behavioral tests
- Google OAuth specifics tested
- No magic string dependencies
- 30% property-based tests

## Phase Completion Marker

Create: `project-plans/authfixes/.completed/P10.md`