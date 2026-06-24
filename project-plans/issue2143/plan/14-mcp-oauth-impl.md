<!-- @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 -->
# Phase 14: MCP OAuth + refresh setTools parity + deep details — Implementation (GREEN)

## Phase ID

`PLAN-20260622-COREAPIGAP.P14`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 13 completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P13.md`
- Pseudocode: `project-plans/issue2143/analysis/pseudocode/mcp-oauth.md`
  (authenticate lines 1-16; refresh lines 30-41; details lines 50-78; Dependencies + buildMcpControl wiring)

## Purpose

Make the P13 behavioral RED suite pass by EXTENDING `AgentMcpControl` (interface) and `McpControl`
(impl) with `authenticate` + `details`, giving `refresh` its setTools parity, extending `McpControlDeps`
with six injected closures, and wiring them in `AgentImpl.buildMcpControl()`. Existing members and the
existing `refresh` signature are untouched (REQ-009 non-breaking). `MCPOAuthProvider.authenticate` is
bound ONLY in the wiring (injected as the `performOAuth` closure) so the control stays hermetically
testable + mutation-killable.

## Implementation Tasks

### Files to Modify

#### 1. `packages/agents/src/api/agent.ts` — add projected types + extend the interface

Add the projected public types near the other projected types (reuse existing `ToolInfo`):

```ts
// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
export interface McpDetailsOptions {
  readonly includeTools?: boolean;
  readonly includePrompts?: boolean;
  readonly includeResources?: boolean;
}
export interface McpPromptInfo {
  readonly name: string;
  readonly description?: string;
}
export interface McpResourceInfo {
  readonly name?: string;
  readonly uri: string;
}
export interface McpBlockedServer {
  readonly name: string;
  readonly extensionName: string;
}
export interface McpServerDetail {
  readonly name: string;
  readonly authenticated: boolean;
  readonly tools?: readonly ToolInfo[];
  readonly prompts?: readonly McpPromptInfo[];
  readonly resources?: readonly McpResourceInfo[];
}
export interface McpDetailStatus {
  readonly servers: readonly McpServerDetail[];
  readonly blockedServers: readonly McpBlockedServer[];
}
```

Extend the existing `AgentMcpControl` (do NOT remove or change the signature of any existing member —
`listServers`/`status`/`toolsByServer`/`auth`/`discoveryState`/`refresh`):

```ts
export interface AgentMcpControl {
  // ...existing members unchanged...
  refresh(server?: string): Promise<void>;
  // @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
  authenticate(server: string): Promise<McpServerAuthStatus>;
  details(opts?: McpDetailsOptions): Promise<McpDetailStatus>;
}
```

`McpServerAuthStatus` already exists (returned by the existing `auth`). Reuse it.

#### 2. `packages/agents/src/api/control/mcpControl.ts` — extend deps + implement

Add the two narrow view interfaces and SIX optional closures to `McpControlDeps` (existing three —
`isMcpAuthenticated`/`getManager`/`getToolRegistry` — unchanged):

```ts
// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
export interface McpPromptRegistryView {
  getPromptsByServer(server: string): ReadonlyArray<{ name: string; description?: string }>;
}
export interface McpResourceRegistryView {
  getAllResources(): ReadonlyArray<{ serverName: string; name?: string; uri: string }>;
}

export interface McpControlDeps {
  // ...existing three closures unchanged...
  readonly getServerConfigs?: () => Record<string, MCPServerConfig> | undefined;
  readonly getBlockedServers?: () => readonly { name: string; extensionName: string }[];
  readonly getPromptRegistry?: () => McpPromptRegistryView | undefined;
  readonly getResourceRegistry?: () => McpResourceRegistryView | undefined;
  readonly refreshClientTools?: () => Promise<void>;
  readonly performOAuth?: (
    server: string,
    oauthConfig: MCPOAuthConfig,
    mcpServerUrl: string | undefined,
  ) => Promise<void>;
}
```

Add the type-only imports — **VERIFIED ground truth, these three come from THREE different sources;
do NOT collapse them into one bare-barrel import (that fails to compile)**:

```ts
// MCPOAuthConfig IS exported as a type from the bare core barrel (core/src/index.ts:508).
import type { MCPOAuthConfig } from '@vybestack/llxprt-code-core';
// MCPServerConfig is NOT in the bare barrel — it lives at the deep config path
// (this exactly mirrors how agent.ts:13 already imports it).
import type { MCPServerConfig } from '@vybestack/llxprt-code-core/config/config.js';
```

> `ToolInfo` is ALREADY imported from `'../agent.js'` at the top of `mcpControl.ts` (the existing
> `import type { … ToolInfo } from '../agent.js'` block). Do **NOT** add a second `ToolInfo` import —
> reuse the existing one. The new projected types (`McpDetailsOptions`, `McpServerDetail`,
> `McpDetailStatus`, `McpPromptInfo`, `McpResourceInfo`, `McpBlockedServer`) must be ADDED to that
> SAME existing `'../agent.js'` type-import group.

Implement `authenticate` (NEW), modify `refresh` (parity), implement `details` (NEW), following the
pseudocode line-by-line:

```ts
// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 @pseudocode lines 1-16
async authenticate(server: string): Promise<McpServerAuthStatus> {
  const configs = this.deps?.getServerConfigs?.();
  const serverConfig = configs ? configs[server] : undefined;
  const performOAuth = this.deps?.performOAuth;
  if (serverConfig === undefined || performOAuth === undefined) {
    return { server, authenticated: false, requiresAuth: true };
  }
  const oauthConfig = serverConfig.oauth ?? { enabled: false };
  const mcpServerUrl = serverConfig.httpUrl ?? serverConfig.url;
  await performOAuth(server, oauthConfig, mcpServerUrl);
  const manager = this.deps?.getManager();
  if (manager !== undefined) {
    await manager.restartServer(server);
  }
  if (this.deps?.refreshClientTools !== undefined) {
    await this.deps.refreshClientTools();
  }
  return { server, authenticated: true, requiresAuth: true };
}

// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 @pseudocode lines 30-41
async refresh(server?: string): Promise<void> {
  const manager = this.deps?.getManager();
  if (manager === undefined) return;
  if (server !== undefined) {
    await manager.restartServer(server);
  } else {
    await manager.restart();
  }
  if (this.deps?.refreshClientTools !== undefined) {
    await this.deps.refreshClientTools();
  }
}

// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 @pseudocode lines 50-78
async details(opts?: McpDetailsOptions): Promise<McpDetailStatus> {
  const includeTools = opts?.includeTools ?? true;
  const includePrompts = opts?.includePrompts ?? false;
  const includeResources = opts?.includeResources ?? false;
  const configs = this.deps?.getServerConfigs?.() ?? {};
  const toolsByServer = this.toolsByServer();
  const resourcesAll = includeResources
    ? (this.deps?.getResourceRegistry?.()?.getAllResources() ?? [])
    : [];
  const servers: McpServerDetail[] = [];
  for (const name of Object.keys(configs)) {
    const detail: {
      name: string;
      authenticated: boolean;
      tools?: readonly ToolInfo[];
      prompts?: readonly McpPromptInfo[];
      resources?: readonly McpResourceInfo[];
    } = { name, authenticated: this.deps?.isMcpAuthenticated(name) ?? false };
    if (includeTools) {
      detail.tools = toolsByServer[name] ?? [];
    }
    if (includePrompts) {
      const prompts = this.deps?.getPromptRegistry?.()?.getPromptsByServer(name) ?? [];
      detail.prompts = prompts.map((p) => ({ name: p.name, description: p.description }));
    }
    if (includeResources) {
      detail.resources = resourcesAll
        .filter((r) => r.serverName === name)
        .map((r) => ({ name: r.name, uri: r.uri }));
    }
    servers.push(detail);
  }
  const blockedServers = (this.deps?.getBlockedServers?.() ?? []).map((b) => ({
    name: b.name,
    extensionName: b.extensionName,
  }));
  return { servers, blockedServers };
}
```

> `toolsByServer()` is the EXISTING method; reuse it so per-server tool projection stays consistent.
> Adjust the exact shape access (`toolsByServer[name]`) to match the existing return type; if it
> returns a `Map`/record, index accordingly — follow the existing method's real type.

#### 3. `packages/agents/src/api/agentImpl.ts` — wire `buildMcpControl()` (method def at `:487`)

Extend the deps object passed to `new McpControl({...})` with the six closures (existing three stay):

```ts
// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 @pseudocode Dependencies/buildMcpControl
getServerConfigs: () => this.deps.config.getMcpServers(),
getBlockedServers: () => this.deps.config.getBlockedMcpServers() ?? [],
getPromptRegistry: () => ({
  getPromptsByServer: (s: string) =>
    this.deps.config.getPromptRegistry().getPromptsByServer(s),
}),
getResourceRegistry: () => ({
  getAllResources: () => this.deps.config.getResourceRegistry().getAllResources(),
}),
refreshClientTools: () => this.deps.resolveClient().setTools(),
performOAuth: async (server, oauthConfig, mcpServerUrl) => {
  await MCPOAuthProvider.authenticate(server, oauthConfig, mcpServerUrl, undefined);
},
```

> The `performOAuth` closure MUST use the `async … => { await …; }` form (NOT a bare arrow returning
> the call). The dep type is `Promise<void>`, but `MCPOAuthProvider.authenticate(...)` returns
> `Promise<MCPOAuthToken>`; a bare `(…) => MCPOAuthProvider.authenticate(…)` is `Promise<MCPOAuthToken>`
> and is NOT assignable to `Promise<void>` (TS only special-cases a bare `void`, not `Promise<void>`).
> Awaiting + discarding also keeps the OAuth token out of the closure result (it is a handshake
> side-effect only).

Add the `MCPOAuthProvider` VALUE import from the bare core barrel at the top of `agentImpl.ts`:

```ts
import { MCPOAuthProvider } from '@vybestack/llxprt-code-core';
```

> `MCPOAuthProvider` is re-exported at `core/src/index.ts:498`; `MCPOAuthProvider.authenticate(
> serverName, config, mcpServerUrl?, events?)` is defined at `packages/mcp/src/auth/oauth-provider.ts:874`.
> Pass `undefined` for `events` (the CLI-only `appEvents` is NOT importable here). This binds the real
> static ONLY in the wiring; the control receives it as the injected `performOAuth` closure.

### Constraints

- Do NOT modify the P13 test file.
- Existing `AgentMcpControl` members + the existing `refresh` signature remain byte-identical (REQ-009).
- Follow the pseudocode line-by-line; cite `@pseudocode lines N-M` on each method.
- No cached manager/registry/config state — resolve each dep closure per call (R-DELEGATE).
- `authenticate` MUST NOT catch a `performOAuth` rejection (it propagates; no restart/setTools on failure).
- `refresh` AND `authenticate` BOTH call `refreshClientTools()` after restart (R-REFRESH-PARITY).
- `details` projects prompts/resources to named-field-only public types (no raw `DiscoveredMCPPrompt`/
  `MCPResource` leak); prompts/resources gated behind opts (default false).
- All new closures are OPTIONAL on `McpControlDeps` and guarded with `?.` (undefined-safe; preserves the
  existing direct-construct-with-partial-deps tests).

## Verification Commands

```bash
set -o pipefail
set -e
A=packages/agents/src/api/agent.ts
M=packages/agents/src/api/control/mcpControl.ts
I=packages/agents/src/api/agentImpl.ts
F=packages/agents/src/api/__tests__/mcpOAuth.behavior.test.ts

# Interface extended, existing members preserved.
grep -qE "authenticate\(server: string\): Promise<McpServerAuthStatus>" "$A" || { echo "FAIL: authenticate missing on interface"; exit 1; }
grep -qE "details\(opts\?: McpDetailsOptions\): Promise<McpDetailStatus>" "$A" || { echo "FAIL: details missing on interface"; exit 1; }
grep -qE "discoveryState" "$A" || { echo "FAIL: existing member removed"; exit 1; }

# Impl present + markers + ordering + parity.
grep -qE "@pseudocode lines 1-16" "$M" || { echo "FAIL: authenticate marker missing"; exit 1; }
grep -qE "@pseudocode lines 30-41" "$M" || { echo "FAIL: refresh marker missing"; exit 1; }
grep -qE "@pseudocode lines 50-78" "$M" || { echo "FAIL: details marker missing"; exit 1; }
grep -qE "performOAuth" "$M" || { echo "FAIL: performOAuth closure not used"; exit 1; }
grep -qE "refreshClientTools" "$M" || { echo "FAIL: setTools parity closure not used"; exit 1; }

# refresh has BOTH restart and refreshClientTools (parity).
awk '/async refresh\(/{f=1} f&&/refreshClientTools/{ok=1} /^  }/{if(f){f=0}} END{exit ok?0:1}' "$M" \
  || { echo "FAIL: refresh() lacks setTools parity"; exit 1; }

# Static OAuth provider is NOT imported into the control (only injected via wiring).
if grep -nE "import .*MCPOAuthProvider" "$M"; then echo "FAIL: MCPOAuthProvider must NOT be imported into the control"; exit 1; fi
grep -qE "import \{ MCPOAuthProvider \} from '@vybestack/llxprt-code-core'" "$I" || { echo "FAIL: MCPOAuthProvider not wired in agentImpl"; exit 1; }
grep -qE "performOAuth:" "$I" || { echo "FAIL: performOAuth not wired in buildMcpControl"; exit 1; }

# No cached field for mcp deep state.
if grep -nE "private .*(cachedDetails|serverCache|mcpCache)\b" "$M"; then echo "FAIL: cached mcp state"; exit 1; fi

# Tests now GREEN.
npx vitest run "$F" 2>&1 | tail -30
npx vitest run "$F" > /tmp/p14_green.log 2>&1 || { echo "FAIL: P13 suite not green"; tail -40 /tmp/p14_green.log; exit 1; }

# Whole control dir still green (non-breaking).
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p14_all.log 2>&1 || { echo "FAIL: regressions"; tail -60 /tmp/p14_all.log; exit 1; }

npm run typecheck 2>&1 | tail -15
npm run lint 2>&1 | tail -15
```

### Deferred Implementation Detection (MANDATORY — scoped to changed lines)

```bash
set -o pipefail
set -e
for F in packages/agents/src/api/agent.ts packages/agents/src/api/control/mcpControl.ts packages/agents/src/api/agentImpl.ts; do
  git diff HEAD -- "$F" | grep -E "^\+" | grep -vE "^\+\+\+" \
    | grep -nE "(TODO|FIXME|HACK|STUB|placeholder|for now|in a real)" \
    && { echo "FAIL: deferred marker in $F"; exit 1; } || true
done
echo "PASS: no deferred markers in changed lines."
```

## Success Criteria

- P13 suite GREEN; whole `__tests__` dir GREEN; typecheck + lint clean.
- Existing `AgentMcpControl` members + `refresh` signature unchanged; `authenticate`/`details` added,
  `refresh` gains setTools parity; six closures wired; `MCPOAuthProvider` bound only in the wiring.

## Failure Recovery

- `git checkout -- packages/agents/src/api/agent.ts packages/agents/src/api/control/mcpControl.ts packages/agents/src/api/agentImpl.ts`

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P14.md` (same field schema as P10).
