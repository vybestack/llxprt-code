# Phase 02a: Verify Re-exports

## Phase ID

`PLAN-20260302-TOOLSCHEDULER.P02a`

## Prerequisites

- Required: Phase 02 completed
- Verification: `grep "export type {" packages/core/src/core/coreToolScheduler.ts | grep scheduler/types`
- Expected: Re-exports added, original types removed

## Verification Tasks

### 1. Structural Verification

```bash
# Re-export block exists
grep -A 20 "export type {" packages/core/src/core/coreToolScheduler.ts | grep "from '../scheduler/types.js'" || {
  echo "FAIL: Re-exports not found"
  exit 1
}

# Plan markers present
grep "@plan PLAN-20260302-TOOLSCHEDULER.P02" packages/core/src/core/coreToolScheduler.ts || {
  echo "FAIL: Plan markers missing"
  exit 1
}

# Original type definitions removed (check for inline definition syntax)
if grep "^export type ValidatingToolCall = {" packages/core/src/core/coreToolScheduler.ts; then
  echo "FAIL: Original type definitions not removed"
  exit 1
fi

echo "[OK] Structural checks passed"
```

### 2. Compilation Verification

```bash
# TypeScript compilation succeeds
npm run typecheck || {
  echo "FAIL: TypeScript compilation failed"
  exit 1
}

echo "[OK] TypeScript compilation passed"
```

### 3. Backward Compatibility Test

```bash
# Create temporary test file
cat > /tmp/test-backward-compat.ts << 'EOF'
import { ToolCall, ScheduledToolCall, ConfirmHandler } from './packages/core/src/core/coreToolScheduler.js';

// Test that types work
const testCall: ScheduledToolCall = {
  status: 'scheduled',
  request: {} as any,
  tool: {} as any,
  invocation: {} as any,
};

const testHandler: ConfirmHandler = async (call) => {
  return 'ProceedOnce' as any;
};

console.log('Backward compatibility test passed');
EOF

# Compile test file
npx tsc --noEmit --skipLibCheck /tmp/test-backward-compat.ts || {
  echo "FAIL: Backward compatible imports broken"
  exit 1
}

rm -f /tmp/test-backward-compat.ts

echo "[OK] Backward compatibility preserved"
```

### 4. File Size Verification

```bash
# Check file size reduction
current_size=$(wc -l < packages/core/src/core/coreToolScheduler.ts)
if [ "$current_size" -gt 2050 ]; then
  echo "FAIL: File not reduced enough (current: $current_size lines, expected < 2050)"
  exit 1
fi

echo "[OK] File size reduced to $current_size lines"
```

## Semantic Verification Checklist

**Go beyond markers. Actually verify the behavior exists.**

#### Behavioral Verification Questions

1. **Does the re-export DO what the requirement says?**
   - [ ] I read the requirement text (TS-COMPAT-001)
   - [ ] I verified old imports work (tested with sample import)
   - [ ] I verified new imports work (tested from scheduler/types.ts)

2. **Is backward compatibility truly preserved?**
   - [ ] No test files needed modification
   - [ ] TypeScript compilation has no new errors
   - [ ] All existing code continues to work

3. **Are all types re-exported?**
   - [ ] Counted type exports in scheduler/types.ts
   - [ ] Verified same count in re-export block
   - [ ] No types left behind

## Success Criteria

- [ ] Re-export block present with all types
- [ ] Original type definitions removed
- [ ] Plan markers present
- [ ] TypeScript compilation succeeds
- [ ] Backward compatible imports work
- [ ] File size reduced by ~100-130 lines
- [ ] All types from scheduler/types.ts accessible via coreToolScheduler.ts

## Failure Recovery

If this phase fails:

1. **Missing types in re-export:** Add missing types to re-export block
2. **Compilation errors:** Check import path is correct ('../scheduler/types.js')
3. **Types not removed:** Delete original type definitions from coreToolScheduler.ts
4. Return to Phase 02 and re-run

## Pass/Fail Decision

**PASS** if all verification commands exit 0 and all checkboxes checked.

**FAIL** if any verification command fails. If FAIL, return to Phase 02 for remediation.

## Phase Completion Marker

If PASS, create: `project-plans/gmerge-0.24.5/toolscheduler/.completed/P02a.md`

Contents:
```markdown
Phase: P02a
Completed: [TIMESTAMP]
Verification Results:
  - Re-exports: PASS
  - Backward compatibility: PASS
  - TypeScript compilation: PASS
  - File size reduction: [N] lines
Next Phase: 03 (Characterize tool execution)
```

## Phase Completion

If PASS:
1. Create completion marker above
2. Update execution-tracker.md: Mark P02 and P02a complete
3. Proceed to Phase 03

If FAIL:
1. Document failures in execution-tracker.md
2. Remediate Phase 02
3. Re-run Phase 02a
