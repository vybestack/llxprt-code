# Phase 12: OpenAI Provider OAuth Extension Stub

## Objective
Extend OpenAIProvider to support OAuth tokens as authentication.

## Input
- specification.md [REQ-004]
- analysis/pseudocode/openai-provider-oauth.md
- Existing OpenAIProvider implementation

## Tasks
1. Modify packages/core/src/providers/openai.ts
2. Add OAuth support to authentication chain
3. New methods throw new Error('NotYetImplemented')

## Required Modifications
```typescript
class OpenAIProvider {
  private oauthManager?: OAuthManager
  
  // Existing constructor, add optional oauth manager
  constructor(
    apiKey?: string,
    model: string,
    config: Config,
    oauthManager?: OAuthManager
  ) {
    // Store oauth manager
    // Existing initialization
  }
  
  // New method for auth resolution
  private async resolveAuthentication(): Promise<string | null> {
    throw new Error('NotYetImplemented')
  }
  
  // New method to check OAuth availability
  private async getOAuthToken(): Promise<string | null> {
    throw new Error('NotYetImplemented')
  }
  
  // Override/extend existing auth check
  async isAuthenticated(): Promise<boolean> {
    throw new Error('NotYetImplemented')
  }
}
```

## Authentication Precedence (REQ-004.1)
1. --key flag (command line)
2. OPENAI_API_KEY environment variable
3. OAuth token from manager
4. Return null if none available

## Files to Modify
- packages/core/src/providers/openai.ts

## Verification
- TypeScript compiles
- Existing functionality preserved
- New OAuth methods present
- No implementation logic yet