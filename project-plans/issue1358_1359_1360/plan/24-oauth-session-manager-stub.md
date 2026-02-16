# Phase 24: OAuthSessionManager — Stub

## Phase ID
`PLAN-20250214-CREDPROXY.P24`

## Prerequisites
- Required: Phase 23a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P23" packages/cli/src/auth/proxy/`
- Expected files: `packages/cli/src/auth/proxy/proactive-scheduler.ts` (fully implemented)
- Preflight verification: Phase 00a MUST be completed

## Requirements Implemented (Expanded)

### R17.1: PKCE Code-Paste Flow Initiation
**Full Text**: When `oauth_initiate` is received for a PKCE code-paste provider (Anthropic or Gemini), the host shall create a fresh provider flow instance for this session and initiate the flow.
**Behavior**:
- GIVEN: An inner process requests `/auth login` for Anthropic or Gemini
- WHEN: `oauth_initiate` arrives at the proxy
- THEN: The OAuthSessionManager creates a fresh flow instance, initiates PKCE, stores session state, returns `{auth_url, session_id, flow_type: "pkce_redirect"}`
**Why This Matters**: PKCE secrets stay on the host; each session gets its own flow instance to avoid shared state.

### R17.2: Code Exchange
**Full Text**: When `oauth_exchange` is received with `{session_id, code}`, the host shall validate the session, exchange the code for a token, store it, return sanitized.
**Behavior**:
- GIVEN: A valid PKCE session exists
- WHEN: `oauth_exchange` arrives with the authorization code
- THEN: The code is exchanged for a full token (stored on host), sanitized token returned
**Why This Matters**: Full token (including refresh_token) never crosses the trust boundary.

### R18.1: Device Code Flow Initiation
**Full Text**: When `oauth_initiate` is received for a device code provider (Qwen, or Codex in fallback mode), the host shall create a device flow instance and initiate.
**Behavior**:
- GIVEN: An inner process requests `/auth login` for Qwen
- WHEN: `oauth_initiate` arrives at the proxy
- THEN: Creates device flow, starts background polling, returns `{verification_url, user_code, session_id, flow_type: "device_code", pollIntervalMs}`
**Why This Matters**: Device code polling runs on the host; PKCE verifiers stay host-side.

### R19.1: Browser Redirect Flow Initiation
**Full Text**: When `oauth_initiate` is received for Codex in browser redirect mode, the host shall start a localhost redirect server and return the auth URL.
**Behavior**:
- GIVEN: An inner process requests `/auth login` for Codex
- WHEN: `oauth_initiate` arrives at the proxy
- THEN: Creates redirect server on host, returns `{auth_url, session_id, flow_type: "browser_redirect"}`
**Why This Matters**: Browser redirect callback happens on the host; container doesn't need localhost access.

### R20.1–R20.9: OAuth Session Management
**Full Text**: Sessions use cryptographic IDs (128 bits), are single-use, peer-bound, expire after 10 minutes (configurable), with GC sweep every 60 seconds.
**Why This Matters**: Prevents session replay, hijacking, and memory leaks.

## Implementation Tasks

### Files to Create
- `packages/cli/src/auth/proxy/oauth-session-manager.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P24`
  - Exports: `PKCESessionStore` class, `OAuthSession` interface
  - Constructor accepts `sessionTimeoutMs?: number` (default 600_000)
  - Methods: `startGC()`, `sweepExpired()`, `createSession(provider, bucket, flowType, flowInstance, peerIdentity)`, `getSession(sessionId, peerIdentity)`, `markUsed(sessionId)`, `removeSession(sessionId)`, `clearAll()`
  - All methods throw `new Error('NotYetImplemented')` or are no-ops
  - Maximum 60 lines (stub)

### Files to Modify
None — this is a new file.

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P24
 * @requirement R17.1-R17.3, R18.1, R19.1, R20.1-R20.9
 * @pseudocode analysis/pseudocode/008-oauth-session-manager.md
 */
```

## Verification Commands

### Automated Checks
```bash
test -f packages/cli/src/auth/proxy/oauth-session-manager.ts || echo "FAIL: oauth-session-manager.ts missing"

grep -r "@plan:PLAN-20250214-CREDPROXY.P24" packages/cli/src/auth/proxy/ | wc -l
# Expected: 1+ occurrences

find packages/ -name "*oauth-session-manager*V2*" -o -name "*oauth-session-manager*New*"
# Expected: no results

npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/cli/src/auth/proxy/oauth-session-manager.ts | grep -v ".test.ts"
# Expected: Only NotYetImplemented throws (acceptable in stub phase)
```

### Semantic Verification Checklist
1. **Do the stubs compile?** `npm run typecheck`
2. **Are exports correct?** `PKCESessionStore` class and `OAuthSession` interface exported with correct signatures
3. **No parallel versions?** No `oauth-session-managerV2.ts` or similar

## Success Criteria
- File created with proper plan markers
- TypeScript compiles cleanly
- Constructor accepts optional `sessionTimeoutMs` parameter
- All public methods exist as stubs
- `sessions` Map and `gcInterval` properties exist
- `OAuthSession` interface exported with all fields from pseudocode

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/`
2. Re-read pseudocode 008 and retry

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P24.md`
