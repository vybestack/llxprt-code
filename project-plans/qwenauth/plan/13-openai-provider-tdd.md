# Phase 13: OpenAI Provider OAuth TDD Tests

## Objective
Write comprehensive behavioral tests for OpenAI provider OAuth support.

## Input
- specification.md [REQ-004]
- analysis/pseudocode/openai-provider-oauth.md

## Test Requirements
Create packages/core/src/providers/openai-oauth.spec.ts with 15-18 behavioral tests.

## Required Test Scenarios

### Authentication Precedence
```typescript
/**
 * @requirement REQ-004.1
 * @scenario Command line key takes precedence
 * @given --key flag, env var, and OAuth all present
 * @when resolveAuthentication() called
 * @then Uses command line key value
 */

/**
 * @requirement REQ-004.1
 * @scenario Environment variable second precedence
 * @given No --key flag, but OPENAI_API_KEY set
 * @when resolveAuthentication() called
 * @then Uses environment variable value
 * @and Ignores OAuth token if present
 */

/**
 * @requirement REQ-004.1
 * @scenario OAuth token as fallback
 * @given No --key flag, no env var
 * @when resolveAuthentication() called
 * @then Uses OAuth token from manager
 */

/**
 * @requirement REQ-004.1
 * @scenario No authentication available
 * @given No --key, no env var, no OAuth
 * @when resolveAuthentication() called
 * @then Returns null, provider unavailable
 */
```

### OAuth Token Usage
```typescript
/**
 * @requirement REQ-004.3
 * @scenario OAuth token used as API key
 * @given Valid OAuth token from manager
 * @when Making API request
 * @then Token passed as apiKey to OpenAI SDK
 */

/**
 * @requirement REQ-004.3
 * @scenario Bearer token in Authorization header
 * @given OAuth token being used
 * @when OpenAI SDK makes request
 * @then Sends Authorization: Bearer <token>
 */
```

### Token Refresh
```typescript
/**
 * @requirement REQ-004.4
 * @scenario Automatic token refresh
 * @given OAuth token expires soon
 * @when API call initiated
 * @then Refreshes token before use
 * @and Uses new token for request
 */

/**
 * @requirement REQ-004.4
 * @scenario Handle refresh failure
 * @given Expired token, refresh fails
 * @when API call attempted
 * @then Provider becomes unavailable
 * @and Returns appropriate error
 */
```

### Provider Compatibility
```typescript
/**
 * @requirement REQ-004.1
 * @scenario Qwen endpoint compatibility
 * @given OPENAI_BASE_URL set to Qwen
 * @when Using OAuth authentication
 * @then Works with Qwen endpoints
 */

/**
 * @requirement REQ-006.1
 * @scenario Backward compatibility with API keys
 * @given Existing API key setup
 * @when No OAuth manager provided
 * @then Works exactly as before
 */
```

### Authentication Status
```typescript
/**
 * @requirement REQ-004.1
 * @scenario Check authentication status
 * @given OAuth token present
 * @when isAuthenticated() called
 * @then Returns true
 */

/**
 * @requirement REQ-004.1
 * @scenario Multiple auth sources status
 * @given API key and OAuth both present
 * @when isAuthenticated() called
 * @then Returns true (uses precedence)
 */
```

### Error Handling
```typescript
/**
 * @requirement REQ-004.4
 * @scenario Handle missing OAuth manager
 * @given No OAuth manager provided
 * @when Checking for OAuth token
 * @then Falls back to other auth methods
 * @and No errors thrown
 */

/**
 * @requirement REQ-004.3
 * @scenario Invalid token format
 * @given Malformed OAuth token
 * @when Used for API request
 * @then Request fails with auth error
 */
```

## Forbidden Patterns
- NO mocking OpenAI SDK internals
- NO testing private methods directly
- NO modifying existing tests
- Must preserve backward compatibility

## Verification
- All tests fail with NotYetImplemented
- Tests cover all precedence orders
- OAuth integration tested
- Backward compatibility verified