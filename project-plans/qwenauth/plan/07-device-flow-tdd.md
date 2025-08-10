# Phase 07: Qwen Device Flow TDD Tests

## Objective
Write comprehensive behavioral tests for Qwen OAuth device flow.

## Input
- specification.md [REQ-002]
- analysis/pseudocode/qwen-device-flow.md
- Example data from specification

## Test Requirements
Create packages/core/src/auth/qwen-device-flow.spec.ts with 18-20 behavioral tests.

## Required Test Scenarios

### Device Flow Initiation
```typescript
/**
 * @requirement REQ-002.1
 * @scenario Initiate device authorization
 * @given Valid Qwen OAuth config
 * @when initiateDeviceFlow() is called
 * @then Returns device code and verification URI
 * @and Response includes user code for display
 */

/**
 * @requirement REQ-002.3
 * @scenario Correct authorization endpoint
 * @given Qwen device flow instance
 * @when initiateDeviceFlow() makes request
 * @then Uses https://chat.qwen.ai/api/v1/oauth2/device/code
 */

/**
 * @requirement REQ-002.4
 * @scenario Uses correct client ID
 * @given Device flow request
 * @when sent to Qwen
 * @then Includes client_id: f0304373b74a44d2b584a3fb70ca9e56
 */
```

### PKCE Security
```typescript
/**
 * @requirement REQ-002.2
 * @scenario PKCE code challenge generation
 * @given Device flow initiation
 * @when PKCE is generated
 * @then Creates SHA-256 challenge from verifier
 * @and Verifier is cryptographically random
 */

/**
 * @requirement REQ-002.2
 * @scenario PKCE verifier storage
 * @given Device flow initiated with PKCE
 * @when polling for token
 * @then Uses same verifier for token exchange
 */
```

### Token Polling
```typescript
/**
 * @requirement REQ-002.1
 * @scenario Poll for authorization completion
 * @given Device code from initiation
 * @when pollForToken() called repeatedly
 * @then Continues until user authorizes
 * @and Returns access token on success
 */

/**
 * @requirement REQ-002.3
 * @scenario Token endpoint usage
 * @given Device code for polling
 * @when requesting token
 * @then Uses https://chat.qwen.ai/api/v1/oauth2/token
 */

/**
 * @requirement REQ-002.1
 * @scenario Respect polling interval
 * @given Server specifies 5 second interval
 * @when polling for token
 * @then Waits at least 5 seconds between requests
 */
```

### Token Refresh
```typescript
/**
 * @requirement REQ-002.5
 * @scenario Refresh token before expiry
 * @given Token expires in 30 seconds
 * @when refresh requested
 * @then Obtains new access token
 * @and Uses refresh token grant type
 */

/**
 * @requirement REQ-002.5
 * @scenario Automatic refresh buffer
 * @given Token with expiry time
 * @when checking if refresh needed
 * @then Triggers 30 seconds before expiry
 */
```

### Error Handling
```typescript
/**
 * @requirement REQ-002.1
 * @scenario Handle authorization denial
 * @given User denies authorization
 * @when polling for token
 * @then Returns specific denial error
 */

/**
 * @requirement REQ-002.1
 * @scenario Handle expired device code
 * @given Device code expired (15 min)
 * @when polling continues
 * @then Returns expiration error
 */

/**
 * @requirement REQ-002.1
 * @scenario Network failure handling
 * @given Network request fails
 * @when polling or refreshing
 * @then Retries with exponential backoff
 */
```

### Data Validation
```typescript
/**
 * @requirement REQ-002.1
 * @scenario Validate device code response
 * @given Response from authorization endpoint
 * @when parsing response
 * @then Validates all required fields present
 */

/**
 * @requirement REQ-002.1
 * @scenario Token response validation
 * @given Token response from endpoint
 * @when parsing token
 * @then Validates access_token and expiry
 */
```

## Forbidden Patterns
- NO mocking HTTP requests - use test server
- NO testing internal state
- NO checking method calls
- Real cryptographic operations for PKCE

## Verification
- All tests fail with NotYetImplemented
- Tests cover all REQ-002 requirements
- Each test has behavioral assertion
- Uses actual HTTP test server