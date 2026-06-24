# Phase 09a: Harness Layer 1 Verification

## Phase ID

`PLAN-20260617-COREAPI.P09a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 09 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P09" packages/agents/src/api/__tests__/`

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P09"
grep -rn "toHaveBeenCalled\|toThrow('NotYetImplemented')\|not\.toThrow" packages/agents/src/api/__tests__/ && echo "FAIL" || echo "OK"
```

## Semantic Verification Checklist (MANDATORY)

1. Do the tests assert real behavior (import resolvability, no deep imports), not mocks?
2. Do they fail NATURALLY (missing subpaths from P27), not via reverse-test assertions?
3. Is the command→API map complete (cross-check against overview §9 slash-command note)?
4. Would these tests PASS once P27 + boundary land, and FAIL if a deep import were added?

### Holistic Functionality Assessment (completion marker)

- Explain what the boundary tests prove and why they currently fail.
- Verdict PASS/FAIL (PASS = good tests that fail for the right reason).

## Success Criteria

- PASS only if tests are behavioral, fail naturally, map is complete.

## Failure Recovery

- Return to Phase 09.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P09a.md`
