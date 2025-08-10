# Phase 03: Token Store Stub Implementation

## Objective
Create minimal skeleton for multi-provider token storage that compiles.

## Input
- specification.md [REQ-003]
- analysis/pseudocode/token-store.md

## Tasks
1. Create packages/core/src/auth/token-store.ts
2. Define TokenStore interface with all methods
3. Implement MultiProviderTokenStore class
4. All methods throw new Error('NotYetImplemented')
5. Export all types and classes

## Implementation Requirements
```typescript
// Required structure (all methods throw NotYetImplemented)
interface TokenStore {
  saveToken(provider: string, token: OAuthToken): Promise<void>
  getToken(provider: string): Promise<OAuthToken | null>
  removeToken(provider: string): Promise<void>
  listProviders(): Promise<string[]>
}

class MultiProviderTokenStore implements TokenStore {
  // All methods: throw new Error('NotYetImplemented')
}
```

## Files to Create
- packages/core/src/auth/token-store.ts
- packages/core/src/auth/types.ts (token schemas)

## Verification
- TypeScript compiles with strict mode
- All exports match specification
- No logic beyond throwing NotYetImplemented
- Maximum 100 lines total