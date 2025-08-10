# Phase 04: Token Store TDD Tests

## Objective
Write comprehensive behavioral tests for multi-provider token storage.

## Input
- specification.md [REQ-003]
- analysis/pseudocode/token-store.md
- Example data from specification

## Test Requirements
Create packages/core/src/auth/token-store.spec.ts with 15-20 behavioral tests.

## Required Test Scenarios

### Token CRUD Operations
```typescript
/**
 * @requirement REQ-003.1
 * @scenario Save token for new provider
 * @given Empty token store
 * @when saveToken('qwen', validToken) is called
 * @then Token is persisted to ~/.llxprt/oauth/qwen.json
 * @and File has 0600 permissions
 */

/**
 * @requirement REQ-003.1
 * @scenario Retrieve saved token
 * @given Token saved for 'qwen' provider
 * @when getToken('qwen') is called
 * @then Returns the saved token with all fields
 */

/**
 * @requirement REQ-003.3
 * @scenario Token structure validation
 * @given Token with access_token, refresh_token, expiry
 * @when saveToken is called
 * @then All fields are preserved in storage
 */
```

### Multi-Provider Scenarios
```typescript
/**
 * @requirement REQ-003.1
 * @scenario Multiple providers coexist
 * @given Tokens saved for 'qwen' and 'gemini'
 * @when getToken('qwen') is called
 * @then Returns only qwen token, gemini unaffected
 */

/**
 * @requirement REQ-003.1
 * @scenario List all authenticated providers
 * @given Tokens for 'qwen', 'gemini' exist
 * @when listProviders() is called
 * @then Returns ['gemini', 'qwen'] sorted
 */
```

### Security & Permissions
```typescript
/**
 * @requirement REQ-003.2
 * @scenario Secure file permissions
 * @given New token being saved
 * @when saveToken creates file
 * @then File has 0600 (owner read/write only)
 */

/**
 * @requirement REQ-003.4
 * @scenario Correct storage path
 * @given Token for provider 'qwen'
 * @when saved to filesystem
 * @then Path is ~/.llxprt/oauth/qwen.json
 */
```

### Error Handling
```typescript
/**
 * @requirement REQ-003.1
 * @scenario Get token for unauthenticated provider
 * @given No token exists for 'anthropic'
 * @when getToken('anthropic') is called
 * @then Returns null, no error thrown
 */

/**
 * @requirement REQ-003.2
 * @scenario Handle corrupted token file
 * @given Malformed JSON in token file
 * @when getToken is called
 * @then Returns null and logs warning
 */
```

### Token Updates
```typescript
/**
 * @requirement REQ-003.3
 * @scenario Update existing token
 * @given Existing token for 'qwen'
 * @when saveToken with new token called
 * @then Old token replaced completely
 */

/**
 * @requirement REQ-003.1
 * @scenario Remove provider token
 * @given Token exists for 'qwen'
 * @when removeToken('qwen') called
 * @then File deleted, getToken returns null
 */
```

## Forbidden Patterns
- NO mock filesystem - use real temp directories
- NO testing internal file operations
- NO checking mock was called
- NO structure-only assertions
- Each test must verify actual behavior with real data

## Verification
- All tests fail with NotYetImplemented
- Each test has @requirement tag
- Tests cover all REQ-003 requirements
- Real file I/O in tests (using temp dir)