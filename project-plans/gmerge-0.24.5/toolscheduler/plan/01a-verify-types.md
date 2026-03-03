# Phase 01a: Verify Type Extraction

## Phase ID

`PLAN-20260302-TOOLSCHEDULER.P01a`

## Prerequisites

- Required: Phase 01 completed
- Verification: `test -f packages/core/src/scheduler/types.ts`
- Expected: TypeScript compilation succeeds
- Expected files from previous phase:
  - `packages/core/src/scheduler/types.ts` with all type definitions
  - Plan markers `@plan PLAN-20260302-TOOLSCHEDULER.P01` in types.ts

## Verification Commands

### Prerequisite Gate

```bash
# ============================================================
# PREREQUISITE GATE: Verify Phase 01 completed
# ============================================================

# Check Phase 01 completion marker
test -f project-plans/gmerge-0.24.5/toolscheduler/.completed/P01.md || {
  echo "FAIL: Phase 01 not completed (missing completion marker)"
  echo "REQUIRED: Complete Phase 01 before running Phase 01a"
  exit 1
}

echo "[GATE PASSED] Phase 01 completion marker found"

# ============================================================
# BEGIN PHASE 01a VERIFICATION
# ============================================================
```

### Automated Checks (Structural)

```bash
# File exists
test -f packages/core/src/scheduler/types.ts || {
  echo "FAIL: types.ts not created"
  exit 1
}

# Plan markers present
grep -q "@plan PLAN-20260302-TOOLSCHEDULER.P01" packages/core/src/scheduler/types.ts || {
  echo "FAIL: Plan markers missing"
  exit 1
}

# No circular dependencies (no imports from index.js)
if grep "from.*index\.js" packages/core/src/scheduler/types.ts; then
  echo "FAIL: Circular dependency detected (imports from index.js)"
  exit 1
fi

# Type-only imports used
import_count=$(grep "^import type" packages/core/src/scheduler/types.ts | wc -l)
if [ "$import_count" -lt 5 ]; then
  echo "FAIL: Expected at least 5 type imports, found $import_count"
  exit 1
fi

# All key types exported
for type in ValidatingToolCall ScheduledToolCall ExecutingToolCall SuccessfulToolCall ErroredToolCall CancelledToolCall WaitingToolCall ToolCall CompletedToolCall Status; do
  grep -q "export type $type" packages/core/src/scheduler/types.ts || {
    echo "FAIL: Type $type not exported"
    exit 1
  }
done

# Handler types exported
for handler in ConfirmHandler OutputUpdateHandler AllToolCallsCompleteHandler ToolCallsUpdateHandler; do
  grep -q "export type $handler" packages/core/src/scheduler/types.ts || {
    echo "FAIL: Handler type $handler not exported"
    exit 1
  }
done

echo "[OK] All structural checks passed"
```

### Compilation Verification

```bash
# TypeScript compilation
npm run typecheck || {
  echo "FAIL: TypeScript compilation failed"
  exit 1
}

echo "[OK] TypeScript compilation passed"
```

### No Premature Changes Verification

```bash
# Verify types still exist in coreToolScheduler.ts
grep -q "^export type ValidatingToolCall" packages/core/src/core/coreToolScheduler.ts || {
  echo "FAIL: Types prematurely removed from coreToolScheduler.ts"
  exit 1
}

echo "[OK] Backward compatibility preserved"
```

### Import Safety Verification

```bash
# Run module graph analysis to detect cycles
npx madge --circular packages/core/src/scheduler/types.ts 2>&1 | tee madge-output.txt

if grep -q "Circular dependency" madge-output.txt; then
  echo "FAIL: Circular dependencies detected"
  cat madge-output.txt
  exit 1
fi

rm -f madge-output.txt

echo "[OK] No circular dependencies"
```

### Semantic Verification Checklist

**Go beyond markers. Actually verify the behavior exists.**

#### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] I read the requirement text (TS-TYPE-001)
   - [ ] I read the extracted types in scheduler/types.ts
   - [ ] I can confirm all ToolCall state types match the original definitions

2. **Is this REAL implementation, not placeholder?**
   - [ ] No TODO/HACK/STUB comments in types.ts
   - [ ] All types have complete definitions (no `any` types)
   - [ ] No "will be implemented" comments

3. **Can I actually USE these types?**
   - [ ] I can import a type: `import type { ToolCall } from './scheduler/types.js'`
   - [ ] TypeScript recognizes the discriminated union (ToolCall status field)
   - [ ] No compilation errors when using types in code

4. **Are circular dependencies truly avoided?**
   - [ ] I verified types.ts only imports from leaf modules (tool.js, tools.js, turn.js)
   - [ ] I verified types.ts NEVER imports from index.js
   - [ ] Build succeeds without module resolution warnings

#### Feature Actually Works

```bash
# Manual test: Try importing types in a temporary file
cat > /tmp/test-types-import.ts << 'EOF'
import type { ToolCall, ScheduledToolCall, Status } from './packages/core/src/scheduler/types.js';

// Test discriminated union works
function processToolCall(call: ToolCall): string {
  switch (call.status) {
    case 'scheduled':
      return `Scheduled: ${call.request.name}`;
    case 'success':
      return `Success: ${call.response.resultDisplay}`;
    default:
      return 'Unknown';
  }
}

console.log('Type import test passed');
EOF

# Try to compile it
npx tsc --noEmit --skipLibCheck /tmp/test-types-import.ts && echo "[OK] Types usable in code" || echo "FAIL: Types not usable"
rm -f /tmp/test-types-import.ts

# Expected behavior: TypeScript compiles without errors
# Actual behavior: [RUN AND PASTE OUTPUT]
```

#### Integration Points Verified

- [ ] scheduler/types.ts exports all types (verified by grep)
- [ ] coreToolScheduler.ts still exports types (not removed yet - correct for Phase 01)
- [ ] Other modules can import from types.ts (verified by test import above)
- [ ] No breaking changes to existing imports (types still in coreToolScheduler.ts)

## Success Criteria

- [ ] types.ts file created with ~130 lines
- [ ] All 9 ToolCall state types exported
- [ ] All 4 handler types exported
- [ ] QueuedRequest interface exported
- [ ] No imports from index.js or barrel exports
- [ ] TypeScript compilation succeeds
- [ ] No circular dependencies
- [ ] Types still in coreToolScheduler.ts (correct for Phase 01)
- [ ] Plan markers present
- [ ] Behavioral verification questions answered (types actually work)

## Failure Recovery

If this phase fails:

1. **If types.ts not created:** Return to Phase 01, verify file creation step
2. **If circular dependencies:** Return to Phase 01, fix imports to use leaf modules only
3. **If types missing:** Return to Phase 01, ensure all types copied from coreToolScheduler.ts
4. **If compilation fails:** Return to Phase 01, check for syntax errors in type definitions

## Pass/Fail Decision

**PASS** if all verification commands exit 0 and all checkboxes checked.

**FAIL** if any verification command fails. If FAIL, return to Phase 01 for remediation.

## Phase Completion Marker

If PASS, create: `project-plans/gmerge-0.24.5/toolscheduler/.completed/P01a.md`

Contents:
```markdown
Phase: P01a
Completed: [TIMESTAMP]
Verification Results:
  - Structural checks: PASS
  - Compilation: PASS
  - Circular dependencies: NONE
  - Backward compatibility: PRESERVED
  - Semantic verification: PASS (types usable in code)
Next Phase: 02 (Add re-exports)
```

## Failure Recovery

If this phase fails:

1. **If types.ts not created:** Return to Phase 01, verify file creation step
2. **If circular dependencies:** Return to Phase 01, fix imports to use leaf modules only
3. **If types missing:** Return to Phase 01, ensure all types copied from coreToolScheduler.ts
4. **If compilation fails:** Return to Phase 01, check for syntax errors in type definitions

Do not proceed to Phase 02 until all verification checks pass.

## Phase Completion

If PASS:
1. Create completion marker above
2. Update execution-tracker.md: Mark P01 and P01a complete
3. Proceed to Phase 02

If FAIL:
1. Document failures in execution-tracker.md
2. Remediate Phase 01
3. Re-run Phase 01a
