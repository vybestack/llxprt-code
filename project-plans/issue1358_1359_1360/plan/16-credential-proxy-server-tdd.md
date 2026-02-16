# Phase 16: CredentialProxyServer — TDD

## Phase ID
`PLAN-20250214-CREDPROXY.P16`

## Prerequisites
- Required: Phase 15a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P15" packages/cli/src/auth/proxy/`
- Expected files: `packages/cli/src/auth/proxy/credential-proxy-server.ts` (stub)

## Requirements Implemented (Expanded)

### R3.1: Socket Path Construction
**Behavior**:
- GIVEN: A `CredentialProxyServer` is constructed
- WHEN: `getSocketPath()` is called
- THEN: Returns a path matching `{tmpdir}/llxprt-cred-{uid}/llxprt-cred-{pid}-{nonce}.sock` with an 8-char hex nonce
**Why This Matters**: Each proxy must have a unique, unpredictable socket path.

### R3.2–R3.3: Socket Permissions
**Behavior**:
- GIVEN: The proxy starts and creates the socket
- WHEN: The socket file is examined
- THEN: The per-user subdirectory has `0o700` and the socket file has `0o600`
**Why This Matters**: Only the owning user can connect; other users cannot list or traverse the socket directory.

### R4.1–R4.3: Peer Credential Verification
**Behavior**:
- GIVEN: A client connects on Linux
- WHEN: Peer UID does not match the server's UID
- THEN: The connection is rejected
**Why This Matters**: Defense-in-depth against unauthorized connections.

### R6.1–R6.3: Protocol Handshake
**Behavior**:
- GIVEN: A client connects and sends `{ v: 1, op: "handshake", payload: { minVersion: 1, maxVersion: 1 } }`
- WHEN: The server processes the handshake
- THEN: Returns `{ v: 1, op: "handshake", ok: true, data: { version: 1 } }`
**Why This Matters**: Version negotiation prevents protocol mismatches between client and server.

### R7.1–R7.2: Request Schema Validation
**Behavior**:
- GIVEN: A `get_token` request with missing `provider` field
- WHEN: The server validates the request
- THEN: Returns `INVALID_REQUEST` without touching credential stores
**Why This Matters**: Prevents invalid data from reaching credential stores.

### R8.1: get_token Response Sanitization
**Behavior**:
- GIVEN: A token `{ access_token: "at", refresh_token: "rt", expiry: 9999999999 }` in the store
- WHEN: `get_token` is requested
- THEN: Response contains `access_token`, `expiry`, `token_type` but NEVER `refresh_token`
**Why This Matters**: Core security invariant — refresh tokens never cross the trust boundary.

### R8.3: save_token Strips refresh_token
**Behavior**:
- GIVEN: Inner process sends `save_token` with `{ provider: "anthropic", token: { access_token: "at", refresh_token: "rt" } }`
- WHEN: The server processes the request
- THEN: The `refresh_token` is stripped before merging; the existing stored `refresh_token` is preserved
**Why This Matters**: Prevents a compromised container from overwriting the host's refresh token.

### R8.4: remove_token Best-Effort
**Behavior**:
- GIVEN: A valid `remove_token` request
- WHEN: The underlying keyring delete fails
- THEN: The error is logged but success is returned to the client
**Why This Matters**: Logout should not fail due to transient keyring issues.

### R21.1–R21.2: Profile Scoping
**Behavior**:
- GIVEN: `allowedProviders = Set(["anthropic"])` and a request for `provider: "openai"`
- WHEN: The server processes the request
- THEN: Returns `UNAUTHORIZED`
**Why This Matters**: Sandbox cannot access credentials outside the loaded profile.

### R22.1: Global Rate Limiting
**Behavior**:
- GIVEN: 61 requests arrive within 1 second on the same connection
- WHEN: The 61st request arrives
- THEN: Returns `RATE_LIMITED` with `retryAfter`
**Why This Matters**: Prevents resource exhaustion from compromised containers.

### R25.1–R25.4: Lifecycle and Cleanup
**Behavior**:
- GIVEN: A proxy is started then `stop()` is called
- WHEN: Stop completes
- THEN: Socket file is removed, server is closed, all connections are terminated
**Why This Matters**: Prevents stale socket files and resource leaks.

## Implementation Tasks

### Files to Create
- `packages/cli/src/auth/proxy/__tests__/credential-proxy-server.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P16`
  - 20–30 behavioral tests covering:
    - **Socket lifecycle**: start creates socket, stop removes socket file
    - **Socket path**: matches `{tmpdir}/llxprt-cred-{uid}/llxprt-cred-{pid}-{nonce}.sock` pattern
    - **Socket permissions**: directory `0o700`, socket `0o600`
    - **Stale socket cleanup**: start removes pre-existing socket file
    - **Handshake**: compatible version returns success
    - **Handshake**: incompatible version returns `UNKNOWN_VERSION` and closes connection
    - **Handshake required**: request before handshake returns `INVALID_REQUEST`
    - **get_token**: returns sanitized token (no refresh_token)
    - **get_token**: returns `NOT_FOUND` when token does not exist
    - **get_token**: preserves provider-specific fields (e.g., `account_id`)
    - **save_token**: strips incoming `refresh_token`, merges with existing, preserves stored refresh_token
    - **save_token**: new provider:bucket with no existing token stores sanitized token
    - **remove_token**: delegates to store, returns success
    - **remove_token**: returns success even when store delete fails (best-effort)
    - **list_providers**: returns filtered list per allowedProviders
    - **list_providers**: returns empty array on store error
    - **list_buckets**: returns filtered list per allowedBuckets
    - **list_buckets**: returns empty array on store error
    - **get_api_key**: returns key value
    - **get_api_key**: returns `NOT_FOUND` when key does not exist
    - **list_api_keys**: returns key names
    - **Profile scoping**: request for disallowed provider returns `UNAUTHORIZED`
    - **Profile scoping**: request for disallowed bucket returns `UNAUTHORIZED`
    - **Schema validation**: missing required fields returns `INVALID_REQUEST`
    - **Rate limiting**: 61st request within 1s returns `RATE_LIMITED`
    - **Error sanitization**: provider errors do not leak credential material

### Test Rules
- Tests expect REAL BEHAVIOR (actual socket communication or handler invocation with real data)
- NO testing for NotYetImplemented
- NO reverse tests (expect().not.toThrow())
- Each test has `@requirement` and `@scenario` comments
- Tests WILL FAIL naturally until implementation phase

### Required Test Pattern
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P16
 * @requirement R8.1
 * @scenario get_token returns sanitized token without refresh_token
 * @given A token { access_token: "at", refresh_token: "rt", expiry: 9999999999 } in the store
 * @when get_token is requested for that provider
 * @then Response contains access_token and expiry but NOT refresh_token
 */
it('returns sanitized token without refresh_token on get_token', async () => {
  // ... test using real CredentialProxyServer + in-process socket client
});
```

## Verification Commands

```bash
# Check test file exists
test -f packages/cli/src/auth/proxy/__tests__/credential-proxy-server.test.ts || echo "FAIL"

# Check for mock theater
grep -r "toHaveBeenCalled\b" packages/cli/src/auth/proxy/__tests__/credential-proxy-server.test.ts && echo "FAIL: Mock theater"

# Check for reverse testing
grep -r "toThrow.*NotYetImplemented\|expect.*not\.toThrow()" packages/cli/src/auth/proxy/__tests__/credential-proxy-server.test.ts && echo "FAIL: Reverse testing"

# Check behavioral assertions
grep -cE "toBe\(|toEqual\(|toMatch\(|toContain\(|toBeNull\(|toThrow\(" packages/cli/src/auth/proxy/__tests__/credential-proxy-server.test.ts
# Expected: 20+ assertions

# Tests should fail naturally (stub not implemented yet)
npm test -- packages/cli/src/auth/proxy/__tests__/credential-proxy-server.test.ts 2>&1 | head -20
```

## Success Criteria
- 20–30 behavioral tests
- Tests fail naturally with "NotYetImplemented" or property access errors
- Zero mock theater or reverse testing
- All tests tagged with plan and requirement IDs
- Coverage spans R3, R4, R6, R7, R8, R10, R21, R22, R25

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/__tests__/credential-proxy-server.test.ts`
2. Re-read pseudocode 005 and specification R3–R25

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P16.md`
