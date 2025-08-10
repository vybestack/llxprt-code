# Phase 08: Qwen Device Flow Implementation

## Objective
Implement QwenDeviceFlow to make all tests pass.

## Input
- Failing tests from phase 07
- analysis/pseudocode/qwen-device-flow.md
- specification.md schemas and endpoints

## Implementation Requirements

### Core Functionality
```typescript
class QwenDeviceFlow {
  private pkceVerifier: string
  
  async initiateDeviceFlow(): Promise<DeviceCodeResponse> {
    // 1. Generate PKCE verifier and challenge
    // 2. POST to https://chat.qwen.ai/api/v1/oauth2/device/code
    // 3. Include client_id: f0304373b74a44d2b584a3fb70ca9e56
    // 4. Store PKCE verifier for later use
    // 5. Return device code response
  }
  
  async pollForToken(deviceCode: string): Promise<OAuthToken> {
    // 1. POST to https://chat.qwen.ai/api/v1/oauth2/token
    // 2. Include device_code and PKCE verifier
    // 3. Handle pending/authorized/denied states
    // 4. Respect polling interval from response
    // 5. Return token on success
  }
  
  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    // 1. POST to token endpoint with refresh grant
    // 2. Include client_id and refresh_token
    // 3. Parse and validate response
    // 4. Calculate expiry with 30-second buffer
  }
}
```

### PKCE Implementation
```typescript
private generatePKCE(): { verifier: string, challenge: string } {
  // 1. Generate 32 random bytes
  // 2. Base64url encode for verifier
  // 3. SHA-256 hash verifier
  // 4. Base64url encode hash for challenge
  // Return both values
}
```

### Polling Logic
- Start with server-specified interval (5 seconds default)
- Exponential backoff on rate limit errors
- Maximum 15-minute timeout
- Handle all OAuth error codes

### Error Handling
- authorization_pending: Continue polling
- slow_down: Increase polling interval
- access_denied: User denied access
- expired_token: Device code expired

## Required HTTP Headers
```typescript
headers: {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept': 'application/json'
}
```

## Forbidden
- No console.log statements
- No modifying tests
- No skipping error cases
- Must validate all responses with Zod

## Verification
- npm test packages/core/src/auth/qwen-device-flow.spec.ts
- All tests pass
- PKCE correctly implemented
- Polling respects intervals