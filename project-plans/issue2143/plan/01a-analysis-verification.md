<!-- @plan:PLAN-20260622-COREAPIGAP.P01a @requirement:REQ-001..REQ-010,REQ-INT-001..005 -->
# Phase 01a: Analysis Verification

## Phase ID

`PLAN-20260622-COREAPIGAP.P01a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 01 completed
- Verification: `test -f project-plans/issue2143/.completed/P01.md`

## Verification Tasks

Read `analysis/domain-model.md` IN FULL and confirm:

```bash
set -o pipefail
for r in REQ-001 REQ-002 REQ-003 REQ-004 REQ-005 REQ-006 REQ-007 REQ-008 REQ-009 REQ-010 \
         REQ-INT-001 REQ-INT-002 REQ-INT-003 REQ-INT-004 REQ-INT-005; do
  grep -q "$r" project-plans/issue2143/analysis/domain-model.md || echo "MISSING $r"
done
grep -cE "R-DELEGATE|R-APPROVAL-THROW|R-POLICY-SNAPSHOT|R-ARGSPATTERN-STRING|R-NO-ABORTCONTROLLER|R-CANCEL-COUNT|R-UNDEFINED-SAFE|R-HOOKS-ROUNDTRIP|R-NO-RAW-SECRETS|R-NO-LEAK|R-REFRESH-PARITY|R-MCP-OAUTH-FLOW|R-KEYS-DISTINCT|R-NONBREAK|R-MAP-VALID|R-NO-DEEP-IMPORT|R-BARREL-TYPEONLY" project-plans/issue2143/analysis/domain-model.md
```

### Semantic Verification Checklist

- [ ] All 15 requirements (10 REQ + 5 REQ-INT) covered with entities + transitions + invariants +
      harness rows.
- [ ] All 17 named invariants present, each mapped to ≥1 harness row.
- [ ] The NEW-vs-EXTEND distinction (additive only) is unambiguous for every controller.
- [ ] No implementation code leaked into analysis.
- [ ] Coverage-map phase references match `plan/00-overview.md` (contiguous; REQ-001→P03/P04/P04a …
      REQ-007→P15/P16/P16a; REQ-008→P17/P17a; REQ-009→P18/P18a; REQ-010→P19/P19a;
      REQ-INT→P20/P20a/P21/P21a).
- [ ] The two corrected issue assumptions (mcpAuth.ts exists; oauthManager already on deps) are
      reflected in the relevant entities/transitions (MCP OAuth flow, auth-detail wiring).

## Holistic Assessment (MANDATORY — write into completion marker)

Answer in prose: What does the domain model describe? Does it capture all seven capability gaps
(G1 approval, G2 policy, G3 tasks, G4 hooks-admin, G5 auth-detail, G6 MCP-OAuth, G7 tool-keys) plus
the two plumbing surfaces (barrel, command-map) and the non-breaking/no-deep-import guarantees? Are
there any gaps between the model and the spec? Verdict PASS/FAIL with reasons.

## Success Criteria

- All checks pass; holistic assessment written.

## Failure Recovery

- Return to Phase 01 with specific findings; do NOT proceed to Phase 02 until PASS.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P01a.md` (include the holistic assessment).

```markdown
Phase: P01a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```
