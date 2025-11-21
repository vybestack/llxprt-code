# Phase 08: Profile Parsing Implementation

## Phase ID
`PLAN-20251118-ISSUE533.P08`

## Prerequisites
- Required: Phase 07 completed (20 tests written and verified)
- Verification: `npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts -- --grep "@plan:.*P07"`
- Expected: 20 tests exist and fail naturally

## Implementation Tasks

### Files to Modify

#### `packages/cli/src/config/profileBootstrap.ts`
**Functions to Implement**:
1. `parseInlineProfile(jsonString: string): BootstrapRuntimeState`
2. `getMaxNestingDepth(obj: any, currentDepth: number): number`
3. `formatValidationErrors(errors: any[]): string`

**Pseudocode Reference**: `analysis/pseudocode/parse-inline-profile.md`

### Implementation Steps

#### Step 1: Implement `getMaxNestingDepth()` Helper

**Location**: Near top of file after imports

```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P08
 * @requirement REQ-PROF-003.3
 * @pseudocode parse-inline-profile.md lines 080-095
 * 
 * Calculate maximum nesting depth of an object
 */
function getMaxNestingDepth(obj: any, currentDepth = 0): number {
  // Line 082: Base case - not an object or array
  if (typeof obj !== 'object' || obj === null) {
    return currentDepth;
  }
  
  // Line 085: Check arrays
  if (Array.isArray(obj)) {
    if (obj.length === 0) return currentDepth;
    return Math.max(...obj.map(item => getMaxNestingDepth(item, currentDepth + 1)));
  }
  
  // Line 090: Check objects
  const keys = Object.keys(obj);
  if (keys.length === 0) return currentDepth;
  
  const depths = keys.map(key => getMaxNestingDepth(obj[key], currentDepth + 1));
  return Math.max(...depths);
}
```

#### Step 2: Implement `formatValidationErrors()` Helper

```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P08
 * @requirement REQ-PROF-003.2
 * @pseudocode parse-inline-profile.md lines 100-115
 * 
 * Format Zod validation errors into user-friendly message
 */
function formatValidationErrors(errors: any[]): string {
  const messages = errors.map(err => {
    const path = err.path.join('.');
    const field = path || 'root';
    return `  - '${field}': ${err.message}`;
  });
  
  return 'Profile validation failed:\n' + messages.join('\n');
}
```

#### Step 3: Implement `parseInlineProfile()` Main Function

```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P08
 * @requirement REQ-PROF-002.1
 * @pseudocode parse-inline-profile.md lines 010-075
 * 
 * Parse inline profile JSON string and validate
 * 
 * @param jsonString - JSON string from --profile flag
 * @returns BootstrapRuntimeState with provider, model, warnings
 * @throws Error if JSON invalid or validation fails
 */
function parseInlineProfile(jsonString: string): BootstrapRuntimeState {
  // Line 012-015: Check for empty string
  const trimmed = jsonString.trim();
  if (trimmed === '') {
    throw new Error('Profile JSON cannot be empty');
  }
  
  // Line 018-025: Parse JSON
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error: any) {
    throw new Error(`Invalid JSON in --profile: ${error.message}`);
  }
  
  // Line 028-030: Verify it's an object
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Profile must be a JSON object, not an array or primitive value');
  }
  
  // Line 033-037: Check nesting depth
  const maxDepth = getMaxNestingDepth(parsed);
  if (maxDepth > 5) {
    throw new Error(
      `Profile nesting depth exceeds maximum of 5 levels (found ${maxDepth} levels). ` +
      'Simplify your profile structure.'
    );
  }
  
  // Line 040-047: Check for dangerous fields
  const dangerousFields = ['__proto__', 'constructor', 'prototype'];
  function checkDangerousFields(obj: any, path = ''): void {
    if (typeof obj !== 'object' || obj === null) return;
    
    for (const key of Object.keys(obj)) {
      if (dangerousFields.includes(key)) {
        const fullPath = path ? `${path}.${key}` : key;
        throw new Error(
          `Disallowed field '${fullPath}' found in profile. ` +
          'Fields __proto__, constructor, and prototype are not allowed for security reasons.'
        );
      }
      checkDangerousFields(obj[key], path ? `${path}.${key}` : key);
    }
  }
  checkDangerousFields(parsed);
  
  // Line 050-058: Basic validation (TypeScript Profile interface)
  // Validate provider and model are present
  if (!parsed.provider || typeof parsed.provider !== 'string') {
    throw new Error("'provider' is required and must be a string");
  }
  if (!parsed.model || typeof parsed.model !== 'string') {
    throw new Error("'model' is required and must be a string");
  }
  
  // Validate provider is supported
  const supportedProviders = ['openai', 'anthropic', 'google', 'azure'];
  if (!supportedProviders.includes(parsed.provider)) {
    throw new Error(
      `Invalid provider '${parsed.provider}'. Supported providers: ${supportedProviders.join(', ')}`
    );
  }
  
  // Optional: Validate temperature range if present
  if (parsed.temperature !== undefined) {
    if (typeof parsed.temperature !== 'number' || parsed.temperature < 0 || parsed.temperature > 2) {
      throw new Error("'temperature' must be a number between 0 and 2");
    }
  }
  
  // Line 060-068: Extract provider and model
  return {
    providerName: parsed.provider,
    modelName: parsed.model,
    warnings: []
  };
}
```

#### Step 4: Validate Using TypeScript Interface

**Note**: This implementation uses basic TypeScript validation against the Profile interface
from `packages/core/src/types/modelParams.ts`. No Zod schema is required.

```typescript
// Line 050-058: TypeScript validation with runtime checks
// Validate provider and model are present and correct types
if (!parsed.provider || typeof parsed.provider !== 'string') {
  throw new Error("'provider' is required and must be a string");
}
if (!parsed.model || typeof parsed.model !== 'string') {
  throw new Error("'model' is required and must be a string");
}

// Validate provider is supported
const supportedProviders = ['openai', 'anthropic', 'google', 'azure'];
if (!supportedProviders.includes(parsed.provider)) {
  throw new Error(
    `Invalid provider '${parsed.provider}'. Supported providers: ${supportedProviders.join(', ')}`
  );
}

// Optional: Validate temperature range if present
if (parsed.temperature !== undefined) {
  if (typeof parsed.temperature !== 'number' || parsed.temperature < 0 || parsed.temperature > 2) {
    throw new Error("'temperature' must be a number between 0 and 2");
  }
}

// Line 060-068: Extract provider and model
return {
  providerName: parsed.provider,
  modelName: parsed.model,
  warnings: []
};
```

## Required Code Markers

All changes MUST include:
```typescript
/**
 * @plan PLAN-20251118-ISSUE533.P08
 * @requirement REQ-XXX
 * @pseudocode parse-inline-profile.md lines XX-YY
 */
```

## Verification Commands

```bash
# 1. Check implementation exists
grep -n "function parseInlineProfile" packages/cli/src/config/profileBootstrap.ts
# Expected: Real implementation (not stub)

# 2. Run all Phase 07 tests
npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts -- --grep "@plan:.*P07"
# Expected: All 20 tests PASS

# 3. TypeScript compilation
npm run typecheck
# Expected: 0 errors

# 4. Build succeeds
npm run build
# Expected: Success
```

## Success Criteria

- All 20 Phase 07 tests pass
- No test modifications made
- TypeScript compiles with no errors
- All helper functions implemented
- Pseudocode lines 010-115 fully implemented
- Basic validation uses Profile TypeScript interface (no Zod schema required)

## Failure Recovery

If tests fail:

1. **JSON parsing errors**: Check error message format matches tests
2. **Validation errors**: Ensure Zod schema matches Profile interface
3. **Nesting depth**: Test getMaxNestingDepth() separately
4. **Security checks**: Verify dangerous field detection works recursively

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P08.md`

```markdown
Phase: P08
Completed: [YYYY-MM-DD HH:MM]
Files Modified:
  - packages/cli/src/config/profileBootstrap.ts (parseInlineProfile implemented)
Test Results:
  - Phase 07 tests: 20/20 PASS [OK]
  - TypeScript: 0 errors [OK]
  - Build: Success [OK]
Pseudocode Compliance: 100%
Note: Uses TypeScript Profile interface validation, not Zod schema
```
