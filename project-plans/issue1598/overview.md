# Bucket Failover Recovery — Functional Specification

## Overview

When a bucket exhausts its quota, the system should automatically try other buckets before giving up. Currently it throws `AllBucketsExhaustedError` after retries exhaust the **first** bucket, even when the profile defines fallback buckets.

This spec defines how `BucketFailoverHandlerImpl` recovers from bucket failure by rotating through available buckets and attempting foreground reauth when refresh fails.

## Goals

- Detect bucket quota exhaustion during API calls and classify the reason for each bucket's unavailability
- Rotate to the next available bucket automatically
- Attempt foreground reauth for buckets classified as `expired-refresh-failed` or `no-token`
- Report detailed failure reasons in `AllBucketsExhaustedError` to aid debugging
- Preserve existing behavior for single-bucket profiles

## Terminology

- **Bucket**: an API key identifier (e.g., `default`, `claudius`, `vybestack`)
- **Failover**: switching from a failed bucket to another bucket in the profile
- **Reauth**: foreground interactive authentication initiated by the failover handler to refresh credentials
- **Exhausted**: all buckets have been tried and classified as unavailable

## Bucket Failure Reasons

The system classifies bucket failures into five categories:

### 1. `quota-exhausted`
The bucket received a 429 response. Refresh is impossible, and further API calls to this bucket will fail until quota resets.

### 2. `expired-refresh-failed`
The token is expired and refresh failed. The system attempts foreground reauth as a fallback.

### 3. `reauth-failed`
Foreground reauth was attempted but failed. The bucket is skipped for this request.

### 4. `no-token`
No token exists in the store (i.e., the problem is potentially recoverable via re-authentication, not definitively quota). The system attempts foreground reauth.

**Note**: Token-store exceptions are also classified as `no-token` as a pragmatic simplification. The actual error is logged for diagnostics.

### 5. `skipped`
The bucket was skipped because it was already tried earlier (due to a prior attempt in the same request). This prevents redundant reauth attempts and infinite loops.

## User-Facing Behavior

### Multi-Bucket Profile
When a 429 error occurs on the active bucket:
1. The system classifies the failure reason and logs it
2. If another untried bucket exists, the system rotates to it and retries the request
3. If the new bucket has an expired or missing token, foreground reauth is attempted
4. If reauth succeeds, the request proceeds
5. If all buckets fail, the system throws `AllBucketsExhaustedError` with detailed reasons

### Single-Bucket Profile
Behavior unchanged. On 429:
1. Retry logic exhausts attempts
2. Throw `AllBucketsExhaustedError` (no failover because there is only one bucket)

## Failover Algorithm

### Triggering Conditions
Failover is triggered when:
- API call returns 429 (quota exhausted)
- Token is expired and refresh failed
- Token is missing (`getOAuthToken` returned `null`)

### Classification Logic

When `RetryOrchestrator` calls `tryFailover(context?)`:

**Pass 1: Classify triggering bucket**

1. If `context.triggeringStatus === 429`:
   - Classify as `quota-exhausted`
2. Else if token is expired:
   - Attempt refresh
   - If refresh succeeds: return `true` immediately (no failover needed)
   - If refresh fails: classify as `expired-refresh-failed`
3. Else if `getOAuthToken` returned `null`:
   - Classify as `no-token`
4. Else (defensive fallback):
   - Classify based on `context.triggeringStatus`:
     - 500, 503 → `quota-exhausted` (fallback classification for triggering bucket when status is not recognized)
     - Other → `no-token` (fallback classification)

**Pass 2: Find next candidate bucket**

Iterate remaining buckets in profile order (skipping already-tried buckets):

1. If bucket is in `triedBucketsThisSession`: classify as `skipped`, continue
2. Call `getOAuthToken(provider, bucket)`:
   - If read fails (exception): classify as `no-token`, continue
   - If `null`: classify as `no-token`, continue to pass 3
   - If token returned:
     - If expired (remainingSec <= 0):
       - Attempt refresh
       - If refresh succeeds: switch bucket, return `true`
       - If refresh fails: classify as `expired-refresh-failed`, continue to pass 3
     - Else: switch bucket, return `true`

**Pass 3: Foreground reauth for expired/missing tokens**

After pass 2, if no bucket with valid/refreshable token was found:

1. Find the first bucket (in profile order) classified as `expired-refresh-failed` or `no-token` (not in `triedBucketsThisSession`)
2. If found:
   - Attempt `oauthManager.authenticate(provider, bucket)` with 5-minute timeout
   - If succeeds: switch bucket, return `true`
   - If fails: classify as `reauth-failed`
3. If no candidate found or all reauth attempts fail: return `false`

All classifications are stored in `lastFailoverReasons` which is cleared at the start of each `tryFailover()` call.

### Abort Mechanism

**Known limitation**: `OAuthManager.authenticate()` does not currently support abort signals. The 5-minute timeout enforced by `RetryOrchestrator` serves as the de facto abort mechanism for foreground reauth. If the user cancels the retry loop (or the timeout expires), the in-flight reauth operation may continue in the background but will not affect the outcome of the current request.

### Token Near-Expiry Handling

Tokens with `expiry <= now + 30` seconds are considered near-expiry. In pass 1, if `getOAuthToken()` returns a token, it is accepted even if near-expiry. The 30-second threshold is used only for classification of NULL results, not for rejecting returned tokens.

### Session State
- `triedBucketsThisSession` tracks buckets attempted in **this API request** to prevent loops
- Reset on each `tryFailover()` call
- `lastFailoverReasons` records why each bucket failed; cleared at the start of each `tryFailover()` call

## Error Reporting

When all buckets fail, `AllBucketsExhaustedError` includes:
- **`message`**: human-readable summary
- **`bucketFailureReasons`**: record mapping bucket → `BucketFailureReason`

Example:
```typescript
{
  message: "All API key buckets exhausted for anthropic",
  bucketFailureReasons: {
    default: "quota-exhausted",
    claudius: "expired-refresh-failed",
    vybestack: "no-token"
  }
}
```

The `bucketFailureReasons` parameter to `AllBucketsExhaustedError` is optional (defaults to empty record). Existing call sites are unchanged.

## Interface Changes

### `BucketFailoverHandler` Interface

Add method:
```typescript
getLastFailoverReasons?(): Record<string, BucketFailureReason>;
```

This method is **optional** to avoid breaking existing implementations. The CLI implementation (`BucketFailoverHandlerImpl`) always provides it. `RetryOrchestrator` uses optional chaining (`?.()`) and falls back to an empty record if unavailable.

### `BucketFailureReason` Type

Exported from `packages/core/src/providers/errors.ts`:
```typescript
export type BucketFailureReason =
  | "quota-exhausted"
  | "expired-refresh-failed"
  | "reauth-failed"
  | "no-token"
  | "skipped";
```

The config interface in `config.ts` imports this type from `providers/errors.ts`.

### `AllBucketsExhaustedError` Constructor

Updated signature:
```typescript
constructor(
  providerName: string,
  buckets: string[],
  bucketFailureReasons?: Record<string, BucketFailureReason>
)
```

## Testing Strategy

### Unit Tests (BucketFailoverHandlerImpl)

1. **Classification accuracy**:
   - 429 → `quota-exhausted`
   - Expired token + refresh fails → `expired-refresh-failed`
   - `getOAuthToken` returns `null` → `no-token`
   - Token-store read exception → `no-token` (logged)
   - Bucket already tried → `skipped`
   - Malformed token objects (missing/invalid expiry field) → handle gracefully

2. **Rotation logic**:
   - Rotate through all buckets when quota exhausted
   - Skip buckets already tried in this session
   - Stop at first valid bucket

3. **Foreground reauth**:
   - Attempt reauth for `expired-refresh-failed` and `no-token` buckets
   - Classify as `reauth-failed` if reauth fails
   - Skip reauth for buckets already tried

4. **State management**:
   - `lastFailoverReasons` cleared at start of each `tryFailover()` call
   - `triedBucketsThisSession` reset properly

5. **Near-expiry tokens**:
   - Tokens returned by `getOAuthToken()` are accepted even if near-expiry
   - 30-second threshold used only for NULL classification

6. **Error reporting**:
   - `AllBucketsExhaustedError` includes all failure reasons
   - Reasons match actual classification

7. **Abort-during-reauth**: Known limitation to test later when abort support is added

### Integration Tests (RetryOrchestrator)

1. **End-to-end failover**:
   - 429 on bucket A → rotate to bucket B → request succeeds
   - 429 on bucket A → rotate to bucket B (expired) → refresh B → request succeeds
   - 429 on all buckets → `AllBucketsExhaustedError` with reasons

2. **Single-bucket profiles**:
   - No failover triggered (existing behavior preserved)

3. **Reauth flow**:
   - Bucket with `no-token` → foreground reauth → request succeeds
   - Reauth fails → next bucket tried
   - All reauths fail → `AllBucketsExhaustedError`
