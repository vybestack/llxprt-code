# PLAN-20260129issue1151: 403 OAuth Token Revoked - Bucket Failover Not Triggering

## 1. Overview

### Problem Statement

Issue #1151 reports that when Anthropic returns a 403 `permission_error` with message "OAuth token has been revoked", the bucket failover is NOT triggering as expected. This is despite PR #1125 being merged to fix the closely related issue #1123.

### Root Cause Analysis

There are **two distinct problems** causing this failure:

#### Problem 1: Failover Handler Not Wired at Runtime

The `BucketFailoverHandler` may not be properly attached to the runtime config when the 403 error occurs. The AnthropicProvider looks for the handler in multiple config sources:

```typescript
let failoverHandler = runtimeConfig?.getBucketFailoverHandler?.();
if (!failoverHandler && optionsConfig) {
  failoverHandler = optionsConfig.getBucketFailoverHandler?.();
}
if (!failoverHandler && globalConfig) {
  failoverHandler = globalConfig.getBucketFailoverHandler?.();
}
```

If none of these config instances have the handler set, the failover returns `null` and no failover is attempted. This can happen when:
- The user re-authenticates (`/auth anthropic login`) without reloading the profile
- The config getter (`setConfigGetter`) is not properly wired during runtime initialization
- The profile is loaded before `OAuthManager.setConfigGetter` is called

#### Problem 2: Multi-Instance Token Refresh Race Condition

When running multiple llxprt instances sharing the same OAuth token files:

1. Multiple instances share tokens in `~/.llxprt/oauth/anthropic~bucket.json`
2. When tokens expire, multiple instances may try to refresh simultaneously
3. Instance A refreshes successfully → gets new tokens, old refresh token invalidated
4. Instance B tries to refresh with the now-invalidated refresh token
5. Anthropic's OAuth 2.1 sees this as refresh token replay attack → **revokes entire session**
6. Both instances now have revoked tokens, neither can recover

The codebase currently:
- Uses atomic file writes (temp + rename)
- Caches tokens in memory per instance
- **No file locking** for concurrent access
- **No inter-process coordination**
- **No "already refreshed" re-check** after acquiring lock

### Solution Overview

1. **Problem 1 Fix**: Ensure the `BucketFailoverHandler` is always wired when loading bucketed profiles
2. **Problem 2 Fix**: Implement file locking around token refresh operations to prevent race conditions

### TDD Approach

All implementation follows strict Test-Driven Development:
1. **Write failing tests first** - Define expected behavior before implementation
2. **Run tests to prove they fail** - Verify tests are actually testing something
3. **Implement the minimum code to pass** - Make tests green
4. **Refactor if needed** - Clean up while keeping tests green

---

## 2. Implementation Phases

### Phase 1: Ensure Failover Handler is Always Wired

#### Purpose
Guarantee that when a bucketed profile is loaded, the `BucketFailoverHandler` is properly set on the config and accessible to providers during API calls.

#### Files to Modify

1. **`packages/cli/src/auth/oauth-manager.ts`**
   - Ensure `BucketFailoverHandlerImpl` is created and set on config during `getOAuthToken()` even when the config was set after initial profile load
   - Add validation that logs a warning if buckets are configured but no config is available

2. **`packages/cli/src/runtime/runtimeSettings.ts`**
   - Ensure `oauthManager.setConfigGetter()` is called earlier in the initialization sequence
   - Add defensive re-wiring when profile is reloaded

3. **`packages/cli/src/config/profileBootstrap.ts`**
   - After profile load, explicitly trigger failover handler creation if buckets are configured

#### Step 1: Write Failing Tests

Create `packages/cli/src/auth/oauth-manager.failover-wiring.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuthManager } from './oauth-manager.js';
import { Config } from '@anthropic-ai/core';

describe('OAuthManager failover handler wiring', () => {
  describe('handler creation on getOAuthToken', () => {
    it('should create BucketFailoverHandler when profile has multiple buckets', async () => {
      // Setup: OAuthManager with config getter, profile with 2+ buckets
      // Action: Call getOAuthToken
      // Assert: config.getBucketFailoverHandler() returns a handler
      // Assert: handler.getBuckets() matches profile buckets
    });

    it('should reuse existing handler if buckets match', async () => {
      // Setup: OAuthManager with existing handler for same buckets
      // Action: Call getOAuthToken twice
      // Assert: setBucketFailoverHandler called only once
    });

    it('should recreate handler if bucket list changes', async () => {
      // Setup: OAuthManager with handler for buckets [A, B]
      // Action: Change profile to buckets [A, B, C], call getOAuthToken
      // Assert: New handler created with [A, B, C]
    });
  });

  describe('handler availability after re-auth', () => {
    it('should have failover handler available after auth login and profile load', async () => {
      // Setup: Load profile, simulate auth logout/login cycle
      // Action: Reload profile, call getOAuthToken
      // Assert: Handler is available and functional
    });

    it('should warn if buckets configured but no config available', async () => {
      // Setup: OAuthManager without config getter, profile with buckets
      // Action: Call getOAuthToken
      // Assert: Warning logged about missing config
    });
  });

  describe('handler wiring during runtime initialization', () => {
    it('should set config getter before profile load completes', async () => {
      // This tests the initialization order in runtimeSettings.ts
      // Assert: setConfigGetter is called before profile activation
    });
  });
});
```

#### Step 2: Run Tests to Prove They Fail

```bash
npm run test -- packages/cli/src/auth/oauth-manager.failover-wiring.spec.ts
```

#### Step 3: Implement to Make Tests Pass

1. **In `oauth-manager.ts` `getOAuthToken()`:**
   ```typescript
   // BEFORE token retrieval, ensure handler is wired
   if (profileBuckets.length > 1 && config) {
     const existingHandler = config.getBucketFailoverHandler?.();
     if (!existingHandler || !bucketsMatch(existingHandler.getBuckets(), profileBuckets)) {
       const handler = new BucketFailoverHandlerImpl(profileBuckets, providerName, this);
       config.setBucketFailoverHandler(handler);
       logger.debug(() => `[issue1151] Ensured BucketFailoverHandler is set for ${providerName}`);
     }
   }
   ```

2. **In `runtimeSettings.ts` `registerCliProviderInfrastructure()`:**
   ```typescript
   // Move setConfigGetter call to be synchronous and immediate
   oauthManager.setConfigGetter(() => config);
   logger.debug(() => `[issue1151] Config getter set on OAuthManager`);
   ```

3. **In `profileBootstrap.ts` after profile activation:**
   ```typescript
   // Trigger handler creation by touching OAuth token (if OAuth profile)
   if (profile.auth?.type === 'oauth' && profile.auth.buckets?.length > 1) {
     const oauthManager = getCliOAuthManager();
     if (oauthManager) {
       await oauthManager.getOAuthToken(profile.provider);
       logger.debug(() => `[issue1151] Failover handler ensured after profile load`);
     }
   }
   ```

#### Step 4: Run Tests to Prove They Pass

```bash
npm run test -- packages/cli/src/auth/oauth-manager.failover-wiring.spec.ts
```

#### Verification Criteria
- [ ] All new tests pass
- [ ] After `/profile load bucketed-profile`, handler is available
- [ ] After `/auth anthropic login` + `/profile load`, handler is available
- [ ] Debug logs show handler creation at appropriate times
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

---

### Phase 2: Implement File Locking for Token Refresh

#### Purpose
Prevent multiple llxprt instances from simultaneously refreshing the same OAuth token, which triggers Anthropic's refresh token replay detection and session revocation.

#### Files to Modify/Create

1. **`packages/cli/src/auth/OAuthTokenStore.ts`** (or the relevant token store file)
   - Add `acquireRefreshLock(provider, bucket)` method
   - Add `releaseRefreshLock(provider, bucket)` method
   - Implement using `.lock` file with timeout and stale detection

2. **`packages/cli/src/auth/oauth-manager.ts`**
   - Wrap token refresh in lock acquisition
   - Re-read token from disk after acquiring lock (another process may have refreshed)
   - If token is now valid, skip refresh and use the new token

#### Step 1: Write Failing Tests

Create/extend `packages/cli/src/auth/oauth-manager.concurrency.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OAuthTokenStore } from './OAuthTokenStore.js';
import { OAuthManager } from './oauth-manager.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('OAuthManager token refresh locking', () => {
  let tempDir: string;
  let tokenStore: OAuthTokenStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oauth-lock-test-'));
    tokenStore = new OAuthTokenStore(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('lock acquisition', () => {
    it('should acquire lock before refreshing token', async () => {
      // Setup: Token store with valid token
      // Action: Trigger refresh
      // Assert: Lock file created before refresh API call
    });

    it('should wait for lock if another process holds it', async () => {
      // Setup: Create lock file manually (simulating another process)
      // Action: Try to acquire lock
      // Assert: Waits and retries until lock available or timeout
    });

    it('should timeout lock acquisition after configurable period', async () => {
      // Setup: Create persistent lock file
      // Action: Try to acquire lock with short timeout
      // Assert: Returns false after timeout, no deadlock
    });

    it('should detect and break stale locks', async () => {
      // Setup: Create lock file with old mtime (>30s ago)
      // Action: Try to acquire lock
      // Assert: Stale lock broken, new lock acquired
    });
  });

  describe('token re-check after lock', () => {
    it('should re-read token after acquiring lock', async () => {
      // Setup: Expired token, mock refresh
      // Action: Acquire lock, refresh
      // Assert: Token re-read from disk after lock acquired
    });

    it('should skip refresh if token is now valid', async () => {
      // Setup: Expired token, another process refreshes while waiting for lock
      // Action: Acquire lock
      // Assert: Detects token is now valid, skips refresh, uses new token
    });

    it('should proceed with refresh if token still expired', async () => {
      // Setup: Expired token that stays expired
      // Action: Acquire lock, check token
      // Assert: Proceeds with refresh
    });
  });

  describe('lock release', () => {
    it('should release lock after successful refresh', async () => {
      // Setup: Acquire lock, refresh successfully
      // Assert: Lock file deleted
    });

    it('should release lock on refresh failure', async () => {
      // Setup: Acquire lock, refresh fails
      // Assert: Lock file still deleted
    });

    it('should release lock in finally block', async () => {
      // Setup: Acquire lock, throw exception during refresh
      // Assert: Lock file deleted despite exception
    });
  });
});
```

#### Step 2: Run Tests to Prove They Fail

```bash
npm run test -- packages/cli/src/auth/oauth-manager.concurrency.spec.ts
```

#### Step 3: Implement to Make Tests Pass

1. **Lock file mechanism in `OAuthTokenStore.ts`:**
   ```typescript
   private getLockPath(provider: string, bucket?: string): string {
     const tokenPath = this.getTokenPath(provider, bucket);
     return `${tokenPath}.lock`;
   }

   async acquireRefreshLock(
     provider: string,
     options?: { waitMs?: number; staleMs?: number; bucket?: string }
   ): Promise<boolean> {
     const lockPath = this.getLockPath(provider, options?.bucket);
     const waitMs = options?.waitMs ?? 10000;  // 10 second default wait
     const staleMs = options?.staleMs ?? 30000; // 30 second stale threshold
     const startTime = Date.now();

     while (Date.now() - startTime < waitMs) {
       try {
         // Check for stale lock
         const stat = await fs.stat(lockPath).catch(() => null);
         if (stat && Date.now() - stat.mtimeMs > staleMs) {
           logger.debug(() => `[issue1151] Breaking stale lock: ${lockPath}`);
           await fs.unlink(lockPath).catch(() => {});
         }

         // Try to create lock file exclusively
         await fs.writeFile(lockPath, `${process.pid}
${Date.now()}`, { flag: 'wx' });
         logger.debug(() => `[issue1151] Lock acquired: ${lockPath}`);
         return true;
       } catch (err) {
         if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
           // Lock exists, wait and retry
           await new Promise(r => setTimeout(r, 100));
           continue;
         }
         throw err;
       }
     }

     logger.warn(`[issue1151] Lock acquisition timeout: ${lockPath}`);
     return false;
   }

   async releaseRefreshLock(provider: string, bucket?: string): Promise<void> {
     const lockPath = this.getLockPath(provider, bucket);
     try {
       await fs.unlink(lockPath);
       logger.debug(() => `[issue1151] Lock released: ${lockPath}`);
     } catch (err) {
       if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
         logger.warn(`[issue1151] Failed to release lock: ${lockPath}`);
       }
     }
   }
   ```

2. **Token refresh with locking in `oauth-manager.ts`:**
   ```typescript
   private async refreshTokenWithLock(
     providerName: string,
     bucket?: string
   ): Promise<OAuthToken | null> {
     const lockAcquired = await this.tokenStore.acquireRefreshLock(
       providerName,
       { waitMs: 10000, staleMs: 30000, bucket }
     );

     if (!lockAcquired) {
       logger.debug(() => `[issue1151] Lock timeout, checking if another process refreshed`);
       // Check if token is now valid (another process may have refreshed)
       const reloadedToken = await this.tokenStore.getToken(providerName, bucket);
       if (reloadedToken && reloadedToken.expiry > Date.now() / 1000 + 30) {
         logger.debug(() => `[issue1151] Token was refreshed by another process`);
         return reloadedToken;
       }
       return null; // Give up
     }

     try {
       // Re-read token AFTER acquiring lock
       const currentToken = await this.tokenStore.getToken(providerName, bucket);
       if (currentToken && currentToken.expiry > Date.now() / 1000 + 30) {
         // Another process refreshed while we waited for lock
         logger.debug(() => `[issue1151] Token already refreshed by another process`);
         return currentToken;
       }

       // Proceed with refresh
       const provider = this.oauthProviders.get(providerName);
       if (!provider || !currentToken?.refresh_token) {
         return null;
       }

       const newToken = await provider.refreshToken(currentToken.refresh_token);
       await this.tokenStore.saveToken(providerName, newToken, bucket);
       logger.debug(() => `[issue1151] Token refreshed successfully for ${providerName}/${bucket}`);
       return newToken;
     } finally {
       await this.tokenStore.releaseRefreshLock(providerName, bucket);
     }
   }
   ```

3. **Update existing refresh logic to use locked refresh:**
   ```typescript
   // In getOAuthToken(), replace direct refresh call with:
   if (token.expiry <= thirtySecondsFromNow) {
     const refreshedToken = await this.refreshTokenWithLock(providerName, bucketToUse);
     if (refreshedToken) {
       return refreshedToken;
     }
     // Refresh failed, trigger bucket failover
   }
   ```

#### Step 4: Run Tests to Prove They Pass

```bash
npm run test -- packages/cli/src/auth/oauth-manager.concurrency.spec.ts
```

#### Verification Criteria
- [ ] All new tests pass
- [ ] Lock files created in `~/.llxprt/oauth/` during refresh
- [ ] Lock files cleaned up after refresh completes
- [ ] Stale locks (>30s old) are broken
- [ ] Second instance waits for first to refresh
- [ ] Token re-read after lock acquisition prevents duplicate refresh
- [ ] No deadlocks when instance crashes while holding lock
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes


## 3. Files Affected Summary

### Core Changes (Problem 1 - Handler Wiring)

| File | Change |
|------|--------|
| `packages/cli/src/auth/oauth-manager.ts` | Ensure handler creation in `getOAuthToken()` |
| `packages/cli/src/runtime/runtimeSettings.ts` | Earlier `setConfigGetter` call |
| `packages/cli/src/config/profileBootstrap.ts` | Trigger handler creation after profile load |

### Core Changes (Problem 2 - File Locking)

| File | Change |
|------|--------|
| `packages/cli/src/auth/OAuthTokenStore.ts` | Add `acquireRefreshLock`, `releaseRefreshLock` |
| `packages/cli/src/auth/oauth-manager.ts` | Wrap refresh in lock, re-check token after lock |

### Test Files

| File | Purpose |
|------|---------|
| `packages/cli/src/auth/oauth-manager.failover-wiring.spec.ts` | Handler wiring tests |
| `packages/cli/src/auth/oauth-manager.concurrency.spec.ts` | File locking tests |

---

## 4. Verification Checklist

### Phase 1 Verification
- [ ] All new tests pass
- [ ] Handler is created when loading multi-bucket profile
- [ ] Handler persists after `/auth login` cycle
- [ ] Debug logs confirm handler creation
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

### Phase 2 Verification
- [ ] All new tests pass
- [ ] Lock files created during refresh
- [ ] Lock files cleaned up after refresh
- [ ] Stale lock detection works
- [ ] Second instance waits for first
- [ ] Token re-read prevents duplicate refresh
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

### End-to-End Verification
- [ ] Load bucketed profile → 403 error → automatic failover to next bucket
- [ ] Two instances running → both can operate without token revocation
- [ ] After re-auth → failover continues to work
- [ ] `npm run test` passes
- [ ] `npm run build` succeeds
- [ ] `node scripts/start.js --profile-load synthetic "write me a haiku"` works

---

## 5. Debug Logging Strategy

All new debug logging uses the `llxprt:bucket:failover` namespace:

```typescript
const logger = new DebugLogger('llxprt:bucket:failover');

// Handler wiring
logger.debug(() => `[issue1151] Ensured BucketFailoverHandler for ${provider}`);
logger.debug(() => `[issue1151] Config getter set on OAuthManager`);
logger.warn(`[issue1151] CRITICAL: No config available for failover handler`);

// Lock operations
logger.debug(() => `[issue1151] Lock acquired: ${lockPath}`);
logger.debug(() => `[issue1151] Lock released: ${lockPath}`);
logger.debug(() => `[issue1151] Breaking stale lock: ${lockPath}`);
logger.debug(() => `[issue1151] Token already refreshed by another process`);
```

Enable with: `LLXPRT_DEBUG=llxprt:bucket:failover`

---

## 6. Backward Compatibility

### No Breaking Changes

1. **Lock files**: New `.lock` files in `~/.llxprt/oauth/` are automatically created/cleaned
2. **Handler wiring**: More aggressive handler creation, but same interface
3. **Token refresh**: Same behavior, just with locking wrapper

### Migration

- No user action required
- Existing profiles work unchanged
- Existing tokens work unchanged

---

## 7. Risk Assessment

### Low Risk
- Handler wiring changes are additive and defensive
- Lock files use standard filesystem semantics
- All changes are in CLI package, not core

### Medium Risk
- Lock timeout could cause delays in edge cases (mitigated by 10s timeout)
- Stale lock detection relies on filesystem mtime (works on all major platforms)

### Mitigation
- Extensive test coverage for lock edge cases
- Debug logging for troubleshooting
- Graceful degradation if lock fails (continue without lock, log warning)
