# Phase 25: OAuthSessionManager — TDD

## Phase ID
`PLAN-20250214-CREDPROXY.P25`

## Prerequisites
- Required: Phase 24a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P24" packages/cli/src/auth/proxy/`
- Expected files: `packages/cli/src/auth/proxy/oauth-session-manager.ts` (stub)

## Requirements Implemented (Expanded)

### R20.1: Cryptographic Session IDs
**Behavior**:
- GIVEN: A new session is created via `createSession()`
- WHEN: The session ID is returned
- THEN: It is a 32-character hex string (128 bits of entropy from `crypto.randomBytes(16)`)

### R20.2: Single-Use Sessions
**Behavior**:
- GIVEN: A session that has been marked as used via `markUsed()`
- WHEN: `getSession()` is called for that session
- THEN: Throws `SESSION_ALREADY_USED`

### R20.3: Peer Identity Binding
**Behavior**:
- GIVEN: A session created by peer with UID 1000
- WHEN: `getSession()` is called with a different peer UID (2000)
- THEN: Throws UNAUTHORIZED "Session peer identity mismatch"

### R20.4–R20.5: Session Expiration
**Behavior**:
- GIVEN: A session created 11 minutes ago (timeout is 10 minutes)
- WHEN: `getSession()` is called
- THEN: Session is deleted and `SESSION_EXPIRED` is thrown

### R20.6: Replay Prevention
**Behavior**:
- GIVEN: A session that has already been used
- WHEN: Another `getSession()` call is made
- THEN: Returns `SESSION_ALREADY_USED` (not the session data)

### R20.7: Garbage Collection
**Behavior**:
- GIVEN: Multiple expired and used sessions exist
- WHEN: `sweepExpired()` runs
- THEN: All expired and used sessions are removed; active sessions remain

### R20.8: Cancel Cleanup
**Behavior**:
- GIVEN: A session with an active `abortController`
- WHEN: `removeSession()` is called
- THEN: The abort controller is aborted and the session is deleted

### R20.9: Independent Concurrent Sessions
**Behavior**:
- GIVEN: Two concurrent login attempts for different providers
- WHEN: `createSession()` is called twice
- THEN: Each returns a unique session ID; sessions do not interfere

### R20.4 (configurable): Environment Variable Override
**Behavior**:
- GIVEN: `LLXPRT_OAUTH_SESSION_TIMEOUT_SECONDS` is set to "300"
- WHEN: `PKCESessionStore` is constructed
- THEN: Session timeout is 300_000ms (5 minutes)

## Implementation Tasks

### Files to Create
- `packages/cli/src/auth/proxy/__tests__/oauth-session-manager.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P25`
  - 15–20 behavioral tests covering:
    - **Create session**: returns 32-char hex session ID
    - **Create session stores all fields**: provider, bucket, flowType, flowInstance, peerIdentity, createdAt, used=false
    - **Get session — valid**: returns session data for valid, unused, non-expired session
    - **Get session — not found**: throws SESSION_NOT_FOUND for unknown session ID
    - **Get session — already used**: throws SESSION_ALREADY_USED when session was marked used
    - **Get session — expired**: throws SESSION_EXPIRED when session exceeds timeout, deletes session
    - **Get session — peer mismatch (UID)**: throws UNAUTHORIZED when peer UID differs from session creator
    - **Get session — peer match**: succeeds when peer UID matches session creator
    - **Mark used**: sets `used` flag to true on session
    - **Remove session**: deletes session from map
    - **Remove session — aborts controller**: calls abort() on session's abortController before deletion
    - **Remove session — nonexistent**: no-op for unknown session ID
    - **Clear all**: removes all sessions, aborts all controllers, clears GC interval
    - **Sweep expired**: removes expired and used sessions, keeps active sessions
    - **Sweep expired — aborts controllers**: aborts controllers on expired sessions during sweep
    - **Independent sessions**: two createSession calls return different IDs
    - **Env var override**: `LLXPRT_OAUTH_SESSION_TIMEOUT_SECONDS` overrides default timeout
    - **Start GC**: starts interval that calls sweepExpired periodically

### Test Rules
- Use `vi.useFakeTimers()` for time-dependent tests (expiration, GC intervals)
- Tests expect REAL BEHAVIOR (actual PKCESessionStore, no mocked session store)
- NO testing for NotYetImplemented
- NO reverse tests
- Each test has `@requirement` and `@scenario` comments

## Verification Commands

```bash
test -f packages/cli/src/auth/proxy/__tests__/oauth-session-manager.test.ts || echo "FAIL"

grep -r "toHaveBeenCalled\b" packages/cli/src/auth/proxy/__tests__/oauth-session-manager.test.ts && echo "FAIL: Mock theater"

grep -r "toThrow.*NotYetImplemented\|expect.*not\.toThrow()" packages/cli/src/auth/proxy/__tests__/oauth-session-manager.test.ts && echo "FAIL: Reverse testing"

grep -cE "toBe\(|toEqual\(|toMatch\(|toContain\(|toBeNull\(|toThrow\(" packages/cli/src/auth/proxy/__tests__/oauth-session-manager.test.ts
# Expected: 15+ assertions
```

## Success Criteria
- 15–20 behavioral tests
- Tests fail naturally (stub not implemented)
- Zero mock theater or reverse testing
- Coverage spans R20.1–R20.9

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/__tests__/oauth-session-manager.test.ts`
2. Re-read pseudocode 008 and specification R20

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P25.md`
