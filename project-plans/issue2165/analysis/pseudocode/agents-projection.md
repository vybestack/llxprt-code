<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P02 @requirement:REQ-002,REQ-003,REQ-004,REQ-005,REQ-INT-002 -->
# Pseudocode: Agents-Layer Projection of Real MCP OAuth Status (`packages/agents`)

Plan ID: PLAN-20260622-MCPOAUTHTRUTH
Modules to change: `packages/agents/src/api/agent.ts` (types + re-export),
`packages/agents/src/api/control/mcpControl.ts` (`auth`/`authenticate`/`details`/`buildServerDetail` +
`McpControlDeps`), `packages/agents/src/api/control/mcpControlWiring.ts` (`buildMcpControlDeps`),
`packages/agents/src/api/index.ts` (type barrel).
Requirements: REQ-002, REQ-003, REQ-004, REQ-005, REQ-INT-002.

---

## Design Rationale — READ FIRST

`packages/mcp` now owns the truth (`getMcpServerOAuthStatus`). The agents layer's ONLY job is to
PROJECT that truth onto the public types — it must NOT re-derive expiry or read storage. The three
methods that report MCP auth (`auth`, `authenticate`, `details`) currently read an in-session Set for
`authenticated` and hardcode `requiresAuth: true`. We:

- ADD two closures to `McpControlDeps` (`getOAuthStatus`, `getRequiresAuth`) wired to the live engine,
- DERIVE `authenticated = (oauthStatus === 'authenticated')` and `requiresAuth = getRequiresAuth(...)`,
- PRESERVE the old in-session signal under the new, accurate name `sessionAuthenticated`,
- ADD `oauthStatus` (quad-state) to both public shapes,
- keep every existing field NAME (non-breaking; the meaning correction IS the bugfix).

`details()`'s helper `buildServerDetail` is currently SYNC; since OAuth status is async, we resolve
all per-server statuses UP FRONT (one `Promise.all` over the configured names) and pass the resolved
value into the (now sync) detail builder so no `Promise` leaks into a field (R-ASYNC-DETAIL).

The wiring reaches the helper through the bare `@vybestack/llxprt-code-core` barrel (agents already
imports `MCPOAuthProvider` from there) — no new dependency, no deep import (R-CORE-BARREL-SEAM).

---

## Interface Contracts

```typescript
// agent.ts — additive/corrective
export type McpOAuthStatus = /* re-exported type-only from @vybestack/llxprt-code-core */;

export interface McpServerAuthStatus {
  readonly server: string;
  readonly authenticated: boolean;        // CORRECTED meaning
  readonly requiresAuth: boolean;         // CORRECTED meaning
  readonly oauthStatus: McpOAuthStatus;   // NEW
  readonly sessionAuthenticated: boolean; // NEW
  readonly authUrl?: string;
}
export interface McpServerDetail {
  readonly name: string;
  readonly authenticated: boolean;        // CORRECTED
  readonly requiresAuth: boolean;         // NEW
  readonly oauthStatus: McpOAuthStatus;   // NEW
  readonly sessionAuthenticated: boolean; // NEW
  readonly tools?: readonly ToolInfo[];
  readonly prompts?: readonly McpPromptInfo[];
  readonly resources?: readonly McpResourceInfo[];
}

// mcpControl.ts — McpControlDeps additions
readonly getOAuthStatus?: (server: string) => Promise<McpOAuthStatus>;
readonly getRequiresAuth?: (server: string) => boolean;
```

## Dependencies (REAL — never stubbed in production)

| Symbol | Source (verified) | Use |
|---|---|---|
| `getMcpServerOAuthStatus`, `McpOAuthStatus` | `@vybestack/llxprt-code-core` (barrel re-export of the Phase-1 helper) | wiring closure + type |
| `mcpServerRequiresOAuth` | `@vybestack/llxprt-code-core` (already re-exported, `core/src/index.ts:491`) | `getRequiresAuth` runtime-map signal |
| `config.getMcpServers()` | `configBaseCore.ts:436` (`Record<string, MCPServerConfig> \| undefined`) | per-server `oauth.enabled` + undefined-safety |
| `serverConfig.oauth?.enabled` | `oauth-provider.ts:35` | requiresAuth config-flag path |
| `isMcpAuthenticated` (existing) | `mcpControl.ts:73` wired at `agentImpl.ts:500` | now feeds `sessionAuthenticated` |

## Wiring Notes

- `agent.ts`: add `import type { McpOAuthStatus } from '@vybestack/llxprt-code-core';` and
  `export type { McpOAuthStatus };` (mirror the existing MCP-type re-export precedent in this file).
- `index.ts` (agents api barrel): surface `McpOAuthStatus` type-only so #1595 names it from the public
  root.

---

## Numbered Pseudocode

### A) McpControlDeps additions (mcpControl.ts:71 region) — REQ-004.1

```
# @pseudocode REQ-004.1
01  INTERFACE McpControlDeps (additions):
02      getOAuthStatus?: (server) => Promise<McpOAuthStatus>   # resolves real persisted status
03      getRequiresAuth?: (server) => boolean                  # real per-server requires
04      # RETAIN isMcpAuthenticated  -> now projected as sessionAuthenticated
```

### B) auth(server) (mcpControl.ts:253) — REQ-002

```
# @pseudocode REQ-002.1/.2/.3/.4/.5
10  ASYNC METHOD auth(server):
11      sessionAuthenticated = this.deps?.isMcpAuthenticated(server) ?? false
12      oauthStatus = AWAIT (this.deps?.getOAuthStatus
13                            ? this.deps.getOAuthStatus(server)
14                            : 'not-required')                # R-UNDEFINED-SAFE
15      requiresAuth = this.deps?.getRequiresAuth
16                        ? this.deps.getRequiresAuth(server)
17                        : false                              # R-UNDEFINED-SAFE / R-REQUIRESAUTH-REAL
18      authenticated = (oauthStatus === 'authenticated')      # R-AUTHENTICATED-DERIVED
19      RETURN { server, authenticated, requiresAuth, oauthStatus, sessionAuthenticated }
```

### C) authenticate(server) (mcpControl.ts:316) — REQ-002.5

```
# @pseudocode REQ-002.5 (active flow; preserve existing handshake order + propagation)
20  ASYNC METHOD authenticate(server):
21      configs = this.deps?.getServerConfigs?.()
22      serverConfig = configs ? configs[server] : undefined
23      performOAuth = this.deps?.performOAuth
24      IF serverConfig is undefined OR performOAuth is undefined THEN
25          # unknown server / unwired: no handshake; report real persisted status (likely 'none')
26          RETURN buildAuthStatus(server)                     # same projection as auth(), AWAITED
27      END IF
28      oauthConfig  = serverConfig.oauth ?? { enabled: false }
29      mcpServerUrl = serverConfig.httpUrl ?? serverConfig.url
30      AWAIT performOAuth(server, oauthConfig, mcpServerUrl)   # rejection PROPAGATES (no catch)
31      manager = this.deps?.getManager()
32      IF manager is defined THEN AWAIT manager.restartServer(server)
33      IF this.deps?.refreshClientTools is defined THEN AWAIT this.deps.refreshClientTools()
34      this.deps?.markAuthenticated?.(server)                 # reconcile in-session marker
35      # Re-read REAL status post-handshake: freshly-written creds => 'authenticated'
36      RETURN buildAuthStatus(server)                         # AWAITED projection (R-DELEGATE)
```

> `buildAuthStatus(server)` = the exact projection in B (lines 11–19), factored into a private async
> helper so `auth()` and both `authenticate()` exits share ONE projection (DRY, kills divergent
> mutants). On the unwired/unknown path (line 26) the real status is typically `'none'` (no creds) or
> `'not-required'`; we no longer fabricate `authenticated:false, requiresAuth:true`.

### D) details() + buildServerDetail (mcpControl.ts:348 / :383) — REQ-003

```
# @pseudocode REQ-003.1/.2/.3 — resolve OAuth status UP FRONT (R-ASYNC-DETAIL)
40  ASYNC METHOD details(opts?):
41      includeTools     = opts?.includeTools ?? true
42      includePrompts   = opts?.includePrompts ?? false
43      includeResources = opts?.includeResources ?? false
44      configs       = this.deps?.getServerConfigs?.() ?? {}
45      toolsByServer = this.toolsByServer()
46      resourcesAll  = includeResources ? (getResourceRegistry?.getAllResources() ?? []) : []
47      names = Object.keys(configs)
48      # resolve all async OAuth statuses BEFORE building details
49      statusEntries = AWAIT Promise.all(
50          names.map(async (name) => [
51              name,
52              (this.deps?.getOAuthStatus ? AWAIT this.deps.getOAuthStatus(name) : 'not-required'),
53          ])
54      )
55      oauthStatusByServer = Object.fromEntries(statusEntries)
56      servers = []
57      FOR EACH name IN names:
58          servers.push(this.buildServerDetail(name, includeTools, includePrompts,
59                                  includeResources, toolsByServer, resourcesAll,
60                                  oauthStatusByServer[name]))      # NEW arg: resolved status
61      blockedServers = (getBlockedServers?() ?? []).map(b => ({ name, extensionName }))
62      RETURN { servers, blockedServers }

# buildServerDetail stays SYNC; receives the already-resolved status
63  PRIVATE METHOD buildServerDetail(name, includeTools, includePrompts,
64                                   includeResources, toolsByServer, resourcesAll, oauthStatus):
65      sessionAuthenticated = this.deps?.isMcpAuthenticated(name) ?? false
66      requiresAuth = this.deps?.getRequiresAuth ? this.deps.getRequiresAuth(name) : false
67      authenticated = (oauthStatus === 'authenticated')          # R-AUTHENTICATED-DERIVED
68      detail = { name, authenticated, requiresAuth, oauthStatus, sessionAuthenticated }
69      IF includeTools THEN detail.tools = toolsByServer[name] ?? []
70      IF includePrompts THEN detail.prompts = (getPromptRegistry?.getPromptsByServer(name) ?? []).map(project)
71      IF includeResources THEN detail.resources = resourcesAll.filter(byServer).map(project)
72      RETURN detail
```

### E) buildMcpControlDeps wiring (mcpControlWiring.ts) — REQ-004.2/.3

```
# @pseudocode REQ-004.2/.3 (undefined-safe over getMcpServers; R-CORE-BARREL-SEAM)
80  FUNCTION buildMcpControlDeps(args):
81      { config, isMcpAuthenticated, markAuthenticated, resolveClient } = args
82      RETURN {
83          ...existing closures (isMcpAuthenticated, markAuthenticated, getManager, getToolRegistry,
84             getServerConfigs, getBlockedServers, getPromptRegistry, getResourceRegistry,
85             refreshClientTools, performOAuth),
86          getRequiresAuth: (server) =>
87              (config.getMcpServers()?.[server]?.oauth?.enabled === true)
88              OR mcpServerRequiresOAuth.has(server),                 # real per-server
89          getOAuthStatus: (server) =>
90              getMcpServerOAuthStatus(server, {
91                  requiresOAuth: config.getMcpServers()?.[server]?.oauth?.enabled === true,
92              }),                                                    # helper OR-combines the map itself
93      }
# config.getMcpServers() may be undefined / omit server -> optional-chain => false / 'not-required'
```

### F) agent.ts type + barrel (agent.ts, index.ts) — REQ-002.1/REQ-003.1/REQ-005

```
93  ADD `oauthStatus: McpOAuthStatus` + `sessionAuthenticated: boolean` to McpServerAuthStatus
94  ADD `oauthStatus: McpOAuthStatus` + `requiresAuth: boolean` + `sessionAuthenticated: boolean`
        to McpServerDetail
95  import type { McpOAuthStatus } from '@vybestack/llxprt-code-core'; export type { McpOAuthStatus };
96  (api/index.ts) surface McpOAuthStatus type-only from the public root
```

---

## Integration Points (Line → REAL symbol, file:line)

| Pseudocode | Real symbol | Source file:line (verified) |
|---|---|---|
| 11/65 | `isMcpAuthenticated` | `mcpControl.ts:73`, wired `agentImpl.ts:500` |
| 12/52/89 | `getMcpServerOAuthStatus` (via barrel) | Phase-1 helper; `core/src/index.ts` re-export |
| 15/66/86 | `getRequiresAuth` / `mcpServerRequiresOAuth.has` | NEW closure; map at `core/src/index.ts:491` |
| 30 | `performOAuth` → `MCPOAuthProvider.authenticate` | `mcpControlWiring.ts:58-65` |
| 32 | `manager.restartServer` | `mcpControl.ts:328` (existing) |
| 33 | `refreshClientTools` → `resolveClient().setTools()` | `mcpControlWiring.ts:57` |
| 87/91 | `config.getMcpServers()` | `configBaseCore.ts:436` |
| 95 | `McpOAuthStatus` type re-export | `agent.ts` (mirror existing MCP-type re-export) |

---

## Anti-Pattern Warnings

- [ERROR] DO NOT keep `requiresAuth: true` hardcoded anywhere. [OK] DO compute it via
  `getRequiresAuth` (undefined-safe → false).
- [ERROR] DO NOT keep `authenticated = isMcpAuthenticated(...)`. [OK] DO derive
  `authenticated = (oauthStatus === 'authenticated')` and route the old signal to
  `sessionAuthenticated`.
- [ERROR] DO NOT re-read token storage or recompute expiry in agents. [OK] DO call the injected
  `getOAuthStatus` closure (R-NO-REDERIVE).
- [ERROR] DO NOT leak a `Promise` into `detail.oauthStatus` by calling an async status inside the sync
  `buildServerDetail`. [OK] DO resolve all statuses with `Promise.all` BEFORE building details
  (R-ASYNC-DETAIL).
- [ERROR] DO NOT catch a `performOAuth` rejection. [OK] DO let it propagate (preserve existing
  behavior).
- [ERROR] DO NOT remove/rename `authenticated` or `requiresAuth` (breaking). [OK] DO keep names, add
  new fields (R-NONBREAK).
- [ERROR] DO NOT deep-import `packages/mcp` from agents. [OK] DO use the bare
  `@vybestack/llxprt-code-core` barrel (R-CORE-BARREL-SEAM).
- [ERROR] DO NOT cache OAuth status on the controller. [OK] DO resolve closures per call (R-DELEGATE).

## Behavior Decision Table (projection — implementer cross-check)

| getOAuthStatus(server) | getRequiresAuth(server) | isMcpAuthenticated(server) | authenticated | requiresAuth | oauthStatus | sessionAuthenticated |
|---|---|---|---|---|---|---|
| 'authenticated' | true | false | true | true | 'authenticated' | false |
| 'expired' | true | false | false | true | 'expired' | false |
| 'none' | true | true | false | true | 'none' | true |
| 'not-required' | false | false | false | false | 'not-required' | false |
| (closure absent) | (closure absent) | true | false | false | 'not-required' | true |
