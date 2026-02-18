# Phase 01: Delete Fake Handlers

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P01`

## Purpose

**DELETE all fake handler implementations** and replace with explicit NOT_IMPLEMENTED errors.

This creates a clean baseline where:
1. Any test that still passes is mock theater and must be deleted
2. The codebase clearly shows what needs to be implemented
3. There's no confusion about what's real vs fake

---

## Prerequisites

- Clean git working directory
- No uncommitted changes to credential-proxy-server.ts

---

## Implementation Tasks

### Task 1: Replace handleOAuthInitiate with NOT_IMPLEMENTED

**File**: `packages/cli/src/auth/proxy/credential-proxy-server.ts`

**Current Code** (approximately lines 507-542):
```typescript
private async handleOAuthInitiate(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // ... ~35 lines of fake implementation
  // Contains: auth_url: `https://auth.example.com/oauth?provider=${provider}`
}
```

**Replace With**:
```typescript
private async handleOAuthInitiate(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // TODO: Phase 03 - Real implementation required
  // Must: detect flow type per provider, create flow instance, store in session
  this.sendError(
    socket,
    id,
    'NOT_IMPLEMENTED',
    'handleOAuthInitiate not yet implemented - requires flowFactories',
  );
}
```

### Task 2: Replace handleOAuthExchange with NOT_IMPLEMENTED

**Current Code** (approximately lines 544-600):
```typescript
private async handleOAuthExchange(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // ... ~55 lines of fake implementation
  // Contains: access_token: `test_access_${sessionId}`
}
```

**Replace With**:
```typescript
private async handleOAuthExchange(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // TODO: Phase 05 - Real implementation required
  // Must: call flow.exchangeCodeForToken(), store token, sanitize response
  this.sendError(
    socket,
    id,
    'NOT_IMPLEMENTED',
    'handleOAuthExchange not yet implemented - requires flow instance',
  );
}
```

### Task 3: Replace handleOAuthPoll with NOT_IMPLEMENTED

**Current Code** (approximately lines 602-650):
```typescript
private async handleOAuthPoll(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // ... ~48 lines of fake implementation
  // Contains: access_token: `test_access_${sessionId}` with immediate return
}
```

**Replace With**:
```typescript
private async handleOAuthPoll(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // TODO: Phase 05 - Real implementation required (device_code flows)
  // Must: call flow.pollForToken() for device_code flows
  this.sendError(
    socket,
    id,
    'NOT_IMPLEMENTED',
    'handleOAuthPoll not yet implemented - requires flow polling',
  );
}
```

### Task 4: Replace handleRefreshToken with NOT_IMPLEMENTED

**Current Code** (approximately lines 671-720):
```typescript
private async handleRefreshToken(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // ... ~50 lines of fake implementation
  // Contains: access_token: `refreshed_${Date.now()}`
}
```

**Replace With**:
```typescript
private async handleRefreshToken(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // TODO: Phase 07 - Real implementation required
  // Must: use RefreshCoordinator to call provider.refreshToken()
  this.sendError(
    socket,
    id,
    'NOT_IMPLEMENTED',
    'handleRefreshToken not yet implemented - requires RefreshCoordinator wiring',
  );
}
```

### Task 5: Remove oauthSessions Map Usages (Clean Up)

The fake handlers use a session map. Since we're deleting the fake logic:

1. Keep the `oauthSessions` Map declaration (will be used by real impl)
2. Remove any fake session manipulation from handleOAuthCancel
3. handleOAuthCancel can remain functional (just deletes from map)

---

## Tests That Should Now Fail

After this change, run:

```bash
npm test -- packages/cli/src/auth/proxy/__tests__/
```

**Tests that now fail** are testing REAL behavior (good).

**Tests that still pass** were testing nothing (mock theater - investigate).

### Expected Failures

Any test containing:
- `oauth_initiate` → should fail with NOT_IMPLEMENTED
- `oauth_exchange` → should fail with NOT_IMPLEMENTED
- `oauth_poll` → should fail with NOT_IMPLEMENTED
- `refresh_token` → should fail with NOT_IMPLEMENTED

### Suspicious Passes

If these tests pass, they need investigation:
- Tests that mock the entire handler
- Tests that only verify mock setup
- Tests that don't actually call the handlers

---

## Verification Commands

### Check fake patterns are gone

```bash
# All of these should return 0 matches
echo "=== Checking for fake patterns ==="

grep -n "auth.example.com" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: 0 matches

grep -n "test_access_" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: 0 matches

grep -n "refreshed_" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: 0 matches
```

### Check NOT_IMPLEMENTED is in place

```bash
echo "=== Checking for NOT_IMPLEMENTED ==="

grep -n "NOT_IMPLEMENTED" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: 4 matches (one per handler)
```

### Check TypeScript compiles

```bash
npm run typecheck
```

### Run tests and capture failures

```bash
npm test -- packages/cli/src/auth/proxy/__tests__/ 2>&1 | tee /tmp/phase01-test-results.txt
```

---

## Success Criteria

1. [x] `grep "auth.example.com"` returns 0 matches
2. [x] `grep "test_access_"` returns 0 matches
3. [x] `grep "refreshed_"` returns 0 matches
4. [x] `grep "NOT_IMPLEMENTED"` returns 4 matches
5. [x] TypeScript compiles
6. [x] Tests for oauth_initiate, oauth_exchange, refresh_token now FAIL (expected)
7. [x] Token CRUD tests still PASS (those are real)

---

## Phase Completion Marker

Create: `project-plans/issue1358_1359_1360_remediation/.completed/P01.md`

```markdown
Phase: P01
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/cli/src/auth/proxy/credential-proxy-server.ts

Changes:
- Deleted handleOAuthInitiate fake (35 lines) → NOT_IMPLEMENTED (5 lines)
- Deleted handleOAuthExchange fake (55 lines) → NOT_IMPLEMENTED (5 lines)  
- Deleted handleOAuthPoll fake (48 lines) → NOT_IMPLEMENTED (5 lines)
- Deleted handleRefreshToken fake (50 lines) → NOT_IMPLEMENTED (5 lines)

Verification:
- grep "auth.example.com": 0 matches
- grep "test_access_": 0 matches
- grep "refreshed_": 0 matches
- grep "NOT_IMPLEMENTED": 4 matches
- TypeScript: compiles
- Tests: oauth handlers fail as expected, token CRUD passes
```
