# Phase 5: Add Debug Logging

## Problem
Current logging uses mix of console.log, console.debug, console.error instead of proper debug logging system.

## Solution

### 1. Use Existing Debug Logger
The codebase already has a `DebugLogger` class. Use it consistently.

### 2. Add Logging Points

#### Auth Resolution
**File**: `packages/core/src/providers/BaseProvider.ts`

```typescript
protected async getAuthToken(): Promise<string> {
  // Check cache first
  if (this.cachedAuthToken && ...) {
    this.logger.debug(() => `Auth cache hit for ${this.constructor.name}`);
    return this.cachedAuthToken;
  }
  
  this.logger.debug(() => `Auth cache miss for ${this.constructor.name}`);
  
  // Clear stale cache
  this.cachedAuthToken = undefined;
  this.authCacheTimestamp = undefined;
  
  // Resolve authentication
  const token = await this.authResolver.resolveAuthentication();
  this.logger.debug(() => 
    `Auth resolved for ${this.constructor.name}: ${token ? 'found' : 'none'}`
  );
  
  // ... rest of logic
}
```

#### Client Recreation
**File**: `packages/core/src/providers/anthropic/AnthropicProvider.ts`

```typescript
async updateClientWithResolvedAuth(): Promise<void> {
  const resolvedToken = await this.getAuthToken();
  
  this.logger.debug(() => 
    `Updating client - old auth: ${this._cachedAuthKey?.substring(0, 10)}, ` +
    `new auth: ${resolvedToken?.substring(0, 10)}`
  );
  
  if (this._cachedAuthKey !== resolvedToken) {
    this.logger.debug(() => 'Recreating Anthropic client with new auth');
    // ... recreate client
  }
}
```

#### Logout Operations
**File**: `packages/cli/src/auth/anthropic-oauth-provider.ts`

```typescript
async logout(): Promise<void> {
  this.logger.debug(() => 'Starting Anthropic OAuth logout');
  
  // ... revocation attempt
  this.logger.debug(() => 'Attempting token revocation');
  
  // ... token removal
  this.logger.debug(() => 'Removing token from storage');
  
  // ... cache clearing
  this.logger.debug(() => 'Clearing auth cache');
  
  this.logger.debug(() => 'Anthropic OAuth logout complete');
}
```

### 3. Remove Console.* Calls
Replace all console.log, console.debug, console.error in auth code with proper logger.

### 4. Make Logging Actionable
Include relevant context:
- Provider name
- Operation being performed
- Success/failure state
- Token prefixes (first 10 chars only)
- Cache hit/miss rates

## Testing
1. Set `DEBUG=llxprt:*` environment variable
2. Run through auth flows
3. Verify logging shows:
   - Cache hits and misses
   - Client recreation
   - Logout operations
   - Error details