<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P02 @requirement:REQ-001,REQ-INT-001 -->
# Pseudocode: Canonical MCP OAuth-Status Helper (`packages/mcp`)

Plan ID: PLAN-20260622-MCPOAUTHTRUTH
Module to create: `packages/mcp/src/auth/oauth-status.ts`
Requirements: REQ-001 (.1–.7), REQ-INT-001

---

## Design Rationale — READ FIRST

There is exactly ONE correct way to answer "what is server X's OAuth status?", and today that logic
is duplicated inside the CLI (`mcpDisplay.ts` `buildOAuthStatusSuffix` + `resolveTokenStatus`) and
partially re-derived in `diagnosticsTokens.ts`. This helper makes `packages/mcp` the single source of
truth, composing primitives that ALREADY exist:

- the runtime "requires OAuth" map `mcpServerRequiresOAuth` (`client/mcp-status.ts:46`),
- the persisted-credential accessor `MCPOAuthTokenStorage.getToken` (`auth/oauth-token-storage.ts:104`),
- the expiry math `MCPOAuthTokenStorage.isTokenExpired` (`auth/oauth-token-storage.ts:130`).

It must mirror the PROVEN CLI reference exactly so #1595 can delete the CLI copy with zero visible
change (REQ-INT-001). The reference order is: decide required (OR-combine) → read persisted token →
`null`⇒none → expired⇒expired → else authenticated; any storage fault ⇒ none.

CRITICAL contract detail (ground-truthed): static `getToken` returns
`Promise<MCPOAuthCredentials | null>`, and `isTokenExpired` takes the INNER `MCPOAuthToken`. Thread
`credentials.token`, NOT the wrapper. (The CLI's `diagnosticsTokens.ts` uses `isTokenExpired(token as
never)` — that is a CLI smell; this helper is properly typed and must NOT copy the `as never`.)

The helper is `async` (storage is async), pure of side effects (reads only), masked (returns the enum
only), and total (never throws — every fault becomes `'none'`).

---

## Interface Contracts

```typescript
export type McpOAuthStatus = 'authenticated' | 'expired' | 'none' | 'not-required';

export async function getMcpServerOAuthStatus(
  serverName: string,
  opts?: { requiresOAuth?: boolean },
): Promise<McpOAuthStatus>;
```

## Dependencies (REAL symbols — NEVER stubbed in production)

| Symbol | Source (verified) | Use |
|---|---|---|
| `mcpServerRequiresOAuth: Map<string, boolean>` | `../client/mcp-status.js` (`client/mcp-status.ts:46`) | runtime "requires OAuth" signal (`.get(name) === true`) |
| `MCPOAuthTokenStorage` (static `getToken`, static `isTokenExpired`) | `./oauth-token-storage.js` (`auth/oauth-token-storage.ts:104`, `:130`) | persisted credential read + expiry math |
| `MCPOAuthCredentials`, `MCPOAuthToken` (types) | `./token-store.js` (re-exported via token-storage types) | typing `credentials` / `credentials.token` |

No new third-party dependency. The `auth/oauth-status.ts → ../client/mcp-status.js` edge introduces no
cycle (`mcp-status.ts` is a zero-import leaf; `auth/*` does not import `../client` today).

## Wiring Notes

- Export `McpOAuthStatus` + `getMcpServerOAuthStatus` from `packages/mcp/src/auth/index.ts`
  (alongside the existing `MCPOAuthTokenStorage` export group), then ensure `packages/mcp/src/index.ts`
  re-exports them (it already does `export * from './auth/index.js'`).
- Re-export from `packages/core/src/index.ts`: add `getMcpServerOAuthStatus` to the MCP VALUE group
  (near `mcpServerRequiresOAuth` re-export) and `McpOAuthStatus` to the MCP TYPE-only group.

---

## Numbered Pseudocode

```
# @pseudocode REQ-001.2 — entry
01  FUNCTION getMcpServerOAuthStatus(serverName, opts?):
02      # @pseudocode REQ-001.3 — required? (OR-combine; R-REQUIRED-OR)
03      hintRequires   = (opts?.requiresOAuth === true)
04      runtimeRequires = (mcpServerRequiresOAuth.get(serverName) === true)
05      required = hintRequires OR runtimeRequires
06      IF NOT required THEN
07          RETURN 'not-required'                 # do NOT touch storage
08      END IF
09
10      # @pseudocode REQ-001.4/.5 — persisted credential read (fault-tolerant; R-FAULT-TOLERANT)
11      TRY
12          credentials = AWAIT MCPOAuthTokenStorage.getToken(serverName)   # Promise<MCPOAuthCredentials|null>
13      CATCH any
14          RETURN 'none'                         # storage absent / read failed
15      END TRY
16
17      IF credentials IS null OR credentials IS undefined THEN
18          RETURN 'none'                         # required but no persisted creds
19      END IF
20
21      # @pseudocode REQ-001.4 — expiry on the INNER token (R-INNER-TOKEN)
22      expired = MCPOAuthTokenStorage.isTokenExpired(credentials.token)
23      IF expired THEN
24          RETURN 'expired'
25      ELSE
26          RETURN 'authenticated'
27      END IF
28  END FUNCTION
```

> Note: lines 11–15 wrap ONLY the storage read. `isTokenExpired` is a pure synchronous predicate over
> an already-fetched token and is engine-owned; it is NOT expected to throw, so it stays outside the
> try (keeping the catch narrowly scoped to the I/O — a non-fetched credential can never reach line
> 22). If a reviewer prefers belt-and-suspenders, widening the try to include line 22 is acceptable
> and still satisfies R-FAULT-TOLERANT; the behavioral outcome table is unchanged.

---

## Integration Points (Line → REAL symbol, file:line)

| Pseudocode line | Real symbol | Source file:line (verified) |
|---|---|---|
| 04 | `mcpServerRequiresOAuth.get` | `packages/mcp/src/client/mcp-status.ts:46` |
| 12 | `MCPOAuthTokenStorage.getToken` (static) | `packages/mcp/src/auth/oauth-token-storage.ts:104-109` |
| 17 | `getToken` null contract | `packages/mcp/src/auth/oauth-token-storage.ts:108` (`return credentials as MCPOAuthCredentials \| null`) |
| 22 | `MCPOAuthTokenStorage.isTokenExpired` (static) | `packages/mcp/src/auth/oauth-token-storage.ts:130-136` |
| 22 | `credentials.token` shape (`MCPOAuthToken`) | `packages/mcp/src/auth/token-store.ts:43` (`token: MCPOAuthToken`) |
| reference parity | CLI `buildOAuthStatusSuffix` / `resolveTokenStatus` | `packages/cli/src/ui/commands/mcpDisplay.ts:69-115` |

---

## Anti-Pattern Warnings

- [ERROR] DO NOT call the instance `MCPOAuthTokenStorage().getCredentials()` (returns the broader
  `OAuthCredentials`); USE the static `getToken` (typed `MCPOAuthCredentials | null`). [OK] DO
  `await MCPOAuthTokenStorage.getToken(serverName)`.
- [ERROR] DO NOT pass the wrapper to `isTokenExpired`. [OK] DO pass `credentials.token`.
- [ERROR] DO NOT copy the CLI's `isTokenExpired(token as never)`; this module is properly typed.
- [ERROR] DO NOT read storage when not required (wasteful + leaks intent). [OK] DO early-return
  `'not-required'` before any storage call.
- [ERROR] DO NOT let a storage error escape. [OK] DO map any read fault to `'none'`.
- [ERROR] DO NOT return, log, or format a token/credential value. [OK] DO return the enum only.
- [ERROR] DO NOT mutate `mcpServerRequiresOAuth`. [OK] DO only `.get`.

## Behavior Decision Table (re-stated for the implementer)

| required (OR-combine) | getToken | isTokenExpired(credentials.token) | Result |
|---|---|---|---|
| false | (not called) | (not called) | `'not-required'` |
| true | throws | — | `'none'` |
| true | null | — | `'none'` |
| true | present | true | `'expired'` |
| true | present | false | `'authenticated'` |
