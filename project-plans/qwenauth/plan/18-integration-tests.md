# Phase 18: End-to-End Integration Tests

## Objective
Create comprehensive integration tests for the complete OAuth flow.

## Input
- All implemented components
- specification.md requirements

## Test Requirements
Create test/integration/qwen-oauth-e2e.spec.ts with 12-15 integration tests.

## Required Test Scenarios

### Complete OAuth Flow
```typescript
/**
 * @requirement REQ-001, REQ-002
 * @scenario Full Qwen OAuth authentication
 * @given Fresh llxprt installation
 * @when User runs /auth qwen
 * @then Device code displayed
 * @and Polling completes on authorization
 * @and Token stored securely
 * @and Provider becomes available
 */

/**
 * @requirement REQ-001.3, REQ-003.1
 * @scenario Multi-provider authentication
 * @given No providers authenticated
 * @when Auth gemini then auth qwen
 * @then Both providers authenticated
 * @and Can use either for content generation
 * @and Tokens stored separately
 */
```

### Provider Switching
```typescript
/**
 * @requirement REQ-004, REQ-006.3
 * @scenario Use Qwen with Gemini tools
 * @given Qwen and Gemini both authenticated
 * @when --provider openai with web search
 * @then Content from Qwen (via OAuth)
 * @and Web search from Gemini (via OAuth)
 */

/**
 * @requirement REQ-004.1
 * @scenario OAuth fallback with API key override
 * @given Qwen OAuth authenticated
 * @when --key provided for different service
 * @then Uses API key, ignores OAuth
 */
```

### Token Lifecycle
```typescript
/**
 * @requirement REQ-002.5, REQ-004.4
 * @scenario Automatic token refresh
 * @given Qwen token expires in 1 minute
 * @when Making API call after expiry
 * @then Token automatically refreshed
 * @and Request completes successfully
 */

/**
 * @requirement REQ-003.2
 * @scenario Secure token storage
 * @given OAuth token saved
 * @when Checking file permissions
 * @then File has 0600 permissions
 * @and Located at ~/.llxprt/oauth/qwen.json
 */
```

### Error Recovery
```typescript
/**
 * @requirement REQ-002.1
 * @scenario Handle auth timeout
 * @given OAuth flow started
 * @when 15 minutes pass without auth
 * @then Flow times out gracefully
 * @and Clear error message shown
 * @and No token stored
 */

/**
 * @requirement REQ-002.1
 * @scenario Handle auth denial
 * @given OAuth flow started
 * @when User denies authorization
 * @then Appropriate error shown
 * @and Provider remains unauthenticated
 */
```

### Backward Compatibility
```typescript
/**
 * @requirement REQ-006.1, REQ-006.2
 * @scenario Existing API keys still work
 * @given OPENAI_API_KEY environment variable
 * @when Using OpenAI provider
 * @then Works without OAuth
 * @and No OAuth prompts shown
 */

/**
 * @requirement REQ-006.3
 * @scenario Gemini OAuth unaffected
 * @given Existing Gemini OAuth setup
 * @when Adding Qwen OAuth
 * @then Gemini continues working
 * @and Both can be used simultaneously
 */
```

### Status and Discovery
```typescript
/**
 * @requirement REQ-005.4
 * @scenario Auth status display
 * @given Mixed auth states
 * @when Running /auth (no args)
 * @then Shows all providers
 * @and Indicates auth status for each
 * @and Shows token expiry if authenticated
 */
```

## Test Infrastructure
- Use real OAuth endpoints (with test account)
- Real file system operations
- No mocks for integration tests
- Test with actual API calls

## Verification
- All components work together
- OAuth flows complete successfully
- Multi-provider scenarios work
- Security requirements met
- Backward compatibility maintained