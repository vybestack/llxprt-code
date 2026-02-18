# Pseudocode: ProactiveScheduler

Plan ID: PLAN-20250214-CREDPROXY
Component: ProactiveScheduler (Host-Side, internal to CredentialProxyServer)

## Interface Contracts

```typescript
// INPUTS
interface ScheduleInput {
  provider: string;
  bucket: string;
  token: OAuthToken;  // full token with expiry
}

// OUTPUTS
// Side effect: schedules setTimeout timers that call refreshCoordinator

// DEPENDENCIES (NEVER stubbed)
interface Dependencies {
  refreshCoordinator: RefreshCoordinator;
}
```

## Integration Points

```
Line 20: CALL setTimeout(callback, delayMs) — Node.js timer
Line 30: CALL refreshCoordinator.handleRefreshToken(provider, bucket) — triggers actual refresh
Line 40: CALL clearTimeout(timerId) — cancels scheduled timer
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: const delay = token.expiry - Date.now() - 60  // Fixed 60s buffer
[OK]    DO: const leadSec = Math.max(300, Math.floor(remainingSec * 0.1))  // Matches OAuthManager

[ERROR] DO NOT: setInterval(() => refresh(), 300000)  // Periodic polling
[OK]    DO: schedule one-shot timer per token expiry, re-schedule on success
```

## Pseudocode

```
 10: CLASS ProactiveScheduler
 11:   PRIVATE timers: Map<string, NodeJS.Timeout>  // provider:bucket → timer
 12:   PRIVATE retryCounters: Map<string, number>    // provider:bucket → consecutive failures
 13:   PRIVATE refreshCoordinator: RefreshCoordinator
 14:   PRIVATE MAX_CONSECUTIVE_FAILURES = 10
 15:   PRIVATE RETRY_BASE_SEC = 30
 16:   PRIVATE RETRY_CAP_SEC = 1800  // 30 minutes
 17:
 18:   CONSTRUCTOR(refreshCoordinator: RefreshCoordinator)
 19:     SET timers = new Map()
 20:     SET retryCounters = new Map()
 21:     STORE refreshCoordinator
 22:
 23:   METHOD scheduleIfNeeded(provider: string, bucket: string, token: OAuthToken): void
 24:     LET key = `${provider}:${bucket ?? 'default'}`
 25:     IF timers.has(key)
 26:       RETURN  // Already scheduled for this provider:bucket
 27:     IF NOT token.refresh_token
 28:       RETURN  // Cannot refresh without refresh_token
 29:     IF NOT token.expiry
 30:       RETURN  // No expiry means no schedule
 31:     CALL scheduleTimer(key, provider, bucket, token.expiry)
 32:
 33:   METHOD scheduleTimer(key: string, provider: string, bucket: string, expirySec: number): void
 34:     LET nowSec = Math.floor(Date.now() / 1000)
 35:     LET remainingSec = expirySec - nowSec
 36:     IF remainingSec <= 0
 37:       // Token already expired — refresh immediately
 38:       CALL runProactiveRenewal(key, provider, bucket)
 39:       RETURN
 40:
 41:     // Lead time: max(300s, 10% of remaining) — matches OAuthManager algorithm
 42:     LET leadSec = Math.max(300, Math.floor(remainingSec * 0.1))
 43:     // Jitter: 0-30 seconds random
 44:     LET jitterSec = Math.floor(Math.random() * 30)
 45:     LET delaySec = remainingSec - leadSec - jitterSec
 46:     IF delaySec < 0
 47:       SET delaySec = 0  // Fire immediately if within lead time
 48:
 49:     LET timerId = setTimeout(() => {
 50:       CALL runProactiveRenewal(key, provider, bucket)
 51:     }, delaySec * 1000)
 52:
 53:     timers.set(key, timerId)
 54:     LOG debug "Scheduled proactive renewal for ${key} in ${delaySec}s"
 55:
 56:   ASYNC METHOD runProactiveRenewal(key: string, provider: string, bucket: string): void
 57:     timers.delete(key)  // Timer fired, remove reference
 58:
 59:     // Re-check wall-clock time vs. actual token expiry (handles sleep/suspend)
 60:     LET token = AWAIT refreshCoordinator.tokenStore.getToken(provider, bucket)
 61:     IF token === null
 62:       RETURN  // Token was removed (logout)
 63:     LET nowSec = Math.floor(Date.now() / 1000)
 64:     LET remainingSec = token.expiry - nowSec
 65:
 66:     // If another process already refreshed and token is well within validity
 67:     LET leadSec = Math.max(300, Math.floor(remainingSec * 0.1))
 68:     IF remainingSec > leadSec + 60
 69:       // Token was refreshed by another process — reschedule for new expiry
 70:       CALL scheduleTimer(key, provider, bucket, token.expiry)
 71:       RETURN
 72:
 73:     TRY
 74:       LET refreshed = AWAIT refreshCoordinator.handleRefreshToken(provider, bucket)
 75:       // Success — reset retry counter and schedule for new expiry
 76:       retryCounters.delete(key)
 77:       LET newToken = AWAIT refreshCoordinator.tokenStore.getToken(provider, bucket)
 78:       IF newToken AND newToken.expiry
 79:         CALL scheduleTimer(key, provider, bucket, newToken.expiry)
 80:     CATCH error
 81:       // Proactive renewal failure — schedule retry with backoff
 82:       LET failures = (retryCounters.get(key) ?? 0) + 1
 83:       retryCounters.set(key, failures)
 84:       IF failures >= MAX_CONSECUTIVE_FAILURES
 85:         LOG warning "Proactive renewal for ${key} failed ${failures} times, giving up"
 86:         retryCounters.delete(key)
 87:         RETURN
 88:       LET backoffSec = Math.min(RETRY_CAP_SEC, RETRY_BASE_SEC * Math.pow(2, failures - 1))
 89:       LOG debug "Proactive renewal failed for ${key}, retrying in ${backoffSec}s"
 90:       LET timerId = setTimeout(() => {
 91:         CALL runProactiveRenewal(key, provider, bucket)
 92:       }, backoffSec * 1000)
 93:       timers.set(key, timerId)
 94:
 95:   METHOD cancelAll(): void
 96:     FOR EACH [key, timerId] IN timers
 97:       CALL clearTimeout(timerId)
 98:     timers.clear()
 99:     retryCounters.clear()
100:     LOG debug "All proactive renewal timers cancelled"
101:
102:   METHOD cancelForKey(provider: string, bucket: string): void
103:     LET key = `${provider}:${bucket ?? 'default'}`
104:     LET timerId = timers.get(key)
105:     IF timerId
106:       CALL clearTimeout(timerId)
107:       timers.delete(key)
108:       retryCounters.delete(key)
```
