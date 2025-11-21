# Phase 10: Bootstrap Integration Implementation

## Phase ID
`PLAN-20251118-ISSUE533.P10`

## Prerequisites
- Required: Phase 09 completed (12 tests written and verified)
- Verification: `npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts -- --grep "@plan:.*P09"`
- Expected: 12 tests exist and fail naturally

## Implementation Tasks

### Files to Modify

#### `packages/cli/src/config/profileBootstrap.ts`
**Function**: `applyBootstrapProfile(args: BootstrapProfileArgs): BootstrapRuntimeState`
**Pseudocode Reference**: `analysis/pseudocode/apply-bootstrap-profile.md`

### Implementation Steps

#### Modify `applyBootstrapProfile()` Function

**Current Logic** (approximate):
```typescript
export function applyBootstrapProfile(
  args: BootstrapProfileArgs
): BootstrapRuntimeState {
  // Line 010: Check if profile-load specified
  if (args.profileName !== null) {
    // Load from file (existing logic)
    return loadProfileFromFile(args.profileName, args);
  }
  
  // Line 015: No profile - return empty/override-only result
  return applyOverridesOnly(args);
}
```

**Modified Logic**:
```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P10
 * @requirement REQ-INT-001.1
 * @pseudocode apply-bootstrap-profile.md lines 010-045
 */
export function applyBootstrapProfile(
  args: BootstrapProfileArgs
): BootstrapRuntimeState {
  // Line 010: Check if profile-load specified
  if (args.profileName !== null) {
    // Existing: Load from file
    return loadProfileFromFile(args.profileName, args);
  }
  
  // NEW: Lines 012-018: Check if inline profile specified
  if (args.profileJson !== null) {
    try {
      // Line 015: Parse inline profile JSON
      const baseProfile = parseInlineProfile(args.profileJson);
      
      // Line 016-017: Apply overrides on top of inline profile
      return applyOverridesToProfile(baseProfile, args);
    } catch (error: any) {
      // Line 020-022: Wrap errors with context
      throw new Error(
        `Failed to apply inline profile from --profile:\n${error.message}`
      );
    }
  }
  
  // Line 025: No profile - return empty/override-only result
  return applyOverridesOnly(args);
}
```

#### Add Helper Function (if not exists)

```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P10
 * @requirement REQ-INT-002.1
 * @pseudocode apply-bootstrap-profile.md lines 050-080
 * 
 * Apply command-line overrides to a loaded profile
 */
function applyOverridesToProfile(
  baseProfile: BootstrapRuntimeState,
  args: BootstrapProfileArgs
): BootstrapRuntimeState {
  const warnings: string[] = [...baseProfile.warnings];
  
  // Start with profile values
  let providerName = baseProfile.providerName;
  let modelName = baseProfile.modelName;
  
  // Apply overrides in precedence order
  if (args.providerOverride !== null) {
    warnings.push(`--provider override applied (from --profile)`);
    providerName = args.providerOverride;
  }
  
  if (args.modelOverride !== null) {
    warnings.push(`--model override applied (from --profile)`);
    modelName = args.modelOverride;
  }
  
  if (args.keyOverride !== null) {
    warnings.push(`--key override applied (from --profile)`);
  }
  
  if (args.keyfileOverride !== null) {
    warnings.push(`--keyfile override applied (from --profile)`);
  }
  
  if (args.baseurlOverride !== null) {
    warnings.push(`--baseurl override applied (from --profile)`);
  }
  
  if (args.setOverrides !== null && args.setOverrides.length > 0) {
    warnings.push(`--set overrides applied (${args.setOverrides.length} values)`);
  }
  
  return {
    providerName,
    modelName,
    warnings
  };
}
```

## Required Code Markers

All changes MUST include:
```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P10
 * @requirement REQ-XXX
 * @pseudocode apply-bootstrap-profile.md lines XX-YY
 */
```

## Verification Commands

```bash
# 1. Verify implementation modified
grep -n "args.profileJson !== null" packages/cli/src/config/profileBootstrap.ts
# Expected: New check exists

# 2. Run all Phase 09 tests
npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts -- --grep "@plan:.*P09"
# Expected: All 12 tests PASS

# 3. Verify existing tests still pass
npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts
# Expected: All tests pass

# 4. TypeScript compilation
npm run typecheck
# Expected: 0 errors
```

## Success Criteria

- All 12 Phase 09 tests pass
- No test modifications made
- Existing profile-load tests still pass
- TypeScript compiles with no errors
- Override precedence working correctly

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P10.md`

```markdown
Phase: P10
Completed: [YYYY-MM-DD HH:MM]
Files Modified:
  - packages/cli/src/config/profileBootstrap.ts (applyBootstrapProfile modified)
Test Results:
  - Phase 09 tests: 12/12 PASS [OK]
  - Existing tests: All PASS [OK]
  - TypeScript: 0 errors [OK]
Pseudocode Compliance: 100%
```
