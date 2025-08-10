# Phase 11: OAuth Manager Implementation

## Objective
Implement OAuthManager to make all tests pass.

## Input
- Failing tests from phase 10
- analysis/pseudocode/oauth-manager.md
- Token store from phase 05

## Implementation Requirements

### Core Functionality
```typescript
class OAuthManager {
  private providers = new Map<string, OAuthProvider>()
  private tokenStore: TokenStore
  
  registerProvider(provider: OAuthProvider): void {
    // Add provider to map by name
    // Validate provider has required methods
  }
  
  async authenticate(providerName: string): Promise<void> {
    // 1. Get provider from map
    // 2. Call provider.initiateAuth()
    // 3. Get token from provider
    // 4. Store token using tokenStore
    // 5. Handle errors gracefully
  }
  
  async getToken(providerName: string): Promise<OAuthToken | null> {
    // 1. Try to get token from store
    // 2. Check if token expired
    // 3. If expired, try refresh
    // 4. Update stored token if refreshed
    // 5. Return valid token or null
  }
  
  async getAuthStatus(): Promise<AuthStatus[]> {
    // 1. Get all registered providers
    // 2. For each, check token existence
    // 3. Calculate expiry time remaining
    // 4. Return status array
  }
}
```

### Token Refresh Logic
```typescript
private async refreshIfNeeded(
  provider: OAuthProvider, 
  token: OAuthToken
): Promise<OAuthToken | null> {
  // 1. Check if token expires soon (30 sec buffer)
  // 2. Call provider.refreshIfNeeded()
  // 3. Store new token if refreshed
  // 4. Return new or existing token
}
```

### Provider Coordination
- Providers are independent
- No shared state between providers
- Each provider manages own auth flow
- Manager only coordinates and stores

## Error Handling
- Unknown provider: Clear error message
- Auth failure: Propagate provider error
- Token refresh failure: Return null, log error

## Forbidden
- No console.log in production code
- No modifying provider internals
- No assumptions about provider implementation

## Verification
- npm test packages/cli/src/auth/oauth-manager.spec.ts
- All tests pass
- Multi-provider scenarios work
- Token refresh works correctly