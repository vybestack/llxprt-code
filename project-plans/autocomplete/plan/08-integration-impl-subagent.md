# Phase 08: Integration Implementation – `/subagent`

## Phase ID
`PLAN-20251013-AUTOCOMPLETE.P08`

## Prerequisites
- Phases P07/P07a complete (integration tests RED)

## Implementation Tasks

### Files to Modify
- `packages/cli/src/ui/hooks/useSlashCompletion.tsx`
  - Remove feature flag guard; integrate hint + suggestions returned from schema handler.
  - Steps to implement:
    - **ArgumentSchema.md line 71**: call `createCompletionHandler` with current command context.
    - **Line 72**: supply schema specific to active command (use map keyed by command name).
    - **Line 73**: capture `{ suggestions, hint }` result.
    - **Line 74**: set state for suggestions and new `activeHint` field.
    - **Line 75**: handle pending async results with sequence/timestamp guard.
    - **Line 76-78**: gracefully handle resolver errors (log + fallback to empty suggestions + hint).
    - **Line 79-80**: ensure cleanup on component unmount / completion reset.
- `packages/cli/src/ui/components/SuggestionsDisplay.tsx`
  - Implement hint line rendering per **UIHintRendering.md lines 4-7**.
  - Maintain consistent height, respect loading state (**lines 5-6**).
- `packages/cli/src/ui/commands/subagentCommand.ts`
  - Define schema constant per **ArgumentSchema.md lines 91-104**.
  - Remove legacy completion function entirely.
  - Comment referencing each step (name completer, profile completer, mode literal branch, prompt hint).
- `packages/cli/src/ui/commands/test/subagentCommand.schema.integration.test.ts`
  - Ensure assertions target new hint behavior (tests should now pass without modification besides potential expectation updates to actual string values).

### Anti-Fraud Controls
- No leftover TODOs or logs.
- Ensure removed legacy code is fully deleted (will also be validated in Phase 11 but must be gone here for `/subagent`).

## Verification Commands

```bash
npm test -- --filter "@plan:PLAN-20250214-AUTOCOMPLETE.P07"

# Mutation testing for hook + component
npx stryker run --mutate "packages/cli/src/ui/hooks/useSlashCompletion.tsx,packages/cli/src/ui/components/SuggestionsDisplay.tsx" --thresholds.high 80

# Property ratio (should still meet ≥30%)
TOTAL=$(rg -c "test\\(" packages/cli/src/ui/hooks/__tests__/useSlashCompletion.schema.integration.test.ts packages/cli/src/ui/commands/test/subagentCommand.schema.integration.test.ts | awk -F: '{s+=$2} END {print s}')
PROP=$(rg -c "test\\.prop" packages/cli/src/ui/hooks/__tests__/useSlashCompletion.schema.integration.test.ts packages/cli/src/ui/commands/test/subagentCommand.schema.integration.test.ts | awk -F: '{s+=$2} END {print s}')
[ "$TOTAL" -gt 0 ] && [ $((PROP * 100 / TOTAL)) -lt 30 ] && echo "FAIL: Property tests below 30%"

# Anti-fraud grep checks
rg "toHaveBeenCalled\|toHaveBeenCalledWith" packages/cli/src/ui && echo "FAIL: mock theater detected"
rg "NotYetImplemented" packages/cli/src/ui && echo "FAIL: reverse testing detected"
rg "toHaveProperty\|toBeDefined\|toBeUndefined" packages/cli/src/ui | grep -v "specific value" && echo "FAIL: structural test detected"
```

## Manual Verification Checklist
- [ ] All P07 tests now GREEN without editing test logic (assertions may require expected values only)
- [ ] Mutation score ≥ 80% for updated files
- [ ] Manual CLI smoke test shows hint line & navigation unaffected
- [ ] Legacy completion removed from `/subagent`

## Success Criteria
- `/subagent` fully schema-driven with hint UI operational.

## Failure Recovery
- Reconcile failing tests vs pseudocode steps; adjust implementation accordingly.
- If hint UI causes layout issues, refine per UI pseudocode while keeping tests intact.

## Phase Completion Marker
- Create `project-plans/autocomplete/.completed/P08.md` capturing verification outputs and manual test notes.
