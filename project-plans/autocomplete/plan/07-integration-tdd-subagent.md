# Phase 07: Integration TDD – `/subagent`

## Phase ID
`PLAN-20251013-AUTOCOMPLETE.P07`

## Prerequisites
- Phases P06/P06a complete

## Implementation Tasks

### Tests to Create
1. `packages/cli/src/ui/hooks/__tests__/useSlashCompletion.schema.integration.test.ts`
   - Use Vitest with React Testing Library (no mocks) to simulate `/subagent save` input progression.
   - Cover pseudocode references:
     - **ArgumentSchema.md lines 71-90** – handler integration.
     - **UIHintRendering.md lines 1-20** – hint propagation and rendering order.
   - Tests must fail (RED) until implementation (Phase 08).
2. `packages/cli/src/ui/commands/test/subagentCommand.schema.integration.test.ts`
   - Behavior tests verifying CLI command pipeline with schema (ensuring hints requested though feature flag hides them currently).
   - Include at least one property-based test (e.g., random profile lists) to maintain ≥30% ratio overall.

### Anti-Fraud Controls
- No snapshots; assert on actual strings shown to user.
- No `toHaveBeenCalled`, `NotYetImplemented`, or structural-only assertions.

## Verification Commands (expect RED)

```bash
npm test -- --run --reporter verbose --filter "@plan:PLAN-20250214-AUTOCOMPLETE.P07" || true

rg "toHaveBeenCalled\|toHaveBeenCalledWith" packages/cli/src/ui && echo "FAIL: mock theater detected"
rg "NotYetImplemented" packages/cli/src/ui && echo "FAIL: reverse testing detected"
rg "toHaveProperty\|toBeDefined\|toBeUndefined" packages/cli/src/ui | grep -v "specific value" && echo "FAIL: structural test detected"

# Property-based coverage check for integration tests
TOTAL=$(rg -c "test\\(" packages/cli/src/ui/hooks/__tests__/useSlashCompletion.schema.integration.test.ts packages/cli/src/ui/commands/test/subagentCommand.schema.integration.test.ts | awk -F: '{s+=$2} END {print s}')
PROP=$(rg -c "test\\.prop" packages/cli/src/ui/hooks/__tests__/useSlashCompletion.schema.integration.test.ts packages/cli/src/ui/commands/test/subagentCommand.schema.integration.test.ts | awk -F: '{s+=$2} END {print s}')
[ "$TOTAL" -gt 0 ] && [ $((PROP * 100 / TOTAL)) -lt 30 ] && echo "FAIL: Property tests below 30%"
```

## Manual Verification Checklist
- [ ] Tests reference pseudocode lines explicitly
- [ ] Failures captured for `.completed/P07.md`
- [ ] Property proportion maintained

## Success Criteria
- RED tests describing integration expectations.

## Phase Completion Marker
- Create `project-plans/autocomplete/.completed/P07.md` with failure logs and verification output.
