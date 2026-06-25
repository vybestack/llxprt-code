<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P00a @requirement:REQ-001..REQ-005,REQ-INT-001..002 -->
# Phase 00a: Preflight Verification

## Phase ID

`PLAN-20260622-MCPOAUTHTRUTH.P00a`

## LLxprt Code Subagent: architect

## Purpose

Verify EVERY assumption this plan depends on against the actual current source BEFORE any
implementation phase begins, including the THREE ground-truthed design corrections (static
`getToken` + `credentials.token`; monotonic true-only `mcpServerRequiresOAuth`; the hardcoded /
in-session-only projection that is the defect under repair). If any check fails, STOP and update the
plan first.

## Prerequisites

- Branch `issue2165` derived from current `main` (post-#2143/PR-#2156 merge).
- Required reading: `specification.md`, `analysis/domain-model.md`, both
  `analysis/pseudocode/*.md`.

## Dependency Verification

Run and paste output:

```bash
set -o pipefail
# Phase 1 ADDS fast-check + Stryker to packages/mcp (they are NOT there yet — absence is EXPECTED):
grep -nE ""fast-check"" packages/mcp/package.json || echo "EXPECTED-ABSENT: fast-check not in mcp yet (P03/P04 add ^4.2.0)"
grep -nE "@stryker-mutator/core" packages/mcp/package.json || echo "EXPECTED-ABSENT: stryker not in mcp yet (P08 adds ^9.6.1 + vitest-runner)"
test -f packages/mcp/stryker.conf.json && echo "UNEXPECTED: mcp stryker.conf.json already exists" || echo "EXPECTED-ABSENT: P08 creates packages/mcp/stryker.conf.json"
# agents already has fast-check + stryker (Phase 2 reuses them):
grep -nE ""fast-check"" packages/agents/package.json   # expect present
grep -nE "@stryker-mutator/core" packages/agents/package.json   # expect ^9.6.1
# agents must already depend on core (the helper is re-exported THROUGH the core barrel:
# agents → core → mcp, keeping the boundary acyclic; agents needs NO direct mcp dep, which is
# why the P05 RED test imports getMcpServerOAuthStatus from '@vybestack/llxprt-code-core'):
grep -nE ""@vybestack/llxprt-code-core"" packages/agents/package.json
grep -nE ""@vybestack/llxprt-code-mcp"" packages/agents/package.json || echo "EXPECTED: no direct agents→mcp dep (helper routes through the core barrel)"
```

| Dependency | Expected | Status |
|---|---|---|
| `fast-check` ABSENT in mcp (P03 adds `^4.2.0`) | absent | [ ] |
| `@stryker-mutator/core` ABSENT in mcp (P08 adds `^9.6.1`) | absent | [ ] |
| `packages/mcp/stryker.conf.json` ABSENT (P08 creates) | absent | [ ] |
| `fast-check` PRESENT in agents | present | [ ] |
| `@stryker-mutator/core` PRESENT in agents (`^9.6.1`) | present | [ ] |
| agents → core dep present (helper routes through core barrel; NO direct agents→mcp dep needed) | present | [ ] |

## CORRECTED DESIGN ASSUMPTIONS (must verify FIRST)

```bash
set -o pipefail
# CORRECTION 1: the canonical token read is STATIC MCPOAuthTokenStorage.getToken(serverName):
# Promise<MCPOAuthCredentials | null>, casting at :109; the result's .token is MCPOAuthToken; and
# isTokenExpired is the STATIC method reading token.expiresAt with a skew buffer + isInvalidExpiry
# guard. The new helper threads credentials.token into isTokenExpired — it MUST NOT copy the CLI's
# `isTokenExpired(token as never)` cast.
grep -n "static async getToken" packages/mcp/src/auth/oauth-token-storage.ts            # expect ~:104
grep -n "as MCPOAuthCredentials | null" packages/mcp/src/auth/oauth-token-storage.ts    # expect cast ~:109
grep -n "static isTokenExpired" packages/mcp/src/auth/oauth-token-storage.ts            # expect ~:130
grep -n "isInvalidExpiry" packages/mcp/src/auth/oauth-token-storage.ts | head          # guard def ~:20 + use ~:132
grep -nE "token: MCPOAuthToken" packages/mcp/src/auth/token-store.ts                    # MCPOAuthCredentials.token ~:45
grep -nE "expiresAt\?: number" packages/mcp/src/auth/token-store.ts                     # MCPOAuthToken.expiresAt ~:35

# CORRECTION 2: mcpServerRequiresOAuth is a module-level Map<string, boolean> that is monotonic /
# true-only — confirm the declaration + that EVERY writer sets true + ZERO clear/delete/set-false.
grep -n "mcpServerRequiresOAuth: Map<string, boolean>" packages/mcp/src/client/mcp-status.ts   # decl ~:46
grep -rnE "mcpServerRequiresOAuth\.(set|delete|clear)" packages/mcp/src | sort
echo "EXPECT: only .set(..., true) writers (mcp-connection.ts ~:269,:318); NO .delete / .clear / .set(...,false) anywhere."

# CORRECTION 3: the agents projection currently FABRICATES authenticated/requiresAuth — this is the
# DEFECT, not a contract. Confirm the hardcoded `requiresAuth: true` sites + in-session reads.
grep -nE "requiresAuth: true" packages/agents/src/api/control/mcpControl.ts             # expect :258, :321, :336
grep -nE "isMcpAuthenticated\(" packages/agents/src/api/control/mcpControl.ts           # expect :254 (auth), :403 (buildServerDetail)
grep -n "this.authState.mcpAuth.has" packages/agents/src/api/agentImpl.ts               # in-session marker source ~:500
grep -nE "mcpAuth" packages/agents/src/api/control/authState.ts | head                  # decl ~:66; Set init ~:86 (starts empty)
```

| Corrected assumption | Expected | Actual | Match? |
|---|---|---|---|
| `MCPOAuthTokenStorage.getToken` static, returns `Promise<MCPOAuthCredentials \| null>`, casts at `:109` | yes | | [ ] |
| `MCPOAuthTokenStorage.isTokenExpired(token)` static `:130`, `isInvalidExpiry` guard `:132` | yes | | [ ] |
| `MCPOAuthCredentials.token: MCPOAuthToken` (`token-store.ts:45`); `MCPOAuthToken.expiresAt?` (`:35`) | yes | | [ ] |
| `mcpServerRequiresOAuth: Map<string, boolean>` (`mcp-status.ts:46`) | yes | | [ ] |
| ONLY `.set(...,true)` writers; ZERO `.delete`/`.clear`/`.set(...,false)` | yes | | [ ] |
| `requiresAuth: true` hardcoded at `mcpControl.ts:258,:321,:336` (the D2 defect) | yes | | [ ] |
| `isMcpAuthenticated()` read at `mcpControl.ts:254,:403`; source `agentImpl.ts:500`; empty Set `control/authState.ts:86` (D1 defect) | yes | | [ ] |

## Type / Interface Verification — backing engines + barrels

```bash
set -o pipefail
# REQ-001 helper composition primitives + barrels:
grep -nE "export \* from './auth/index.js'|export \* from './client/index.js'" packages/mcp/src/index.ts   # :8 / :10
grep -nE "MCPOAuthProvider|MCPOAuthTokenStorage" packages/mcp/src/auth/index.ts            # :8 / :15 (ADD getMcpServerOAuthStatus + McpOAuthStatus here)
# core barrel mcp groups (value :486-503, type :505-514) — ADD getMcpServerOAuthStatus (value) + McpOAuthStatus (type):
grep -nE "mcpServerRequiresOAuth|MCPOAuthProvider|MCPOAuthTokenStorage" packages/core/src/index.ts | head   # value group ~:491/:498/:499
grep -nE "} from '@vybestack/llxprt-code-mcp';" packages/core/src/index.ts                 # close of value group ~:503 + type group ~:514

# REQ-002..004 agents projection anchors (exact bodies):
grep -nE "interface McpServerAuthStatus|interface McpServerDetail" packages/agents/src/api/agent.ts   # :150 / :188
grep -nE "McpServerAuthStatus|McpServerDetail" packages/agents/src/api/index.ts            # already type-re-exported :34 / :36
grep -n "export type { ApprovalMode }" packages/agents/src/api/agent.ts                    # type-only precedent ~:568 (mirror for McpOAuthStatus)
# McpControl shape (Deps interface, auth, authenticate, details, buildServerDetail):
grep -nE "interface McpControlDeps|isMcpAuthenticated|getManager|getServerConfigs|getBlockedServers|getPromptRegistry" packages/agents/src/api/control/mcpControl.ts | head
grep -nE "async auth\(|async authenticate\(|async details\(|buildServerDetail\(" packages/agents/src/api/control/mcpControl.ts
# Wiring — confirm MCPOAuthProvider imported from the BARE core barrel (seam for the helper too):
grep -nE "from '@vybestack/llxprt-code-core'|buildMcpControlDeps|getMcpServers|getBlockedMcpServers|performOAuth|refreshClientTools" packages/agents/src/api/control/mcpControlWiring.ts
grep -nE "getMcpServers" packages/core/src/config/configBaseCore.ts                          # ~:436 (Record<string,MCPServerConfig>|undefined)
grep -nE "enabled" packages/mcp/src/auth/oauth-provider.ts | head                           # MCPOAuthConfig.enabled ~:35
```

| Assumption | Expected | Actual | Match? |
|---|---|---|---|
| mcp barrel: `auth/index.js` (`:8`) + `client/index.js` (`:10`) re-exported | yes | | [ ] |
| `auth/index.ts` exports `MCPOAuthProvider` (`:8`) / `MCPOAuthTokenStorage` (`:15`) — add helper+type here | yes | | [ ] |
| core barrel value group closes `:503`, type group `:505-514` — add helper(value)+type | yes | | [ ] |
| `McpServerAuthStatus` (`agent.ts:150`) / `McpServerDetail` (`:188`) — gain fields | yes | | [ ] |
| both already type-re-exported (`api/index.ts:34,:36`) | yes | | [ ] |
| `export type { ApprovalMode }` (`agent.ts:568`) — type-only precedent | yes | | [ ] |
| `McpControlDeps` / `auth()` / `authenticate()` / `details()` / `buildServerDetail()` present | yes | | [ ] |
| wiring imports `MCPOAuthProvider` from bare `@vybestack/llxprt-code-core`; `buildMcpControlDeps` present | yes | | [ ] |
| `getMcpServers(): Record<string,MCPServerConfig> \| undefined` (`configBaseCore.ts:436`); `MCPOAuthConfig.enabled` (`oauth-provider.ts:35`) | yes | | [ ] |

## Import-Graph / Boundary Verification

```bash
set -o pipefail
# New auth/oauth-status.ts → ../client/mcp-status.js must NOT create a cycle. Confirm client/mcp-status
# is a leaf (no imports) and auth/ does not already import ../client:
grep -nE "^import" packages/mcp/src/client/mcp-status.ts || echo "CONFIRMED: mcp-status.ts has ZERO imports (pure leaf)"
grep -rnE "from '\.\./client" packages/mcp/src/auth || echo "CONFIRMED: auth/ does not currently import ../client (new file is the first; still acyclic since client is a leaf)"
# Non-breaking guard files (extended in P07) exist:
ls packages/agents/src/api/__tests__/additiveSurface.types.ts \
   packages/agents/src/api/__tests__/nonBreaking.exports.test.ts \
   packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts 2>/dev/null
# Canonical single-file run form smoke on a known mcp spec:
EXISTING=$(ls packages/mcp/src/auth/*.test.ts 2>/dev/null | head -1)
if [ -n "$EXISTING" ]; then
  npx vitest run "$EXISTING" > /tmp/p00a-canon.log 2>&1; CANON=$?
  tail -5 /tmp/p00a-canon.log
  [ "$CANON" -eq 0 ] || { echo "FAIL: canonical single-file run form did not succeed on a known mcp spec"; exit 1; }
fi
echo "CANONICAL: npx vitest run <file>"
# Baselines clean. On a clean checkout (HEAD==origin/main) `npm run typecheck` ALONE
# false-fails exit 2 purely from STALE core dist/.d.ts (HistoryService missing
# resetTokenAccounting + recalculateTotalTokens(arg)); the FIX is to BUILD FIRST so the
# emitted .d.ts are fresh, THEN typecheck. Run build then typecheck SERIALLY (concurrent
# → TS2307/TS6305). build→typecheck = exit 0.
npm run build >/tmp/p00a-build.log 2>&1 && echo "build baseline OK" || { echo "build baseline BROKEN — fix before starting"; tail -20 /tmp/p00a-build.log; exit 1; }
npm run typecheck >/tmp/p00a-tc.log 2>&1 && echo "typecheck baseline OK" || { echo "typecheck baseline BROKEN (after build) — fix before starting"; tail -20 /tmp/p00a-tc.log; exit 1; }
```

| Item | Expected | Status |
|---|---|---|
| `client/mcp-status.ts` is an import-leaf; `auth/` → `../client` introduces no cycle | yes | [ ] |
| three non-breaking guard files present (extend in P07) | yes | [ ] |
| Canonical single-file form `npx vitest run <file>` works on a known mcp spec | yes | [ ] |
| Baseline `npm run build` then `npm run typecheck` clean (build-first; typecheck-alone false-fails on stale core dist) | yes | [ ] |

## Test-Infra / Seam Verification

```bash
set -o pipefail
# Phase-1 tests drive the real token store via a MockTokenStorage implementing TokenStorage + the
# static setTokenStore seam (NOT vi.fn). Confirm both exist:
grep -nE "class MockTokenStorage|implements TokenStorage" packages/mcp/src/auth/oauth-token-storage.test.ts | head
grep -nE "static setTokenStore|setTokenStore\(" packages/mcp/src/auth/oauth-token-storage.ts | head     # seam ~:63
# Phase-2 tests use the real agents fakes. `createFakeMcpDeps` EXISTS at
# helpers/fakeMcpManager.ts:160 (returns { deps: McpControlDeps, manager }; opts incl
# servers/tools/authenticatedServers/hasManager/hasRegistry; used in mcp-discovery.spec.ts).
# It is the natural no-mock-theater seam to EXTEND in P05/P06 with the new
# getOAuthStatus/getRequiresAuth closures (alongside isMcpAuthenticated → sessionAuthenticated).
ls packages/agents/src/api/__tests__/helpers/fakeMcpManager.ts packages/agents/src/api/__tests__/helpers/fakeMcpServer.ts 2>/dev/null
grep -rn "createFakeMcpDeps" packages/agents/src && echo "CONFIRMED: createFakeMcpDeps exists (extend it in P05/P06 with getOAuthStatus/getRequiresAuth)" || { echo "UNEXPECTED: createFakeMcpDeps missing — fall back to building McpControlDeps inline"; exit 1; }
# CLI reference we canonicalize (NOT modified): buildOAuthStatusSuffix OR-combine path
grep -nE "buildOAuthStatusSuffix|getCredentials|isTokenExpired" packages/cli/src/ui/commands/mcpDisplay.ts | head
```

| Item | Expected | Status |
|---|---|---|
| `MockTokenStorage implements TokenStorage` + `MCPOAuthTokenStorage.setTokenStore` seam present | yes | [ ] |
| `fakeMcpManager.ts` / `fakeMcpServer.ts` present; `createFakeMcpDeps` EXISTS (`fakeMcpManager.ts:160`) — extend in P05/P06 | yes | [ ] |
| CLI `buildOAuthStatusSuffix` reference path located (read-only, not modified) | yes | [ ] |

## Blocking Issues Found

[List any mismatch that requires plan modification BEFORE Phase 01.]

## Verification Gate

- [ ] Dependency expectations confirmed (mcp lacks fast-check/stryker; agents has both)
- [ ] All THREE corrected design assumptions confirmed (getToken cast + credentials.token; monotonic true-only map; hardcoded/in-session defect)
- [ ] All backing-engine types + barrel anchors match plan assumptions
- [ ] Import graph acyclic; non-breaking guard files located; canonical test command works
- [ ] Test seams confirmed (MockTokenStorage/setTokenStore; real agents fakes; createFakeMcpDeps present at fakeMcpManager.ts:160 — extend it)
- [ ] Baseline `npm run build` then `npm run typecheck` clean (build-first)

IF ANY CHECKBOX IS UNCHECKED: STOP and update the plan before proceeding.

## Phase Completion Marker

Create: `project-plans/issue2165/.completed/P00a.md`

Contents (REQUIRED — the executor fills every field with REAL values, not placeholders):

```markdown
Phase: P00a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [none expected — preflight is read-only]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```
:

```markdown
Phase: P00a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [none expected — preflight is read-only]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```
