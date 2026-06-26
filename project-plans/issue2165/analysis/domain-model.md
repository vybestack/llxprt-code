<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P01 @requirement:REQ-001,REQ-002,REQ-003,REQ-004,REQ-005,REQ-INT-001,REQ-INT-002 -->
# Domain Model: Project Real MCP OAuth Status through the Agent API (prereq for #1595)

Plan ID: PLAN-20260622-MCPOAUTHTRUTH
Source: `project-plans/issue2165/specification.md`
Scope: ANALYSIS ONLY — no implementation code. Models the entities, relationships, state transitions,
invariants, edge cases, and the test-harness cross-reference for the canonical mcp OAuth-status helper
and its agents-layer projection.

---

## 1. Entities

### 1.1 McpOAuthStatus (NEW value-union type — `packages/mcp`)
The quad-state OAuth truth for one MCP server: `'authenticated' | 'expired' | 'none' |
'not-required'`. Lives at `packages/mcp/src/auth/oauth-status.ts`, re-exported through
`mcp/src/auth/index.ts` → `mcp/src/index.ts` → `core/src/index.ts` (type-only) → `agents` api barrel
(type-only).
- Invariant: it is a STRING UNION only — never carries a token or credential field (R-MASKED).

### 1.2 getMcpServerOAuthStatus (NEW pure-ish async function — `packages/mcp`)
Canonical derivation: `(serverName, opts?) => Promise<McpOAuthStatus>`. Composes three primitives that
ALREADY exist:
- `mcpServerRequiresOAuth: Map<string, boolean>` (`client/mcp-status.ts:46`) — the runtime
  "requires OAuth" signal.
- `MCPOAuthTokenStorage.getToken(serverName): Promise<MCPOAuthCredentials | null>`
  (`auth/oauth-token-storage.ts:104-109`) — persisted credential accessor (masked, static).
- `MCPOAuthTokenStorage.isTokenExpired(token: MCPOAuthToken): boolean`
  (`auth/oauth-token-storage.ts:130-136`) — expiry math (5-min skew buffer).
- Invariant: OWNS the "required?" OR-combine (R-REQUIRED-OR); NEVER throws (R-FAULT-TOLERANT);
  threads the INNER `credentials.token` into `isTokenExpired` (R-INNER-TOKEN); returns the enum only
  (R-MASKED).

### 1.3 MCPOAuthCredentials / MCPOAuthToken (EXISTING — read-only here)
`MCPOAuthCredentials` (`token-store.ts:43-50`) = `{ serverName; token: MCPOAuthToken; clientId?;
tokenUrl?; mcpServerUrl?; updatedAt }`. `MCPOAuthToken` (`token-store.ts:32-38`) = `{ accessToken;
refreshToken?; expiresAt?: number; tokenType; scope? }`. The helper reads `.token` and passes it to
`isTokenExpired` (which reads `.expiresAt`). It does NOT surface either object.

### 1.4 mcpServerRequiresOAuth (EXISTING runtime map — read-only here)
`Map<string, boolean>` declared at `client/mcp-status.ts:46`. PROVEN monotonic/true-only: the ONLY
writers are `mcp-connection.ts:269` and `:318`, both `set(name, true)`; there is NO `.clear()`,
`.delete()`, or `set(name, false)` anywhere in `packages/` (grep-verified). So `.get(name) === true`
or `.has(name)` is a safe, lazily-accumulating "this server demanded OAuth at least once" signal.
- Invariant: the helper only READS it (`.get`); it never mutates it.

### 1.5 AgentMcpControl / McpControl (EXISTING — extended/corrected projection)
The public MCP sub-controller (`agent.ts` interface; `control/mcpControl.ts` impl). This plan CORRECTS
`auth()` (`:253`) and `authenticate()` (`:316`) and `details()`/`buildServerDetail()` (`:348`/`:383`)
to report real `oauthStatus` + corrected `authenticated`/`requiresAuth` + new `sessionAuthenticated`.
- Invariant: existing method NAMES/signatures unchanged (R-NONBREAK); resolves status through
  injected closures PER CALL (R-DELEGATE); undefined-safe for partial deps (R-UNDEFINED-SAFE).

### 1.6 McpControlDeps (EXISTING — extended)
The injected-closure dependency bag (`mcpControl.ts:71`). Gains `getOAuthStatus?: (server) =>
Promise<McpOAuthStatus>` and `getRequiresAuth?: (server) => boolean`; RETAINS `isMcpAuthenticated`
(now feeds `sessionAuthenticated`, not `authenticated`).
- Invariant: closures are OPTIONAL — controller defaults safely when absent (R-UNDEFINED-SAFE).

### 1.7 buildMcpControlDeps / mcpControlWiring (EXISTING — extended)
The wiring that binds the closures to the live `Config` (`control/mcpControlWiring.ts`). Binds
`getOAuthStatus` to `getMcpServerOAuthStatus(server, { requiresOAuth: serverConfig?.oauth?.enabled
=== true })` and `getRequiresAuth` to `serverConfig?.oauth?.enabled === true ||
mcpServerRequiresOAuth.has(server)`, reading `serverConfig` from `config.getMcpServers()?.[server]`.
- Invariant: undefined-safe over `getMcpServers()` (may be undefined / omit the server)
  (R-UNDEFINED-SAFE); `MCPOAuthProvider`/`getMcpServerOAuthStatus`/`mcpServerRequiresOAuth` reached
  via the bare `@vybestack/llxprt-code-core` barrel — NO new dependency, NO deep import
  (R-CORE-BARREL-SEAM).

### 1.8 In-session marker (EXISTING — preserved, renamed in projection)
`authState.mcpAuth: Set<string>` (`authState.ts:86`), read via `isMcpAuthenticated`
(`agentImpl.ts:500`). Today it (wrongly) feeds `authenticated`. After this plan it feeds the NEW,
accurately-named `sessionAuthenticated` field. The Set itself is NOT modified.

---

## 2. Relationships

```
mcpServerRequiresOAuth (map) ─┐
MCPOAuthTokenStorage.getToken ─┼─► getMcpServerOAuthStatus (packages/mcp) ──► McpOAuthStatus
MCPOAuthTokenStorage.isTokenExpired ─┘                                          │
                                                                               │ (core barrel re-export)
                                                                               ▼
config.getMcpServers()[server].oauth.enabled ──► buildMcpControlDeps.getOAuthStatus / getRequiresAuth
                                                                               │
                                                                               ▼
                                          McpControl.auth()/authenticate()/details()
                                                                               │
                                                                               ▼
                            McpServerAuthStatus / McpServerDetail { oauthStatus, authenticated*,
                                          requiresAuth*, sessionAuthenticated }  (* corrected)
```

- The agents layer NEVER imports `packages/mcp` directly and NEVER re-derives expiry — it calls the
  helper (through the core barrel) and projects the result (R-NO-REDERIVE).
- `packages/auth` is NOT in this graph (different domain).

---

## 3. State Transitions (per server, as observed through the API)

| From | Event | To (oauthStatus) | authenticated | requiresAuth | sessionAuthenticated |
|---|---|---|---|---|---|
| not configured for oauth | — | `'not-required'` | false | false | false |
| oauth required, no token | (fresh) | `'none'` | false | true | false |
| oauth required, valid token persisted | (prior session) | `'authenticated'` | true | true | false |
| oauth required, token past expiry+buffer | (time passes) | `'expired'` | false | true | false |
| `'none'` | `auth.mcpLogin("s")` (in-session only) | `'none'` | false | true | **true** |
| `'none'` | `mcp.authenticate("s")` success (writes creds) | `'authenticated'` | true | true | true |

> Key insight: `sessionAuthenticated` and `authenticated` are INDEPENDENT axes. A server can be
> `sessionAuthenticated: true` (mcpLogin marked it this session) while `authenticated: false`
> (no persisted credential yet) — and vice-versa (valid disk token on a fresh process:
> `authenticated: true`, `sessionAuthenticated: false`).

---

## 4. Invariants (R-codes — referenced by pseudocode + tests)

- **R-REQUIRED-OR** — "required?" = `opts?.requiresOAuth === true || mcpServerRequiresOAuth.get(name)
  === true`. If not required, return `'not-required'` WITHOUT reading storage.
- **R-INNER-TOKEN** — expiry is computed on `credentials.token` (the inner `MCPOAuthToken`), never on
  the `MCPOAuthCredentials` wrapper.
- **R-FAULT-TOLERANT** — any absence/throw from token storage yields `'none'`; the helper never
  throws.
- **R-MASKED** — only the `McpOAuthStatus` enum crosses the boundary; no token/credential fields.
- **R-AUTHENTICATED-DERIVED** — `authenticated === (oauthStatus === 'authenticated')` (persisted
  truth), in BOTH `McpServerAuthStatus` and `McpServerDetail`.
- **R-REQUIRESAUTH-REAL** — `requiresAuth` reflects the real per-server value; never hardcoded `true`.
- **R-SESSION-DISTINCT** — `sessionAuthenticated` carries the old in-session `isMcpAuthenticated`
  signal, distinct from `authenticated`.
- **R-DELEGATE** — resolve `getOAuthStatus`/`getRequiresAuth`/`isMcpAuthenticated` per call; no cached
  OAuth state in the controller.
- **R-UNDEFINED-SAFE** — absent closures / absent `getMcpServers()` / missing server → safe defaults
  (`'not-required'` / `false`), never a throw.
- **R-NONBREAK** — no existing public export removed or changed in shape; `authenticated`/
  `requiresAuth` NAMES retained; new fields additive.
- **R-NO-REDERIVE** — the agents layer calls the helper; it does NOT reimplement expiry / storage
  reads.
- **R-CORE-BARREL-SEAM** — agents reaches the helper via the bare `@vybestack/llxprt-code-core`
  barrel; no new dependency, no deep import.
- **R-ASYNC-DETAIL** — `details()` resolves all per-server OAuth statuses up-front (await/Promise.all)
  so no `Promise` leaks into the `oauthStatus` field of a `McpServerDetail`.

---

## 5. Edge Cases

| Edge | Expected behavior | Invariant |
|---|---|---|
| `requiresOAuth` false AND map lacks server | `'not-required'`; storage NOT read | R-REQUIRED-OR |
| `requiresOAuth` false BUT map has server (runtime-detected) | treated as required → reads storage | R-REQUIRED-OR |
| token store not configured (`setTokenStore` never called / throws) | `'none'` | R-FAULT-TOLERANT |
| `getToken` resolves `null` | `'none'` | REQ-001.4 |
| credential present, `expiresAt` undefined/invalid | `isInvalidExpiry` guard → treated NOT expired → `'authenticated'` | engine-owned (`oauth-token-storage.ts:132`) |
| credential present, `expiresAt` in the past (+ 5-min buffer) | `'expired'` | engine-owned (`:135`) |
| `config.getMcpServers()` undefined | `getRequiresAuth` false; `getOAuthStatus` → `'not-required'` | R-UNDEFINED-SAFE |
| server omitted from `getMcpServers()` | same as above | R-UNDEFINED-SAFE |
| partial deps (no `getOAuthStatus`/`getRequiresAuth`) | `oauthStatus:'not-required'`, `requiresAuth:false`, `authenticated:false`; `sessionAuthenticated` from `isMcpAuthenticated ?? false` | R-UNDEFINED-SAFE |
| `details()` over 0 configured servers | `{ servers: [], blockedServers: [...] }` | R-ASYNC-DETAIL |

---

## 6. Test-Harness Cross-Reference (no mock theater)

### 6.1 Phase 1 (packages/mcp helper) — REAL token store seam
- Drive through the REAL `MCPOAuthTokenStorage.setTokenStore(store)` seam with a real in-memory
  `MockTokenStorage implements TokenStorage` (the EXISTING pattern at
  `oauth-token-storage.test.ts:12`, used at `:72-81`) — NOT `vi.fn`/spies. Write a credential to make
  `'authenticated'`; write one with a past `expiresAt` to make `'expired'`; leave empty for `'none'`;
  point `setTokenStore` at a store whose `getCredentials` throws for the fault-tolerant `'none'`.
- Drive BOTH "required" paths: (a) `opts.requiresOAuth: true` (config-flag path); (b)
  `mcpServerRequiresOAuth.set(name, true)` (runtime-map path). RESET the map between cases (delete the
  keys the test set) so cases are independent — the map is module-global.
- Property (≥30%, MIN-2): over arbitrary server names + arbitrary (present/expired/absent) credential
  states, assert the returned enum matches the decision table; over the not-required axis, assert
  `'not-required'` and that storage was never consulted (observable: a store whose `getCredentials`
  pushes the name into a shared `callLog` array — assert the name is ABSENT when not-required).

### 6.2 Phase 2 (agents projection) — REAL closures recording into a callLog
- `.behavior.test.ts` (T17-exempt) directly constructs `new McpControl(deps)` with REAL closures:
  `getOAuthStatus: async (s) => statusByServer[s] ?? 'not-required'`, `getRequiresAuth: (s) =>
  requiresByServer[s] ?? false`, `isMcpAuthenticated: (s) => sessionSet.has(s)`. Assert the projected
  `oauthStatus`/`authenticated`/`requiresAuth`/`sessionAuthenticated` for each decision-table row.
- Assert the CORRECTION explicitly: a server with `getOAuthStatus → 'authenticated'` but NOT in the
  session set yields `authenticated: true, sessionAuthenticated: false`; a server in the session set
  but `getOAuthStatus → 'none'` yields `authenticated: false, sessionAuthenticated: true`. This single
  pair kills the "authenticated still reads the Set" mutant.
- `details()`: two servers in different states; assert per-server projection and that no field holds a
  `Promise` (assert `typeof detail.oauthStatus === 'string'`).
- Property (≥30%, MIN-2): over arbitrary maps of server→status and server→requires, assert the
  invariants R-AUTHENTICATED-DERIVED and R-REQUIRESAUTH-REAL hold for every projected server.
- Non-breaking: extend the compile-anchor fence (`additiveSurface.types.ts`) to read the new fields;
  extend the runtime guard (`publicSurface.nonbreaking.test.ts`) to assert the new fields exist AND
  no prior field was removed.

### 6.3 Mutation (scoped, per the LOCKED policy)
- Mutate ONLY the logic-bearing files: `packages/mcp/src/auth/oauth-status.ts` (Phase 1) and the
  CHANGED projection logic in `packages/agents/src/api/control/mcpControl.ts` +
  `control/mcpControlWiring.ts` (Phase 2). NOT barrels/glue.
- A surviving mutant is a REVIEW QUESTION: add a behavioral case if it maps to a real observable
  behavior; if killing it requires a private/internal/mock assertion, LEAVE IT SURVIVED; if genuinely
  equivalent, `// Stryker disable next-line` + a written reason. Behavioral honesty (RULES.md)
  overrides the 80% number, documented in the phase doc if they ever conflict.

---

## 7. Package-Boundary Confirmation (no cycle, no new dep)

- `client/mcp-status.ts` has ZERO imports (pure leaf) and `auth/*` never imports `../client` today
  (grep-verified). So the NEW edge `auth/oauth-status.ts → ../client/mcp-status.js` (for
  `mcpServerRequiresOAuth`) introduces NO import cycle.
- `packages/agents` deps = `@vybestack/llxprt-code-core` (+ providers) only; it reaches the helper via
  the core barrel re-export. No `packages/mcp` dependency is added. No deep import. `packages/auth` is
  untouched.
