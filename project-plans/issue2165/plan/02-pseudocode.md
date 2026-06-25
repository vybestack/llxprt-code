<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P02 @requirement:REQ-001,REQ-002,REQ-003,REQ-004,REQ-005,REQ-INT-001,REQ-INT-002 -->
# Phase 02: Pseudocode

## Phase ID

`PLAN-20260622-MCPOAUTHTRUTH.P02`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 01a completed (PASS)
- Verification: `test -f project-plans/issue2165/.completed/P01a.md`

## Purpose

Produce/confirm contract-first NUMBERED pseudocode for both components. NO TypeScript implementation.

## Implementation Tasks

### Files to Create / Confirm (under `analysis/pseudocode/`)

- `oauth-status-helper.md` (already drafted) — the NEW `packages/mcp` helper:
  `getMcpServerOAuthStatus(serverName, opts?) → Promise<McpOAuthStatus>` and the `McpOAuthStatus`
  union. OR-combine required-check (R-REQUIRED-OR), static `getToken` → `credentials.token` →
  `isTokenExpired` (R-INNER-TOKEN), fault → `'none'` (R-FAULT-TOLERANT), masked enum only (R-MASKED).
  Covers REQ-001, REQ-INT-001.
- `agents-projection.md` (already drafted) — the agents-layer projection: `McpControlDeps` additions
  (`getOAuthStatus`/`getRequiresAuth`), corrected `auth()`/`authenticate()` via a shared private
  `buildAuthStatus`, async-resolved `details()` + sync `buildServerDetail` (R-ASYNC-DETAIL),
  undefined-safe `buildMcpControlDeps` wiring through the core barrel (R-CORE-BARREL-SEAM), and the
  `agent.ts`/`index.ts` type additions + re-export. Covers REQ-002, REQ-003, REQ-004, REQ-005,
  REQ-INT-002.

Each file MUST contain the mandatory sections: **Interface Contracts**, **Integration Points**,
**Anti-Pattern Warnings**, plus NUMBERED pseudocode lines (`^[0-9]+`).

### Required Markers

Each pseudocode file's top comment MUST include `@plan:PLAN-20260622-MCPOAUTHTRUTH.P02`.

## Verification Commands

```bash
set -o pipefail
cd project-plans/issue2165/analysis/pseudocode
for f in oauth-status-helper agents-projection; do
  test -f "$f.md" || { echo "MISSING $f.md"; exit 1; }
  grep -q "Interface Contracts" "$f.md" || { echo "$f MISSING Interface Contracts"; exit 1; }
  grep -q "Integration Points" "$f.md" || { echo "$f MISSING Integration Points"; exit 1; }
  grep -q "Anti-Pattern Warnings" "$f.md" || { echo "$f MISSING Anti-Pattern Warnings"; exit 1; }
  grep -qE "^[0-9]+" "$f.md" || { echo "$f MISSING numbered lines"; exit 1; }
  grep -q "@plan:PLAN-20260622-MCPOAUTHTRUTH.P02" "$f.md" || { echo "$f MISSING plan marker"; exit 1; }
  grep -q "@pseudocode" "$f.md" || { echo "$f MISSING @pseudocode tags"; exit 1; }
done
echo "OK"
```

### Anti-Pattern Self-Check

- [ ] No actual TypeScript bodies (only numbered pseudocode + contract sections).
- [ ] Pseudocode references REAL symbols/lines: `mcpServerRequiresOAuth` (`mcp-status.ts:46`),
      `MCPOAuthTokenStorage.getToken` (`oauth-token-storage.ts:104`), `.isTokenExpired`
      (`oauth-token-storage.ts:130`), `credentials.token` (`token-store.ts:45`),
      `isMcpAuthenticated` (`mcpControl.ts:73`/`agentImpl.ts:500`), `getMcpServers`
      (`configBaseCore.ts:436`), `performOAuth`/`restartServer`/`refreshClientTools`
      (`mcpControlWiring.ts:57-65`/`mcpControl.ts:328`).
- [ ] Helper threads the INNER `credentials.token` into `isTokenExpired` (NOT the wrapper, NOT
      `as never`).
- [ ] Projection DERIVES `authenticated = (oauthStatus === 'authenticated')` and computes
      `requiresAuth` via `getRequiresAuth` — NO hardcoded `true`, NO `isMcpAuthenticated` for
      `authenticated`.
- [ ] `details()` resolves all OAuth statuses UP FRONT (Promise.all) so no `Promise` leaks into a
      `McpServerDetail.oauthStatus` field.
- [ ] Both files keep every existing public field NAME (additive/non-breaking).

## Success Criteria

- Both pseudocode files present, each with the mandatory sections + numbered lines + markers +
  `@pseudocode` tags.

## Failure Recovery

- Revise the deficient pseudocode file(s); re-run verification.

## Phase Completion Marker

Create: `project-plans/issue2165/.completed/P02.md`

```markdown
Phase: P02
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of whether the pseudocode satisfies the cited requirements]
```
