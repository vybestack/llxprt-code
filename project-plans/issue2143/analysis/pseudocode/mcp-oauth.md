<!-- @plan:PLAN-20260622-COREAPIGAP.P02 @requirement:REQ-006 -->
# Pseudocode: MCP OAuth + setTools parity + deep details (extend `Agent.mcp`)

Plan ID: PLAN-20260622-COREAPIGAP
Component: G6 — extend the EXISTING `AgentMcpControl` / `McpControl` with:
  (1) real OAuth `authenticate(server)`, (2) `refresh(server?)` setTools parity, (3) deep `details()`.
Source of truth: specification.md REQ-006; domain-model.md R-REFRESH-PARITY, R-MCP-OAUTH-FLOW,
R-UNDEFINED-SAFE, R-DELEGATE.
Analysis only — NO implementation code is written in this document.

---

## Design rationale (READ FIRST — why `performOAuth` is an injected closure)

`MCPOAuthProvider.authenticate(...)` (`packages/mcp/src/auth/oauth-provider.ts:874`) performs a REAL
browser/network OAuth handshake and is a **static** method. If `McpControl.authenticate()` called it
directly:
- the only way to drive `authenticate()` in a hermetic test would be `vi.spyOn(MCPOAuthProvider, …)`
  = **mock theater (BANNED)**, or a real network call (**non-hermetic / flaky**);
- Stryker mutants that delete/reorder the post-auth `restartServer` / `setTools` steps could NOT be
  killed (nothing observable).

The whole existing `McpControl` surface already takes its external capabilities as **injected
closures** (`getManager`, `getToolRegistry`, `isMcpAuthenticated`) — and this component already adds
`refreshClientTools` as a perform-action closure. So we follow the SAME convention: inject
`performOAuth` as a closure. The orchestration logic (unknown-server guard, ordering
auth→restart→setTools, error propagation, undefined-safety) lives in the CONTROL where it is
unit-tested + mutation-covered; the thin static binding
(`MCPOAuthProvider.authenticate(server, cfg, url, undefined)`) lives in `buildMcpControl()` wiring,
exactly like `getManager: () => this.deps.config.getMcpClientManager()`.

---

## Interface Contracts

```typescript
// EXTEND the existing AgentMcpControl interface in packages/agents/src/api/agent.ts (:232-239).
// Existing members (listServers / status / toolsByServer / auth / discoveryState / refresh) stay
// (REQ-009). `refresh` signature is UNCHANGED but its BEHAVIOUR gains setTools parity. ADD:
interface AgentMcpControl {
  // ...existing members unchanged in signature...
  refresh(server?: string): Promise<void>;          // existing — now also re-publishes tools
  authenticate(server: string): Promise<McpServerAuthStatus>;   // NEW: real OAuth flow
  details(opts?: McpDetailsOptions): Promise<McpDetailStatus>;  // NEW: deep registry projection
}

// Projected public types (specification.md Data Schemas).
interface McpDetailsOptions {
  readonly includeTools?: boolean;       // default true
  readonly includePrompts?: boolean;     // default false
  readonly includeResources?: boolean;   // default false
}
interface McpDetailStatus {
  readonly servers: readonly McpServerDetail[];
  readonly blockedServers: readonly McpBlockedServer[];
}
interface McpServerDetail {
  readonly name: string;
  readonly authenticated: boolean;
  readonly tools?: readonly ToolInfo[];       // reuse existing ToolInfo
  readonly prompts?: readonly McpPromptInfo[];
  readonly resources?: readonly McpResourceInfo[];
}
interface McpPromptInfo { readonly name: string; readonly description?: string; }
interface McpResourceInfo { readonly name?: string; readonly uri: string; }
interface McpBlockedServer { readonly name: string; readonly extensionName: string; }
```

### Dependencies (NEVER stubbed) — extend `McpControlDeps` (control/mcpControl.ts:45)

```typescript
// EXISTING (unchanged): isMcpAuthenticated, getManager, getToolRegistry.
// ADD (each a narrow closure mirroring the existing getToolRegistry view pattern):
export interface McpControlDeps {
  // ...existing three closures...
  /** Raw configured MCP servers (config.getMcpServers()). MAY be undefined pre-init. */
  readonly getServerConfigs?: () => Record<string, MCPServerConfig> | undefined;
  /** Blocked servers (config.getBlockedMcpServers() ?? []). */
  readonly getBlockedServers?: () => readonly { name: string; extensionName: string }[];
  /** Narrow prompt-registry view for per-server prompt projection. */
  readonly getPromptRegistry?: () => McpPromptRegistryView | undefined;
  /** Narrow resource-registry view for per-server resource projection. */
  readonly getResourceRegistry?: () => McpResourceRegistryView | undefined;
  /** Re-publishes the agent client's tool declarations (resolveClient().setTools()). */
  readonly refreshClientTools?: () => Promise<void>;
  /**
   * Performs the REAL OAuth handshake for one server. Wired in buildMcpControl() to
   * MCPOAuthProvider.authenticate(server, oauthConfig, mcpServerUrl, undefined). Injected (not a
   * direct static import) so authenticate()'s orchestration is hermetically testable + mutation-
   * killable. Errors PROPAGATE (the control does NOT catch).
   */
  readonly performOAuth?: (
    server: string,
    oauthConfig: MCPOAuthConfig,
    mcpServerUrl: string | undefined,
  ) => Promise<void>;
}
export interface McpPromptRegistryView {
  getPromptsByServer(server: string): ReadonlyArray<{ name: string; description?: string }>;
}
export interface McpResourceRegistryView {
  getAllResources(): ReadonlyArray<{ serverName: string; name?: string; uri: string }>;
}
// Type-only imports in mcpControl.ts (VERIFIED ground truth — these differ by source):
//   import type { MCPOAuthConfig } from '@vybestack/llxprt-code-core';            // bare barrel (core/src/index.ts:508)
//   import type { MCPServerConfig } from '@vybestack/llxprt-code-core/config/config.js'; // NOT in bare barrel; deep path (mirrors agent.ts:13)
//   // ToolInfo is ALREADY imported from '../agent.js' (mcpControl.ts:17) — do NOT re-import it.
```

Wiring in `AgentImpl.buildMcpControl()` (`agentImpl.ts:476`):
- `getServerConfigs: () => this.deps.config.getMcpServers()`
- `getBlockedServers: () => this.deps.config.getBlockedMcpServers() ?? []`
- `getPromptRegistry: () => ({ getPromptsByServer: (s) => this.deps.config.getPromptRegistry().getPromptsByServer(s) })`
- `getResourceRegistry: () => ({ getAllResources: () => this.deps.config.getResourceRegistry().getAllResources() })`
- `refreshClientTools: () => this.deps.resolveClient().setTools()`
- `performOAuth: async (server, oauthConfig, mcpServerUrl) => { await MCPOAuthProvider.authenticate(server, oauthConfig, mcpServerUrl, undefined); }`
  - MUST use the `async … => { await …; }` form (NOT a bare arrow returning the call): the closure type
    is `Promise<void>` but `MCPOAuthProvider.authenticate(...)` returns `Promise<MCPOAuthToken>`. A bare
    `() => authenticate(...)` is `Promise<MCPOAuthToken>` and is NOT assignable to `Promise<void>`
    (TS only special-cases a bare `void` return, not `Promise<void>`). Awaiting and discarding also keeps
    the token out of the closure result (R-NO-RAW-SECRETS — the token is a handshake side-effect only).
  - `MCPOAuthProvider` is a VALUE import from the bare core barrel `@vybestack/llxprt-code-core`
    (re-exported at `core/src/index.ts:498`) — NO new mcp dependency, NO deep import.
  - `events` arg is OMITTED (undefined): `appEvents` is CLI-only (`cli/src/utils/events.ts`) and
    cannot be imported by the agents package; the handshake works without UI display events.

---

## Numbered Pseudocode

### METHOD authenticate(server): Promise<McpServerAuthStatus>  (REAL OAuth flow, orchestration)

```
1: // @pseudocode REQ-006.1 — real OAuth (injected) → restart server → re-publish tools; errors PROPAGATE
2: METHOD authenticate(server) RETURNS Promise<McpServerAuthStatus>
3:   SET configs = this.deps?.getServerConfigs?.()
4:   SET serverConfig = configs ? configs[server] : undefined
5:   SET performOAuth = this.deps?.performOAuth
6:   IF serverConfig IS undefined OR performOAuth IS undefined THEN
7:     RETURN { server, authenticated: false, requiresAuth: true }   // unknown/unsupported — undefined-safe
8:   END IF
9:   SET oauthConfig = serverConfig.oauth ?? { enabled: false }       // mirrors mcpAuth.ts:107
10:  SET mcpServerUrl = serverConfig.httpUrl ?? serverConfig.url       // mirrors mcpAuth.ts:109
11:  AWAIT performOAuth(server, oauthConfig, mcpServerUrl)             // real handshake; a rejection PROPAGATES
12:  SET manager = this.deps?.getManager()                            // post-auth parity (mcpAuth.ts:132-136)
13:  IF manager IS NOT undefined THEN AWAIT manager.restartServer(server)
14:  IF this.deps?.refreshClientTools IS DEFINED THEN AWAIT this.deps.refreshClientTools()
15:  RETURN { server, authenticated: true, requiresAuth: true }
16: END METHOD
```

> Ordering is load-bearing: OAuth MUST complete before restart, and restart before tool re-publish.
> A rejected `performOAuth` MUST abort the flow (no restart, no setTools) and propagate.

### METHOD refresh(server?): Promise<void>  (EXISTING + setTools parity)

```
30: // @pseudocode REQ-006.2 — existing restart behaviour PLUS re-publish tool declarations
31: METHOD refresh(server?) RETURNS Promise<void>
32:   SET manager = this.deps?.getManager()
33:   IF manager IS undefined THEN RETURN                              // R-UNDEFINED-SAFE (unchanged)
34:   IF server IS NOT undefined THEN
35:     AWAIT manager.restartServer(server)
36:   ELSE
37:     AWAIT manager.restart()
38:   END IF
39:   // NEW (R-REFRESH-PARITY): mirror CLI /mcp refresh which calls agentClient.setTools() (mcpCommand)
40:   IF this.deps?.refreshClientTools IS DEFINED THEN AWAIT this.deps.refreshClientTools()
41: END METHOD
```

### METHOD details(opts?): Promise<McpDetailStatus>

```
50: // @pseudocode REQ-006.3 — deep per-server projection; opts gate prompts/resources; undefined-safe
51: METHOD details(opts?) RETURNS Promise<McpDetailStatus>
52:   SET includeTools = opts?.includeTools ?? true
53:   SET includePrompts = opts?.includePrompts ?? false
54:   SET includeResources = opts?.includeResources ?? false
55:   SET configs = this.deps?.getServerConfigs?.() ?? {}
56:   SET toolsByServer = this.toolsByServer()                         // reuse existing projection
57:   SET resourcesAll = includeResources
58:        ? (this.deps?.getResourceRegistry?.()?.getAllResources() ?? [])
59:        : []
60:   SET servers = empty array
61:   FOR EACH name IN keys(configs)
62:     SET detail = { name, authenticated: this.deps?.isMcpAuthenticated(name) ?? false }
63:     IF includeTools THEN SET detail.tools = toolsByServer[name] ?? []
64:     IF includePrompts THEN
65:       SET prompts = this.deps?.getPromptRegistry?.()?.getPromptsByServer(name) ?? []
66:       SET detail.prompts = prompts.map(p => ({ name: p.name, description: p.description }))
67:     END IF
68:     IF includeResources THEN
69:       SET detail.resources = resourcesAll
70:            .filter(r => r.serverName === name)
71:            .map(r => ({ name: r.name, uri: r.uri }))
72:     END IF
73:     APPEND detail TO servers
74:   END FOR
75:   SET blocked = (this.deps?.getBlockedServers?.() ?? [])
76:        .map(b => ({ name: b.name, extensionName: b.extensionName }))
77:   RETURN { servers, blockedServers: blocked }
78: END METHOD
```

> NOTE: `auth(server)` (existing per-agent-flag read) is UNCHANGED — REQ-009. The NEW `authenticate()`
> is the active OAuth flow; the two coexist.

---

## Integration Points (Line-by-Line, REAL symbols)

| Pseudocode line | Real symbol / call | File:line (verified) |
|---|---|---|
| 3 | `Config.getMcpServers(): Record<string, MCPServerConfig> \| undefined` | `configBaseCore.ts:436` |
| 9 | `MCPServerConfig.oauth?: MCPOAuthConfig` | `configTypes.ts:229` |
| 10 | `MCPServerConfig.httpUrl?`/`url?` | `configTypes.ts:203` / `:201` |
| 11 (wiring) | `MCPOAuthProvider.authenticate(serverName, config, mcpServerUrl?, events?)` | `packages/mcp/src/auth/oauth-provider.ts:874`; barrel `core/src/index.ts:498` |
| 13/35 | `McpClientManager.restartServer(server)` | core (used by `mcpControl.ts:241`, reference `mcpAuth.ts:132`) |
| 14/40 | `AgentClientContract.setTools(): Promise<void>` via `resolveClient()` | `core/src/core/clientContract.ts:77`; `resolveClient` `agentImpl.ts:132` |
| 37 | `McpClientManager.restart()` | core (used by `mcpControl.ts:244`) |
| 58 | `Config.getResourceRegistry().getAllResources(): MCPResource[]` | `configBaseCore.ts:406`; `resource-registry.ts:44` |
| 65 | `Config.getPromptRegistry().getPromptsByServer(name): DiscoveredMCPPrompt[]` | `configBaseCore.ts:403`; `prompt-registry.ts:48` |
| 70 | `MCPResource.serverName` | `resource-registry.ts:13` |
| 75 | `Config.getBlockedMcpServers(): Array<{name,extensionName}> \| undefined` | `configBaseCore.ts:445` |
| n/a (wiring) | extend `buildMcpControl()` | `agentImpl.ts:476` |

CLI flow this preserves parity with (#1595): `packages/cli/src/ui/commands/mcpAuth.ts`
`performMcpOAuth` (`authenticate:108` → `restartServer:132` → `agentClient.setTools():136`).
NOTE (spec correction): the real OAuth flow lives in `mcpAuth.ts` — the issue's "no such file" claim
is FALSE; `listOAuthServers:49`, `performMcpOAuth:82` exist.

---

## Anti-Pattern Warnings

- [ERROR] DO NOT: import `MCPOAuthProvider` directly into `mcpControl.ts` and call the static inside
  `authenticate()` (untestable without mock theater; mutants survive).
  [OK] DO: inject `performOAuth` as a closure dep; bind the static in `buildMcpControl()` wiring.
- [ERROR] DO NOT: import `appEvents` / `AppEvent` (CLI-only `packages/cli/src/utils/events.ts`) to pass
  as the `events` arg.
  [OK] DO: pass `undefined` for the optional `events` param.
- [ERROR] DO NOT: catch/swallow a `performOAuth` rejection into `{authenticated:false}`.
  [OK] DO: let it PROPAGATE; on failure NO restart and NO setTools happen (R-MCP-OAUTH-FLOW).
- [ERROR] DO NOT: change `auth(server)`'s existing semantics or remove it.
  [OK] DO: ADD `authenticate(server)` as a separate method (REQ-009).
- [ERROR] DO NOT: leave `refresh()` without a `setTools()` call (the original parity gap).
  [OK] DO: call `refreshClientTools()` after restart in `refresh()` AND `authenticate()` (R-REFRESH-PARITY).
- [ERROR] DO NOT: throw when the manager / registries / performOAuth are undefined.
  [OK] DO: no-op / empty-project per REQ-006 (R-UNDEFINED-SAFE) — mirror the existing
  `getManager() === undefined` guards (`mcpControl.ts:122,217,237`).
- [ERROR] DO NOT: populate `prompts`/`resources` unconditionally (perf + surface noise).
  [OK] DO: gate them behind `opts.includePrompts`/`includeResources` (default false).
- [ERROR] DO NOT: leak raw `DiscoveredMCPPrompt` / `MCPResource` objects.
  [OK] DO: project to `McpPromptInfo` / `McpResourceInfo` (named fields only).
- [ERROR] DO NOT: cache the manager / registries / configs in a control field.
  [OK] DO: resolve every dep closure per call (R-DELEGATE).

---

## Behavior Decision Table

| GIVEN | Method | Result |
|---|---|---|
| server not in configs | `authenticate("nope")` | `{server:"nope", authenticated:false, requiresAuth:true}`; performOAuth NOT called; no restart |
| performOAuth not wired (deps partial) | `authenticate("s")` | `{authenticated:false, requiresAuth:true}`; no restart/setTools |
| server with oauth config, manager present | `authenticate("s")` | order: performOAuth("s") → restartServer("s") → refreshClientTools(); returns `authenticated:true` |
| performOAuth REJECTS | `authenticate("s")` | the call REJECTS (propagates); restartServer NOT called; refreshClientTools NOT called |
| server present, manager undefined | `authenticate("s")` | performOAuth runs; restart skipped; refreshClientTools still attempted; `authenticated:true` |
| manager present | `refresh("s")` | restartServer("s") THEN refreshClientTools() (parity) |
| manager present, no arg | `refresh()` | restart() THEN refreshClientTools() |
| manager undefined | `refresh()` | no-op (returns); refreshClientTools NOT called |
| 2 servers, opts default | `details()` | `servers` len 2, each has `tools`, no `prompts`/`resources`; `blockedServers` from config |
| opts includePrompts:true | `details({includePrompts:true})` | each server detail includes projected `prompts` |
| opts includeResources:true | `details({includeResources:true})` | each detail includes `resources` filtered by serverName |
| getServerConfigs undefined | `details()` | `{servers:[], blockedServers:[...]}` (undefined-safe) |
