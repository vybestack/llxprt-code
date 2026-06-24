# Phase 25a: Discovery Helpers Verification

## Phase ID

`PLAN-20260617-COREAPI.P25a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 25 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P25" packages/agents/src/api/`

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P25"
npm test -- --testNamePattern "T12\b\|T25\b"
npm run typecheck
grep -rnE "(TODO|FIXME|HACK|STUB)" packages/agents/src/api/discovery.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

## Semantic Verification Checklist (MANDATORY)

1. Does static listProviders return the set without a CLI deep import?
2. Does instance listTools include MCP/extension/skill entries (not just built-ins)?
3. Are public ProviderInfo/ToolInfo shapes used (no internal leakage)?

### Holistic Functionality Assessment (completion marker)

- Trace static vs instance discovery and confirm the difference is real.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if static + instance discovery behaviorally correct, T12/T25 green.

## Failure Recovery

- Return to Phase 25.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P25a.md`
