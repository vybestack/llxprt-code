# Phase 09: `/set` Migration TDD

## Phase ID
`PLAN-20251013-AUTOCOMPLETE.P09`

## Prerequisites
- `/subagent` migration verified (P08a complete)

## Implementation Tasks

### Tests to Create
1. `packages/cli/src/ui/commands/test/setCommand.schema.integration.test.ts`
   - Write RED tests covering `/set` schema requirements per **ArgumentSchema.md lines 111-130**.
   - Behaviors to cover:
     - Literal subcommands (`unset`, `modelparam`, `emojifilter`, etc.).
     - Nested value arguments (parameter name/value, emoji modes).
     - Hint text correctness for each argument.
     - Property-based test generating random model parameter names, ensuring resolver remains stable.
2. Update `packages/cli/src/ui/hooks/__tests__/useSlashCompletion.schema.integration.test.ts` to include `/set` flows (fail until implementation).

### Anti-Fraud Controls
- No mocks/spies; assert final suggestions + hints.
- No TODO/reverse testing.

## Verification Commands (expect RED)

```bash
npm test -- --filter "@plan:PLAN-20250214-AUTOCOMPLETE.P09" || true

# Anti-fraud checks
rg "toHaveBeenCalled\|toHaveBeenCalledWith" packages/cli/src/ui && echo "FAIL: mock theater detected"
rg "NotYetImplemented" packages/cli/src/ui && echo "FAIL: reverse testing detected"
rg "toHaveProperty\|toBeDefined\|toBeUndefined" packages/cli/src/ui | grep -v "specific value" && echo "FAIL: structural test detected"

# Property ratio (≥30%)
TOTAL=$(rg -c "test\\(" packages/cli/src/ui/commands/test/setCommand.schema.integration.test.ts | awk -F: '{s+=$2} END {print s}')
PROP=$(rg -c "test\\.prop" packages/cli/src/ui/commands/test/setCommand.schema.integration.test.ts | awk -F: '{s+=$2} END {print s}')
[ "$TOTAL" -gt 0 ] && [ $((PROP * 100 / TOTAL)) -lt 30 ] && echo "FAIL: Property tests below 30%"
```

## Manual Verification Checklist
- [ ] Tests reference pseudocode lines 111-130 explicitly
- [ ] Failures captured in `.completed/P09.md`
- [ ] Property-based requirement satisfied

## Phase Completion Marker
- Create `project-plans/autocomplete/.completed/P09.md` with failure output and verification results.
