# Phase 10: OAuth Manager TDD Tests

## Objective
Write comprehensive behavioral tests for OAuth manager coordination.

## Input
- specification.md [REQ-001, REQ-003]
- analysis/pseudocode/oauth-manager.md

## Test Requirements
Create packages/cli/src/auth/oauth-manager.spec.ts with 15-18 behavioral tests.

## Required Test Scenarios

### Provider Registration
```typescript
/**
 * @requirement REQ-001.1
 * @scenario Register OAuth provider
 * @given OAuthManager instance
 * @when registerProvider(qwenProvider) called
 * @then Provider available for authentication
 * @and Listed in getSupportedProviders()
 */

/**
 * @requirement REQ-001.3
 * @scenario Multiple provider registration
 * @given Empty OAuth manager
 * @when Register qwen and gemini providers
 * @then Both providers available
 * @and Can authenticate with either
 */
```

### Authentication Flow
```typescript
/**
 * @requirement REQ-001.3
 * @scenario Authenticate with specific provider
 * @given Registered qwen provider
 * @when authenticate('qwen') called
 * @then Initiates qwen OAuth flow
 * @and Stores token on success
 */

/**
 * @requirement REQ-001.1
 * @scenario OAuth-only authentication
 * @given Provider registered
 * @when authenticate() called
 * @then Uses OAuth flow exclusively
 * @and No API key prompts shown
 */
```

### Token Management
```typescript
/**
 * @requirement REQ-003.1
 * @scenario Retrieve provider token
 * @given Authenticated with qwen
 * @when getToken('qwen') called
 * @then Returns stored OAuth token
 */

/**
 * @requirement REQ-003.1
 * @scenario Independent provider tokens
 * @given Authenticated with qwen and gemini
 * @when getToken('qwen') called
 * @then Returns only qwen token
 * @and Gemini token unaffected
 */

/**
 * @requirement REQ-002.5
 * @scenario Auto-refresh expired token
 * @given Token expires in 10 seconds
 * @when getToken() called
 * @then Automatically refreshes token
 * @and Returns new valid token
 */
```

### Status Reporting
```typescript
/**
 * @requirement REQ-005.4
 * @scenario Get auth status for all providers
 * @given Qwen authenticated, Gemini not
 * @when getAuthStatus() called
 * @then Returns status for both providers
 * @and Shows authenticated/unauthenticated state
 */

/**
 * @requirement REQ-005.4
 * @scenario Show token expiry in status
 * @given Authenticated provider with expiry
 * @when getAuthStatus() called
 * @then Includes time until expiry
 */
```

### Error Handling
```typescript
/**
 * @requirement REQ-001.3
 * @scenario Authenticate unknown provider
 * @given Provider 'unknown' not registered
 * @when authenticate('unknown') called
 * @then Throws provider not found error
 */

/**
 * @requirement REQ-003.1
 * @scenario Get token for unauthenticated provider
 * @given Provider registered but not authenticated
 * @when getToken() called
 * @then Returns null, no error
 */
```

### Provider Discovery
```typescript
/**
 * @requirement REQ-001.1
 * @scenario List OAuth-capable providers
 * @given Qwen and Gemini registered
 * @when getSupportedProviders() called
 * @then Returns ['gemini', 'qwen'] sorted
 */

/**
 * @requirement REQ-001.2
 * @scenario No API key providers in OAuth list
 * @given OAuth and API key providers registered
 * @when getSupportedProviders() called
 * @then Returns only OAuth-capable providers
 */
```

## Forbidden Patterns
- NO mocking provider implementations
- NO testing internal state
- NO structure-only assertions
- Must test actual coordination behavior

## Verification
- All tests fail with NotYetImplemented
- Tests cover multi-provider scenarios
- Each test has @requirement tag
- Real provider interactions tested