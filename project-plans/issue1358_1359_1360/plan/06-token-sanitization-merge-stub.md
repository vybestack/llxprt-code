# Phase 06: Token Sanitization & Merge — Stub

## Phase ID
`PLAN-20250214-CREDPROXY.P06`

## Prerequisites
- Required: Phase 05a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P05" packages/core/src/auth/proxy/`
- Expected files from previous phase: `packages/core/src/auth/proxy/framing.ts`, `packages/core/src/auth/proxy/proxy-socket-client.ts` (fully implemented)
- Preflight verification: Phase 00a MUST be completed

## Requirements Implemented (Expanded)

### R10.1: Refresh Token Stripping
**Full Text**: The `refresh_token` field shall be stripped from ALL data crossing the Unix socket boundary. This includes: `get_token` responses, `refresh_token` operation responses, `oauth_exchange` responses, `oauth_poll` completion responses, error responses, and `save_token` request payloads.
**Behavior**:
- GIVEN: An `OAuthToken` object with `{ access_token: "at", refresh_token: "rt", expiry: 1234 }`
- WHEN: `sanitizeTokenForProxy(token)` is called
- THEN: Returns `{ access_token: "at", expiry: 1234 }` — `refresh_token` is absent
**Why This Matters**: The core security property of the proxy — refresh tokens never leave the host. Without this, sandbox escape exposes long-lived credentials.

### R10.2: Single Sanitization Function
**Full Text**: Token sanitization shall be implemented as a single function (`sanitizeTokenForProxy`) at the proxy server response boundary.
**Behavior**:
- GIVEN: All socket-crossing token responses
- WHEN: Any response contains token data
- THEN: The response passes through `sanitizeTokenForProxy` before serialization
**Why This Matters**: Centralizing sanitization prevents accidental refresh_token leakage if new response paths are added.

### R10.3: SanitizedOAuthToken Type
**Full Text**: The `sanitizeTokenForProxy` function shall produce `SanitizedOAuthToken`: `Omit<OAuthToken, 'refresh_token'> & Record<string, unknown>`. Provider-specific passthrough fields shall be preserved.
**Behavior**:
- GIVEN: A token with `{ access_token: "at", refresh_token: "rt", expiry: 1234, account_id: "acc" }`
- WHEN: `sanitizeTokenForProxy(token)` is called
- THEN: Returns `{ access_token: "at", expiry: 1234, account_id: "acc" }` — provider-specific fields preserved
**Why This Matters**: Provider-specific fields like Codex `account_id` and `id_token` are needed by the inner process for API calls.

### R12.1–R12.5: Token Merge Contract
**Full Text**: When merging a newly received token with the stored token, `access_token` and `expiry` always use the new value. `refresh_token` uses the new value if provided and non-empty; otherwise preserves existing. `scope`, `token_type`, `resource_url`, and provider-specific fields use new if provided, else keep existing.
**Behavior**:
- GIVEN: Stored token `{ access_token: "old_at", refresh_token: "old_rt", expiry: 100, scope: "read" }` and new token `{ access_token: "new_at", expiry: 200 }`
- WHEN: `mergeRefreshedToken(stored, newToken)` is called
- THEN: Returns `{ access_token: "new_at", refresh_token: "old_rt", expiry: 200, scope: "read" }`
**Why This Matters**: The merge contract ensures refresh tokens are never accidentally lost during refresh, while always updating to the latest access credentials.

## Implementation Tasks

### Files to Create
- `packages/core/src/auth/token-sanitization.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P06`
  - Exports: `sanitizeTokenForProxy`, `SanitizedOAuthToken` type
  - Stub: method throws `new Error('NotYetImplemented')`
  - Maximum 20 lines

- `packages/core/src/auth/token-merge.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P06`
  - Exports: `mergeRefreshedToken`
  - Stub: method throws `new Error('NotYetImplemented')`
  - Maximum 20 lines

### Files to Modify
None — these are new files.

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P06
 * @requirement R10.1, R10.2, R10.3, R12.1-R12.5
 * @pseudocode analysis/pseudocode/002-token-sanitization-merge.md
 */
```

## Verification Commands

### Automated Checks
```bash
# Check files exist
test -f packages/core/src/auth/token-sanitization.ts || echo "FAIL: token-sanitization.ts missing"
test -f packages/core/src/auth/token-merge.ts || echo "FAIL: token-merge.ts missing"

# Check plan markers
grep -r "@plan:PLAN-20250214-CREDPROXY.P06" packages/core/src/auth/ | wc -l
# Expected: 2+ occurrences

# Check for version duplication
find packages/ -name "*token-sanitization*V2*" -o -name "*token-merge*New*"
# Expected: no results

# TypeScript compiles
npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/auth/token-sanitization.ts packages/core/src/auth/token-merge.ts | grep -v ".test.ts"
# Expected: Only NotYetImplemented throws (acceptable in stub phase)
```

### Semantic Verification Checklist
1. **Do the stubs compile?** `npm run typecheck`
2. **Are exports correct?** `sanitizeTokenForProxy`, `SanitizedOAuthToken`, `mergeRefreshedToken` exported
3. **No parallel versions?** No `token-sanitizationV2.ts` or similar

## Success Criteria
- Both files created with proper plan markers
- TypeScript compiles cleanly
- Exports match pseudocode contract
- No TODO comments (only NotYetImplemented throws)

## Failure Recovery
1. `git checkout -- packages/core/src/auth/token-sanitization.ts packages/core/src/auth/token-merge.ts`
2. Re-read pseudocode 002 and retry

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P06.md`
