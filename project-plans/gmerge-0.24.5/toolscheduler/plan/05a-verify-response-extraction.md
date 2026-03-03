# Phase 05a: Verify Response Formatting Extraction

## Phase ID

`PLAN-20260302-TOOLSCHEDULER.P05a`

## Prerequisites

- Required: Phase 05 completed
- Verification: Functions extracted to generateContentResponseUtilities.ts
- Expected: coreToolScheduler imports and uses extracted functions

## Verification Tasks

### 1. Functions Extracted

```bash
# Check convertToFunctionResponse added
grep "export function convertToFunctionResponse" packages/core/src/utils/generateContentResponseUtilities.ts || {
  echo "FAIL: convertToFunctionResponse not exported"
  exit 1
}

# Check plan markers
grep "@plan:PLAN-20260302-TOOLSCHEDULER.P05" packages/core/src/utils/generateContentResponseUtilities.ts || {
  echo "FAIL: Plan markers missing"
  exit 1
}

# Check helpers added (should be private, not exported)
grep "function createFunctionResponsePart" packages/core/src/utils/generateContentResponseUtilities.ts || {
  echo "FAIL: createFunctionResponsePart not present"
  exit 1
}

grep "function limitStringOutput" packages/core/src/utils/generateContentResponseUtilities.ts || {
  echo "FAIL: limitStringOutput not present"
  exit 1
}

grep "function limitFunctionResponsePart" packages/core/src/utils/generateContentResponseUtilities.ts || {
  echo "FAIL: limitFunctionResponsePart not present"
  exit 1
}

grep "function toParts" packages/core/src/utils/generateContentResponseUtilities.ts || {
  echo "FAIL: toParts not present"
  exit 1
}

echo "[OK] All functions extracted"
```

### 2. Functions Removed from coreToolScheduler

```bash
# Check functions removed (should not find them as standalone functions)
if grep -E "^function (createFunctionResponsePart|limitStringOutput|limitFunctionResponsePart|toParts)" packages/core/src/core/coreToolScheduler.ts; then
  echo "FAIL: Functions still present in coreToolScheduler.ts"
  exit 1
fi

if grep -E "^export function convertToFunctionResponse" packages/core/src/core/coreToolScheduler.ts; then
  echo "FAIL: convertToFunctionResponse still exported from coreToolScheduler.ts"
  exit 1
fi

echo "[OK] Functions removed from coreToolScheduler.ts"
```

### 3. State-Related Functions Preserved

```bash
# Check extractAgentIdFromMetadata KEPT
grep "function extractAgentIdFromMetadata" packages/core/src/core/coreToolScheduler.ts || {
  echo "FAIL: extractAgentIdFromMetadata was removed (should be kept)"
  exit 1
}

# Check createErrorResponse KEPT
grep "const createErrorResponse" packages/core/src/core/coreToolScheduler.ts || {
  echo "FAIL: createErrorResponse was removed (should be kept)"
  exit 1
}

echo "[OK] State-related functions preserved"
```

### 4. Import Wired

```bash
# Check import added
grep "import.*convertToFunctionResponse.*from.*generateContentResponseUtilities" packages/core/src/core/coreToolScheduler.ts || {
  echo "FAIL: Import not added"
  exit 1
}

echo "[OK] Import wired correctly"
```

### 5. TypeScript Compilation

```bash
# Verify TypeScript compiles
npm run typecheck || {
  echo "FAIL: TypeScript compilation failed"
  exit 1
}

echo "[OK] TypeScript compilation passed"
```

### 6. All Tests Pass

```bash
# Run ALL coreToolScheduler tests
npm test -- coreToolScheduler.test.ts || {
  echo "FAIL: Main tests failed"
  exit 1
}

npm test -- coreToolScheduler.cancellation.test.ts || {
  echo "FAIL: Cancellation tests failed"
  exit 1
}

npm test -- coreToolScheduler.contextBudget.test.ts || {
  echo "FAIL: Context budget tests failed"
  exit 1
}

npm test -- coreToolScheduler.duplication.test.ts || {
  echo "FAIL: Duplication tests failed"
  exit 1
}

npm test -- coreToolScheduler.interactiveMode.test.ts || {
  echo "FAIL: Interactive mode tests failed"
  exit 1
}

npm test -- coreToolScheduler.publishingError.test.ts || {
  echo "FAIL: Publishing error tests failed"
  exit 1
}

npm test -- coreToolScheduler.raceCondition.test.ts || {
  echo "FAIL: Race condition tests failed"
  exit 1
}

npm test -- coreToolScheduler.toolExecutor.characterization.test.ts || {
  echo "FAIL: Characterization tests failed"
  exit 1
}

echo "[OK] All tests pass"
```

### 7. File Size Verification

```bash
# Check file size reduction
current_size=$(wc -l < packages/core/src/core/coreToolScheduler.ts)
original_size=2140

reduction=$((original_size - current_size))

if [ "$reduction" -lt 250 ]; then
  echo "WARN: File size only reduced by $reduction lines (expected ~300 total from both extractions)"
fi

echo "[OK] File size reduced by $reduction lines (target: ~460 lines / 21.5%)"
```

### 8. No Circular Dependencies

```bash
# Run module graph analysis
npx madge --circular packages/core/src/utils/generateContentResponseUtilities.ts 2>&1 | tee madge-output.txt

if grep -q "Circular dependency" madge-output.txt; then
  echo "FAIL: Circular dependencies detected"
  cat madge-output.txt
  exit 1
fi

echo "[OK] No circular dependencies"
```

### 9. Final Refactoring Summary

```bash
echo "=================================="
echo "Refactoring Complete Summary"
echo "=================================="
echo "Original size: 2140 lines"
current_size=$(wc -l < packages/core/src/core/coreToolScheduler.ts)
echo "Current size: $current_size lines"
reduction=$((2140 - current_size))
percentage=$(( (reduction * 100) / 2140 ))
echo "Reduction: $reduction lines ($percentage%)"
echo "Target: 460 lines (21.5%)"
echo ""
echo "Extracted Modules:"
echo "  - scheduler/types.ts (~130 lines)"
echo "  - scheduler/tool-executor.ts (~200 lines)"
echo "  - utils/generateContentResponseUtilities.ts (+~180 lines)"
echo ""
echo "Remaining in coreToolScheduler.ts:"
echo "  - Scheduling & queue management"
echo "  - State machine (setStatusInternal)"
echo "  - Parallel batch orchestration"
echo "  - Confirmation flow"
echo "  - Policy evaluation"
echo "  - Tool governance"
echo "  - Validation & context injection"
echo "  - Inline modification"
echo "  - Lifecycle management"
echo "  - Completion detection"
echo "=================================="
```

## Success Criteria

- [ ] Functions added to generateContentResponseUtilities.ts
- [ ] Functions removed from coreToolScheduler.ts
- [ ] State-related functions preserved in coreToolScheduler.ts
- [ ] Import added correctly
- [ ] TypeScript compilation succeeds
- [ ] All tests pass
- [ ] File size reduced by ~300 lines total (both extractions)
- [ ] No circular dependencies
- [ ] Plan markers present

## Pass/Fail Decision

**PASS** if all verification commands exit 0 and all checkboxes checked.

**FAIL** if any verification command fails. If FAIL, return to Phase 05 for remediation.

## Phase Completion

If PASS:
1. Update execution-tracker.md: Mark P05 and P05a complete
2. **Refactoring COMPLETE** — All planned extractions done
3. Document final metrics in execution-tracker.md

If FAIL:
1. Document failures in execution-tracker.md
2. Remediate Phase 05
3. Re-run Phase 05a

## Notes

This is the FINAL phase of the refactoring plan. After this phase passes:
- coreToolScheduler.ts reduced from 2,140 lines to ~1,680 lines (21.5% reduction)
- 3 new modules created (types, tool-executor, response formatting utilities)
- All existing tests pass (behavior preserved)
- All characterization tests pass (extraction equivalence proven)
- System remains fully operational at every step
