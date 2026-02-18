# Phase 18: RefreshCoordinator — Stub

## Phase ID
`PLAN-20250214-CREDPROXY.P18`

## Prerequisites
- Required: Phase 17a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P17" packages/cli/src/auth/proxy/`
- Expected files: `packages/cli/src/auth/proxy/credential-proxy-server.ts` (fully implemented)
- Preflight verification: Phase 00a MUST be completed

## Requirements Implemented (Expanded)

### R11.1: Host-Side Refresh Flow
**Full Text**: When the proxy receives a `refresh_token` operation, it shall read the full token, verify refresh_token exists, acquire lock, double-check, call provider.refreshToken(), merge, save, release lock, return sanitized.
**Behavior**:
- GIVEN: An inner process needs to refresh a token
- WHEN: `refresh_token` operation arrives at the proxy
- THEN: The RefreshCoordinator orchestrates the entire refresh flow on the host
**Why This Matters**: Refresh tokens never cross the trust boundary — all refresh logic runs on the host.

### R12.1–R12.5: Token Merge Contract
**Full Text**: Merge rules for access_token, expiry, refresh_token, scope, token_type, and provider-specific fields.
**Why This Matters**: Ensures token state remains consistent across refresh cycles.

### R13.1–R13.3: Refresh Retry and Backoff
**Full Text**: 2 retries with exponential backoff (1s, 3s) on transient errors; no retry on auth errors.
**Why This Matters**: Handles transient network failures without retrying permanently invalid tokens.

### R14.1–R14.4: Refresh Rate Limiting
**Full Text**: Max 1 refresh per provider:bucket per 30 seconds. Return current token if valid during cooldown; RATE_LIMITED if expired during cooldown. Concurrent requests deduplicated.
**Why This Matters**: Prevents a compromised container from hammering the refresh endpoint.

### R15.1–R15.2: Refresh + Logout Race
**Full Text**: remove_token acquires the same lock (waits for refresh to complete), then deletes. Logout intent wins.
**Why This Matters**: Deterministic ordering between concurrent refresh and logout operations.

## Implementation Tasks

### Files to Create
- `packages/cli/src/auth/proxy/refresh-coordinator.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P18`
  - Exports: `RefreshCoordinator` class
  - Constructor accepts `{ tokenStore: KeyringTokenStore, providers: Map<string, OAuthProvider> }`
  - Methods: `handleRefreshToken(provider, bucket)`, `refreshWithRetry(provider, token)`, `refreshGeminiToken(storedToken)`, `isAuthError(error)`, `isTransientError(error)`
  - All methods throw `new Error('NotYetImplemented')` or return empty values
  - Maximum 60 lines (stub)

### Files to Modify
None — this is a new file.

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P18
 * @requirement R11.1-R11.5, R12.1-R12.5, R13.1-R13.3, R14.1-R14.4
 * @pseudocode analysis/pseudocode/006-refresh-coordinator.md
 */
```

## Verification Commands

### Automated Checks
```bash
test -f packages/cli/src/auth/proxy/refresh-coordinator.ts || echo "FAIL: refresh-coordinator.ts missing"

grep -r "@plan:PLAN-20250214-CREDPROXY.P18" packages/cli/src/auth/proxy/ | wc -l
# Expected: 1+ occurrences

find packages/ -name "*refresh-coordinator*V2*" -o -name "*refresh-coordinator*New*"
# Expected: no results

npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/cli/src/auth/proxy/refresh-coordinator.ts | grep -v ".test.ts"
# Expected: Only NotYetImplemented throws (acceptable in stub phase)
```

### Semantic Verification Checklist
1. **Do the stubs compile?** `npm run typecheck`
2. **Are exports correct?** `RefreshCoordinator` class exported with correct constructor signature
3. **No parallel versions?** No `refresh-coordinatorV2.ts` or similar

## Success Criteria
- File created with proper plan markers
- TypeScript compiles cleanly
- Constructor accepts correct dependency types matching pseudocode
- All public methods exist as stubs

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/`
2. Re-read pseudocode 006 and retry

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P18.md`
