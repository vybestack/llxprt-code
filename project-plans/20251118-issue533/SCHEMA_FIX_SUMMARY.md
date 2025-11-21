# Schema Fix Summary - Issue #533

## Problem Identified

The specification.md file for the `--profile` CLI flag feature incorrectly assumed that Zod schemas for Profile validation already existed in the codebase. This was not true.

## Corrections Made

### 1. Updated Technology Stack Section (Line 21-26)
**Before**: "Uses existing JSON parsing and Zod schemas"
**After**: "Uses existing Zod library (already present), requires new profile schema definition"

### 2. Updated Data Flow (Line 30-33)
**Before**: Generic "Zod validation" step
**After**: Explicit `ProfileSchema.parse() [NEW]` step

### 3. Updated Dependencies Section (Line 73-77)
**Before**: "Will use EXISTING Zod schemas from `/packages/core/src/types/modelParams.ts`"
**After**: 
- Notes that modelParams.ts contains TypeScript interface only
- Documents NEW file requirement: `/packages/core/src/types/profileSchemas.ts`
- Clarifies that no Zod schema currently exists

### 4. Added Critical Schema Discovery Section (Lines 57-76)
New section documenting:
- Current state of Profile validation (interface only, no runtime validation)
- Required changes (create profileSchemas.ts)
- Chosen validation approach (Zod)
- Reference to detailed analysis document

### 5. Added New Files Section (Lines 100-109)
Documents the NEW files that must be created:
- `packages/core/src/types/profileSchemas.ts` - Main schema file
- `packages/core/src/types/__tests__/profileSchemas.test.ts` - Tests

### 6. Updated Profile JSON Structure Section (Lines 237-273)
**Before**: Simple interface reference
**After**: 
- Full Profile TypeScript interface (from modelParams.ts)
- Complete NEW Zod schema definition
- Import examples for use in profileBootstrap.ts

### 7. Updated Requirements (Line 175)
**Before**: "Validate against existing profile schema"
**After**: "Validate using ProfileSchema (Zod) from `/packages/core/src/types/profileSchemas.ts`"

### 8. Updated Usage Context (Line 327-332)
Added explicit steps for parseInlineProfile():
1. Parse JSON string with JSON.parse()
2. Validate with ProfileSchema.parse()
3. Return ProfileApplicationResult

### 9. Updated Data Flow Implementation (Line 639)
Added validation step: "validates with ProfileSchema.parse() (Zod) from profileSchemas.ts"

### 10. Updated File Organization (Line 153)
Changed from "NO CHANGE" to explicit note about new file creation

## New Deliverables Required

Based on the corrections, implementers must now create:

1. **`/packages/core/src/types/profileSchemas.ts`**
   - Zod schema definition for Profile
   - Mirrors existing TypeScript interface
   - Provides runtime validation
   - Exports ProfileSchema and type

2. **`/packages/core/src/types/__tests__/profileSchemas.test.ts`**
   - Tests for valid profile structures
   - Tests for invalid profile structures
   - Tests for missing required fields
   - Tests for type validation

3. **Schema Export in Core Package**
   - Update `/packages/core/src/index.ts` to export ProfileSchema
   - Make schema available to CLI package

## Reference Schema Structure

The specification now includes a complete Zod schema definition:

```typescript
export const ProfileSchema = z.object({
  provider: z.string().min(1, 'Provider is required'),
  model: z.string().min(1, 'Model is required'),
  key: z.string().optional(),
  keyFile: z.string().optional(),
  baseUrl: z.string().url().optional(),
  modelParams: z.record(z.unknown()).optional(),
  ephemerals: z.record(z.unknown()).optional(),
  promptConfig: z.record(z.unknown()).optional(),
}).strict(); // Reject unknown fields
```

## Documentation Created

**`zod-schema-analysis.md`**: Detailed analysis document covering:
- Current state of profile validation
- Comparison of validation options (Zod vs AJV)
- Recommended approach
- Impact assessment
- Complete implementation examples

## Validation

All references to Zod schemas in the specification now:
1. Acknowledge that schemas don't currently exist
2. Document the required creation steps
3. Provide complete schema definitions
4. Show proper import statements
5. Reference the correct file paths

## No Breaking Changes

These corrections are additive:
- Existing Profile interface unchanged
- Existing profile loading unchanged
- New validation applies only to `--profile` flag
- Existing `--profile-load` functionality unaffected
