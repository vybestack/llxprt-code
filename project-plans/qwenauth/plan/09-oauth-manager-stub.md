# Phase 09: OAuth Manager Stub

## Objective
Create minimal skeleton for multi-provider OAuth coordination.

## Input
- specification.md [REQ-001, REQ-003]
- analysis/pseudocode/oauth-manager.md

## Tasks
1. Create packages/cli/src/auth/oauth-manager.ts
2. Define OAuthManager class for coordinating providers
3. All methods throw new Error('NotYetImplemented')

## Required Structure
```typescript
interface OAuthProvider {
  name: string
  initiateAuth(): Promise<void>
  getToken(): Promise<OAuthToken | null>
  refreshIfNeeded(): Promise<OAuthToken | null>
}

class OAuthManager {
  private providers: Map<string, OAuthProvider>
  private tokenStore: TokenStore
  
  registerProvider(provider: OAuthProvider): void {
    throw new Error('NotYetImplemented')
  }
  
  async authenticate(providerName: string): Promise<void> {
    throw new Error('NotYetImplemented')
  }
  
  async getAuthStatus(): Promise<AuthStatus[]> {
    throw new Error('NotYetImplemented')
  }
  
  async getToken(providerName: string): Promise<OAuthToken | null> {
    throw new Error('NotYetImplemented')
  }
  
  getSupportedProviders(): string[] {
    throw new Error('NotYetImplemented')
  }
}
```

## Files to Create
- packages/cli/src/auth/oauth-manager.ts
- packages/cli/src/auth/types.ts (if needed)

## Verification
- TypeScript compiles
- All methods present
- Provider registration interface defined
- No implementation logic