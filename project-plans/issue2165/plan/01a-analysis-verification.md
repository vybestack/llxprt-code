<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P01a @requirement:REQ-001,REQ-002,REQ-003,REQ-004,REQ-005,REQ-INT-001,REQ-INT-002 -->
# Phase 01a: Analysis Verification

## Phase ID

`PLAN-20260622-MCPOAUTHTRUTH.P01a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 01 completed
- Verification: `test -f project-plans/issue2165/.completed/P01.md`

## Verification Tasks

Read `analysis/domain-model.md` IN FULL and confirm it is faithful to the ACTUAL source (cross-check
every cited anchor) and adequate for #1595.

```bash
set -o pipefail
M=project-plans/issue2165/analysis/domain-model.md
for r in REQ-001 REQ-002 REQ-003 REQ-004 REQ-005 REQ-INT-001 REQ-INT-002; do
  grep -q "$r" "$M" || echo "MISSING $r"
done
grep -cE "R-REQUIRED-OR|R-INNER-TOKEN|R-FAULT-TOLERANT|R-MASKED|R-AUTHENTICATED-DERIVED|R-REQUIRESAUTH-REAL|R-SESSION-DISTINCT|R-DELEGATE|R-UNDEFINED-SAFE|R-NONBREAK|R-NO-REDERIVE|R-CORE-BARREL-SEAM|R-ASYNC-DETAIL" "$M"
# Cross-check the model's cited anchors against real source (each MUST resolve):
grep -n "mcpServerRequiresOAuth: Map<string, boolean>" packages/mcp/src/client/mcp-status.ts
grep -n "static async getToken" packages/mcp/src/auth/oauth-token-storage.ts
grep -n "static isTokenExpired" packages/mcp/src/auth/oauth-token-storage.ts
grep -n "token: MCPOAuthToken" packages/mcp/src/auth/token-store.ts
grep -nE "requiresAuth: true" packages/agents/src/api/control/mcpControl.ts
grep -n "this.authState.mcpAuth.has" packages/agents/src/api/agentImpl.ts
grep -nE "interface McpServerAuthStatus|interface McpServerDetail" packages/agents/src/api/agent.ts
# Re-prove the map is monotonic / true-only (no clear/delete/set-false anywhere):
grep -rnE "mcpServerRequiresOAuth\.(set|delete|clear)" packages/mcp/src | sort
```

### Semantic Verification Checklist

- [ ] All 7 requirements (5 REQ + 2 REQ-INT) covered with entities + transitions + invariants +
      harness references.
- [ ] All 13 named invariants present, each mapped to ≥1 harness row.
- [ ] NEW-vs-EXTEND (additive only) is unambiguous; no breaking change implied.
- [ ] No implementation code leaked into analysis.
- [ ] The corrected design facts are reflected: static `getToken` → `credentials.token` →
      `isTokenExpired`; `mcpServerRequiresOAuth` monotonic/true-only; the hardcoded `requiresAuth:
      true` + in-session-only `authenticated` are modeled as the DEFECT being repaired.
- [ ] The independence axis (REQ-INT-002) is modeled by a concrete transition pair (session-marked
      but not persisted; persisted but not session-marked).
- [ ] Package-boundary §7 confirms no cycle (`auth/oauth-status.ts → ../client/mcp-status.js`) and no
      new dependency (agents reaches the helper via the core barrel).

## Holistic Assessment (MANDATORY — write into completion marker)

Answer in prose: Does the domain model describe a public surface that lets #1595 render the full MCP
auth UX (authenticated / expired / none / not-required, plus the in-session distinction) WITHOUT any
`getConfig()` escape hatch or CLI-side expiry math? Are there gaps between the model and the spec?
Verdict PASS/FAIL with the key evidence.

## Success Criteria

- All checks pass; all cited anchors resolve; holistic assessment written.

## Failure Recovery

- Return to Phase 01 with specific findings; do NOT proceed to Phase 02 until PASS.

## Phase Completion Marker

Create: `project-plans/issue2165/.completed/P01a.md` (include the holistic assessment).

```markdown
Phase: P01a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```
