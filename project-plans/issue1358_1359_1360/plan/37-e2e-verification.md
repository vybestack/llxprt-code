# Phase 37: E2E Verification — Full Sandbox Credential Flow

## Phase ID
`PLAN-20250214-CREDPROXY.P37`

## Prerequisites
- Required: Phase 36a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P36" packages/`
- Expected: All migration and deprecation complete, factory functions wired, sandbox.ts integrated

## Requirements Implemented (Expanded)

This phase does not implement new requirements — it VERIFIES that all previously implemented requirements work together end-to-end in a realistic scenario.

### Cross-Cutting Verification Targets

| Requirement | What to Verify |
|---|---|
| R2.1–R2.4 | Factory detection selects correct implementation; singleton works |
| R3.1–R3.6 | Socket created with correct path, permissions, nonce; env var passed |
| R5.1–R5.4 | Framing protocol handles real messages correctly |
| R6.1–R6.5 | Handshake succeeds; request IDs correlate |
| R8.1–R8.9 | All TokenStore operations work via proxy |
| R9.1–R9.5 | All ProviderKeyStorage operations work via proxy |
| R10.1–R10.4 | Token sanitization holds across all operations |
| R11.1–R11.5 | Host-side refresh works for all providers |
| R16.1–R16.8 | Proactive renewal schedules and fires correctly |
| R17.1–R17.5 | PKCE code-paste login works via proxy |
| R18.1–R18.6 | Device code login works via proxy |
| R19.1–R19.3 | Browser redirect login works via proxy |
| R20.1–R20.9 | Session management (single-use, expiry, GC) |
| R21.1–R21.3 | Profile scoping enforced |
| R22.1 | Rate limiting enforced |
| R23.1–R23.5 | Error handling correct across all scenarios |
| R25.1–R25.5 | Lifecycle correct (start, stop, signal cleanup) |
| R26.1–R26.3 | Non-sandbox and seatbelt modes unaffected |

## Implementation Tasks

### Files to Create
- `packages/cli/src/auth/proxy/__tests__/e2e-credential-flow.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P37`
  - End-to-end scenarios that simulate the full sandbox credential lifecycle:

    **Scenario 1: Full Token Lifecycle**
    1. Start proxy server with in-memory token store
    2. Create `ProxyTokenStore` connected to the socket
    3. Store a token with `refresh_token` on the host side
    4. `getToken()` via proxy → verify `access_token` present, `refresh_token` absent
    5. `saveToken()` with a different token → verify host receives it sans `refresh_token`
    6. `removeToken()` → verify host store is empty
    7. Stop proxy → verify socket removed

    **Scenario 2: Login via Proxy (PKCE Redirect)**
    1. Start proxy server with mock OAuth provider (Anthropic-like PKCE)
    2. Create `ProxyOAuthAdapter` connected to the socket
    3. Call `login("anthropic")` → receive auth URL
    4. Simulate user code input
    5. Verify `oauth_exchange` returns sanitized token
    6. Verify host store has full token WITH `refresh_token`
    7. Verify inner received token WITHOUT `refresh_token`

    **Scenario 3: Login via Proxy (Device Code)**
    1. Start proxy server with mock OAuth provider (device code flow)
    2. Call `login("qwen")` → receive verification URL + user code
    3. Simulate poll loop: pending → pending → complete
    4. Verify sanitized token returned to inner
    5. Verify host store has full token

    **Scenario 4: Token Refresh via Proxy**
    1. Start proxy with expired token in host store
    2. `ProxyOAuthAdapter.refresh("provider", "bucket")` → triggers host refresh
    3. Verify new sanitized token returned
    4. Verify host store has new token with preserved `refresh_token`

    **Scenario 5: Proactive Renewal**
    1. Start proxy with near-expiry token
    2. `getToken()` triggers proactive renewal scheduling
    3. Advance timers to renewal time
    4. Verify renewal fires, new token stored on host
    5. Next `getToken()` returns new token

    **Scenario 6: Profile Scoping**
    1. Start proxy with `allowedProviders: ["anthropic"]`
    2. `getToken("anthropic", "default")` → succeeds
    3. `getToken("gemini", "default")` → returns `UNAUTHORIZED` error

    **Scenario 7: Connection Loss**
    1. Start proxy, connect `ProxyTokenStore`
    2. Kill proxy server
    3. Next `getToken()` → throws "Credential proxy connection lost"

    **Scenario 8: Concurrent Operations**
    1. Start proxy, send multiple `getToken` requests concurrently
    2. All receive correct responses
    3. Rate limiting kicks in if threshold exceeded

    **Scenario 9: Non-Sandbox Mode Unaffected**
    1. `LLXPRT_CREDENTIAL_SOCKET` is NOT set
    2. `createTokenStore()` returns `KeyringTokenStore`
    3. Normal credential operations work without proxy

### Test Architecture
- Tests create REAL `CredentialProxyServer` and REAL client components
- Connected via REAL Unix sockets
- OAuth providers test-doubled at HTTP boundary only
- Token stores can use in-memory implementations for the host-side backing store
- `vi.useFakeTimers()` for proactive renewal timing

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P37
 * @requirement R2, R3, R5, R6, R8, R9, R10, R11, R16, R17, R18, R19, R20, R21, R22, R23, R25, R26
 */
```

## Verification Commands

```bash
npm test -- packages/cli/src/auth/proxy/__tests__/e2e-credential-flow.test.ts
npm run typecheck
```

## Success Criteria
- All 9 E2E scenarios pass
- Tests exercise REAL components across REAL sockets
- Token sanitization invariant holds in every scenario (no `refresh_token` crosses socket)
- Non-sandbox mode confirmed unaffected
- No test doubles except at outermost boundaries (HTTP, backing store)

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/__tests__/e2e-credential-flow.test.ts`
2. Debug failing scenario by checking individual component test suites (P03–P29 tests)

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P37.md`
