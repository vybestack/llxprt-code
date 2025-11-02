# Phase 10: `/set` Implementation

## Phase ID
`PLAN-20251013-AUTOCOMPLETE.P10`

## Prerequisites
- Phases P09/P09a complete

## Implementation Tasks

### Files to Modify
- `packages/cli/src/ui/commands/setCommand.ts`
  - Replace bespoke completion logic with schema definition referencing **ArgumentSchema.md lines 111-130**.
  - Remove old completion functions entirely.
  - Code comment example:
    ```typescript
    /**
     * @plan:PLAN-20251013-AUTOCOMPLETE.P10
     * @requirement:REQ-006
     * @pseudocode ArgumentSchema.md lines 111-130
     * - Line 111: literal `unset`
     * - Line 112: literal `modelparam`
     * - Line 113: literal `emojifilter`
     * - Line 114: nested value arg for param name
     * - Line 115: nested value arg for param value
     * - Line 116: hint for emoji mode
     * - Line 117-120: dynamic completers for providers/params
     */
    ```
- `packages/cli/src/ui/hooks/useSlashCompletion.tsx`
  - Register `/set` schema within the command map (per pseudocode lines 111-130).
- Adjust integration tests to reflect actual hints (no structural changes beyond expected strings).

### Anti-Fraud Controls
- No leftover references to old functions.
- Ensure implementation only imports new schema modules.

## Verification Commands

```bash
npm test -- --filter "@plan:PLAN-20250214-AUTOCOMPLETE.P09"

# Mutation testing on updated command
npx stryker run --mutate "packages/cli/src/ui/commands/setCommand.ts" --thresholds.high 70

# Property ratio check
TOTAL=$(rg -c "test\\(" packages/cli/src/ui/commands/test/setCommand.schema.integration.test.ts | awk -F: '{s+=$2} END {print s}')
PROP=$(rg -c "test\\.prop" packages/cli/src/ui/commands/test/setCommand.schema.integration.test.ts | awk -F: '{s+=$2} END {print s}')
[ "$TOTAL" -gt 0 ] && [ $((PROP * 100 / TOTAL)) -lt 30 ] && echo "FAIL: Property tests below 30%"

# Anti-fraud greps
rg "toHaveBeenCalled\|toHaveBeenCalledWith" packages/cli/src/ui && echo "FAIL: mock theater detected"
rg "NotYetImplemented" packages/cli/src/ui && echo "FAIL: reverse testing detected"
```

## Manual Verification Checklist
- [ ] All `/set` schema tests green
- [ ] Mutation score ≥ 70%
- [ ] Legacy completion fully removed from file
- [ ] Execution tracker updated

## Phase Completion Marker
- Create `project-plans/autocomplete/.completed/P10.md` capturing verification outputs.
