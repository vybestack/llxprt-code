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
grep "@plan:PLAN-20260302-TOOLSCHEDULER.P02" packages/core/src/core/coreToolScheduler.ts || {
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

## Success Criteria

- [ ] Re-export block present with all types
- [ ] Original type definitions removed
- [ ] Plan markers present
- [ ] TypeScript compilation succeeds
- [ ] Backward compatible imports work
- [ ] File size reduced by ~100-130 lines
- [ ] All types from scheduler/types.ts accessible via coreToolScheduler.ts

## Pass/Fail Decision

**PASS** if all verification commands exit 0 and all checkboxes checked.

**FAIL** if any verification command fails. If FAIL, return to Phase 02 for remediation.

## Phase Completion

If PASS:
1. Update execution-tracker.md: Mark P02 and P02a complete
2. Proceed to Phase 03

If FAIL:
1. Document failures in execution-tracker.md
2. Remediate Phase 02
3. Re-run Phase 02a
