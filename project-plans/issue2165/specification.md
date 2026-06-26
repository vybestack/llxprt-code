<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH @requirement:REQ-001,REQ-002,REQ-003,REQ-004,REQ-005,REQ-INT-001,REQ-INT-002 -->
# Feature Specification: Project Real MCP OAuth Status through the Agent API (prereq for #1595)

Plan ID: PLAN-20260622-MCPOAUTHTRUTH
Generated: 2026-06-22
Issue: #2165 — "Project real MCP OAuth status through the Agent API (correct
authenticated/requiresAuth; canonical mcp helper)"
Predecessor lineage: #1594 (PR #2108, built the public Agent API) → #2143 (PR #2156, closed the first
round of engine-capability gaps, INCLUDING the G6 MCP detail surface). This plan CORRECTS the
semantics of two fields that G6 inherited unchanged from the #1594 per-agent in-session model.
Scope: `packages/mcp/src/auth/**` (canonical derivation) + `packages/agents/src/api/**` (public
projection). NO CLI production source is modified (that is #1595). `packages/auth` is UNTOUCHED
(different domain — provider/model auth). `packages/core` only gains two barrel re-export lines.

---

## Purpose

The public Agent API's MCP auth surface (`agent.mcp.auth()` / `agent.mcp.details()` /
`agent.mcp.authenticate()`) reports **`authenticated`** from an **in-session-only marker** and
hardcodes **`requiresAuth: true`**. Neither reflects the real, persisted MCP-OAuth state the CLI
renders today. If #1595 rewires the CLI to consume the Agent API (its entire purpose), the `/mcp`
OAuth/connection display would **regress**: a server authenticated in a previous session (or
out-of-band) would show as not-authenticated.

This issue is a **prerequisite for #1595** and is purely **additive / corrective** to the API surface
(non-breaking). It does three things:

1. **`packages/mcp`** — add ONE canonical, pure, well-tested helper that composes the persisted-OAuth
   status from primitives that ALREADY exist (token storage + `isTokenExpired` +
   `mcpServerRequiresOAuth`), so there is exactly ONE source of truth for the tri/quad-state
   semantic (today it is duplicated inside the CLI).
2. **`packages/agents`** — project that real status onto the public MCP types: add `oauthStatus`
   (quad-state) and `sessionAuthenticated` (the preserved in-session marker, accurately renamed),
   and CORRECT the meaning of `authenticated` (now persisted truth) and `requiresAuth` (now real).
3. **`packages/core`** — re-export the new helper + type from the barrel (one value line, one
   type-only line), mirroring the existing MCP re-export group.

### Why the shipped surface is inadequate (evidence, current post-#2143-merge source)

Each row was ground-truthed against the working tree on the `issue2165` branch.

| Defect | Evidence (file:line, verified) | Why it blocks #1595 |
|---|---|---|
| **D1 `authenticated` is an in-session marker, not persisted truth** | `agent.mcp.auth()` returns `authenticated` from `isMcpAuthenticated` (`mcpControl.ts:254`); `details()` builds each server's `authenticated` from the same predicate (`mcpControl.ts:403`). That predicate is wired as `(server) => this.authState.mcpAuth.has(server)` (`agentImpl.ts:500`). `authState.mcpAuth` is an EMPTY Set at construction (`authState.ts:86`), written ONLY by `auth.mcpLogin` (`authControl.ts:214`) and a successful in-session `mcp.authenticate` (`agentImpl.ts:502`). In-code doc admits it (`mcpControl.ts:72` "Returns true when the named server was authenticated via mcpLogin."). | On a fresh process `authenticated` is `false` for every server even with valid OAuth credentials persisted on disk — the CLI would regress to "not authenticated". |
| **D2 `requiresAuth` is hardcoded `true`** | `mcpControl.ts:258`, `:321`, `:336` all return `requiresAuth: true` unconditionally. The real answer is per-server: `server.oauth?.enabled === true \|\| mcpServerRequiresOAuth.has(server)`. | Every server would be reported as requiring auth, including ones that do not. |
| **D3 the tri-state semantic has no canonical home** | `packages/cli/src/ui/commands/mcpDisplay.ts:69-115` (`resolveTokenStatus` + `buildOAuthStatusSuffix`) computes "(OAuth authenticated)" / "(OAuth token expired)" / "(OAuth not authenticated)" from `MCPOAuthTokenStorage.getCredentials` + `isTokenExpired`; `diagnosticsTokens.ts:123` re-derives expiry independently. There is NO shared helper in `packages/mcp` for "given a server name, what is its OAuth status?". | Every consumer (CLI today, Agent API tomorrow) re-derives the semantic and can drift; #1595 has no clean engine function to consume. |

> The connection-status half of the MCP surface is ALREADY done right: `mapServerStatus`
> (`mcpControl.ts:151`) delegates to the real `getMCPServerStatus`. That is the template this plan
> follows for OAuth status.

### One issue subtlety corrected by ground-truthing (recorded so the plan is accurate)

The issue body's Layer-1 sketch writes `getCredentials(serverName)` then `isTokenExpired(token)`. The
PRECISE engine contract (verified) is: static `MCPOAuthTokenStorage.getToken(serverName)` returns
`Promise<MCPOAuthCredentials | null>` (`oauth-token-storage.ts:104-109`); `MCPOAuthCredentials.token`
is the inner `MCPOAuthToken` (`token-store.ts:43-50`); `MCPOAuthTokenStorage.isTokenExpired(token:
MCPOAuthToken)` reads `token.expiresAt` (`oauth-token-storage.ts:130-136`). Therefore the helper must
thread the **inner `credentials.token`** into `isTokenExpired`, NOT the wrapper. This is exactly what
the working CLI reference does: `mcpDisplay.ts` `resolveTokenStatus(MCPOAuthTokenStorage,
credentials.token)`. The static `getToken` is the convenience accessor (vs the instance
`getCredentials`), and is the masked, allocation-free path for a status query.

---

## Architectural Decisions

- **Engine owns truth → Agent API projects truth → CLI renders pixels.** The canonical derivation
  lives in `packages/mcp` (where the token storage, expiry math, and requiresOAuth map already
  live). The agents layer PROJECTS it (no re-derivation). The CLI (in #1595) will consume it and keep
  only colors/strings.
- **One canonical helper, pure + async + masked.** `getMcpServerOAuthStatus(serverName, opts?)`
  returns a 4-value union `McpOAuthStatus = 'authenticated' | 'expired' | 'none' | 'not-required'`.
  It NEVER returns a token string (masked). It is `async` because token storage is async.
- **Design Choice 1 (KEPT from CodeRabbit's plan): the helper OR-combines internally.** It takes
  `opts?: { requiresOAuth?: boolean }` and OR-combines that hint with its OWN read of
  `mcpServerRequiresOAuth.get(serverName)`. The agents layer passes
  `serverConfig.oauth?.enabled === true` as the hint; the helper adds the runtime-map signal. This
  keeps the "required?" decision in ONE place and matches the proven CLI reference
  (`buildOAuthStatusSuffix`: `server.oauth?.enabled === true || mcpServerRequiresOAuth.has(name)`).
- **Non-breaking is a HARD CONSTRAINT (REQ-INT-002).** Additive only. `authenticated` and
  `requiresAuth` keep their NAMES (their MEANING is corrected — that is the bugfix); `oauthStatus`
  and `sessionAuthenticated` are NEW fields. Every current public export keeps working. Backed by the
  existing characterization tests (`publicSurface.nonbreaking.test.ts`, `nonBreaking.exports.test.ts`)
  and the compile-anchor fence (`additiveSurface.types.ts`).
- **Delegate, never cache.** The agents controller resolves OAuth status through injected closures
  over the live engine PER CALL — no cached OAuth state in the controller (mirrors the existing
  `getManager`/`getToolRegistry`/`isMcpAuthenticated` closure convention).
- **No new agents dependency.** `packages/agents` reaches the new helper through the existing
  `@vybestack/llxprt-code-core` barrel re-export (agents already pulls `MCPOAuthProvider` /
  `mcpServerRequiresOAuth` from core). No direct `packages/mcp` dependency is added; no deep import.

---

## Requirements

### REQ-001 — Canonical mcp OAuth-status helper (`packages/mcp`)

- **REQ-001.1** Export type `McpOAuthStatus = 'authenticated' | 'expired' | 'none' | 'not-required'`
  from a new module `packages/mcp/src/auth/oauth-status.ts`.
- **REQ-001.2** Export `async function getMcpServerOAuthStatus(serverName: string, opts?: {
  requiresOAuth?: boolean }): Promise<McpOAuthStatus>`.
- **REQ-001.3** "Required?" = `opts?.requiresOAuth === true || mcpServerRequiresOAuth.get(serverName)
  === true`. When NOT required → return `'not-required'` (do NOT touch storage).
- **REQ-001.4** When required: call `MCPOAuthTokenStorage.getToken(serverName)`. If it returns `null`
  → `'none'`. Else thread the inner `credentials.token` into
  `MCPOAuthTokenStorage.isTokenExpired(credentials.token)` → `'expired'` when true, `'authenticated'`
  when false.
- **REQ-001.5** Undefined-safe / fault-tolerant: if the token store is absent or `getToken` throws,
  return `'none'` (never throw out of the helper). Wrap the storage read in try/catch.
- **REQ-001.6** Masked: the return is the enum only — never a token, never credential fields.
- **REQ-001.7** Barrel: export both symbols from `packages/mcp/src/auth/index.ts` →
  `packages/mcp/src/index.ts`; re-export from `packages/core/src/index.ts` (value group +
  type-only group), mirroring the existing MCP re-export block (`core/src/index.ts:478-514`).

### REQ-002 — Project `oauthStatus` + corrected `authenticated`/`requiresAuth` onto `McpServerAuthStatus`

The two methods that return `McpServerAuthStatus` — `auth(server)` (`mcpControl.ts:253`) and
`authenticate(server)` (`mcpControl.ts:316`) — must report the real status.

- **REQ-002.1** Add to `McpServerAuthStatus` (`agent.ts:150-155`): `readonly oauthStatus:
  McpOAuthStatus` and `readonly sessionAuthenticated: boolean`. Keep `server`, `authenticated`,
  `requiresAuth`, `authUrl?` (names unchanged).
- **REQ-002.2** `authenticated` semantics CORRECTED: `authenticated === (oauthStatus ===
  'authenticated')` (persisted truth), NOT the in-session Set.
- **REQ-002.3** `requiresAuth` semantics CORRECTED: real per-server value (`oauthStatus !==
  'not-required'`, equivalently `oauth.enabled || mcpServerRequiresOAuth.has(server)`). No more
  hardcoded `true`.
- **REQ-002.4** `sessionAuthenticated` preserves the OLD in-session signal
  (`isMcpAuthenticated(server)`) under its accurate name.
- **REQ-002.5** `auth(server)` reports persisted status WITHOUT performing a handshake.
  `authenticate(server)` (the active flow) reports the post-handshake status; on the success path the
  freshly-written credentials make `oauthStatus === 'authenticated'`.

### REQ-003 — Project the same onto `McpServerDetail` (`details()`)

- **REQ-003.1** Add to `McpServerDetail` (`agent.ts:188-194`): `readonly oauthStatus: McpOAuthStatus`,
  `readonly requiresAuth: boolean`, `readonly sessionAuthenticated: boolean`. Keep `name`,
  `authenticated`, `tools?`, `prompts?`, `resources?`.
- **REQ-003.2** `authenticated` / `requiresAuth` / `sessionAuthenticated` carry the SAME corrected
  semantics as REQ-002 (per server).
- **REQ-003.3** `details()` resolves per-server OAuth status via the SAME injected closure; the sync
  `buildServerDetail` (`mcpControl.ts:383`) is refactored so the awaited status is resolved up-front
  (e.g. `Promise.all` over the configured server names) and never leaks a `Promise` into the
  `oauthStatus` field.

### REQ-004 — `McpControlDeps` closures + undefined-safe wiring

- **REQ-004.1** Add to `McpControlDeps` (`mcpControl.ts:71`): `readonly getOAuthStatus?: (server:
  string) => Promise<McpOAuthStatus>` and `readonly getRequiresAuth?: (server: string) => boolean`.
  Retain `isMcpAuthenticated` (now feeds `sessionAuthenticated`).
- **REQ-004.2** Wire in `buildMcpControlDeps` (`mcpControlWiring.ts`): `getOAuthStatus(server)` →
  `getMcpServerOAuthStatus(server, { requiresOAuth: serverConfig?.oauth?.enabled === true })` where
  `serverConfig` comes from `config.getMcpServers()?.[server]`; `getRequiresAuth(server)` →
  `serverConfig?.oauth?.enabled === true || mcpServerRequiresOAuth.has(server)`.
- **REQ-004.3** Undefined-safe: `config.getMcpServers()` may be `undefined` or omit the server →
  `getRequiresAuth` returns `false`, and `getOAuthStatus` returns `'not-required'` (via the helper's
  own logic) — never throw.
- **REQ-004.4** Controller-side undefined-safety: when `getOAuthStatus`/`getRequiresAuth` closures are
  absent (partial deps), default to `oauthStatus: 'not-required'`, `requiresAuth: false`,
  `authenticated: false` — never throw.

### REQ-005 — Type re-export from the agents api barrel

- **REQ-005.1** `agent.ts` imports `McpOAuthStatus` type-only from `@vybestack/llxprt-code-core` and
  re-exports it (mirroring the existing MCP-type re-export precedent in `agent.ts`).
- **REQ-005.2** The agents api barrel (`packages/agents/src/api/index.ts`) surfaces `McpOAuthStatus`
  type-only so #1595 can name it from the public root.

### REQ-INT-001 — Behavioral parity with the CLI reference

The helper's outcome for a given (serverName, requiresOAuth, persisted-credential, expiry) tuple MUST
match what `mcpDisplay.ts`'s `buildOAuthStatusSuffix` renders today (authenticated/expired/none), so
#1595 can delete the CLI derivation and consume the helper with zero visible change.

### REQ-INT-002 — Non-breaking public surface

No existing public export removed or changed in shape. `authenticated` / `requiresAuth` field NAMES
retained (meaning corrected). New fields additive. Guarded by the existing non-breaking
characterization tests + the compile-anchor fence.

---

## Data Schemas

```typescript
// packages/mcp/src/auth/oauth-status.ts  (canonical, no UI, no formatting)
export type McpOAuthStatus = 'authenticated' | 'expired' | 'none' | 'not-required';
export async function getMcpServerOAuthStatus(
  serverName: string,
  opts?: { requiresOAuth?: boolean },
): Promise<McpOAuthStatus>;

// packages/agents/src/api/agent.ts  (public projection — additive/corrective)
export interface McpServerAuthStatus {
  readonly server: string;
  readonly authenticated: boolean;        // CORRECTED: === (oauthStatus === 'authenticated')
  readonly requiresAuth: boolean;         // CORRECTED: real per-server
  readonly oauthStatus: McpOAuthStatus;   // NEW: quad-state from packages/mcp
  readonly sessionAuthenticated: boolean; // NEW: preserved in-session marker
  readonly authUrl?: string;              // unchanged
}
export interface McpServerDetail {
  readonly name: string;
  readonly authenticated: boolean;        // CORRECTED (persisted truth)
  readonly requiresAuth: boolean;         // NEW: real per-server
  readonly oauthStatus: McpOAuthStatus;   // NEW
  readonly sessionAuthenticated: boolean; // NEW
  readonly tools?: readonly ToolInfo[];
  readonly prompts?: readonly McpPromptInfo[];
  readonly resources?: readonly McpResourceInfo[];
}
```

---

## Behavior Decision Table (canonical helper)

| serverName | opts.requiresOAuth | mcpServerRequiresOAuth.get | persisted credential | isTokenExpired | Result |
|---|---|---|---|---|---|
| "s" | false/undefined | undefined/false | (not read) | (not read) | `'not-required'` |
| "s" | true | (either) | null | — | `'none'` |
| "s" | false | true (runtime map) | null | — | `'none'` |
| "s" | true | (either) | present | false | `'authenticated'` |
| "s" | true | (either) | present | true | `'expired'` |
| "s" | true | (either) | getToken THROWS | — | `'none'` (caught) |
| "s" | true | (either) | store undefined | — | `'none'` (caught) |

## Behavior Decision Table (agents projection)

| GIVEN | Method | oauthStatus | authenticated | requiresAuth | sessionAuthenticated |
|---|---|---|---|---|---|
| oauth.enabled, valid token on disk, fresh process, not mcpLogin'd | `auth("s")` | `'authenticated'` | `true` | `true` | `false` |
| oauth.enabled, expired token on disk | `auth("s")` | `'expired'` | `false` | `true` | `false` |
| oauth.enabled, no token | `auth("s")` | `'none'` | `false` | `true` | `false` |
| no oauth, not in requiresOAuth map | `auth("s")` | `'not-required'` | `false` | `false` | `false` |
| in-session mcpLogin'd, no persisted token | `auth("s")` | `'none'` | `false` | `true` | `true` |
| getOAuthStatus/getRequiresAuth closures absent | `auth("s")` | `'not-required'` | `false` | `false` | (isMcpAuthenticated ?? false) |
| 2 servers, mixed states | `details()` | per-server | per-server | per-server | per-server |

---

## Out of Scope

- The #1595 CLI rewrite itself (deleting the duplicated CLI derivations + consuming the API). This
  plan only makes the API correct + documents the CLI follow-up.
- Any change to `packages/auth` (provider/model auth — different domain).
- Rendering/formatting concerns (colors, strings, indicators) — stay in the CLI.
- Live connection status (`getMCPServerStatus`) — already projected correctly by `mapServerStatus`.

## Relationships

- **Follows:** #1594 (PR #2108), #2143 (PR #2156).
- **Blocks / prerequisite for:** #1595 (Refactor CLI to consume core API).
