# Phase 06a: Profile Parsing Stub Verification

## Phase ID
`PLAN-20251118-ISSUE533.P06a`

## Prerequisites
- Required: Phase 06 completed (stubs created)
- Verification: Stub functions exist in profileBootstrap.ts
- Expected: Code compiles, stubs callable but fail naturally

## Verification Tasks

### Automated Verification

```bash
# 1. Verify TypeScript compilation
npm run typecheck
# Expected: Exit code 0, no errors

# 2. Verify parseInlineProfile stub exists
grep -A 10 "function parseInlineProfile" packages/cli/src/config/profileBootstrap.ts
# Expected: Function with STUB comment returning empty BootstrapRuntimeState

# 3. Verify getMaxNestingDepth stub exists
grep -A 5 "function getMaxNestingDepth" packages/cli/src/config/profileBootstrap.ts
# Expected: Function with STUB comment returning 0

# 4. Verify formatValidationErrors stub exists
grep -A 5 "function formatValidationErrors" packages/cli/src/config/profileBootstrap.ts
# Expected: Function with STUB comment returning empty string

# 5. Verify plan markers present
grep "@plan.*PLAN-20251118-ISSUE533.P06" packages/cli/src/config/profileBootstrap.ts | wc -l
# Expected: 3 markers (one per stub)

# 6. Verify requirement markers
grep "@requirement.*REQ-PROF-" packages/cli/src/config/profileBootstrap.ts | wc -l
# Expected: At least 3 markers

# 7. Verify stubs are callable (import test)
node -e "const pb = require('./packages/cli/src/config/profileBootstrap'); console.log(typeof pb.parseInlineProfile);"
# Expected: "function" or TypeScript equivalent check
```

### Manual Verification Checklist

- [ ] Phase 06 completion marker exists
- [ ] All three stub functions present:
  - [ ] parseInlineProfile()
  - [ ] getMaxNestingDepth()
  - [ ] formatValidationErrors()
- [ ] Each stub has:
  - [ ] @plan marker referencing P06
  - [ ] @requirement marker
  - [ ] STUB comment indicating placeholder
  - [ ] Proper return type signature
- [ ] TypeScript compiles without errors
- [ ] No implementation code (only return stubs)
- [ ] Functions are exported/accessible

### Function Signature Verification

#### parseInlineProfile
```bash
grep -A 3 "function parseInlineProfile" packages/cli/src/config/profileBootstrap.ts
```
Expected signature:
```typescript
function parseInlineProfile(jsonString: string): BootstrapRuntimeState
```

#### getMaxNestingDepth
```bash
grep -A 2 "function getMaxNestingDepth" packages/cli/src/config/profileBootstrap.ts
```
Expected signature:
```typescript
function getMaxNestingDepth(obj: any, currentDepth: number): number
```

#### formatValidationErrors
```bash
grep -A 2 "function formatValidationErrors" packages/cli/src/config/profileBootstrap.ts
```
Expected signature:
```typescript
function formatValidationErrors(errors: any[]): string
```

## Exit Criteria

- All stub functions exist and compile
- All functions have proper signatures
- All plan/requirement markers present
- TypeScript type checking passes
- Stubs are callable but return placeholder values
- Ready for Phase 07 (TDD tests)

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P06a.md`

```markdown
Phase: P06a
Completed: [YYYY-MM-DD HH:MM]
Verification Results:
  - TypeScript compilation: PASS
  - parseInlineProfile stub: EXISTS
  - getMaxNestingDepth stub: EXISTS
  - formatValidationErrors stub: EXISTS
  - Plan markers: 3/3 PRESENT
  - Requirement markers: 3/3 PRESENT
  - Function signatures: CORRECT
Status: VERIFIED - Ready for Phase 07
```

## Notes

- Stubs should NOT implement real logic
- Stubs should return valid type but incorrect values
- This enables Phase 07 TDD tests to fail naturally
- Real implementation comes in Phase 08
