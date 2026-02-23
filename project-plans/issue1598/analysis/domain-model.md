<!-- @plan PLAN-20260223-ISSUE1598.P01 -->
# Domain Model: Bucket Failover Recovery

**Plan ID**: PLAN-20260223-ISSUE1598  
**Created**: 2026-02-23  
**Purpose**: Define entities, state transitions, and error scenarios for bucket failover recovery

---

## Core Entities

### 1. Bucket
**Definition**: An API key identifier within a multi-key profile configuration.

**Properties**:
- `name: string` — Bucket identifier (e.g., "default", "claudius", "vybestack")
- `provider: string` — Provider name (e.g., "anthropic", "openai")
- `state: BucketState` — Current state of the bucket
- `reason?: BucketFailureReason` — Why the bucket is unavailable (if failed)
- `lastAttempt?: timestamp` — When the bucket was last tried

**States**:
- `AVAILABLE` — Has valid token, ready for use
- `EXPIRED_REFRESHABLE` — Token expired but can be refreshed automatically
- `EXPIRED_UNREFFRESHABLE` — Token expired and refresh failed
- `MISSING_TOKEN` — No token exists in store
- `QUOTA_EXHAUSTED` — 429 response received, quota limit reached
- `REAUTH_FAILED` — Foreground reauth attempted but failed
- `SKIPPED` — Already tried in this session

### 2. BucketFailureReason (Type)
**Definition**: Classification of why a bucket cannot be used.

**Values**:
- `"quota-exhausted"` — 429 response, rate limit hit
- `"expired-refresh-failed"` — Token expired AND refresh failed
- `"reauth-failed"` — Foreground reauth failed
- `"no-token"` — Token missing or read error
- `"skipped"` — Already tried in current request

### 3. FailoverContext
**Definition**: Context passed to `tryFailover()` to aid classification.

**Properties**:
- `triggeringStatus?: number` — HTTP status code that triggered failover (e.g., 429, 402, 401)

### 4. BucketFailoverHandler
**Definition**: Interface for bucket failover management.

**Methods**:
- `getBuckets(): string[]` — List of buckets in profile order
- `getCurrentBucket(): string | undefined` — Active bucket
- `tryFailover(context?: FailoverContext): Promise<boolean>` — Attempt failover
- `isEnabled(): boolean` — Whether failover is available (>1 bucket)
- `resetSession(): void` — Clear session state (triedBucketsThisSession)
- `reset(): void` — Full reset (session + sessionBucket)
- `getLastFailoverReasons?(): Record<string, BucketFailureReason>` — Optional: Get classification results

### 5. OAuthToken
**Definition**: Token structure from token store.

**Properties**:
- `access_token: string` — The actual token value
- `expiry: number` — Unix timestamp (seconds) when token expires
- `refresh_token?: string` — Optional refresh token
- `scope?: string` — Token scope

---

## State Transitions

### Bucket Lifecycle

```
           [Token Acquisition]
                  ↓
            AVAILABLE ←──────────────┐
                  │                  │
     [Token Expires]          [Successful]
                  │              [Refresh]
                  ↓                  │
        EXPIRED_REFRESHABLE ────────┘
                  │
          [Refresh Fails]
                  ↓
      EXPIRED_UNREFFRESHABLE
                  │
          [Reauth Attempt]
                  ↓
        ┌─── [Success] → AVAILABLE
        │
        └─── [Failure] → REAUTH_FAILED
```

### Failover State Machine

```
[API Request] → [Error Detected]
                      ↓
              [tryFailover Called]
                      ↓
           ┌──────────┴──────────┐
           │                     │
      [Pass 1:              [Immediate
    Classify Trigger]       Success]
           │                     ↓
    [Record Reason]          [Return true]
           ↓
      [Pass 2:
   Find Candidate]
           ↓
    ┌──────┴──────┐
    │             │
[Found Valid] [No Valid]
    │             │
[Switch &]    [Pass 3:
 Return]      Reauth]
    │             │
    ↓        ┌────┴────┐
[true]   [Found]   [None]
             │         │
         [Reauth]  [Return
          Try]      false]
             │
         ┌───┴───┐
     [Success] [Fail]
         │         │
     [true]   [Record &
               Continue]
```

---

## Error Scenarios

### Scenario 1: Single Bucket Quota Exhaustion
**Given**: Profile with one bucket  
**When**: API returns 429  
**Then**: No failover attempted, throw `AllBucketsExhaustedError`

### Scenario 2: Multi-Bucket Sequential Exhaustion
**Given**: Profile with 3 buckets  
**When**: Bucket A returns 429  
**Then**: 
1. Pass 1: Classify A as `quota-exhausted`
2. Pass 2: Try bucket B
3. If B valid → switch and succeed
4. If B also 429 → classify and try C
5. If all 429 → throw `AllBucketsExhaustedError` with all reasons

### Scenario 3: Expired Token with Successful Refresh
**Given**: Current bucket has expired token  
**When**: API call fails (non-429)  
**Then**:
1. Pass 1: Detect expired token, attempt refresh
2. If refresh succeeds → return `true` immediately (no failover needed)
3. If refresh fails → classify as `expired-refresh-failed`, proceed to Pass 2

### Scenario 4: Missing Token Requiring Reauth
**Given**: Bucket B has no token  
**When**: Pass 2 evaluates bucket B  
**Then**:
1. Classify B as `no-token`
2. Continue to Pass 3
3. Select B for foreground reauth
4. If reauth succeeds AND token exists → switch and succeed
5. If reauth fails → classify as `reauth-failed`, return `false`

### Scenario 5: Token Store Read Error
**Given**: `getOAuthToken()` throws exception  
**When**: Pass 1 or Pass 2 evaluates bucket  
**Then**:
1. Log error with `logger.warn()`
2. Classify bucket as `no-token` (pragmatic recovery)
3. Attempt foreground reauth in Pass 3

### Scenario 6: Bucket Already Tried (Loop Prevention)
**Given**: Bucket A tried earlier in this request  
**When**: Pass 2 encounters bucket A again  
**Then**:
1. Classify as `skipped`
2. Continue to next bucket

### Scenario 7: setSessionBucket Failure
**Given**: Valid token found, failover should succeed  
**When**: `setSessionBucket()` throws exception  
**Then**:
1. Log error with `logger.warn()`
2. Continue with failover (do not abort)
3. Bucket switch considered successful

### Scenario 8: Malformed Token (Missing expiry)
**Given**: Token object lacks `expiry` field  
**When**: Pass 1 or Pass 2 evaluates token  
**Then**:
1. Treat as expired
2. Attempt refresh
3. If refresh fails → classify as `expired-refresh-failed`

---

## Business Rules

### BR-1: Profile Order Preservation
**Rule**: Buckets MUST be evaluated in array index order from the profile configuration.  
**Rationale**: Predictable behavior; buckets earlier in array have higher priority.

### BR-2: Session Isolation
**Rule**: `triedBucketsThisSession` MUST be reset at request boundaries, not only on success.  
**Rationale**: Each new request should try all buckets; prior failures may have resolved.

### BR-3: Single Reauth Attempt Per Request
**Rule**: Pass 3 MUST select at most ONE bucket for foreground reauth.  
**Rationale**: Multiple reauth prompts in one request causes user fatigue.

### BR-4: Classification Finality
**Rule**: Once a bucket is classified in `lastFailoverReasons`, the classification persists until next `tryFailover()` call.  
**Rationale**: Error reporting needs stable reasons; no mid-flight changes.

### BR-5: Immediate Success on Refresh
**Rule**: If Pass 1 refresh succeeds, return `true` without Pass 2.  
**Rationale**: Current bucket recovered; no need to rotate.

### BR-6: 30-Second Near-Expiry Acceptance
**Rule**: Tokens with `expiry - now <= 30` but `> 0` MUST be accepted without refresh.  
**Rationale**: 30-second threshold is only for classifying NULL results, not rejecting returned tokens.

### BR-7: Proactive Renewal at 80% Lifetime
**Rule**: After successful token acquisition or refresh, schedule renewal at 80% of token lifetime if lifetime > 5 minutes.  
**Rationale**: Prevents mid-request expiration by renewing before expiry.

### BR-8: Proactive Renewal Failure Threshold
**Rule**: After 3 consecutive proactive renewal failures for a bucket, stop scheduling renewals until manual refresh succeeds.  
**Rationale**: Prevents infinite retry loops for permanently broken buckets.

---

## Data Flow Diagrams

### Failover Request Flow

```
RetryOrchestrator
      │
      │ (API error detected)
      ↓
bucketFailoverHandler.resetSession()  ← Reset at request boundary
      │
      ↓
bucketFailoverHandler.tryFailover(context)
      │
      ├─→ Pass 1: Classify triggering bucket
      │         ↓
      │   Record in lastFailoverReasons
      │         ↓
      ├─→ Pass 2: Find valid/refreshable bucket
      │         ↓
      │   (if found) setSessionBucket() → return true
      │         ↓
      ├─→ Pass 3: Foreground reauth
      │         ↓
      │   (if success) getOAuthToken() → validate → return true
      │         ↓
      └─→ (if all fail) return false
                ↓
      getLastFailoverReasons()
                ↓
      AllBucketsExhaustedError(reasons)
```

### Token Lifecycle with Proactive Renewal

```
[Token Acquired]
      │
      ↓
scheduleProactiveRenewal(provider, bucket, token)
      │
      ├─ lifetime < 5min? → No renewal
      └─ lifetime >= 5min → Schedule timer at 80%
                                    ↓
                          [Timer Fires]
                                    ↓
                          refreshOAuthToken()
                                    ↓
                          ┌─────────┴─────────┐
                     [Success]           [Failure]
                          │                   │
                  Reschedule 80%       Increment counter
                          │                   │
                          │             [Counter >= 3?]
                          │                   ↓
                          │              Stop scheduling
                          │                   │
                   [Next cycle]        [Wait for manual]
```

---

## Edge Cases

### Edge 1: Empty Bucket List
**Scenario**: Profile defines zero buckets  
**Handling**: `isEnabled()` returns `false`, `tryFailover()` returns `false`, `getCurrentBucket()` returns `undefined`

### Edge 2: All Buckets Skipped
**Scenario**: Every bucket in `triedBucketsThisSession` before Pass 2  
**Handling**: Pass 2 completes without finding candidate → Pass 3 has no reauth target → return `false`

### Edge 3: Reauth Timeout
**Scenario**: User does not complete reauth within 5 minutes  
**Handling**: `RetryOrchestrator` enforces timeout via `Promise.race`, classify as `reauth-failed`

### Edge 4: Concurrent tryFailover Calls
**Scenario**: Multiple requests call `tryFailover()` simultaneously  
**Handling**: Not protected by lock (each request has independent session state)

### Edge 5: getOAuthToken Returns Token with remainingSec = 0
**Scenario**: Token expiry exactly matches current time  
**Handling**: Treated as expired (`remainingSec <= 0`), attempt refresh

### Edge 6: Proactive Renewal Overlaps with Manual Refresh
**Scenario**: Timer fires while user is manually refreshing  
**Handling**: `refreshOAuthToken()` uses refresh lock to serialize; one succeeds, other may skip or fail

---

## Invariants

### INV-1: Classification Completeness
**Statement**: After `tryFailover()` returns `false`, `lastFailoverReasons` MUST contain entries for all buckets OR explain why some are missing (e.g., skipped).

### INV-2: No Duplicate Reauth
**Statement**: Within a single `tryFailover()` call, a bucket MUST NOT be reauth'd more than once.

### INV-3: Session Bucket Validity
**Statement**: If `sessionBucket` is set, it MUST correspond to a bucket in `buckets` array.

### INV-4: Reason Freshness
**Statement**: `lastFailoverReasons` MUST be cleared at the start of each `tryFailover()` call.

### INV-5: Proactive Renewal State Consistency
**Statement**: If a proactive renewal timer exists for a bucket, there MUST be an entry in `proactiveRenewalTimers` map AND `proactiveRenewalFailures` counter.

---

## Glossary Reminders

- **Session**: Single API request/response cycle (NOT user session)
- **Profile order**: Array index order from profile configuration
- **Near-expiry**: Token with `expiry <= now + 30` seconds
- **Proactive renewal**: Automatic token refresh before expiration (80% lifetime)
- **Foreground reauth**: User-interactive authentication flow triggered by failover
