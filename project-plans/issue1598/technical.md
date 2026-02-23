# Bucket Failover Recovery — Technical Specification

## Scope

This document specifies implementation details for bucket failover recovery. For functional behavior, see `overview.md`.

## Modified Components

### 1. `BucketFailoverHandlerImpl` (packages/cli/src/auth/BucketFailoverHandlerImpl.ts)

#### New State
```typescript
private lastFailoverReasons: Record<string, BucketFailureReason> = {};
```

Tracks the classification result for each bucket during the most recent `tryFailover()` call. Cleared at the start of each call.

#### Modified: `tryFailover(context?: FailoverContext): Promise<boolean>`

**Signature unchanged.** Internal behavior updated to implement two-pass classification and foreground reauth.

**Pass 1: Classify the triggering bucket**

```typescript
// Clear reasons from previous attempt
this.lastFailoverReasons = {};

const currentBucket = this.sessionBucket ?? this.buckets[0];
let reason: BucketFailureReason;

if (context?.triggeringStatus === 429) {
  reason = 'quota-exhausted';
} else {
  // Attempt to get token for classification
  let token: OAuthToken | null = null;
  try {
    token = await this.oauthManager.getOAuthToken(this.provider, currentBucket);
  } catch (err) {
    // Token-store read error — log and classify as no-token for pragmatic recovery
    logger.warn(`Token read failed for ${this.provider}/${currentBucket}:`, err);
    reason = 'no-token';
  }

  if (token) {
    const nowSec = Math.floor(Date.now() / 1000);
    const remainingSec = token.expiry - nowSec;

    if (remainingSec <= 0) {
      // Token expired — attempt refresh
      try {
        const refreshed = await this.oauthManager.refreshOAuthToken(this.provider, currentBucket);
        if (refreshed) {
          logger.debug('Refresh succeeded for triggering bucket — no failover needed');
          return true;
        }
      } catch (err) {
        logger.debug('Refresh failed for triggering bucket:', err);
      }
      reason = 'expired-refresh-failed';
    } else {
      // Token not expired but call failed — fallback classification
      if (context?.triggeringStatus === 500 || context?.triggeringStatus === 503) {
        reason = 'quota-exhausted';
      } else {
        reason = 'no-token';
      }
    }
  } else {
    reason = 'no-token';
  }
}

this.lastFailoverReasons[currentBucket] = reason;
this.triedBucketsThisSession.add(currentBucket);
```

**Pass 2: Find next candidate bucket with valid/refreshable token**

```typescript
for (const bucket of this.buckets) {
  if (this.triedBucketsThisSession.has(bucket)) {
    this.lastFailoverReasons[bucket] = 'skipped';
    continue;
  }

  let token: OAuthToken | null = null;
  try {
    token = await this.oauthManager.getOAuthToken(this.provider, bucket);
  } catch (err) {
    logger.warn(`Token read failed for ${this.provider}/${bucket}:`, err);
    this.lastFailoverReasons[bucket] = 'no-token';
    continue;
  }

  if (!token) {
    this.lastFailoverReasons[bucket] = 'no-token';
    continue;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const remainingSec = token.expiry - nowSec;

  if (remainingSec <= 0) {
    // Token expired — attempt refresh
    try {
      const refreshed = await this.oauthManager.refreshOAuthToken(this.provider, bucket);
    if (refreshed) {
      this.sessionBucket = bucket;
      try {
        await this.oauthManager.setSessionBucket(this.provider, bucket);
      } catch (err) {
        logger.warn(`Failed to set session bucket during pass-2 refresh: ${err}`);
        // Continue anyway — setSessionBucket failure should not abort failover
      }
      logger.info(`Switched to bucket after refresh: ${bucket}`);
      return true;
    }
    } catch (err) {
      logger.debug(`Refresh failed for ${bucket}:`, err);
    }
    this.lastFailoverReasons[bucket] = 'expired-refresh-failed';
    continue;
  }

  // Valid token found — switch and succeed
  this.sessionBucket = bucket;
  try {
    await this.oauthManager.setSessionBucket(this.provider, bucket);
  } catch (err) {
    logger.warn(`Failed to set session bucket during pass-2 switch: ${err}`);
    // Continue anyway — setSessionBucket failure should not abort failover
  }
  logger.info(`Switched to bucket: ${bucket}`);
  return true;
}
```

**Pass 3: Foreground reauth for expired/missing tokens**

```typescript
// Find first bucket classified as expired-refresh-failed or no-token (not tried yet)
const candidateBucket = this.buckets.find(
  (b) =>
    !this.triedBucketsThisSession.has(b) &&
    (this.lastFailoverReasons[b] === 'expired-refresh-failed' || this.lastFailoverReasons[b] === 'no-token')
);

if (candidateBucket) {
  try {
    logger.info(`Attempting foreground reauth for bucket: ${candidateBucket}`);
    await this.oauthManager.authenticate(this.provider, candidateBucket);
    
    // Verify token exists after reauth
    const token = await this.oauthManager.getOAuthToken(this.provider, candidateBucket);
    if (!token) {
      logger.warn(`Foreground reauth succeeded but token is null for bucket: ${candidateBucket}`);
      this.lastFailoverReasons[candidateBucket] = 'reauth-failed';
      this.triedBucketsThisSession.add(candidateBucket);
    } else {
      this.sessionBucket = candidateBucket;
      try {
        await this.oauthManager.setSessionBucket(this.provider, candidateBucket);
      } catch (err) {
        logger.warn(`Failed to set session bucket during pass-3 reauth: ${err}`);
        // Continue anyway — setSessionBucket failure should not abort failover
      }
      logger.info(`Foreground reauth succeeded for bucket: ${candidateBucket}`);
      return true;
    }
  } catch (err) {
    logger.warn(`Foreground reauth failed for bucket ${candidateBucket}:`, err);
    this.lastFailoverReasons[candidateBucket] = 'reauth-failed';
    this.triedBucketsThisSession.add(candidateBucket);
  }
}

logger.warn('All buckets exhausted — failover unsuccessful');
return false;
```

#### New Method: `getLastFailoverReasons(): Record<string, BucketFailureReason>`

Returns the classification results from the most recent `tryFailover()` call.

```typescript
getLastFailoverReasons(): Record<string, BucketFailureReason> {
  return { ...this.lastFailoverReasons };
}
```

### 2. `RetryOrchestrator` (packages/core/src/providers/retryOrchestrator.ts)

#### Modified: Error Handling in Retry Loop

When `tryFailover()` returns `false`, construct `AllBucketsExhaustedError` with reasons:

```typescript
const failoverHandler = config.getBucketFailoverHandler?.();
const bucketFailureReasons = failoverHandler?.getLastFailoverReasons?.() ?? {};

throw new AllBucketsExhaustedError(
  providerName,
  failoverHandler?.getBuckets?.() ?? [],
  bucketFailureReasons
);
```

#### Timeout Enforcement

Wrap foreground reauth in a timeout using `Promise.race`:

```typescript
const REAUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

async function tryFailoverWithTimeout(
  failoverHandler: BucketFailoverHandler,
  context?: FailoverContext
): Promise<boolean> {
  const timeoutPromise = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      logger.warn('Foreground reauth timed out after 5 minutes');
      resolve(false);
    }, REAUTH_TIMEOUT_MS);
    // Store timer reference if abort support is added later
  });

  const failoverPromise = failoverHandler.tryFailover(context);

  const result = await Promise.race([failoverPromise, timeoutPromise]);
  return result;
}
```

**Note**: The timeout does not cancel the in-flight `authenticate()` call because `OAuthManager.authenticate()` does not currently support abort signals. This is a known limitation. The timeout ensures the retry loop doesn't hang indefinitely.

### 3. `AllBucketsExhaustedError` (packages/core/src/providers/errors.ts)

#### Modified Constructor

```typescript
export class AllBucketsExhaustedError extends Error {
  constructor(
    public readonly providerName: string,
    public readonly buckets: string[],
    public readonly bucketFailureReasons: Record<string, BucketFailureReason> = {}
  ) {
    super(
      `All API key buckets exhausted for ${providerName}: ${buckets.join(', ')}`
    );
    this.name = 'AllBucketsExhaustedError';
  }
}
```

The `bucketFailureReasons` parameter is **optional** (defaults to empty record). No breaking change for existing call sites.

#### New Export: `BucketFailureReason` Type

```typescript
export type BucketFailureReason =
  | 'quota-exhausted'
  | 'expired-refresh-failed'
  | 'reauth-failed'
  | 'no-token'
  | 'skipped';
```

### 4. `BucketFailoverHandler` Interface (packages/core/src/config/config.ts)

#### New Optional Method

```typescript
export interface BucketFailoverHandler {
  getBuckets(): string[];
  getCurrentBucket(): string | undefined;
  tryFailover(context?: FailoverContext): Promise<boolean>;
  isEnabled(): boolean;
  resetSession(): void;
  reset(): void;
  getLastFailoverReasons?(): Record<string, BucketFailureReason>;
}
```

The method is **optional** (`?`) to avoid breaking existing implementations. The CLI implementation always provides it.

### 5. Config Interface (packages/core/src/config/config.ts)

Import `BucketFailureReason` from errors module:

```typescript
import type { BucketFailureReason } from '../providers/errors.js';
```

## Instantiation Sites

`BucketFailoverHandlerImpl` is instantiated in **two production methods** of `OAuthManager`:

1. **`OAuthManager.getOAuthToken()`** (line ~991 in `packages/cli/src/auth/oauth-manager.ts`)
   - Called during token acquisition
   - Sets up failover handler if multiple buckets are configured

2. **`OAuthManager.authenticate()`** (line ~2343 in `packages/cli/src/auth/oauth-manager.ts`)
   - Called after successful multi-bucket authentication
   - Sets up failover handler for newly authenticated buckets

Both sites construct the handler as:
```typescript
const handler = new BucketFailoverHandlerImpl(
  buckets,
  providerName,
  this
);
config.setBucketFailoverHandler(handler);
```

## State Management

### `triedBucketsThisSession`
- Tracks buckets attempted during the current API request
- Reset is **not automatic** — the caller (RetryOrchestrator) must call `resetSession()` at the start of each request
- Prevents redundant reauth attempts within a single request

### `lastFailoverReasons`
- Records why each bucket was classified during the most recent `tryFailover()` call
- **Cleared at the start of each `tryFailover()` call** to avoid carrying over stale reasons
- Used to populate `AllBucketsExhaustedError.bucketFailureReasons`

### `sessionBucket`
- Tracks the currently active bucket
- Persists across requests within a session
- Reset via `resetSession()` or `reset()`

## Error Handling

### Token-Store Read Failures

If `getOAuthToken()` throws an exception (e.g., I/O error, JSON parse error), the handler:
1. Logs the error with `logger.warn()` for diagnostics
2. Classifies the bucket as `no-token` for pragmatic recovery
3. Continues to the next bucket or attempts foreground reauth

This is a **pragmatic simplification** — we do not claim semantic equivalence between a missing token and a corrupted token store. However, both require reauth to recover, so the classification enables the same recovery path.

### Malformed Token Objects

If a token object is missing the `expiry` field or has an invalid value:
- The handler treats it as expired and attempts refresh
- If refresh fails, it is classified as `expired-refresh-failed`
- Foreground reauth is attempted in pass 3

### setSessionBucket Failures

If `setSessionBucket()` throws an exception during pass-2 or pass-3 bucket switch:
- The handler logs the error with `logger.warn()` for diagnostics
- The handler continues with failover (does not abort the process)
- The bucket switch is still considered successful if the token validation passed

## Testing

### New Test Cases

1. **Classification accuracy**:
   - 429 status → `quota-exhausted`
   - Expired token + refresh fails → `expired-refresh-failed`
   - Expired token + refresh succeeds → return `true` immediately
   - `getOAuthToken` returns `null` → `no-token`
   - Token-store read exception → `no-token` (logged)
   - Bucket already tried → `skipped`
   - Malformed token (missing `expiry`) → handle gracefully

2. **Rotation logic**:
   - Rotate through all buckets when first fails
   - Skip buckets already tried
   - Stop at first valid bucket

3. **Foreground reauth**:
   - Attempt reauth for `expired-refresh-failed` and `no-token` buckets
   - Verify token exists after reauth via `getOAuthToken`
   - Classify as `reauth-failed` if reauth fails or token is null
   - Skip buckets already tried
   - Handle `setSessionBucket` failures gracefully

4. **State management**:
   - `lastFailoverReasons` cleared at start of each `tryFailover()` call
   - `triedBucketsThisSession` reset properly

5. **Near-expiry tokens**:
   - Tokens returned by `getOAuthToken()` accepted even if near-expiry
   - 30-second threshold used only for NULL classification, not for rejecting returned tokens
   - Token field name is `expiry`, not `expiresAt`

6. **Error reporting**:
   - `AllBucketsExhaustedError` includes all failure reasons
   - Reasons match actual classification
   - Optional parameter works correctly (existing call sites unchanged)

7. **Timeout enforcement**:
   - 5-minute timeout for foreground reauth
   - Retry loop does not hang indefinitely

8. **Abort-during-reauth**: Known limitation to test later when abort support is added to `OAuthManager.authenticate()`

### Existing Tests (Regression)

All existing `BucketFailoverHandlerImpl` tests must pass without modification to ensure backward compatibility.

## Known Limitations

1. **Abort support**: `OAuthManager.authenticate()` does not currently support abort signals. The 5-minute timeout enforced by `RetryOrchestrator` serves as the de facto abort mechanism. If the user cancels the retry loop, the in-flight reauth operation may continue in the background but will not affect the outcome of the current request.

2. **Token-store read errors**: Classified as `no-token` for pragmatic recovery. The actual error is logged but not exposed in `AllBucketsExhaustedError`.

3. **Malformed tokens**: Missing or invalid `expiry` fields are treated as expired tokens. No explicit validation is performed.

4. **setSessionBucket failures**: Logged but do not abort the failover process. The bucket switch is considered successful if token validation passed.
