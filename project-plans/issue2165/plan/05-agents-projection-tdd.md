<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P05 @requirement:REQ-002,REQ-003,REQ-004,REQ-INT-001,REQ-INT-002 -->
# Phase 05 — Agents Projection: Behavioral RED Tests

Plan ID: PLAN-20260622-MCPOAUTHTRUTH
Phase: P05 (TDD / RED)

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- `test -f project-plans/issue2165/.completed/P04a.md` (the engine helper
  `getMcpServerOAuthStatus` + `McpOAuthStatus` exist and passed the Phase-1 gate;
  this phase delegates to that helper for the parity tests).
- Read, in full, before writing any test:
  - `project-plans/issue2165/analysis/pseudocode/agents-projection.md` (sections
    A–F, the projection Behavior Decision Table). **This phase writes ONLY tests —
    DO NOT implement the projection here.**
  - The existing gold seam `packages/agents/src/api/__tests__/mcpOAuth.behavior.test.ts`
    (the `buildOrderingDeps` no-mock-theater idiom you will mirror) and the helper
    `packages/agents/src/api/__tests__/helpers/fakeMcpManager.ts` (`fakeServerConfig`).

## Requirements Under Test (expanded)

- **REQ-002 — corrected `authenticated`.**
  - GIVEN a server whose engine OAuth status is resolved by an injected
    `getOAuthStatus` closure, WHEN `agent.mcp.auth(server)` / `details()` project it,
    THEN `authenticated === (oauthStatus === 'authenticated')` — NOT the in-session
    marker.
- **REQ-003 — real `requiresAuth`.**
  - GIVEN an injected `getRequiresAuth` closure, WHEN the projection runs, THEN
    `requiresAuth` equals that closure's boolean (never hardcoded `true`); WHEN the
    closure is absent, THEN `requiresAuth === false` (undefined-safe).
- **REQ-004 — additive quad-state + session distinction.**
  - GIVEN any projected MCP auth shape, THEN it carries `oauthStatus: McpOAuthStatus`
    (the resolved quad-state) AND `sessionAuthenticated: boolean` (the preserved
    in-session marker), in addition to every existing field.
- **REQ-INT-001 — engine↔agents parity.**
  - GIVEN the injected `getOAuthStatus` is the REAL engine helper
    `getMcpServerOAuthStatus` seeded through `MCPOAuthTokenStorage.setTokenStore` +
    the `mcpServerRequiresOAuth` map, WHEN the projection reports a server across all
    four token/requirement states, THEN the reported `oauthStatus` EQUALS the helper's
    direct verdict and `authenticated` equals `(verdict === 'authenticated')`.
- **REQ-INT-002 — session-vs-persisted independence.**
  - GIVEN `oauthStatus` and the in-session marker are set independently, THEN
    `oauthStatus` and `sessionAuthenticated` vary independently (e.g. valid token +
    no session login ⇒ `authenticated:true, sessionAuthenticated:false`; in-session
    login + `none`/`expired` ⇒ `authenticated:false, sessionAuthenticated:true`).

## Files to Create

Create **one** new behavioral test file (DO NOT modify the existing
`mcpOAuth.behavior.test.ts` in this phase — its reconciliation belongs to P06):

`packages/agents/src/api/__tests__/mcpProjection.behavior.test.ts`

Design (mirror the existing `mcpOAuth.behavior.test.ts` exactly — same
no-mock-theater seam):

1. `import { McpControl } from '../control/mcpControl.js';` and
   `import type { McpControlDeps } from '../control/mcpControl.js';`
   (the `.behavior.test.ts` boundary is T17-exempt; deep-importing the control +
   core types is permitted here, as the existing sibling file already does).
2. `import { getMcpServerOAuthStatus } from '@vybestack/llxprt-code-core';` and
   `import type { McpOAuthStatus } from '@vybestack/llxprt-code-core';` (the
   PUBLIC-ROOT engine seam — Phase 1's helper re-exported through the core barrel;
   NO deep `packages/mcp` import).
3. A local `buildProjectionDeps(callLog, opts)` that returns an `McpControlDeps`
   closing over **controllable, observable** state — NEVER spies/stubs:
   - `oauthStatusByServer?: Record<string, McpOAuthStatus>` →
     `getOAuthStatus: async (s) => oauthStatusByServer[s] ?? 'not-required'`
     (OMIT the whole `getOAuthStatus` key when `opts.omitOAuthStatus === true`, to
     drive the undefined-safe path).
   - `requiresAuthByServer?: Record<string, boolean>` →
     `getRequiresAuth: (s) => requiresAuthByServer[s] ?? false` (OMIT the key when
     `opts.omitRequiresAuth === true`).
   - a real `Set<string>` session marker → `isMcpAuthenticated`/`markAuthenticated`
     (the SAME pattern as the existing file; observed through real Set membership).
   - `manager` / `servers` / `performOAuth` / `tools` exactly as the existing
     `buildOrderingDeps` does (reuse `fakeServerConfig`).
   - The builder's return type is annotated `: McpControlDeps`. NO `as any`, NO cast
     of the control at the call site — construct plainly as `new McpControl(deps)`.
   For the REQ-INT-001 parity block, build a SEPARATE deps whose `getOAuthStatus`
   delegates to the REAL helper:
   `getOAuthStatus: (s) => getMcpServerOAuthStatus(s, { requiresOAuth: true })`,
   with the token store seeded via `MCPOAuthTokenStorage.setTokenStore(mockStore)`
   and `mockStore.setCredentials(...)` (mirror Phase-1's `MockTokenStorage`
   seam from `oauth-token-storage.test.ts`), resetting `mcpServerRequiresOAuth`
   keys + restoring the token store in `afterEach`.

## Required Scenarios (write ALL — behavioral, no mock theater)

Deterministic (`it`):

- **T20** `auth('s')` with `oauthStatus='authenticated'`, `requiresAuth=true`,
  session=`false` ⇒ `toStrictEqual({ server:'s', authenticated:true,
  requiresAuth:true, oauthStatus:'authenticated', sessionAuthenticated:false })`.
  `@requirement:REQ-002 @scenario:auth-authenticated`
- **T21** `auth('s')` with `oauthStatus='expired'`, `requiresAuth=true`,
  session=`false` ⇒ `authenticated:false`, `oauthStatus:'expired'`,
  `requiresAuth:true`, `sessionAuthenticated:false`.
  `@requirement:REQ-002 @scenario:auth-expired`
- **T22** `auth('s')` with `oauthStatus='none'`, `requiresAuth=true`, session=`true`
  ⇒ `authenticated:false`, `oauthStatus:'none'`, `requiresAuth:true`,
  `sessionAuthenticated:true` (INDEPENDENCE: session true while persisted `none`).
  `@requirement:REQ-INT-002 @scenario:auth-none-session-true`
- **T23** `auth('s')` with `oauthStatus='not-required'`, `requiresAuth=false`,
  session=`false` ⇒ `authenticated:false`, `requiresAuth:false`,
  `oauthStatus:'not-required'`, `sessionAuthenticated:false`.
  `@requirement:REQ-003 @scenario:auth-not-required`
- **T24** `auth('s')` with BOTH closures omitted (`omitOAuthStatus`,
  `omitRequiresAuth`), session=`true` ⇒ `authenticated:false`, `requiresAuth:false`,
  `oauthStatus:'not-required'`, `sessionAuthenticated:true` (R-UNDEFINED-SAFE; no
  throw). `@requirement:REQ-003 @scenario:auth-undefined-safe`
- **T25** `details()` over two servers `alpha`(`oauthStatus='authenticated'`,
  `requiresAuth=true`, session=`false`) and `beta`(`oauthStatus='expired'`,
  `requiresAuth=true`, session=`true`) ⇒ each server detail carries the projected
  `authenticated`/`requiresAuth`/`oauthStatus`/`sessionAuthenticated`; assert
  `typeof srv.oauthStatus === 'string'` for every server (NO Promise leaks into a
  field — R-ASYNC-DETAIL). `@requirement:REQ-004 @scenario:details-projection`
- **T26** `authenticate('s')` happy path (`servers.s` with `oauth.enabled:true`,
  `performOAuth` resolves, `oauthStatusByServer.s='authenticated'`) ⇒ returns
  `authenticated:true`, `oauthStatus:'authenticated'`, `requiresAuth:true`,
  `sessionAuthenticated:true` (markAuthenticated ran), AND
  `callLog` is `['oauth:s','restart:s','setTools']` (handshake order preserved).
  `@requirement:REQ-002 @scenario:authenticate-rereads-real`
- **T27** `authenticate('nope')` (NOT in configs), `oauthStatusByServer.nope='none'`
  ⇒ returns `authenticated:false`, `oauthStatus:'none'`, performs NO
  oauth/restart/setTools (`callLog` `[]`) — the unwired path projects REAL status,
  no fabricated `authenticated:false, requiresAuth:true`.
  `@requirement:REQ-002 @scenario:authenticate-unknown-real`

Property (`it` + `fc.assert` — MIN 2, target ≥30%):

- **PROP-A** for any `oauthStatus ∈ {authenticated,expired,none,not-required}` and any
  `session ∈ {true,false}`, `auth(server)` yields
  `authenticated === (status === 'authenticated')` AND `oauthStatus === status` AND
  `sessionAuthenticated === session` (derivation + independence).
  `@requirement:REQ-INT-002 @scenario:prop-derive-independent`
- **PROP-B** for any `requiresAuth ∈ {true,false}`, `auth(server).requiresAuth === r`
  (real pass-through, never hardcoded). `@requirement:REQ-003 @scenario:prop-requires`
- **PROP-C** (parity) seed the REAL token store + `mcpServerRequiresOAuth` so the
  injected `getOAuthStatus` is the real `getMcpServerOAuthStatus`; for each of the
  four seeded states (valid token / expired token / required-no-creds /
  not-required) assert `auth('s').oauthStatus === (await
  getMcpServerOAuthStatus('s', { requiresOAuth: true|false }))` AND
  `auth('s').authenticated === (that === 'authenticated')`.
  `@requirement:REQ-INT-001 @scenario:prop-engine-agents-parity`
- **PROP-D** for a generated 1..4-server config map with per-server statuses,
  `details().servers` length equals the key count AND every `srv.oauthStatus` equals
  the seeded status for `srv.name` (faithful per-server projection through the async
  up-front resolve). `@requirement:REQ-INT-001 @scenario:prop-details-parity`

## Constraints

- Assert REAL projected VALUES (`toStrictEqual` / `.toBe(...)`), never
  `toHaveBeenCalled` / `vi.fn(` / `vi.spyOn` / `mockResolvedValue` /
  `mockReturnValue`. NO reverse tests (`toThrow('NotYetImplemented')` /
  `not.toThrow()`). NO `any` / `as any`. NO structure-only (`toBeDefined` as the
  sole assertion).
- ≥30% property-based, MIN-2 distinct property cases (the gate below COMPUTES it).
- The new file must FAIL for BEHAVIORAL reasons (missing `oauthStatus` /
  `sessionAuthenticated` fields resolve to `undefined`; `authenticated` still the
  in-session marker; `requiresAuth` still hardcoded `true`) — NOT for
  compile/import/setup reasons.

## Verification (BLOCKING — run from repo root)

```bash
set -o pipefail
F="packages/agents/src/api/__tests__/mcpProjection.behavior.test.ts"

# 0) file exists + carries plan/requirement markers
test -f "$F" || { echo "FAIL: missing $F"; exit 1; }
grep -q "@plan:PLAN-20260622-MCPOAUTHTRUTH.P05" "$F" || { echo "FAIL: plan marker"; exit 1; }
grep -qE "@requirement:REQ-002" "$F" && grep -qE "@requirement:REQ-003" "$F" \
  && grep -qE "@requirement:REQ-004" "$F" \
  && grep -qE "@requirement:REQ-INT-001" "$F" \
  && grep -qE "@requirement:REQ-INT-002" "$F" \
  || { echo "FAIL: requirement coverage"; exit 1; }

# 1) NO mock theater / reverse / any  (grep finding a hit => FAIL)
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue|vi\.fn\(|vi\.spyOn|toThrow\('NotYetImplemented'\)|\bas any\b|: any\b" "$F"; then
  echo "FAIL: banned mock-theater / reverse / any pattern present"; exit 1
fi

# 2) delegates to the REAL engine helper via the PUBLIC ROOT (parity seam present)
grep -q "getMcpServerOAuthStatus" "$F" || { echo "FAIL: no engine-helper parity"; exit 1; }
grep -q "from '@vybestack/llxprt-code-core'" "$F" || { echo "FAIL: helper not via core barrel"; exit 1; }
# no deep packages/mcp import
if grep -nE "from '@vybestack/llxprt-code-mcp" "$F"; then echo "FAIL: deep mcp import"; exit 1; fi

# 3) asserts the new fields + corrected derivation behaviorally
grep -q "oauthStatus" "$F" || { echo "FAIL: oauthStatus not asserted"; exit 1; }
grep -q "sessionAuthenticated" "$F" || { echo "FAIL: sessionAuthenticated not asserted"; exit 1; }

# 4) property ratio (MIN-2, >=30%)  — internally-consistent counting
TOTAL=$(grep -cE "^\s*it\(" "$F")
PROP=$(grep -cE "fc\.assert\(" "$F")
echo "TOTAL it()=$TOTAL  PROP fc.assert()=$PROP"
[ "$PROP" -ge 2 ] || { echo "FAIL: <2 property tests"; exit 1; }
awk -v p="$PROP" -v t="$TOTAL" 'BEGIN{ if (t==0 || (p*100)/t < 30){ print "FAIL: property ratio < 30%"; exit 1 } }'

# 5) RED STATE: the new behavioral suite must FAIL, and NOT for compile/import reasons
npx vitest run "$F" > /tmp/p05_red.log 2>&1; STATUS=$?
if [ "$STATUS" -eq 0 ]; then echo "FAIL: expected RED but suite passed"; cat /tmp/p05_red.log; exit 1; fi
if grep -qE "Cannot find module|SyntaxError|Failed to resolve import|ReferenceError" /tmp/p05_red.log; then
  echo "FAIL: RED for the WRONG (compile/import) reason"; cat /tmp/p05_red.log; exit 1
fi
echo "PASS: P05 behavioral-RED established (suite fails for behavioral reasons)."
```

## Semantic Checklist (self-review before marker)

- [ ] Every assertion checks an observable projected VALUE or the `callLog` ORDER —
      none assert spy calls.
- [ ] The undefined-safe case (T24) and independence cases (T22, PROP-A) are present.
- [ ] PROP-C wires the REAL engine helper through a seeded token store (true
      engine↔agents parity, not a re-derivation in the test).
- [ ] No existing test file was modified by this phase.

## Success Criteria

- New file present, markers present, banned patterns absent, parity seam present,
  property ratio ≥30% / ≥2, and the suite is RED for behavioral reasons.

## Failure Recovery

- If RED fails because the suite unexpectedly PASSES: a field/derivation you asserted
  already exists — strengthen the assertion to the corrected semantics (derived
  `authenticated`, real `requiresAuth`, present `oauthStatus`/`sessionAuthenticated`).
- If RED fails for `Cannot find module`: you imported the not-yet-created production
  path or a deep `packages/mcp` path — import the control via `../control/mcpControl.js`
  and the helper via the `@vybestack/llxprt-code-core` barrel only.

## Deferred-Detection (BLOCKING)

```bash
F="packages/agents/src/api/__tests__/mcpProjection.behavior.test.ts"
if grep -nE "TODO|FIXME|HACK|STUB|placeholder|for now|skip\(|\.skip\b|xit\(|xdescribe\(" "$F"; then
  echo "FAIL: deferred/placeholder/skipped test marker present"; exit 1
fi
echo "PASS: no deferred markers."
```

## Completion Marker

Write `project-plans/issue2165/.completed/P05.md` containing: the new file path; the
final `TOTAL it()` / `PROP fc.assert()` counts and computed percentage; the exact
RED failure summary (which assertions failed and that none failed for
compile/import reasons); confirmation no existing file was modified.
