<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P01 @requirement:REQ-001,REQ-002,REQ-003,REQ-004,REQ-005,REQ-INT-001,REQ-INT-002 -->
# Phase 01: Domain Analysis

## Phase ID

`PLAN-20260622-MCPOAUTHTRUTH.P01`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 00a completed (PASS)
- Verification: `test -f project-plans/issue2165/.completed/P00a.md`

## Requirements Implemented (Expanded)

This phase produces/confirms `analysis/domain-model.md` covering ALL requirements (REQ-001..005,
REQ-INT-001, REQ-INT-002). No production code.

- **REQ-001** — canonical `getMcpServerOAuthStatus` + `McpOAuthStatus` in `packages/mcp`.
- **REQ-002** — corrected `authenticated` + new `oauthStatus`/`sessionAuthenticated` on the agents
  projection.
- **REQ-003** — real `requiresAuth` (no hardcoded `true`) on the agents projection + `details()`.
- **REQ-004** — additive `McpControlDeps` closures + undefined-safe wiring through the core barrel.
- **REQ-005** — docs reflect the new truth model (the helper as single source of truth).
- **REQ-INT-001** — engine↔CLI-reference parity (the helper matches `buildOAuthStatusSuffix`).
- **REQ-INT-002** — `sessionAuthenticated` and `authenticated` are independent axes.

## Implementation Tasks

### Files to Create / Confirm

- `project-plans/issue2165/analysis/domain-model.md` (already drafted) — confirm it contains:
  - **Entities (§1):** `McpOAuthStatus` (NEW value-union), `getMcpServerOAuthStatus` (NEW async fn),
    `MCPOAuthCredentials`/`MCPOAuthToken` (existing, read-only), `mcpServerRequiresOAuth` (existing
    monotonic map), `AgentMcpControl`/`McpControl` (corrected projection), `McpControlDeps`
    (extended), `buildMcpControlDeps`/`mcpControlWiring` (extended), the in-session marker
    (`authState.mcpAuth`, preserved → `sessionAuthenticated`).
  - **Relationships (§2):** the helper composes the three primitives; agents projects through the
    core barrel and NEVER re-derives expiry; `packages/auth` is out of the graph.
  - **State transitions (§3):** the per-server quad-state table + the independence insight
    (`authenticated` vs `sessionAuthenticated`).
  - **Invariants (§4):** R-REQUIRED-OR, R-INNER-TOKEN, R-FAULT-TOLERANT, R-MASKED,
    R-AUTHENTICATED-DERIVED, R-REQUIRESAUTH-REAL, R-SESSION-DISTINCT, R-DELEGATE, R-UNDEFINED-SAFE,
    R-NONBREAK, R-NO-REDERIVE, R-CORE-BARREL-SEAM, R-ASYNC-DETAIL — each tied to ≥1 harness row.
  - **Edge cases (§5)** and **harness cross-reference (§6)** for both phases (real token-store seam;
    real closures recording into a callLog; scoped mutation per the LOCKED policy).
  - **Package-boundary confirmation (§7)** — no cycle, no new dependency.

### Required Markers

The `domain-model.md` top comment MUST include `@plan:PLAN-20260622-MCPOAUTHTRUTH.P01`.

## Verification Commands

```bash
set -o pipefail
M=project-plans/issue2165/analysis/domain-model.md
test -f "$M" || { echo FAIL-missing; exit 1; }
for r in REQ-001 REQ-002 REQ-003 REQ-004 REQ-005 REQ-INT-001 REQ-INT-002; do
  grep -q "$r" "$M" || { echo "MISSING $r"; exit 1; }
done
for inv in R-REQUIRED-OR R-INNER-TOKEN R-FAULT-TOLERANT R-MASKED R-AUTHENTICATED-DERIVED \
           R-REQUIRESAUTH-REAL R-SESSION-DISTINCT R-DELEGATE R-UNDEFINED-SAFE R-NONBREAK \
           R-NO-REDERIVE R-CORE-BARREL-SEAM R-ASYNC-DETAIL; do
  grep -q "$inv" "$M" || { echo "MISSING invariant $inv"; exit 1; }
done
grep -q "@plan:PLAN-20260622-MCPOAUTHTRUTH.P01" "$M" || { echo "MISSING plan marker"; exit 1; }
# The two corrected design facts must be present (static getToken + credentials.token; monotonic map):
grep -q "credentials.token" "$M" || { echo "MISSING inner-token note"; exit 1; }
grep -qiE "monotonic|true-only" "$M" || { echo "MISSING map-monotonic note"; exit 1; }
echo "OK"
```

### Semantic Verification Checklist

- [ ] Every REQ has coverage via entity + transition + invariant + harness reference.
- [ ] No implementation code (analysis only).
- [ ] The NEW-vs-EXTEND distinction is explicit (helper/type NEW; controller/deps/wiring/types
      EXTENDED — additive, R-NONBREAK).
- [ ] The masked/projected invariants (R-MASKED, R-INNER-TOKEN, R-NO-REDERIVE) are present and
      testable.
- [ ] The independence of `authenticated` vs `sessionAuthenticated` (REQ-INT-002, R-SESSION-DISTINCT)
      is modeled with a concrete transition.

## Success Criteria

- `domain-model.md` present; all REQ + invariants covered; plan marker present; corrected-design
  facts captured.

## Failure Recovery

- Revise `analysis/domain-model.md`; re-run verification.

## Phase Completion Marker

Create: `project-plans/issue2165/.completed/P01.md`

```markdown
Phase: P01
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count — expect 0; analysis only]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of whether the model satisfies the cited requirements]
```
