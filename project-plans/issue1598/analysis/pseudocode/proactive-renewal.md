<!-- @plan PLAN-20260223-ISSUE1598.P02 -->
# Pseudocode: Proactive Token Renewal Fix

**Plan ID**: PLAN-20260223-ISSUE1598  
**Purpose**: Fix scheduleProactiveRenewal to prevent mid-request token expiration  
**Requirements**: REQ-1598-PR01 through PR06

---

## Current Bug (Before Fix)

```typescript
// BUG: Schedules renewal even for already-expired tokens
function scheduleProactiveRenewal(provider: string, bucket: string, token: OAuthToken) {
  const nowSec = Math.floor(Date.now() / 1000);
  const lifetime = token.expiry - nowSec;
  
  // BUG: lifetime can be NEGATIVE for expired tokens
  if (lifetime >= 300) {  // 5 minutes
    const renewalDelay = lifetime * 0.8 * 1000;  // 80% of lifetime
    // BUG: If lifetime is -600 (expired 10min ago), renewalDelay is -480000ms
    // Timer fires immediately OR becomes invalid
  }
}
```

---

## Fixed Algorithm: scheduleProactiveRenewal

```
1   // File: packages/cli/src/auth/oauth-manager.ts
2   
3   function scheduleProactiveRenewal(
4     provider: string,
5     bucket: string,
6     token: OAuthToken
7   ): void
8   
9   // Calculate token lifetime remaining
10  let nowSec = Math.floor(Date.now() / 1000)
11  let remainingSec = token.expiry - nowSec
12  
13  // Get or initialize failure counter for this bucket
14  if not this.proactiveRenewalFailures.has(provider + ":" + bucket) then
15    this.proactiveRenewalFailures.set(provider + ":" + bucket, 0)
16  end if
17  
18  let failureCount = this.proactiveRenewalFailures.get(provider + ":" + bucket)
19  
20  // Skip scheduling if failure threshold reached
21  if failureCount >= 3 then
22    logger.warn(`Proactive renewal disabled for ${provider}/${bucket} due to repeated failures`)
23    return
24  end if
25  
26  // FIX: Check remainingSec > 0 before comparing to 300
27  if remainingSec > 0 and remainingSec >= 300 then
28    // Schedule renewal at 80% of remaining lifetime
29    let renewalDelaySec = remainingSec * 0.8
30    let renewalDelayMs = renewalDelaySec * 1000
31    
32    logger.debug(`Scheduling proactive renewal for ${provider}/${bucket} in ${renewalDelaySec}s`)
33    
34    // Clear existing timer for this bucket if any
35    let timerKey = provider + ":" + bucket
36    if this.proactiveRenewalTimers.has(timerKey) then
37      clearTimeout(this.proactiveRenewalTimers.get(timerKey))
38    end if
39    
40    // Set new timer
41    let timer = setTimeout(async () => {
42      await handleProactiveRenewal(provider, bucket)
43    }, renewalDelayMs)
44    
45    this.proactiveRenewalTimers.set(timerKey, timer)
46  else
47    logger.debug(`Token lifetime too short for proactive renewal: ${remainingSec}s`)
48  end if
49  
50  end function
```

---

## Algorithm: handleProactiveRenewal (Timer Callback)

```
51  async function handleProactiveRenewal(provider: string, bucket: string): Promise<void>
52  
53  let timerKey = provider + ":" + bucket
54  
55  try
56    logger.info(`Proactive renewal triggered for ${provider}/${bucket}`)
57    
58    // Attempt refresh
59    let refreshed = await this.refreshOAuthToken(provider, bucket)
60    
61    if refreshed === true then
62      // Success — reset failure counter
63      this.proactiveRenewalFailures.set(timerKey, 0)
64      
65      // Get updated token
66      let token = await this.getOAuthToken(provider, bucket)
67      
68      if token !== null then
69        // Reschedule for next renewal
70        this.scheduleProactiveRenewal(provider, bucket, token)
71      else
72        logger.warn(`Token missing after successful refresh for ${provider}/${bucket}`)
73      end if
74    else
75      // Refresh returned false — increment failure counter
76      let currentCount = this.proactiveRenewalFailures.get(timerKey) ?? 0
77      this.proactiveRenewalFailures.set(timerKey, currentCount + 1)
78      logger.warn(`Proactive renewal failed for ${provider}/${bucket}, failure count: ${currentCount + 1}`)
79    end if
80    
81  catch error
82    // Exception during refresh — increment failure counter
83    let currentCount = this.proactiveRenewalFailures.get(timerKey) ?? 0
84    this.proactiveRenewalFailures.set(timerKey, currentCount + 1)
85    logger.error(`Proactive renewal exception for ${provider}/${bucket}:`, error)
86  finally
87    // Remove timer reference
88    this.proactiveRenewalTimers.delete(timerKey)
89  end try
90  
91  end function
```

---

## Algorithm: reset (Cancel All Timers)

```
92  function reset(): void
93    // Cancel all proactive renewal timers
94    for each [key, timer] in this.proactiveRenewalTimers do
95      clearTimeout(timer)
96    end for
97    this.proactiveRenewalTimers.clear()
98    this.proactiveRenewalFailures.clear()
99    
100   // Reset other state...
101   this.triedBucketsThisSession.clear()
102   this.sessionBucket = undefined
103   // etc.
104 end function
```

---

## State Management

### New State Variables (OAuthManager)

```typescript
private proactiveRenewalTimers: Map<string, NodeJS.Timeout> = new Map()
private proactiveRenewalFailures: Map<string, number> = new Map()
```

**Timer Key Format**: `"${provider}:${bucket}"`  
**Example**: `"anthropic:default"`, `"openai:claudius"`

### Lifecycle

1. **Token acquired/refreshed** → `scheduleProactiveRenewal()` called
2. **Timer fires** → `handleProactiveRenewal()` executes
3. **Refresh succeeds** → Reset counter, reschedule timer
4. **Refresh fails** → Increment counter, check threshold
5. **Threshold reached (3)** → Stop scheduling for that bucket
6. **Session reset** → Cancel all timers, clear state

---

## Requirements Traceability

| Line(s) | Requirement | Description |
|---------|-------------|-------------|
| 27 | REQ-1598-PR01 | Schedule at 80% lifetime if > 5min |
| 27 | **BUG FIX** | Check `remainingSec > 0` before comparing to 300 |
| 29-30 | REQ-1598-PR01 | Calculate renewal delay |
| 42 | REQ-1598-PR02 | Call refreshOAuthToken() when timer fires |
| 63, 70 | REQ-1598-PR03 | Reschedule on success |
| 77, 84 | REQ-1598-PR04 | Log failure, increment counter |
| 21-24 | REQ-1598-PR05 | Stop scheduling after 3 consecutive failures |
| 94-98 | REQ-1598-PR06 | Cancel timers on reset() |

---

## Key Decisions

### Line 27: Double-Check for Positive Lifetime
**Before**: `if (lifetime >= 300)`  
**After**: `if (remainingSec > 0 && remainingSec >= 300)`  
**Rationale**: 
- Prevents scheduling renewal for already-expired tokens
- Expired tokens have `remainingSec <= 0`, which would produce negative delay
- JavaScript's `setTimeout()` with negative delay behaves unpredictably

### Line 34-38: Clear Existing Timer
**Decision**: Replace existing timer for same bucket  
**Rationale**:
- Avoids duplicate timers for same bucket
- Handles case where token refreshed before scheduled renewal

### Line 21-24: Failure Threshold Enforcement
**Decision**: Stop scheduling after 3 failures  
**Rationale**:
- Prevents infinite retry loop for permanently broken buckets
- Failure count resets on success (line 63)
- Manual refresh triggers reschedule (new token → scheduleProactiveRenewal)

---

## Edge Cases

### Edge 1: Token Already Expired
**Scenario**: Token passed to `scheduleProactiveRenewal` has `expiry < now`  
**Handling**: Line 27 condition fails (`remainingSec <= 0`), no timer scheduled  
**Log Output**: Line 47 logs "Token lifetime too short"

### Edge 2: Token Expires in < 5 Minutes
**Scenario**: Token has 4 minutes remaining  
**Handling**: Line 27 condition fails (`remainingSec < 300`), no timer scheduled  
**Rationale**: Too short to benefit from proactive renewal

### Edge 3: Multiple Buckets with Same Provider
**Scenario**: `anthropic:default` and `anthropic:claudius`  
**Handling**: Separate timer keys, independent failure counters

### Edge 4: Refresh Succeeds but getOAuthToken Returns Null
**Scenario**: Line 59 returns `true`, but line 66 returns `null`  
**Handling**: Line 72 logs warning, no reschedule, failure counter NOT incremented  
**Rationale**: Refresh succeeded (semantically), token-store read issue is separate

### Edge 5: Timer Fires During reset()
**Scenario**: Timer callback starts executing, then reset() called  
**Handling**: Line 88 deletes timer reference, but callback continues execution  
**Impact**: Callback logs error if state cleared, but doesn't crash

---

## Integration Points

### Called By
- `OAuthManager.getOAuthToken()` after successful token acquisition
- `OAuthManager.refreshOAuthToken()` after successful refresh
- `handleProactiveRenewal()` after successful recursive refresh (line 70)

### Calls
- `OAuthManager.refreshOAuthToken()` (line 59)
- `OAuthManager.getOAuthToken()` (line 66)
- `scheduleProactiveRenewal()` recursively (line 70)

### State Dependencies
- `proactiveRenewalTimers`: Map of active timers
- `proactiveRenewalFailures`: Map of failure counters
- Token expiry field (`token.expiry`)

---

## Testing Strategy

### Unit Tests
1. **Positive lifetime**: Token with 10min remaining → timer scheduled at 8min
2. **Negative lifetime**: Expired token → no timer scheduled
3. **Short lifetime**: Token with 4min remaining → no timer scheduled
4. **Failure threshold**: 3 consecutive failures → stop scheduling
5. **Success after failures**: Failure → success → counter reset, reschedule
6. **Timer cancellation**: reset() cancels all timers

### Integration Tests
1. **End-to-end renewal**: Schedule → timer fires → refresh succeeds → reschedule
2. **Concurrent buckets**: Multiple buckets with independent timers
3. **Reset during active timer**: Verify no crashes or stale timers

### Fake Timers
Use Vitest's `vi.useFakeTimers()` to control time progression without real delays.

---

## Verification Points

### After scheduleProactiveRenewal()
- [ ] Timer key exists in `proactiveRenewalTimers` map
- [ ] Timer delay matches 80% of remaining lifetime
- [ ] Failure counter initialized if first time
- [ ] No timer scheduled if lifetime < 5min or already expired

### After handleProactiveRenewal() Success
- [ ] Failure counter reset to 0
- [ ] New timer scheduled for updated token
- [ ] Old timer reference removed

### After handleProactiveRenewal() Failure
- [ ] Failure counter incremented
- [ ] Warning logged
- [ ] Timer reference removed
- [ ] No new timer scheduled if threshold reached

### After reset()
- [ ] All timers cancelled
- [ ] proactiveRenewalTimers map empty
- [ ] proactiveRenewalFailures map empty
