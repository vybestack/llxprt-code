<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P02a @requirement:REQ-001,REQ-002,REQ-003,REQ-004,REQ-005,REQ-INT-001,REQ-INT-002 -->
# Phase 02a: Pseudocode Verification

## Phase ID

`PLAN-20260622-MCPOAUTHTRUTH.P02a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 02 completed
- Verification: `test -f project-plans/issue2165/.completed/P02.md`

## Verification Tasks

Read both pseudocode files IN FULL. Confirm contract-first structure and fidelity to the ACTUAL
source (cross-check every cited line number against the real files).

```bash
set -o pipefail
cd project-plans/issue2165/analysis/pseudocode
for f in oauth-status-helper agents-projection; do
  grep -q "Interface Contracts" "$f.md" && grep -q "Integration Points" "$f.md" && grep -q "Anti-Pattern Warnings" "$f.md" || echo "$f INCOMPLETE"
done
cd - >/dev/null
# Fidelity spot-checks against real source (cited anchors MUST resolve):
grep -n "mcpServerRequiresOAuth: Map<string, boolean>" packages/mcp/src/client/mcp-status.ts   # :46
grep -n "static async getToken" packages/mcp/src/auth/oauth-token-storage.ts                   # :104
grep -n "static isTokenExpired" packages/mcp/src/auth/oauth-token-storage.ts                   # :130
grep -n "token: MCPOAuthToken" packages/mcp/src/auth/token-store.ts                            # :45
grep -nE "async auth\(|async authenticate\(|async details\(|buildServerDetail\(" packages/agents/src/api/control/mcpControl.ts
grep -nE "requiresAuth: true|isMcpAuthenticated\(" packages/agents/src/api/control/mcpControl.ts
grep -nE "getMcpServers|getBlockedMcpServers|performOAuth|refreshClientTools|from '@vybestack/llxprt-code-core'" packages/agents/src/api/control/mcpControlWiring.ts
grep -nE "interface McpServerAuthStatus|interface McpServerDetail|export type \{ ApprovalMode \}" packages/agents/src/api/agent.ts
```

### Semantic Verification Checklist

- [ ] Both pseudocode files have all three mandatory sections + numbered lines + `@pseudocode` tags.
- [ ] Cited symbols/line numbers MATCH actual source for both components.
- [ ] `oauth-status-helper`: OR-combines required (R-REQUIRED-OR) and early-returns `'not-required'`
      WITHOUT touching storage; uses the STATIC `getToken` (not the instance `getCredentials`);
      threads `credentials.token` into `isTokenExpired` (R-INNER-TOKEN); maps any storage fault to
      `'none'` (R-FAULT-TOLERANT); returns the enum only (R-MASKED).
- [ ] `agents-projection`: `auth()`/`authenticate()` share ONE private `buildAuthStatus`; derives
      `authenticated = (oauthStatus === 'authenticated')` (R-AUTHENTICATED-DERIVED); computes
      `requiresAuth` via `getRequiresAuth` with NO hardcoded `true` (R-REQUIRESAUTH-REAL); routes the
      old in-session signal to `sessionAuthenticated` (R-SESSION-DISTINCT); `details()` resolves all
      statuses UP FRONT and `buildServerDetail` stays sync (R-ASYNC-DETAIL); wiring is undefined-safe
      over `getMcpServers()` and reaches the helper via the bare core barrel (R-CORE-BARREL-SEAM); no
      field NAME removed/renamed (R-NONBREAK).
- [ ] `performOAuth` rejection is NOT caught (handshake propagation preserved).
- [ ] Neither file re-derives expiry/storage in the agents layer (R-NO-REDERIVE).

## Holistic Assessment (MANDATORY — into completion marker)

Explain whether, if implemented faithfully, the pseudocode produces a public surface adequate for
#1595: every MCP OAuth state reachable through the public Agent root with no `getConfig()` escape
hatch and no CLI-side expiry math, with `authenticated`/`sessionAuthenticated` correctly independent.
Note any line-number drift found and corrected. Verdict PASS/FAIL.

## Success Criteria

- All checks pass; line numbers reconciled; holistic assessment written.

## Failure Recovery

- Return to Phase 02 with specific corrections; do NOT proceed to Phase 03 until PASS.

## Phase Completion Marker

Create: `project-plans/issue2165/.completed/P02a.md`

```markdown
Phase: P02a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```
