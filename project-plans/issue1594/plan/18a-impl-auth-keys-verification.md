# Phase 18a: Auth / Keys Verification

## Phase ID

`PLAN-20260617-COREAPI.P18a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 18 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P18" packages/agents/src/api/control/`

## Verification Commands

```bash
set -e
missing=0
npm test -- --testNamePattern "@plan:.*P18"
npm test -- --testNamePattern "T18\b\|T18b\|T18c"
npm run typecheck
grep -rnE "(TODO|FIXME|HACK|STUB)" packages/agents/src/api/control/auth.ts | grep -v ".spec.ts" && { echo FAIL; missing=1; } || echo OK
exit $missing
```

## Semantic Verification Checklist (MANDATORY)

1. Does the precedence chain match REQ-008 exactly (trace each tier)?
2. Does `auth.keys.save` store a key reference, never a raw secret?
3. Does interactive OAuth reject clearly when no `onOAuthPrompt`?
4. Are shipped providers functions used (no re-implementation)?
5. Is the agent runtime context registered before mutators are called?

### Holistic Functionality Assessment (completion marker)

- Trace a `/key` save → secure store + runtime + ephemeral → reference-ready.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if precedence exact, secret-safety correct, T-rows green.

## Failure Recovery

- Return to Phase 18.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P18a.md`
