<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-002,REQ-003,REQ-004,REQ-INT-001,REQ-INT-002 -->
# Phase 06 — Agents Projection: Implementation (GREEN)

Plan ID: PLAN-20260622-MCPOAUTHTRUTH
Phase: P06 (impl)

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- `test -f project-plans/issue2165/.completed/P05.md` (the behavioral-RED projection
  suite exists and is RED for behavioral reasons).
- Read in full: `project-plans/issue2165/analysis/pseudocode/agents-projection.md`
  (sections A–F + the projection Behavior Decision Table). Implement EXACTLY that.

## Purpose

Project the engine truth (`getMcpServerOAuthStatus`) through the agents public MCP
surface: derive `authenticated = (oauthStatus === 'authenticated')`, compute a real
`requiresAuth`, preserve the in-session marker as `sessionAuthenticated`, and add
`oauthStatus` to both public shapes — **additively, delegating, never caching, never
re-deriving expiry**. After this phase the P05 suite AND the existing
`mcpOAuth.behavior.test.ts` are GREEN.

## Files to Modify (NUMBERED — apply in order)

### 1. `packages/agents/src/api/agent.ts` — public type fields + type-only re-export

`@pseudocode agents-projection.md lines 93-96 (section F)`

- Add the import near the existing core type imports (top of file):
  ```ts
  import type { McpOAuthStatus } from '@vybestack/llxprt-code-core';
  ```
  (bare core barrel — Phase-1 helper's type, re-exported through `core/src/index.ts`.)
- Extend `McpServerAuthStatus` (currently `:150-155`) to (keep `authUrl?` last):
  ```ts
  export interface McpServerAuthStatus {
    readonly server: string;
    readonly authenticated: boolean; // meaning corrected: oauthStatus === 'authenticated'
    readonly requiresAuth: boolean; // meaning corrected: real per-server
    readonly oauthStatus: McpOAuthStatus; // NEW (REQ-004)
    readonly sessionAuthenticated: boolean; // NEW (REQ-004)
    readonly authUrl?: string;
  }
  ```
- Extend `McpServerDetail` (currently `:188-194`) to:
  ```ts
  export interface McpServerDetail {
    readonly name: string;
    readonly authenticated: boolean; // corrected
    readonly requiresAuth: boolean; // NEW (REQ-003)
    readonly oauthStatus: McpOAuthStatus; // NEW (REQ-004)
    readonly sessionAuthenticated: boolean; // NEW (REQ-004)
    readonly tools?: readonly ToolInfo[];
    readonly prompts?: readonly McpPromptInfo[];
    readonly resources?: readonly McpResourceInfo[];
  }
  ```
- At the bottom, alongside `export type { ApprovalMode };` (`:568`), add:
  ```ts
  export type { McpOAuthStatus };
  ```
  Update the `@plan`/`@requirement` marker on the touched interfaces to append
  `@plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-004` (do NOT delete the
  existing `PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006` marker — additive).

### 2. `packages/agents/src/api/index.ts` — surface the type from the public root

`@pseudocode agents-projection.md line 96 (section F)`

- Add `McpOAuthStatus,` to the existing type-only re-export block from `./agent.js`
  (the block at `:28-43`, alongside `McpServerAuthStatus` / `McpServerDetail`):
  ```ts
  export type {
    // … existing …
    McpServerAuthStatus,
    McpDetailStatus,
    McpServerDetail,
    McpOAuthStatus, // NEW (REQ-004)
    // … existing …
  } from './agent.js';
  ```
  (`McpServerAuthStatus` / `McpServerDetail` are ALREADY here, so their new FIELDS
  surface automatically.)

### 3. `packages/agents/src/api/control/mcpControl.ts` — deps + projection

`@pseudocode agents-projection.md sections A (01-04), B (10-19), C (20-36), D (40-72)`

- **3a. `McpControlDeps` additions** (interface at `:71`) — `@pseudocode lines 01-04`:
  ```ts
  readonly getOAuthStatus?: (server: string) => Promise<McpOAuthStatus>;
  readonly getRequiresAuth?: (server: string) => boolean;
  ```
  Import the type at the top of the file:
  ```ts
  import type { McpOAuthStatus } from '@vybestack/llxprt-code-core';
  ```
  RETAIN `isMcpAuthenticated` (now feeds `sessionAuthenticated`).
- **3b. Add a private async `buildAuthStatus`** — `@pseudocode lines 10-19` (this is
  the single shared projection; `auth()` and both `authenticate()` exits call it):
  ```ts
  private async buildAuthStatus(server: string): Promise<McpServerAuthStatus> {
    const sessionAuthenticated = this.deps?.isMcpAuthenticated(server) ?? false;
    const oauthStatus: McpOAuthStatus = this.deps?.getOAuthStatus
      ? await this.deps.getOAuthStatus(server)
      : 'not-required';
    const requiresAuth = this.deps?.getRequiresAuth
      ? this.deps.getRequiresAuth(server)
      : false;
    const authenticated = oauthStatus === 'authenticated';
    return { server, authenticated, requiresAuth, oauthStatus, sessionAuthenticated };
  }
  ```
- **3c. Rewrite `auth()`** (`:253`) — `@pseudocode lines 10-19` — to
  `return this.buildAuthStatus(server);` (it is already `async`). REMOVE the
  hardcoded `requiresAuth: true` and the in-session `authenticated` read.
- **3d. Rewrite both `authenticate()` exits** (`:316`) — `@pseudocode lines 20-36`.
  Preserve the EXACT handshake order + rejection propagation; only the two `return`
  shapes change from the fabricated `{ server, authenticated:false|true,
  requiresAuth:true }` to `return this.buildAuthStatus(server);`:
  - early/unwired exit (currently `:321`): after determining `serverConfig` /
    `performOAuth` is undefined, `return this.buildAuthStatus(server);`
  - success exit (currently `:336`): after `performOAuth` →
    `manager.restartServer` → `refreshClientTools` → `markAuthenticated`, then
    `return this.buildAuthStatus(server);` (re-reads REAL post-handshake status).
  Do NOT add a `catch` around `performOAuth` (rejection must propagate).
- **3e. Make `details()` resolve OAuth status UP FRONT** (`:348`) —
  `@pseudocode lines 40-62` — between `const configs = …` (`:358`) and the
  `for (const name of Object.keys(configs))` loop, add:
  ```ts
  const names = Object.keys(configs);
  const statusEntries = await Promise.all(
    names.map(
      async (name): Promise<[string, McpOAuthStatus]> => [
        name,
        this.deps?.getOAuthStatus
          ? await this.deps.getOAuthStatus(name)
          : 'not-required',
      ],
    ),
  );
  const oauthStatusByServer: Record<string, McpOAuthStatus> =
    Object.fromEntries(statusEntries);
  ```
  Change the loop to iterate `names` and pass `oauthStatusByServer[name]` as a NEW
  trailing arg to `buildServerDetail(...)`.
- **3f. Update `buildServerDetail()`** (`:383`, stays **sync**) —
  `@pseudocode lines 63-72`. Add a 7th param `oauthStatus: McpOAuthStatus`. Update
  the INLINE detail type (`:395-401`) and initializer (`:401-404`) to:
  ```ts
  const detail: {
    name: string;
    authenticated: boolean;
    requiresAuth: boolean;
    oauthStatus: McpOAuthStatus;
    sessionAuthenticated: boolean;
    tools?: readonly ToolInfo[];
    prompts?: readonly McpPromptInfo[];
    resources?: readonly McpResourceInfo[];
  } = {
    name,
    authenticated: oauthStatus === 'authenticated',
    requiresAuth: this.deps?.getRequiresAuth
      ? this.deps.getRequiresAuth(name)
      : false,
    oauthStatus,
    sessionAuthenticated: this.deps?.isMcpAuthenticated(name) ?? false,
  };
  ```
  Leave the `includeTools` / `includePrompts` / `includeResources` blocks unchanged.

### 4. `packages/agents/src/api/control/mcpControlWiring.ts` — wire the live closures

`@pseudocode agents-projection.md section E (80-93)`

- Add imports (bare core barrel — R-CORE-BARREL-SEAM, mirrors the existing
  `MCPOAuthProvider` import at `:14`):
  ```ts
  import {
    MCPOAuthProvider,
    getMcpServerOAuthStatus,
    mcpServerRequiresOAuth,
  } from '@vybestack/llxprt-code-core';
  ```
- In `buildMcpControlDeps`'s returned object (`:43-66`), add two closures
  (undefined-safe over `getMcpServers()`):
  ```ts
  getRequiresAuth: (server) =>
    config.getMcpServers()?.[server]?.oauth?.enabled === true ||
    mcpServerRequiresOAuth.has(server),
  getOAuthStatus: (server) =>
    getMcpServerOAuthStatus(server, {
      requiresOAuth: config.getMcpServers()?.[server]?.oauth?.enabled === true,
    }),
  ```
  Append `@plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-003,REQ-004` to the
  file/function marker block (keep the existing COREAPIGAP marker).

## Constraints

- Implement EXACTLY the pseudocode; cite `@pseudocode lines N-M` in each touched
  region's marker (N5: only `@plan`/`@requirement`/`@pseudocode` comments — no prose).
- **R-DELEGATE:** resolve `getOAuthStatus`/`getRequiresAuth`/`getMcpServers()` PER
  CALL; cache NO OAuth state on the controller.
- **R-NO-REDERIVE:** agents must NOT read the token store or recompute expiry — only
  call the injected `getOAuthStatus`.
- **R-ASYNC-DETAIL:** `buildServerDetail` stays sync; all statuses resolved up front
  via `Promise.all`. No `Promise` may reach a detail field.
- **R-UNDEFINED-SAFE:** absent closures ⇒ `'not-required'` / `false`; never throw.
- **R-NONBREAK:** keep every existing field NAME; only ADD fields + the type re-export.
- Do NOT `catch` the `performOAuth` rejection.

## Verification (BLOCKING — run from repo root)

```bash
set -o pipefail
set -e
AGENT="packages/agents/src/api/agent.ts"
CTRL="packages/agents/src/api/control/mcpControl.ts"
WIRE="packages/agents/src/api/control/mcpControlWiring.ts"
IDX="packages/agents/src/api/index.ts"

# 1) public types gained the new fields + type-only re-export
grep -q "oauthStatus: McpOAuthStatus" "$AGENT" || { echo "FAIL: oauthStatus field"; exit 1; }
grep -q "sessionAuthenticated: boolean" "$AGENT" || { echo "FAIL: sessionAuthenticated field"; exit 1; }
grep -qE "export type \{ McpOAuthStatus \}" "$AGENT" || { echo "FAIL: McpOAuthStatus re-export"; exit 1; }
grep -q "McpOAuthStatus," "$IDX" || { echo "FAIL: barrel type surface"; exit 1; }

# 2) projection derives (no hardcoded requiresAuth:true left in the projection methods)
grep -q "oauthStatus === 'authenticated'" "$CTRL" || { echo "FAIL: derived authenticated"; exit 1; }
grep -q "buildAuthStatus" "$CTRL" || { echo "FAIL: shared buildAuthStatus missing"; exit 1; }
# the two former fabrications must be gone (auth/authenticate now delegate to buildAuthStatus)
if grep -nE "requiresAuth:\s*true" "$CTRL"; then echo "FAIL: hardcoded requiresAuth:true remains"; exit 1; fi

# 3) up-front async resolution present; buildServerDetail still sync (no async keyword on it)
grep -q "Promise.all" "$CTRL" || { echo "FAIL: details() not resolving up-front"; exit 1; }
grep -q "oauthStatusByServer" "$CTRL" || { echo "FAIL: resolved-status map missing"; exit 1; }
awk '/private[ ]+buildServerDetail/{ if ($0 ~ /async/){ print "FAIL: buildServerDetail became async"; exit 1 } }' "$CTRL"

# 4) wiring reaches helper via the BARE core barrel (no deep mcp import)
grep -q "getMcpServerOAuthStatus" "$WIRE" || { echo "FAIL: wiring missing helper"; exit 1; }
grep -q "mcpServerRequiresOAuth" "$WIRE" || { echo "FAIL: wiring missing real requires map"; exit 1; }
grep -q "from '@vybestack/llxprt-code-core'" "$WIRE" || { echo "FAIL: not via core barrel"; exit 1; }
if grep -nE "from '@vybestack/llxprt-code-mcp" "$WIRE" "$CTRL"; then echo "FAIL: deep mcp import in agents"; exit 1; fi

# 5) NO cached oauth state on the controller (delegate-only)
if grep -nE "this\.(oauthStatus|cachedStatus|_status)\s*=" "$CTRL"; then echo "FAIL: cached oauth state"; exit 1; fi

# 6) pseudocode citations present on the touched files
grep -q "@pseudocode" "$CTRL" || { echo "FAIL: no pseudocode citation in control"; exit 1; }

# 7) target behavioral suites GREEN (P05 new + pre-existing reconciliation)
npx vitest run packages/agents/src/api/__tests__/mcpProjection.behavior.test.ts > /tmp/p06_proj.log 2>&1 || { echo "FAIL: P05 suite not GREEN"; tail -40 /tmp/p06_proj.log; exit 1; }
npx vitest run packages/agents/src/api/__tests__/mcpOAuth.behavior.test.ts > /tmp/p06_oauth.log 2>&1 || { echo "FAIL: existing mcpOAuth suite regressed"; tail -40 /tmp/p06_oauth.log; exit 1; }

# 8) whole agents api dir GREEN in isolation + typecheck + lint
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p06_dir.log 2>&1 || { echo "FAIL: agents api dir red"; tail -40 /tmp/p06_dir.log; exit 1; }
npm run typecheck > /tmp/p06_tc.log 2>&1 || { echo "FAIL: typecheck"; tail -40 /tmp/p06_tc.log; exit 1; }
npm run lint > /tmp/p06_lint.log 2>&1 || { echo "FAIL: lint"; tail -40 /tmp/p06_lint.log; exit 1; }
echo "PASS: P06 GREEN (projection + wiring + types; suites/typecheck/lint clean)."
```

> If the agents api dir over-subscribes under root load, re-run the single failing
> file in isolation to confirm green (documented load-contention, not a defect).

## Deferred-Detection (BLOCKING)

```bash
for f in packages/agents/src/api/agent.ts packages/agents/src/api/index.ts \
         packages/agents/src/api/control/mcpControl.ts \
         packages/agents/src/api/control/mcpControlWiring.ts; do
  if git diff HEAD -- "$f" | grep -nE "^\+.*(TODO|FIXME|HACK|STUB|placeholder|for now)"; then
    echo "FAIL: deferred marker introduced in $f"; exit 1
  fi
done
echo "PASS: no deferred markers introduced."
```

## Success Criteria

- All four files modified per pseudocode; both behavioral suites + the agents api
  dir GREEN; typecheck + lint clean; no hardcoded `requiresAuth:true` left in the
  projection; no cached OAuth state; no deep mcp import; pseudocode citations present.

## Failure Recovery

- Promise-in-field / `[object Promise]` in a detail ⇒ you called `getOAuthStatus`
  inside the sync `buildServerDetail`; resolve up front via `Promise.all` and pass the
  resolved value (section D).
- Existing `mcpOAuth.behavior.test.ts` T14*/Td* regressions ⇒ you changed the
  handshake order or `details()` projection shape beyond the additive fields; the
  `callLog` order and `tools/prompts/resources` projection must be byte-preserved.

## Completion Marker

Write `project-plans/issue2165/.completed/P06.md` with: the four modified files; the
exact lines/methods changed with their `@pseudocode` citations; confirmation both
behavioral suites + the agents api dir are GREEN and typecheck/lint pass; explicit
note that `auth()`/`authenticate()` now both delegate to `buildAuthStatus` (no
fabricated `requiresAuth:true`) and that `buildServerDetail` remained sync.
