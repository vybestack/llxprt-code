# Phase 09a: Validation Stub Verification

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P09a`

## Prerequisites

- Required: Phase 09 (validation stub) completed
- Verification: `ls packages/core/src/hooks/hookValidators.ts`

## Verification Commands

```bash
# 1. hookValidators.ts exists
ls packages/core/src/hooks/hookValidators.ts || exit 1
echo "PASS: hookValidators.ts exists"

# 2. All 10 validator functions exported
for fn in "validateBeforeToolInput" "validateAfterToolInput" "validateBeforeAgentInput" \
          "validateAfterAgentInput" "validateBeforeModelInput" "validateAfterModelInput" \
          "validateBeforeToolSelectionInput" "validateNotificationInput" "isObject" "isNonEmptyString"; do
  grep -q "export function $fn" packages/core/src/hooks/hookValidators.ts && \
    echo "PASS: $fn" || echo "FAIL: $fn missing"
done

# 3. Type predicate syntax used (not plain boolean)
TYPE_PREDICATES=$(grep -c "input is " packages/core/src/hooks/hookValidators.ts)
echo "Type predicates: $TYPE_PREDICATES"
[ "$TYPE_PREDICATES" -ge 8 ] && echo "PASS: 8+ type predicates" || echo "FAIL: Only $TYPE_PREDICATES"

# 4. validateEventPayload exists on HookEventHandler
grep -q "validateEventPayload" packages/core/src/hooks/hookEventHandler.ts && \
  echo "PASS: validateEventPayload present" || echo "FAIL: validateEventPayload missing"

# 5. Validation gate wired into routeAndExecuteMediated
grep -A 5 "routeAndExecuteMediated" packages/core/src/hooks/hookEventHandler.ts | \
  grep -q "validateEventPayload" && echo "PASS: validation gate wired" || \
  echo "FAIL: validation not wired into routeAndExecuteMediated"

# 6. TypeScript compiles
npm run typecheck && echo "PASS: typecheck" || echo "FAIL: typecheck"

# 7. Plan markers
grep -c "PLAN-20250218-HOOKSYSTEM.P09" packages/core/src/hooks/ -r
# Expected: 6+

# 8. Stubs return false consistently (or throw, not NotYetImplemented disguised)
grep -A 2 "validateBeforeToolInput" packages/core/src/hooks/hookValidators.ts | head -5
# Expected: body returning false or basic implementation

# 9. No TODO/FIXME
grep -rn "TODO\|FIXME" packages/core/src/hooks/hookValidators.ts
# Expected: 0

# 10. P04 lifecycle tests still pass (direct path unaffected)
npm test -- --testPathPattern="hookSystem-lifecycle" 2>&1 | grep "passed"
# Expected: 15+ passing

# 11. Build succeeds
npm run build && echo "PASS: build"
```

### Semantic Verification Checklist

1. **Are type predicates correct TypeScript syntax?**
   - [ ] `(input: unknown): input is BeforeToolInput` syntax used
   - [ ] Not `(input: unknown): boolean` (plain boolean is non-conforming per DELTA-HPAY-005)

2. **Is the validation gate correctly wired?**
   - [ ] validateEventPayload called in routeAndExecuteMediated before executeHooksCore
   - [ ] Failure from validateEventPayload throws with 'validation_failure' code

3. **Is backward compatibility preserved?**
   - [ ] Direct path (fire*Event) does NOT call validateEventPayload (validation only mediated)
   - [ ] P04 lifecycle tests still pass

4. **Expected regression noted?**
   - Mediated path tests from P07 that rely on valid payloads may now fail
   - This is expected because validators are stubs returning false
   - Document which tests are newly failing

#### Holistic Assessment

**What was created?**
hookValidators.ts with 10 stub validator functions using TypeScript type predicate syntax.
validateEventPayload routing method added to HookEventHandler.
Validation gate wired into routeAndExecuteMediated (stub returns false for all inputs).

**Is the stub safe?**
Yes — returning false for all inputs means no mediated request will proceed to
executeHooksCore during this stub phase. This causes P07 mediated-path tests to fail,
which is expected and will be fixed in P11.

**Verdict**: PASS if TypeScript compiles, hookValidators.ts exists with 8+ type predicates,
validateEventPayload is wired, and P04 tests pass.

## Success Criteria

- hookValidators.ts with 10 exported functions
- 8+ TypeScript type predicates
- validateEventPayload wired into mediated path
- TypeScript compiles, build succeeds
- P04 tests pass (direct path unaffected)

## Failure Recovery

1. If TypeScript fails on type imports: add missing input type imports to hookValidators.ts
2. If P04 tests regress: check validation gate only in mediated path
3. Cannot proceed to P10 until all checks pass

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P09a.md`
