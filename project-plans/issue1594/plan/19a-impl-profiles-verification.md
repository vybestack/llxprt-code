# Phase 19a: Profiles CRUD + Apply Verification

## Phase ID

`PLAN-20260617-COREAPI.P19a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 19 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P19" packages/agents/src/api/control/`

## Verification Commands

```bash
set -e
missing=0
npm test -- --testNamePattern "@plan:.*P19"
npm test -- --testNamePattern "T18d\|T4b\b"
npm run typecheck
grep -rnE "(TODO|FIXME|HACK|STUB)" packages/agents/src/api/control/profiles.ts | grep -v ".spec.ts" && { echo FAIL; missing=1; } || echo OK
exit $missing
```

## Semantic Verification Checklist (MANDATORY)

1. Does profile apply (standard + load-balancer) preserve context (no chat reset)?
2. Is the SAME `HistoryService` instance reused on apply (identity)?
3. Does `saveCurrent` store a key reference, never a raw secret?
4. Are shipped providers functions used (no re-implementation)?

### Holistic Functionality Assessment (completion marker)

- Trace an `apply(name)` → switch path reused → history preserved.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if context preserved, secret-safety correct, T-rows green.

## Failure Recovery

- Return to Phase 19.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P19a.md`
