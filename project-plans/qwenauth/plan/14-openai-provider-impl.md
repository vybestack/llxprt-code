# Phase 14: OpenAI Provider OAuth Implementation

## Objective
Implement OAuth support in OpenAIProvider to make all tests pass.

## Input
- Failing tests from phase 13
- analysis/pseudocode/openai-provider-oauth.md
- Existing OpenAIProvider code

## Implementation Requirements

### Authentication Resolution
```typescript
private async resolveAuthentication(): Promise<string | null> {
  // 1. Check command line --key flag
  if (this.cliApiKey) {
    return this.cliApiKey
  }
  
  // 2. Check environment variable
  const envKey = process.env.OPENAI_API_KEY
  if (envKey) {
    return envKey
  }
  
  // 3. Check OAuth token
  if (this.oauthManager) {
    const token = await this.oauthManager.getToken('qwen')
    if (token) {
      return token.access_token
    }
  }
  
  // 4. No authentication available
  return null
}
```

### OAuth Integration
```typescript
private async getOAuthToken(): Promise<string | null> {
  if (!this.oauthManager) {
    return null
  }
  
  // Get token with auto-refresh
  const token = await this.oauthManager.getToken('qwen')
  return token?.access_token || null
}
```

### Modified Constructor
```typescript
constructor(
  apiKey: string | undefined,
  model: string,
  config: Config,
  oauthManager?: OAuthManager
) {
  this.oauthManager = oauthManager
  
  // Resolve authentication
  const authKey = await this.resolveAuthentication()
  
  // Pass to OpenAI SDK as API key
  this.client = new OpenAI({
    apiKey: authKey || '',
    baseURL: process.env.OPENAI_BASE_URL,
    // ... other config
  })
}
```

### Authentication Check
```typescript
async isAuthenticated(): Promise<boolean> {
  const auth = await this.resolveAuthentication()
  return auth !== null
}
```

## Key Points
- OAuth token used exactly like API key
- OpenAI SDK handles Bearer token header
- Maintain backward compatibility
- Auto-refresh handled by OAuth manager

## Forbidden
- Do NOT break existing API key functionality
- No console.log statements
- No modifying OpenAI SDK behavior
- Must follow precedence order exactly

## Verification
- npm test packages/core/src/providers/openai-oauth.spec.ts
- npm test packages/core/src/providers/openai.spec.ts (existing tests still pass)
- All authentication methods work
- Precedence order correct