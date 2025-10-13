# Phase 04: Schema TDD (Unit)

## Phase ID
`PLAN-20251013-AUTOCOMPLETE.P04`

## Prerequisites
- Phases P03/P03a complete
- Schema stubs exist

## Implementation Tasks

### Tests to Create
- `packages/cli/src/ui/commands/schema/argumentResolver.test.ts`
  - Use Vitest + fast-check (property-based) to cover resolver behavior prior to implementation.
  - Failing tests must reference pseudocode **ArgumentSchema.md lines 7-70** explicitly in comments:
    ```typescript
    it('resolves literal suggestions @plan:PLAN-20250214-AUTOCOMPLETE.P04 @requirement:REQ-002', () => {
      // Pseudocode reference:
      // - Line 9: initialize nodeList
      // - Line 10: iterate tokens
      // - Line 12: literal filter
      // Expect failure until implementation.
    });
    ```
  - Required test coverage:
    1. Token parsing cases (quotes, escapes, trailing spaces) – reference lines 7-10.
    2. Literal completions – reference lines 12-14.
    3. Value completions with `options` – line 13.
    4. Async completer behavior (use fake async) – line 14.
    5. Hint resolution fallback – lines 16-18.
    6. Property-based test generating random token sequences ensuring resolver never mutates inputs (≥30% of tests).
- Tests must assert observable behavior (suggestion values, hints) and avoid implementation details/mocks.

### Anti-Fraud Requirements
- No usage of `toHaveBeenCalled`, `toHaveProperty`, or reverse-testing assertions.
- Include property-based tests using `test.prop` from `fast-check`.
- Ensure failing tests throw meaningful errors (e.g., “NotImplemented: P04” or missing hint) rather than general `NotYetImplemented` exceptions.

## Verification Commands (expect RED)

```bash
npm test -- --run --reporter verbose --filter "@plan:PLAN-20250214-AUTOCOMPLETE.P04" || true

# Anti-fraud checks
rg "toHaveBeenCalled\|toHaveBeenCalledWith" packages/cli/src/ui/commands/schema && echo "FAIL: mock theater detected"
rg "NotYetImplemented" packages/cli/src/ui/commands/schema && echo "FAIL: reverse testing detected"
rg "toHaveProperty\|toBeDefined\|toBeUndefined" packages/cli/src/ui/commands/schema | grep -v "specific value" && echo "FAIL: structural test detected"

# Property test coverage (30% minimum)
TOTAL=$(rg -c "test\\(" packages/cli/src/ui/commands/schema/argumentResolver.test.ts | awk -F: '{s+=$2} END {print s}')
PROP=$(rg -c "test\\.prop" packages/cli/src/ui/commands/schema/argumentResolver.test.ts | awk -F: '{s+=$2} END {print s}')
[ "$TOTAL" -gt 0 ] && [ $((PROP * 100 / TOTAL)) -lt 30 ] && echo "FAIL: Property tests below 30%"
```

## Manual Verification Checklist
- [ ] Tests reference pseudocode lines explicitly
- [ ] No production code modified
- [ ] Property-based tests present (≥30% of total tests)
- [ ] Anti-fraud grep checks pass

## Success Criteria
- RED tests describing desired resolver behavior.

## Failure Recovery
- Adjust or add tests covering missing pseudocode steps; rerun commands.

## Phase Completion Marker
- Create `project-plans/autocomplete/.completed/P04.md` capturing failing test output and verification results.
