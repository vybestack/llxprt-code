# Phase 27a: App-service Subpaths + command→API map Verification

## Phase ID

`PLAN-20260617-COREAPI.P27a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 27 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P27" packages/agents/src`

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P27"
npm test -- --testNamePattern "T23\b\|T24\b"
npm test -- --testNamePattern "@plan:.*P09"   # P09 boundary specs now GREEN
npm run typecheck
! grep -rnE "unsupported|deferred|NotYetImplemented|TODO|FIXME|placeholder|not yet" packages/agents/src/app-services
```

## Semantic Verification Checklist (MANDATORY)

1. Do durable mutations resolve to importable public subpaths with behavior-real backing (not Agent)?
2. Does the command→API map have NO orphan; are completions reachable or classified CLI-local?
3. Is the runtime-vs-app-service boundary real (durable ops absent from Agent)?
4. Are unsupported/deferred Result shapes absent for required app-service commands?
5. Are the P09 boundary specs now GREEN?

### Holistic Functionality Assessment (completion marker)

- Trace one durable command (e.g. /mcp add) → app-service subpath import.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if boundary real, map orphan-free, T23/T24 + P09 green.

## Failure Recovery

- Return to Phase 27.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P27a.md`
