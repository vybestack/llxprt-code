# Phase 05: Schema Implementation

## Phase ID
`PLAN-20251013-AUTOCOMPLETE.P05`

## Prerequisites
- Phases P04/P04a complete (tests failing)

## Implementation Tasks

### Files to Modify
- `packages/cli/src/ui/commands/schema/index.ts`
  - Implement `tokenize`, `resolveContext`, `generateSuggestions`, `computeHint`, and `createCompletionHandler` strictly following pseudocode **ArgumentSchema.md lines 7-90**.
  - Within each function, include detailed comment referencing every line implemented, e.g.:
    ```typescript
    /**
     * @plan:PLAN-20251013-AUTOCOMPLETE.P05
     * @requirement:REQ-001
     * @requirement:REQ-002
     * @pseudocode ArgumentSchema.md lines 7-40
     * - Line 7: tokenize handles quotes/escapes
     * - Line 8: returns partial token info
     * - Line 9: initialize nodeList
     * - Line 10: iterate tokens
     * - Line 11: literal matching
     * - Line 12: literal suggestion filter
     * - Line 13: value suggestions via options
     * - Line 14: await completer
     * - Line 15: error fallback to empty array
     */
    ```
- `packages/cli/src/ui/commands/schema/types.ts`
  - Update types if additional helper interfaces required by implementation (maintain documentation comments referencing lines 1-6).
- `packages/cli/src/ui/hooks/useSlashCompletion.tsx`
  - Wire `createCompletionHandler` into the hook, replacing temporary TODO. Ensure code path still returns existing UI data (hint integration occurs in later phase).
  - Reference pseudocode **lines 71-90**.

### Behavioral Constraints
- No tests updated in this phase.
- Implementation must make P04 tests pass (GREEN) without modifying assertions.

### Anti-Fraud Controls
- Ensure no `console.log`, `TODO`, or stubbed fallbacks remain.
- Maintain immutability when processing tokens (do not mutate input arrays).

## Verification Commands

```bash
npm test -- --filter "@plan:PLAN-20250214-AUTOCOMPLETE.P04"

# Mutation testing (≥80% score)
npx stryker run --mutate "packages/cli/src/ui/commands/schema/**/*.ts" --thresholds.high 80

# Property-testing ratio (should remain ≥30%)
TOTAL=$(rg -c "test\\(" packages/cli/src/ui/commands/schema/argumentResolver.test.ts | awk -F: '{s+=$2} END {print s}')
PROP=$(rg -c "test\\.prop" packages/cli/src/ui/commands/schema/argumentResolver.test.ts | awk -F: '{s+=$2} END {print s}')
[ "$TOTAL" -gt 0 ] && [ $((PROP * 100 / TOTAL)) -lt 30 ] && echo "FAIL: Property tests below 30%"

# Anti-fraud checks (ensure no mock theater / reverse or structural tests)
rg "toHaveBeenCalled\|toHaveBeenCalledWith" packages/cli/src/ui/commands/schema && echo "FAIL: mock theater detected"
rg "NotYetImplemented" packages/cli/src/ui/commands/schema && echo "FAIL: reverse testing detected"
rg "toHaveProperty\|toBeDefined\|toBeUndefined" packages/cli/src/ui/commands/schema | grep -v "specific value" && echo "FAIL: structural test detected"
```

## Manual Verification Checklist
- [ ] All P04 tests green without modification
- [ ] Mutation score ≥ 80%
- [ ] Property tests still ≥ 30%
- [ ] Pseudocode lines referenced in code comments exactly
- [ ] No lingering placeholders

## Success Criteria
- Resolver fully operational and validated by tests + mutation run.

## Failure Recovery
- If tests fail, compare implementation vs pseudocode lines and adjust.
- If mutation threshold missed, improve tests or implementation.

## Phase Completion Marker
- Create `project-plans/autocomplete/.completed/P05.md` including test/mutation outputs.
