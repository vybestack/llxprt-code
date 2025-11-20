# Phase 05: Argument Parsing Implementation

## Phase ID
`PLAN-20251118-ISSUE533.P05`

## Prerequisites
- Required: Phase 04 completed (15 tests written and verified)
- Verification: `grep -c "@plan:PLAN-20251118-ISSUE533.P04" packages/cli/src/config/__tests__/profileBootstrap.test.ts`
- Expected: 15 tests exist and fail naturally

## Implementation Tasks

### Files to Modify

#### `packages/cli/src/config/profileBootstrap.ts`
**Function**: `parseBootstrapArgs()`
**Pseudocode Reference**: `analysis/pseudocode/parse-bootstrap-args.md` lines 030-074

### Implementation Steps

#### Step 1: Add Tracking Flags (Pseudocode Lines 013-014)

**Location**: Inside `parseBootstrapArgs()` function, after initializing `bootstrapArgs`

```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P05
 * @requirement REQ-INT-001.2
 * @pseudocode parse-bootstrap-args.md lines 013-014
 */
let profileLoadUsed = false;  // Track if --profile-load was used
let profileUsed = false;       // Track if --profile was used
```

#### Step 2: Modify Existing --profile-load Case (Pseudocode Lines 042-048)

**Location**: In the switch statement, find the `--profile-load` case

**Current Code** (approximate):
```typescript
case '--profile-load': {
  const { value, nextIndex } = consumeValue(argv, index, inline);
  bootstrapArgs.profileName = value;
  index = nextIndex;
  break;
}
```

**Modified Code**:
```typescript
case '--profile-load': {
  /**
   * @plan PLAN-20251118-ISSUE533.P05
   * @requirement REQ-INT-001.2
   * @pseudocode parse-bootstrap-args.md lines 042-048
   */
  const { value, nextIndex } = consumeValue(argv, index, inline);
  bootstrapArgs.profileName = value;
  profileLoadUsed = true;  // NEW: Track usage
  index = nextIndex;
  break;
}
```

#### Step 3: Add --profile Case (Pseudocode Lines 031-040)

**Location**: In the switch statement, add new case BEFORE or AFTER `--profile-load`

```typescript
case '--profile': {
  /**
   * @plan PLAN-20251118-ISSUE533.P05
   * @requirement REQ-PROF-001.1
   * @pseudocode parse-bootstrap-args.md lines 031-040
   */
  const { value, nextIndex } = consumeValue(argv, index, inline);
  
  // Line 034: Verify value exists
  if (value === null) {
    throw new Error('--profile requires a value');
  }
  
  // Line 037: Store JSON string
  bootstrapArgs.profileJson = value;
  
  // Line 038: Track usage for mutual exclusivity
  profileUsed = true;
  
  // Line 039: Update index
  index = nextIndex;
  break;
}
```

#### Step 4: Add Mutual Exclusivity Check (Pseudocode Lines 060-067)

**Location**: AFTER the for loop, BEFORE the return statement

```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P05
 * @requirement REQ-INT-001.2
 * @pseudocode parse-bootstrap-args.md lines 060-067
 */
// Line 060: Check if both profile methods used
if (profileUsed && profileLoadUsed) {
  throw new Error(
    'Cannot use both --profile and --profile-load. ' +
    'Choose one profile source:\n' +
    '  --profile for inline JSON (CI/CD)\n' +
    '  --profile-load for saved profiles (local dev)'
  );
}
```

#### Step 5: Add Size Limit Check (Pseudocode Lines 070-074)

**Location**: After mutual exclusivity check, before return

```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P05
 * @requirement REQ-PROF-003.3
 * @pseudocode parse-bootstrap-args.md lines 070-074
 */
// Line 070-071: Check size limit
if (bootstrapArgs.profileJson !== null) {
  if (bootstrapArgs.profileJson.length > 10240) {
    throw new Error('Profile JSON exceeds maximum size of 10KB');
  }
}
```

## Complete Modified Function Structure

The function should now look like this (abbreviated):

```typescript
export function parseBootstrapArgs(): ParsedBootstrapArgs {
  const argv = process.argv.slice(2);
  const bootstrapArgs: BootstrapProfileArgs = {
    profileName: null,
    profileJson: null,  // From Phase 03
    providerOverride: null,
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    baseurlOverride: null,
    setOverrides: null,
  };
  
  // NEW: Tracking flags
  let profileLoadUsed = false;
  let profileUsed = false;
  
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('-')) {
      continue;
    }
    
    let flag = token;
    let inline: string | undefined;
    const equalsIndex = token.indexOf('=');
    if (equalsIndex !== -1) {
      flag = token.slice(0, equalsIndex);
      inline = token.slice(equalsIndex + 1);
    }
    
    switch (flag) {
      case '--profile': {  // NEW CASE
        const { value, nextIndex } = consumeValue(argv, index, inline);
        if (value === null) {
          throw new Error('--profile requires a value');
        }
        bootstrapArgs.profileJson = value;
        profileUsed = true;
        index = nextIndex;
        break;
      }
      
      case '--profile-load': {  // MODIFIED: Add tracking
        const { value, nextIndex } = consumeValue(argv, index, inline);
        bootstrapArgs.profileName = value;
        profileLoadUsed = true;  // NEW
        index = nextIndex;
        break;
      }
      
      // ... other existing cases unchanged ...
    }
  }
  
  // NEW: Mutual exclusivity check
  if (profileUsed && profileLoadUsed) {
    throw new Error(
      'Cannot use both --profile and --profile-load. ' +
      'Choose one profile source:\n' +
      '  --profile for inline JSON (CI/CD)\n' +
      '  --profile-load for saved profiles (local dev)'
    );
  }
  
  // NEW: Size limit check
  if (bootstrapArgs.profileJson !== null) {
    if (bootstrapArgs.profileJson.length > 10240) {
      throw new Error('Profile JSON exceeds maximum size of 10KB');
    }
  }
  
  return {
    args: bootstrapArgs,
    warnings: []
  };
}
```

## Required Code Markers

All changes MUST include:
```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P05
 * @requirement REQ-XXX
 * @pseudocode parse-bootstrap-args.md lines XX-YY
 */
```

## Verification Commands

### Automated Checks

```bash
# Check implementation exists
grep -n "case '--profile':" packages/cli/src/config/profileBootstrap.ts
# Expected: 1 match

# Check mutual exclusivity
grep -n "Cannot use both --profile and --profile-load" packages/cli/src/config/profileBootstrap.ts
# Expected: 1 match

# Check size limit
grep -n "Profile JSON exceeds maximum size" packages/cli/src/config/profileBootstrap.ts
# Expected: 1 match

# Run all Phase 04 tests
npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts -- --grep "@plan:.*P04"
# Expected: All 15 tests PASS

# Run full test suite for file
npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts
# Expected: All tests pass (including existing --profile-load tests)
```

### Manual Verification Checklist

- [ ] `--profile` case added to switch statement
- [ ] `profileUsed` flag set when `--profile` used
- [ ] `profileLoadUsed` flag set when `--profile-load` used
- [ ] Mutual exclusivity check added after loop
- [ ] Size limit check added after mutual exclusivity
- [ ] Error messages match specification exactly
- [ ] All 15 Phase 04 tests pass
- [ ] No existing tests modified
- [ ] No existing tests broken
- [ ] Plan markers present on all changes
- [ ] Pseudocode line numbers referenced

## Success Criteria

- All 15 Phase 04 tests pass
- No test modifications made
- All existing tests still pass
- TypeScript compiles with no errors
- Pseudocode lines 031-074 fully implemented
- All error messages match specification

## Failure Recovery

If this phase fails:

1. **Tests still failing**: 
   - Verify exact error messages match test expectations
   - Check case-sensitive string matching
   - Verify null checks use `=== null` not `== null`

2. **Existing tests broken**:
   - Verify `--profile-load` case still works
   - Ensure tracking flag doesn't interfere with existing logic
   - Rollback and re-implement more carefully

3. **TypeScript errors**:
   - Verify `profileJson` field exists in interface
   - Check variable declarations have correct types
   - Run `npm run typecheck` for details

4. **Pseudocode mismatch**:
   - Review pseudocode lines 031-074
   - Ensure line-by-line implementation
   - Check error message text matches pseudocode

## Pseudocode Compliance Matrix

| Pseudocode Lines | Implementation Location | Status |
|------------------|-------------------------|--------|
| 013-014 | Tracking flags declaration | [ ] |
| 031-040 | `--profile` case | [ ] |
| 042-048 | `--profile-load` modification | [ ] |
| 060-067 | Mutual exclusivity check | [ ] |
| 070-074 | Size limit check | [ ] |

All rows must be checked before completing phase.

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P05.md`

```markdown
Phase: P05
Completed: [YYYY-MM-DD HH:MM]
Files Modified:
  - packages/cli/src/config/profileBootstrap.ts (+45 lines, modified parseBootstrapArgs)
Changes:
  - Added --profile case to switch statement
  - Added mutual exclusivity check
  - Added size limit validation
  - Added tracking flags for profile source
Test Results:
  - Phase 04 tests: 15/15 PASS [OK]
  - Existing tests: All PASS [OK]
  - TypeScript: 0 errors [OK]
Pseudocode Compliance: 100%
  - Lines 013-014: [OK]
  - Lines 031-040: [OK]
  - Lines 042-048: [OK]
  - Lines 060-067: [OK]
  - Lines 070-074: [OK]
```
