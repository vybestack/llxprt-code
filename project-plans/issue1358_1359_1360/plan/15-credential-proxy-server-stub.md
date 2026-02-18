# Phase 15: CredentialProxyServer — Stub

## Phase ID
`PLAN-20250214-CREDPROXY.P15`

## Prerequisites
- Required: Phase 14a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P14" packages/core/src/auth/proxy/`
- Expected files from previous phase: `packages/core/src/auth/proxy/proxy-provider-key-storage.ts` (fully implemented)
- Preflight verification: Phase 00a MUST be completed

## Requirements Implemented (Expanded)

### R3.1: Socket Path Construction
**Full Text**: The `CredentialProxyServer` shall create a Unix domain socket at `{tmpdir}/llxprt-cred-{uid}/llxprt-cred-{pid}-{nonce}.sock`.
**Behavior**:
- GIVEN: A host process starting a sandbox
- WHEN: `CredentialProxyServer` is constructed
- THEN: A socket path is generated using `fs.realpathSync(os.tmpdir())`, UID, PID, and a cryptographic nonce
**Why This Matters**: The socket path must be unique per instance and include a nonce to prevent path-guessing attacks.

### R3.2–R3.3: Socket Permissions
**Full Text**: Per-user subdirectory with `0o700`, socket file with `0o600`.
**Behavior**:
- GIVEN: The proxy server starts
- WHEN: The socket is created
- THEN: The directory has `0o700` permissions and the socket file has `0o600` permissions
**Why This Matters**: Prevents other users from connecting to the proxy socket.

### R4.1–R4.3: Peer Credential Verification
**Full Text**: Verify peer UID on Linux (SO_PEERCRED), peer PID on macOS (LOCAL_PEERPID), log warning on other platforms.
**Behavior**:
- GIVEN: A client connects to the proxy socket
- WHEN: The connection is established
- THEN: The server verifies the peer identity using platform-specific mechanisms
**Why This Matters**: Defense-in-depth against unauthorized connections.

### R7.1–R7.2: Request Schema Validation
**Full Text**: Each operation shall have a defined request schema validated on the server side. Malformed requests return `INVALID_REQUEST`.
**Behavior**:
- GIVEN: A request with missing required fields
- WHEN: The server processes the request
- THEN: `INVALID_REQUEST` is returned without touching credential stores
**Why This Matters**: Prevents invalid data from reaching the credential stores.

### R21.1–R21.3: Profile Scoping
**Full Text**: The proxy shall restrict credential access to the loaded profile's providers and buckets.
**Behavior**:
- GIVEN: A request for a provider not in `allowedProviders`
- WHEN: The server processes the request
- THEN: `UNAUTHORIZED` is returned
**Why This Matters**: Prevents sandbox from accessing credentials outside the current profile scope.

### R22.1: Global Rate Limiting
**Full Text**: Max 60 requests per second per connection.
**Behavior**:
- GIVEN: More than 60 requests per second on a connection
- WHEN: The excess request arrives
- THEN: `RATE_LIMITED` is returned with `retryAfter`
**Why This Matters**: Prevents resource exhaustion attacks from a compromised container.

### R25.1–R25.4: Lifecycle and Cleanup
**Full Text**: Create proxy before container spawn, clean up on exit/signal, remove stale sockets on startup.
**Behavior**:
- GIVEN: The proxy server is stopped
- WHEN: `stop()` is called
- THEN: Socket is closed, file removed, timers cancelled, sessions cleared
**Why This Matters**: Prevents resource leaks and stale socket files.

## Implementation Tasks

### Files to Create
- `packages/cli/src/auth/proxy/credential-proxy-server.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P15`
  - Exports: `CredentialProxyServer` class
  - Methods: `start()`, `stop()`, `getSocketPath()`, `handleConnection()`, `dispatchRequest()`, `handleGetToken()`, `handleSaveToken()`, `handleRemoveToken()`, `handleListProviders()`, `handleListBuckets()`, `handleGetApiKey()`, `handleListApiKeys()`
  - All methods throw `new Error('NotYetImplemented')` or return empty values
  - Maximum 80 lines (stub)

### Files to Modify
None — this is a new file.

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P15
 * @requirement R3.1-R3.3, R4.1-R4.3, R7.1-R7.2, R21.1-R21.3, R22.1, R25.1-R25.4
 * @pseudocode analysis/pseudocode/005-credential-proxy-server.md
 */
```

## Verification Commands

### Automated Checks
```bash
test -f packages/cli/src/auth/proxy/credential-proxy-server.ts || echo "FAIL: credential-proxy-server.ts missing"

grep -r "@plan:PLAN-20250214-CREDPROXY.P15" packages/cli/src/auth/proxy/ | wc -l
# Expected: 1+ occurrences

find packages/ -name "*credential-proxy-server*V2*" -o -name "*credential-proxy-server*New*"
# Expected: no results

npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -v ".test.ts"
# Expected: Only NotYetImplemented throws (acceptable in stub phase)
```

### Semantic Verification Checklist
1. **Do the stubs compile?** `npm run typecheck`
2. **Are exports correct?** `CredentialProxyServer` class exported with correct constructor signature
3. **No parallel versions?** No `credential-proxy-serverV2.ts` or similar

## Success Criteria
- File created with proper plan markers
- TypeScript compiles cleanly
- Constructor accepts `CredentialProxyServerOptions` matching pseudocode contract
- All public methods exist as stubs

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/`
2. Re-read pseudocode 005 and retry

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P15.md`
