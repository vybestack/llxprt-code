# Phase 02: Add Re-exports for Backward Compatibility

## Phase ID

`PLAN-20260302-TOOLSCHEDULER.P02`

## Prerequisites

- Required: Phase 01 and 01a completed successfully
- Verification: `grep "@plan PLAN-20260302-TOOLSCHEDULER.P01" packages/core/src/scheduler/types.ts`
- Expected: scheduler/types.ts exists and compiles

## Requirements Implemented

### TS-COMPAT-001: Backward Compatible Imports

**Full Text**: After refactoring, the system shall continue to accept imports of ToolCall types from `coreToolScheduler.ts` without compilation errors.

**Behavior**:
- GIVEN: Existing code imports `ToolCall` from coreToolScheduler.ts
- WHEN: Types have been moved to scheduler/types.ts
- THEN: Old import continues to work without changes
- AND: New code can import from scheduler/types.ts

**Why This Matters**: Breaking existing imports would require modifying every file that uses these types, which violates the refactoring principle of preserving behavior.

## Implementation Tasks

### Files to Modify

#### 1. `packages/core/src/core/coreToolScheduler.ts`

**At the top of the file, after existing imports, add:**

```typescript
/**
 * @plan PLAN-20260302-TOOLSCHEDULER.P02
 * @requirement TS-COMPAT-001
 * 
 * Re-export types from scheduler/types.ts for backward compatibility.
 * Existing code can continue importing these types from coreToolScheduler.
 */
export type {
  ValidatingToolCall,
  ScheduledToolCall,
  ExecutingToolCall,
  SuccessfulToolCall,
  ErroredToolCall,
  CancelledToolCall,
  WaitingToolCall,
  ToolCall,
  CompletedToolCall,
  Status,
  ConfirmHandler,
  OutputUpdateHandler,
  AllToolCallsCompleteHandler,
  ToolCallsUpdateHandler,
  QueuedRequest,
} from '../scheduler/types.js';
```

**Then, DELETE the original type definitions:**

Remove the `export type ValidatingToolCall = { ... }` and all other type definitions that were copied to scheduler/types.ts. Replace them with the re-export block above.

**CRITICAL:** Do NOT delete any non-type code (classes, functions, etc.)

### Required Code Markers

The re-export block MUST include:

```typescript
/**
 * @plan PLAN-20260302-TOOLSCHEDULER.P02
 * @requirement TS-COMPAT-001
 */
```

## Subagent Prompt

```typescript
You are implementing Phase 02 of the CoreToolScheduler refactoring.

CONTEXT: Types have been extracted to scheduler/types.ts in Phase 01. Now we need to maintain backward compatibility.

TASK: Add re-exports to coreToolScheduler.ts and remove duplicate type definitions

WHAT TO DO:
1. Open packages/core/src/core/coreToolScheduler.ts
2. Find the type definition section (ValidatingToolCall, ScheduledToolCall, etc.)
3. REPLACE all type definitions with a single re-export block:
   ```typescript
   /**
    * @plan PLAN-20260302-TOOLSCHEDULER.P02
    * @requirement TS-COMPAT-001
    */
   export type {
     ValidatingToolCall,
     ScheduledToolCall,
     // ... all types ...
   } from '../scheduler/types.js';
   ```
4. Verify all type exports are covered
5. Do NOT delete any non-type code

EXPECTED RESULT:
- Type definitions removed from coreToolScheduler.ts
- Re-export block added
- File size reduced by ~130 lines
- All imports of types from coreToolScheduler.ts still work
- TypeScript compilation succeeds

FORBIDDEN:
- Deleting non-type code (classes, functions, etc.)
- Forgetting to add @plan markers
- Breaking existing imports
```

## Verification Commands

### Automated Checks

```bash
# Re-exports added
grep "export type {" packages/core/src/core/coreToolScheduler.ts | grep -q "from '../scheduler/types.js'" || {
  echo "FAIL: Re-exports not added"
  exit 1
}

# Plan markers present
grep "@plan PLAN-20260302-TOOLSCHEDULER.P02" packages/core/src/core/coreToolScheduler.ts || {
  echo "FAIL: Plan markers missing"
  exit 1
}

# Original type definitions removed
if grep "^export type ValidatingToolCall = {" packages/core/src/core/coreToolScheduler.ts; then
  echo "FAIL: Original type definitions not removed"
  exit 1
fi

# TypeScript compilation
npm run typecheck || {
  echo "FAIL: TypeScript compilation failed"
  exit 1
}

# File size reduced
original_size=$(git show HEAD:packages/core/src/core/coreToolScheduler.ts | wc -l)
current_size=$(wc -l < packages/core/src/core/coreToolScheduler.ts)
reduction=$((original_size - current_size))

if [ "$reduction" -lt 100 ]; then
  echo "FAIL: File size not reduced enough (only $reduction lines removed, expected ~130)"
  exit 1
fi

echo "[OK] File size reduced by $reduction lines"
```

### Manual Verification

Test that existing imports still work:

```bash
# Create test file
cat > /tmp/test-import.ts << 'EOF'
import { ToolCall, ScheduledToolCall } from './packages/core/src/core/coreToolScheduler.js';

// Verification-only: as unknown used to test type import works (not production code)
const testCall: ToolCall = {
  status: 'scheduled',
  request: {} as unknown as ToolCall['request'],
  tool: {} as unknown as ToolCall['tool'],
  invocation: {} as unknown as ToolCall['invocation'],
};

console.log('Import test passed');
EOF

# Try to compile it
npx tsc --noEmit /tmp/test-import.ts || {
  echo "FAIL: Imports from coreToolScheduler.ts broken"
  exit 1
}

echo "[OK] Backward compatible imports work"
```

### Structural Verification Checklist

- [ ] Re-export block present in coreToolScheduler.ts
- [ ] All type names listed in re-export (ValidatingToolCall through QueuedRequest)
- [ ] Original type definitions removed
- [ ] Plan markers present
- [ ] Import path uses '../scheduler/types.js'

### Semantic Verification Checklist

- [ ] TypeScript compilation succeeds (types resolve correctly)
- [ ] Existing imports from coreToolScheduler.ts work (backward compatibility)
- [ ] New imports from scheduler/types.ts work (forward compatibility)
- [ ] No runtime behavior changes (types only)

## Success Criteria

- [ ] Re-export block added to coreToolScheduler.ts
- [ ] Original type definitions removed
- [ ] File size reduced by ~130 lines
- [ ] TypeScript compilation succeeds
- [ ] Existing imports from coreToolScheduler.ts work
- [ ] New imports from scheduler/types.ts work
- [ ] Plan markers present

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/core/coreToolScheduler.ts`
2. Re-run Phase 02 with corrected re-export block
3. Verify all type names are included in re-export
4. Ensure no non-type code was deleted

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/toolscheduler/.completed/P02.md`

Contents:
```markdown
Phase: P02
Completed: [TIMESTAMP]
Files Modified:
  - packages/core/src/core/coreToolScheduler.ts (-130 lines)
Verification: Backward compatible imports verified, TypeScript compilation passed
```
