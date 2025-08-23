# Phase 15: Integration with Existing System

## Phase ID
`PLAN-20250823-AUTHFIXES.P15`

## Prerequisites
- Required: Phase 14 completed
- Verification: `npm test packages/cli/test/auth/`
- Expected: All unit tests passing

## Integration Tasks

### Files to Modify for Integration

1. **`/packages/cli/src/index.ts`**
   - Ensure OAuthManager initialized with TokenStore
   - Verify providers registered on startup
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P15`

2. **`/packages/core/src/providers/anthropic/AnthropicProvider.ts`**
   - UPDATE error messages for expired OAuth (lines 99-104)
   - Reference auth commands in error text
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P15`

3. **`/packages/core/src/providers/gemini/GeminiProvider.ts`**
   - REMOVE magic string checks (lines 125-129)
   - UPDATE to use real OAuth tokens
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P15`

### Integration Test Creation

Create **`/packages/cli/test/integration/auth-persistence.integration.test.ts`**:
```typescript
/**
 * @plan PLAN-20250823-AUTHFIXES.P15
 * @requirement REQ-004
 * Integration tests for OAuth persistence across CLI restarts
 */
describe('OAuth Authentication Persistence Integration', () => {
  it('should persist tokens across CLI restarts', async () => {
    // Save token
    const tokenStore = new MultiProviderTokenStore();
    await tokenStore.saveToken('qwen', validToken);
    
    // Simulate CLI restart
    const newManager = new OAuthManager(tokenStore);
    const token = await newManager.getOAuthToken('qwen');
    
    expect(token).toEqual(validToken);
  });
  
  it('should handle logout command end-to-end', async () => {
    // Test full flow from command to storage
  });
  
  it('should refresh expired tokens automatically', async () => {
    // Test refresh integration
  });
});
```

### Remove Deprecated Code

1. **Remove magic string usage**:
   - `oauth-manager.ts` lines 214-220 (USE_LOGIN_WITH_GOOGLE)
   - `GeminiProvider.ts` lines 125-129 (magic string check)

2. **Update error messages**:
   - Add helpful auth command references
   - Mention logout option in errors

## Verification Commands

```bash
# Run integration tests
npm test packages/cli/test/integration/auth-persistence.integration.test.ts
# Expected: All passing

# Check magic strings removed
grep -r "USE_LOGIN_WITH_GOOGLE" packages/
# Expected: No results (or only in tests/comments)

# Test CLI startup with persisted token
echo '{"access_token":"test","expiry":9999999999,"token_type":"Bearer"}' > ~/.llxprt/oauth/qwen.json
npm run cli -- --help
# Expected: No re-authentication required

# Test logout command
echo "/auth qwen logout" | npm run cli
# Expected: Logout successful

# Verify no duplicate files
find packages -name "*V2*" -o -name "*New*" -o -name "*Copy*"
# Expected: No results
```

## Success Criteria

- Tokens persist across CLI restarts
- Logout command works end-to-end
- Magic strings removed
- Integration tests pass
- No isolated features

## Phase Completion Marker

Create: `project-plans/authfixes/.completed/P15.md`