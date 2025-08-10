# Phase 03: Fix Provider OAuth Integration

## Objective

Update providers to implement lazy OAuth triggering with proper authentication precedence chain. Ensure OpenAIProvider only uses Qwen OAuth for Qwen endpoints.

## Context

Providers currently may trigger OAuth immediately or not follow proper precedence. They need to check OAuth enablement, respect auth precedence, and only trigger OAuth when actually needed for API calls.

## Implementation Changes

### 1. GeminiProvider OAuth Integration

**Current issues:**
- May not check OAuth enablement properly
- May not follow auth precedence chain
- May trigger OAuth too early

**Required changes:**
- Check OAuth enablement before attempting OAuth
- Implement full auth precedence chain
- Only trigger OAuth when making API calls and no other auth available
- Handle OAuth flow asynchronously without blocking initialization

### 2. OpenAIProvider Endpoint Validation

**Current issues:**
- Uses Qwen OAuth regardless of baseURL
- No validation of endpoint compatibility

**Required changes:**
- Check if baseURL matches Qwen endpoints before using Qwen OAuth
- Validate endpoint compatibility
- Provide clear errors for mismatched configurations
- Fall back gracefully when OAuth can't be used

### 3. Authentication Precedence Implementation

**Priority order (highest to lowest):**
1. `/key` command key
2. `/keyfile` command keyfile
3. `--key` CLI argument
4. `--keyfile` CLI argument
5. Environment variables
6. OAuth (if enabled)

**Implementation:**
- Each provider checks methods in precedence order
- Stop at first available method
- Only attempt OAuth if enabled and no higher priority method exists

## Files to Modify

### Core Provider Files
- `packages/core/src/providers/gemini.ts` - Gemini provider OAuth integration
- `packages/core/src/providers/openai.ts` - OpenAI provider with endpoint validation
- `packages/core/src/providers/base-provider.ts` - Base auth precedence logic

### Supporting Files
- `packages/core/src/auth/precedence.ts` - Auth precedence utility
- `packages/core/src/config/endpoints.ts` - Endpoint validation utilities
- Provider-specific auth modules

## Implementation Details

### Base Provider Auth Precedence
```typescript
export abstract class BaseProvider {
  protected async getAuthToken(): Promise<string> {
    // Check precedence chain
    const token = await this.checkAuthPrecedence();
    if (token) return token;
    
    // Only attempt OAuth if enabled and no other auth available
    if (this.isOAuthEnabled() && this.supportsOAuth()) {
      return await this.triggerOAuth();
    }
    
    throw new Error('No authentication method available');
  }
  
  private async checkAuthPrecedence(): Promise<string | null> {
    // 1. /key command
    const keyFromCommand = await this.getCommandKey();
    if (keyFromCommand) return keyFromCommand;
    
    // 2. /keyfile command
    const keyFromFile = await this.getCommandKeyfile();
    if (keyFromFile) return keyFromFile;
    
    // 3. --key CLI arg
    const keyFromCli = this.getCliKey();
    if (keyFromCli) return keyFromCli;
    
    // 4. --keyfile CLI arg
    const keyFromCliFile = await this.getCliKeyfile();
    if (keyFromCliFile) return keyFromCliFile;
    
    // 5. Environment variables
    const keyFromEnv = this.getEnvKey();
    if (keyFromEnv) return keyFromEnv;
    
    return null;
  }
  
  protected abstract isOAuthEnabled(): boolean;
  protected abstract supportsOAuth(): boolean;
  protected abstract triggerOAuth(): Promise<string>;
}
```

### OpenAI Provider Endpoint Validation
```typescript
export class OpenAIProvider extends BaseProvider {
  protected supportsOAuth(): boolean {
    // Only support Qwen OAuth for Qwen endpoints
    return this.isQwenEndpoint(this.baseURL);
  }
  
  private isQwenEndpoint(baseURL: string): boolean {
    const qwenEndpoints = [
      'https://dashscope.aliyuncs.com',
      'https://api.qwen.com',
      // Add other Qwen endpoints
    ];
    
    return qwenEndpoints.some(endpoint => 
      baseURL.startsWith(endpoint)
    );
  }
  
  protected async getAuthToken(): Promise<string> {
    try {
      return await super.getAuthToken();
    } catch (error) {
      if (this.isOAuthEnabled() && !this.supportsOAuth()) {
        throw new Error(
          `Qwen OAuth is enabled but baseURL (${this.baseURL}) is not a Qwen endpoint. ` +
          `Use an API key instead or change the baseURL to a Qwen endpoint.`
        );
      }
      throw error;
    }
  }
}
```

### Lazy OAuth Triggering
```typescript
export class GeminiProvider extends BaseProvider {
  protected async triggerOAuth(): Promise<string> {
    // Check if we already have a valid token
    const cachedToken = await this.getCachedOAuthToken();
    if (cachedToken && !this.isTokenExpired(cachedToken)) {
      return cachedToken;
    }
    
    // Start OAuth flow only when needed
    console.log('Starting Qwen OAuth flow...');
    const token = await this.oauthManager.authenticate();
    
    // Cache the token
    await this.cacheOAuthToken(token);
    
    return token;
  }
  
  // Override to lazy-load auth
  async makeRequest(endpoint: string, data: any): Promise<any> {
    const token = await this.getAuthToken(); // Lazy auth here
    return super.makeRequest(endpoint, data, { 
      Authorization: `Bearer ${token}` 
    });
  }
}
```

## Expected Behavior Changes

### Before (Current - Incorrect)
- OAuth triggered immediately regardless of other auth methods
- OpenAI uses Qwen OAuth for all endpoints
- No precedence checking

### After (Fixed - Correct)
- OAuth only triggered when making API calls
- Full precedence chain respected
- OpenAI validates endpoints before OAuth
- Clear errors for misconfigurations

## Verification Steps

1. **Auth Precedence**
   - API key takes precedence over OAuth
   - CLI args take precedence over env vars
   - OAuth only used when enabled and no higher priority method

2. **Lazy Triggering**
   - OAuth not triggered during provider initialization
   - OAuth triggered only on first API call needing auth
   - Cached tokens reused appropriately

3. **Endpoint Validation**
   - OpenAI provider validates baseURL before OAuth
   - Clear error messages for endpoint mismatches
   - Graceful fallback to API key auth

## Success Criteria

- [ ] Providers respect full authentication precedence chain
- [ ] OAuth triggered lazily only when making API calls
- [ ] OpenAI provider validates Qwen endpoints before OAuth
- [ ] Clear error messages for configuration issues
- [ ] No blocking OAuth flows during initialization
- [ ] Proper token caching and reuse