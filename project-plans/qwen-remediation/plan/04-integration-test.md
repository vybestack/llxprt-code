# Phase 04: Integration Testing and Validation

## Objective

Comprehensive integration testing to verify the complete OAuth remediation works correctly across all components. Test toggle behavior, lazy triggering, precedence order, and endpoint validation.

## Context

This phase validates that all previous phases work together correctly in real usage scenarios. It covers end-to-end workflows and edge cases.

## Test Categories

### 1. OAuth Toggle Integration Tests

**Scenarios to test:**
- Toggle OAuth enablement for different providers
- Persistence across CLI restarts
- Multiple providers with different states
- Toggle while active sessions exist

**Test cases:**
```typescript
describe('OAuth Toggle Integration', () => {
  it('should persist OAuth enablement across restarts', async () => {
    // Enable OAuth
    await runCommand('/auth qwen');
    
    // Restart CLI simulation
    await restartCLI();
    
    // Verify state persisted
    const status = await getOAuthStatus('qwen');
    expect(status.enabled).toBe(true);
  });
  
  it('should handle multiple provider toggles', async () => {
    await runCommand('/auth qwen');
    await runCommand('/auth openai');
    
    expect(await getOAuthStatus('qwen')).toBe(true);
    expect(await getOAuthStatus('openai')).toBe(true);
  });
});
```

### 2. Lazy OAuth Triggering Tests

**Scenarios to test:**
- OAuth triggered only on API calls, not on command
- OAuth not triggered when higher priority auth exists
- OAuth token caching and reuse
- OAuth flow interruption handling

**Test cases:**
```typescript
describe('Lazy OAuth Triggering', () => {
  it('should not trigger OAuth on auth command', async () => {
    const oauthSpy = jest.spyOn(oauthManager, 'authenticate');
    
    await runCommand('/auth qwen');
    
    expect(oauthSpy).not.toHaveBeenCalled();
  });
  
  it('should trigger OAuth on first API call when no other auth', async () => {
    // Enable OAuth, no other auth configured
    await runCommand('/auth qwen');
    clearAllApiKeys();
    
    const oauthSpy = jest.spyOn(oauthManager, 'authenticate');
    
    // Make API call
    await geminiProvider.chat('Hello');
    
    expect(oauthSpy).toHaveBeenCalledOnce();
  });
  
  it('should not trigger OAuth when API key exists', async () => {
    // Enable OAuth but set API key
    await runCommand('/auth qwen');
    await runCommand('/key gemini sk-test-key');
    
    const oauthSpy = jest.spyOn(oauthManager, 'authenticate');
    
    await geminiProvider.chat('Hello');
    
    expect(oauthSpy).not.toHaveBeenCalled();
  });
});
```

### 3. Authentication Precedence Tests

**Scenarios to test:**
- Full precedence chain: /key → /keyfile → --key → --keyfile → ENV → OAuth
- Each method correctly overrides lower priority methods
- Proper fallback when higher priority methods fail
- Clear indication of which method is being used

**Test cases:**
```typescript
describe('Authentication Precedence', () => {
  it('should use /key over OAuth when both available', async () => {
    await runCommand('/key gemini sk-key-command');
    await runCommand('/auth qwen');
    
    const authMethod = await geminiProvider.getActiveAuthMethod();
    expect(authMethod.type).toBe('command-key');
    expect(authMethod.source).toBe('sk-key-command');
  });
  
  it('should use ENV vars over OAuth when no commands set', async () => {
    process.env.GEMINI_API_KEY = 'sk-env-key';
    await runCommand('/auth qwen');
    
    const authMethod = await geminiProvider.getActiveAuthMethod();
    expect(authMethod.type).toBe('environment');
    expect(authMethod.source).toBe('GEMINI_API_KEY');
  });
  
  it('should use OAuth when no other methods available', async () => {
    clearAllApiKeys();
    clearEnvironmentVars();
    await runCommand('/auth qwen');
    
    const authMethod = await geminiProvider.getActiveAuthMethod();
    expect(authMethod.type).toBe('oauth');
  });
});
```

### 4. OpenAI Endpoint Validation Tests

**Scenarios to test:**
- Qwen endpoints allow OAuth
- Non-Qwen endpoints reject OAuth with clear error
- Endpoint detection accuracy
- Fallback to API key when endpoint mismatch

**Test cases:**
```typescript
describe('OpenAI Endpoint Validation', () => {
  it('should allow OAuth for Qwen endpoints', async () => {
    await runCommand('/baseurl https://dashscope.aliyuncs.com/v1');
    await runCommand('/auth qwen');
    
    // Should not throw
    await expect(openaiProvider.validateOAuthEligibility()).resolves.not.toThrow();
  });
  
  it('should reject OAuth for OpenAI endpoints', async () => {
    await runCommand('/baseurl https://api.openai.com/v1');
    await runCommand('/auth qwen');
    
    await expect(openaiProvider.chat('Hello')).rejects.toThrow(
      /baseURL.*is not a Qwen endpoint/
    );
  });
  
  it('should fallback to API key when endpoint mismatch', async () => {
    await runCommand('/baseurl https://api.openai.com/v1');
    await runCommand('/key openai sk-openai-key');
    await runCommand('/auth qwen');
    
    // Should use API key instead of failing OAuth
    const authMethod = await openaiProvider.getActiveAuthMethod();
    expect(authMethod.type).toBe('command-key');
  });
});
```

### 5. Warning System Tests

**Scenarios to test:**
- Warnings when OAuth enabled but higher priority auth exists
- Correct identification of active auth method
- Clear messaging about precedence conflicts
- Endpoint mismatch warnings

**Test cases:**
```typescript
describe('Warning System', () => {
  it('should warn when OAuth enabled but API key exists', async () => {
    await runCommand('/key gemini sk-test-key');
    
    const output = await runCommand('/auth qwen');
    
    expect(output).toContain('API key configured - OAuth will not be used');
    expect(output).toContain('Current auth method: API key');
  });
  
  it('should warn about OpenAI endpoint mismatch', async () => {
    await runCommand('/baseurl https://api.openai.com/v1');
    
    const output = await runCommand('/auth qwen');
    
    expect(output).toContain('OpenAI baseURL is not Qwen - OAuth will not work');
  });
});
```

### 6. Error Handling Tests

**Scenarios to test:**
- OAuth flow cancellation
- Network errors during OAuth
- Invalid/expired tokens
- Configuration conflicts

**Test cases:**
```typescript
describe('Error Handling', () => {
  it('should handle OAuth cancellation gracefully', async () => {
    await runCommand('/auth qwen');
    clearAllApiKeys();
    
    // Mock OAuth cancellation
    jest.spyOn(oauthManager, 'authenticate').mockRejectedValue(
      new Error('User cancelled OAuth flow')
    );
    
    await expect(geminiProvider.chat('Hello')).rejects.toThrow(
      'User cancelled OAuth flow'
    );
  });
  
  it('should handle expired OAuth tokens', async () => {
    await runCommand('/auth qwen');
    clearAllApiKeys();
    
    // Set expired token
    await setCachedToken('expired-token', Date.now() - 3600000);
    
    const oauthSpy = jest.spyOn(oauthManager, 'authenticate');
    
    await geminiProvider.chat('Hello');
    
    // Should trigger fresh OAuth
    expect(oauthSpy).toHaveBeenCalled();
  });
});
```

## End-to-End Workflow Tests

### Complete User Journey
```typescript
describe('Complete OAuth Workflow', () => {
  it('should complete full OAuth enablement and usage cycle', async () => {
    // 1. Enable OAuth
    const enableOutput = await runCommand('/auth qwen');
    expect(enableOutput).toContain('Qwen OAuth enabled');
    
    // 2. Make API call (should trigger OAuth)
    mockOAuthFlow(); // Mock successful OAuth
    const response = await geminiProvider.chat('Hello');
    expect(response).toBeDefined();
    
    // 3. Second call should use cached token
    const oauthSpy = jest.spyOn(oauthManager, 'authenticate');
    await geminiProvider.chat('Hello again');
    expect(oauthSpy).not.toHaveBeenCalled(); // Cached token used
    
    // 4. Disable OAuth
    const disableOutput = await runCommand('/auth qwen');
    expect(disableOutput).toContain('Qwen OAuth disabled');
    
    // 5. Without other auth, should fail
    await expect(geminiProvider.chat('Hello')).rejects.toThrow(
      'No authentication method available'
    );
  });
});
```

## Performance and Reliability Tests

### Concurrent Usage
- Multiple simultaneous OAuth flows
- Token sharing across instances
- Race condition handling

### Edge Cases
- Malformed configuration files
- Network interruptions during OAuth
- Partial configuration states

## Success Criteria

- [ ] OAuth toggle persists correctly across restarts
- [ ] Lazy triggering works - no OAuth on command execution
- [ ] Full auth precedence chain respected in all scenarios
- [ ] OpenAI endpoint validation prevents misuse
- [ ] Warning system provides clear user guidance
- [ ] Error handling is graceful and informative
- [ ] Performance meets requirements (<50ms toggle, <10ms precedence check)
- [ ] No regression in existing authentication methods
- [ ] End-to-end workflows complete successfully

## Verification Commands

```bash
# Test OAuth toggle functionality
npm test -- --testPathPattern="auth-toggle"

# Test lazy OAuth triggering
npm test -- --testPathPattern="lazy-oauth"

# Test authentication precedence
npm test -- --testPathPattern="auth-precedence"

# Test endpoint validation
npm test -- --testPathPattern="endpoint-validation"

# Run all integration tests
npm test -- --testPathPattern="integration"

# Performance benchmarks
npm run test:performance -- --testPathPattern="oauth"
```