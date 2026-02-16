# Phase 17: CredentialProxyServer — Implementation

## Phase ID
`PLAN-20250214-CREDPROXY.P17`

## Prerequisites
- Required: Phase 16a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P16" packages/cli/src/auth/proxy/__tests__/`
- Expected files: `packages/cli/src/auth/proxy/__tests__/credential-proxy-server.test.ts` (20–30 behavioral tests)

## Requirements Implemented (Expanded)

### R3.1: Socket Path Construction
**Full Text**: The `CredentialProxyServer` shall create a Unix domain socket at `{tmpdir}/llxprt-cred-{uid}/llxprt-cred-{pid}-{nonce}.sock`.
**Behavior**:
- GIVEN: The proxy server starts
- WHEN: `buildSocketPath()` is called
- THEN: Returns a path using `fs.realpathSync(os.tmpdir())`, UID, PID, and 8-hex-char nonce

### R3.2–R3.3: Socket Permissions
**Full Text**: Per-user subdirectory with `0o700`, socket file with `0o600`.
**Behavior**:
- GIVEN: The proxy server starts
- WHEN: Socket is created
- THEN: Directory has `0o700`, socket file has `0o600`

### R4.1–R4.3: Peer Credential Verification
**Full Text**: Verify peer UID on Linux (`SO_PEERCRED`), peer PID on macOS (`LOCAL_PEERPID`), log warning on other platforms.

### R6.1–R6.3: Protocol Handshake
**Full Text**: Version negotiation on connect; incompatible versions rejected with `UNKNOWN_VERSION`.

### R7.1–R7.2: Request Schema Validation
**Full Text**: Each operation validated via Zod schema before processing. Malformed requests return `INVALID_REQUEST`.

### R8.1–R8.9: Token Operations
**Full Text**: `get_token` returns sanitized tokens (never `refresh_token`). `save_token` strips incoming `refresh_token` and merges with existing. `remove_token` is best-effort. `list_providers`/`list_buckets` filter by allowed set.

### R21.1–R21.3: Profile Scoping
**Full Text**: Requests for disallowed providers/buckets return `UNAUTHORIZED`.

### R22.1: Global Rate Limiting
**Full Text**: Max 60 requests per second per connection; excess returns `RATE_LIMITED`.

### R25.1–R25.4: Lifecycle and Cleanup
**Full Text**: Start creates socket, stop removes file and closes all connections, stale sockets removed on startup.

## Implementation Tasks

### Files to Modify (NOT create new)
- `packages/cli/src/auth/proxy/credential-proxy-server.ts` — UPDATE stub with full implementation
  - MUST follow pseudocode `analysis/pseudocode/005-credential-proxy-server.md`
  - Line 19–26: Constructor stores dependencies, creates child components (session store, rate limiter)
  - Line 28–35: `buildSocketPath()` — realpath tmpdir, UID, PID, nonce, mkdirSync 0o700
  - Line 37–46: `start()` — stale socket cleanup, net.createServer, listen, chmodSync 0o600, GC interval
  - Line 48–73: `handleConnection()` — peer verification, frame reader, handshake gate, rate limit, dispatch
  - Line 75–89: `verifyPeerCredentials()` — platform-specific SO_PEERCRED / LOCAL_PEERPID
  - Line 91–97: `handleHandshake()` — version negotiation
  - Line 99–120: `dispatchRequest()` — Zod validation, profile scoping, operation switch, error sanitization
  - Line 122–129: `handleGetToken()` — tokenStore.getToken → sanitizeTokenForProxy, proactiveScheduler.scheduleIfNeeded
  - Line 131–144: `handleSaveToken()` — strip refresh_token, acquire lock, merge, save, release lock
  - Line 146–155: `handleRemoveToken()` — acquire lock, remove (best-effort), release lock
  - Line 157–162: `handleListProviders()` — filter by allowedProviders, empty on error
  - Line 164–171: `handleListBuckets()` — filter by allowedBuckets, empty on error
  - Line 173–178: `handleGetApiKey()` — keyStorage.getKey, NOT_FOUND if null
  - Line 180–184: `handleListApiKeys()` — keyStorage.listKeys, empty on error
  - Line 186–194: `stop()` — cancelAll timers, clearAll sessions, close server, wait 5s, close connections, unlink socket

### FORBIDDEN
- Do NOT modify test files
- No TODO/FIXME/HACK comments
- No `console.log` or debug code outside structured logging

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P17
 * @requirement R3.1-R3.3, R4.1-R4.3, R6.1-R6.3, R7.1-R7.2, R8.1-R8.9, R21.1-R21.3, R22.1, R25.1-R25.4
 * @pseudocode analysis/pseudocode/005-credential-proxy-server.md
 */
```

## Verification Commands

```bash
# All tests pass
npm test -- packages/cli/src/auth/proxy/__tests__/credential-proxy-server.test.ts

# No test modifications
git diff packages/cli/src/auth/proxy/__tests__/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"

# TypeScript compiles
npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/cli/src/auth/proxy/credential-proxy-server.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/cli/src/auth/proxy/credential-proxy-server.ts
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -v "handleList"
# Note: handleListProviders/handleListBuckets/handleListApiKeys intentionally return [] on error (degraded operation per spec)
```

## Success Criteria
- All 20–30 behavioral tests pass
- No test modifications
- Implementation follows pseudocode lines 10–197
- TypeScript compiles cleanly
- No deferred implementation patterns

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/credential-proxy-server.ts`
2. Re-read pseudocode 005 and retry

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P17.md`
