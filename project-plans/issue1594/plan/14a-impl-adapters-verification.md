# Phase 14a: Adapters Impl Verification (incl. pseudocode compliance)

## Phase ID

`PLAN-20260617-COREAPI.P14a`

## LLxprt Code Subagent: deepthinker

## Prerequisites

- Required: Phase 14 completed
- Verification: `grep -c "@pseudocode" packages/agents/src/api/adapters/event-adapter.ts`

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P14"
npm test -- --testNamePattern "@plan:.*P10"
npm run typecheck
grep -rnE "(TODO|FIXME|HACK|STUB)" packages/agents/src/api/adapters/*.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

## Pseudocode Compliance Review (MANDATORY — deepthinker)

- Compare `config-adapter.ts` with `analysis/pseudocode/config-adapter.md`: every
  numbered line implemented, in order, no shortcuts.
- Compare `event-adapter.ts` with `analysis/pseudocode/event-adapter.md`: 21-variant
  table complete, terminal classification matches, exactly-one-`done` synthesis present.
- Report any deviation; FAIL on missing/reordered steps.

## Semantic Verification Checklist (MANDATORY)

1. Is toConfigParameters genuinely pure (trace: input frozen/unchanged, output frozen)?
2. Does the settings shadow-check actually throw on a shadowing key?
3. Does mapLoopStream guarantee exactly one `done` across all terminal paths?
4. Are all 21 variants mapped to documented projections (cross-check §4.4)?
5. Do the P10 characterization tests now pass for pure-mapping variants?

### Holistic Functionality Assessment (completion marker)

- Describe the data flow AgenticLoopEvent → AgentEvent in your own words.
- Identify any variant whose mapping is suspect.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if pseudocode fully followed, adapters pure/correct, P10 variants green.

## Failure Recovery

- Return to Phase 14 with deviation list.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P14a.md`
