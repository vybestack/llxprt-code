<!-- @plan:PLAN-20260621-COREAPIREMED.P22a @requirement:REQ-007 -->
# Phase 22a: Documentation Verification

## Phase ID

`PLAN-20260621-COREAPIREMED.P22a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 22 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P22.md`

## Verification Goal

Confirm docs/agent-api.md is ACCURATE against the code (no invented APIs, no drift), uses only public
imports, and documents the ownership/normalization semantics correctly.

## Verification Commands

```bash
set -e
# Each documented symbol must resolve to a real public export
for s in fromConfig getEphemeralSetting setEphemeralSetting getEphemeralSettings getConfig getCurrentSequenceModel getRuntimeId; do
  grep -rq "$s" packages/agents/src/api/ || { echo "DOC DRIFT: $s not in code"; exit 1; }
done
grep -rq "AgentClientContract" packages/agents/src/api/index.ts || { echo "DOC DRIFT: AgentClientContract not exported from the curated API barrel"; exit 1; }
if grep -nE "from '[^']*(/src/|core/src|providers/src)" docs/agent-api.md; then echo "FAIL: deep-import example in docs"; exit 1; fi
```

### Semantic Verification Checklist

- [ ] Every documented method/type maps to a real, exported, tested symbol (trace each).
- [ ] `fromConfig` ownership wording matches the implementation (supplied Config not disposed).
- [ ] Settings normalization wording matches Config behavior (delegated).
- [ ] Examples compile conceptually with public-only imports (cross-checked against the harness).
- [ ] Existing #1594 documentation untouched/preserved.

## Holistic Functionality Assessment (MANDATORY — into marker)

### Could a #1595 developer follow these docs and avoid ALL deep imports? ### Any drift between docs
and code? ### Verdict

## Success Criteria

- Docs verified accurate, public-only, drift-free.

## Failure Recovery

- Return to Phase 22; correct drift.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P22a.md` (include assessment).

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P22a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```

