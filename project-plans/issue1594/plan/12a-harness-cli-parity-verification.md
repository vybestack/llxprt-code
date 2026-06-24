# Phase 12a: CLI-parity Harness Verification

## Phase ID

`PLAN-20260617-COREAPI.P12a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 12 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P12" packages/agents/src/api/__tests__/`

## Verification Commands

```bash
missing=0
npm test -- --testNamePattern "@plan:.*P12"
npm test -- --testNamePattern "runtime context.*messageBus\|@plan:.*P12.*messageBus"
grep -rq "messageBus" packages/providers/src/runtime/runtimeContextFactory.messageBus.test.ts || { echo "MISSING provider runtime messageBus RED contract"; missing=1; }

for t in T4 T4b T4c T4d T4e T4f T5 T12 T12b T15 T15b T15c T18 T18b T18c T18d T18e T20 T25; do
  grep -rq "$t\b" packages/agents/src/api/__tests__/*.spec.ts || { echo "MISSING $t"; missing=1; }
done
# mock-theater / reverse-test guard (must NOT match)
grep -rn "toHaveBeenCalled\|not\.toThrow" packages/agents/src/api/__tests__/*.spec.ts | grep -E "switch-context|mcp-discovery|auth-profiles|ide|sandbox-boundary|provider-bootstrap" && { echo "FAIL mock/reverse"; missing=1; }
exit $missing
```

## Semantic Verification Checklist (MANDATORY)

6. Does T25 exist in a RED harness file before P15 and assert provider-by-name bootstrap/shared runtime/static discovery?
7. Does T18e assert sandbox startup/status and classify sandbox mutation as recreate/app-service, not live runtime mutation?

1. Do T4d/T4e assert HistoryService IDENTITY (the product-critical guarantee)?
2. Does T18 assert the exact REQ-008 precedence chain?
3. Are only infra fakes used (MCP/IDE/OAuth/FS), never the Agent under test?
4. Do tests fail for the right reason (impl absent), not reverse-test?
5. Are property-based tests contributed toward the GLOBAL ≥30% gate? (Hard ≥30%
   enforced in P29 across the full harness — B9; not a per-layer "where natural" check.)

### Holistic Functionality Assessment (completion marker)

- Confirm this layer proves CLI parity touchpoints are expressible via public API.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if all T-rows present, identity assertions correct, behavioral, fail naturally.

## Failure Recovery

- Return to Phase 12.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P12a.md`
