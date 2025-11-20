# Zod Schema Analysis for Issue #533

## Executive Summary

**CRITICAL FINDING**: The specification.md file incorrectly assumes Zod schemas exist for Profile validation. The codebase does NOT use Zod for profile validation. Instead, it uses:
1. TypeScript interfaces (no runtime validation)
2. JSON.parse() with type casting
3. AJV-based SchemaValidator for some validations (but not for Profile)

## Current State of Profile Validation

### Profile Type Definition
**Location**: `/packages/core/src/types/modelParams.ts:92`

```typescript
export interface Profile {
  provider: string;
  model: string;
  key?: string;
  keyFile?: string;
  baseUrl?: string;
  modelParams?: ModelParams;
  ephemerals?: EphemeralSettings;
  promptConfig?: PromptConfig;
}
```

**Key Points**:
- This is a TypeScript `interface`, NOT a Zod schema
- No runtime validation exists
- Optional fields use `?` syntax

### Current Profile Loading
**Location**: `/packages/core/src/config/profileManager.ts:61`

```typescript
const profile = JSON.parse(content) as Profile;
```

**Validation Method**: Type casting only - NO runtime validation

### Validation Infrastructure Available

#### Option 1: SchemaValidator (AJV-based)
**Location**: `/packages/core/src/utils/schemaValidator.ts`

```typescript
export class SchemaValidator {
  static validate(schema: ExtendedSchema, data: unknown): string | null
}
```

- Uses AJV (JSON Schema validator)
- Already in use for other validations
- Would require JSON Schema definition (not Zod)

#### Option 2: Zod (Available but Unused for Profiles)
**Files Using Zod**:
- `/packages/core/src/auth/types.ts` - OAuth schemas
- `/packages/core/src/tools/todo-schemas.ts` - Todo tool schemas
- `/packages/cli/src/zed-integration/schema.ts` - Zed integration
- `/packages/cli/src/services/FileCommandLoader.ts` - Command definitions

**Zod IS available** as a dependency but NO profile schemas exist.

## Issues with specification.md

### Line 23
```markdown
- **Validation**: Zod schema for profile JSON validation
```
**ISSUE**: No Zod schema exists for Profile

### Line 25
```markdown
- **No new dependencies**: Uses existing JSON parsing and Zod schemas
```
**ISSUE**: Claims to use "existing Zod schemas" that don't exist

### Line 30
```markdown
CLI args → parseBootstrapArgs() → JSON.parse(profileJson) → Zod validation → 
```
**ISSUE**: Describes non-existent Zod validation step

### Line 64
```markdown
- Will use EXISTING Zod schemas from `/packages/core/src/types/modelParams.ts`
```
**ISSUE**: 
1. This file contains TypeScript interfaces, NOT Zod schemas
2. No Zod schemas exist in this file
3. This is the most explicit incorrect assumption

## Recommended Solutions

### Option A: Create Zod Schema (Align with Spec)
Create a new Zod schema that mirrors the Profile interface:

**New file**: `/packages/core/src/types/profileSchemas.ts`

```typescript
import { z } from 'zod';

export const ProfileSchema = z.object({
  provider: z.string().min(1, 'Provider is required'),
  model: z.string().min(1, 'Model is required'),
  key: z.string().optional(),
  keyFile: z.string().optional(),
  baseUrl: z.string().url().optional(),
  modelParams: z.record(z.unknown()).optional(),
  ephemerals: z.record(z.unknown()).optional(),
  promptConfig: z.record(z.unknown()).optional(),
}).refine(
  (data) => data.key || data.keyFile || true,
  { message: 'Either key or keyFile can be provided, but not required' }
);

export type Profile = z.infer<typeof ProfileSchema>;
```

**Usage in profileBootstrap.ts**:
```typescript
import { ProfileSchema } from '@vybestack/llxprt-code-core';

function parseInlineProfile(profileJson: string): ProfileApplicationResult {
  const parsed = JSON.parse(profileJson);
  const validated = ProfileSchema.parse(parsed); // Throws on invalid
  // ... rest of logic
}
```

### Option B: Use Existing SchemaValidator (Less Work)
Use the existing AJV-based validator:

**New file**: `/packages/core/src/config/profileJsonSchema.ts`

```typescript
export const PROFILE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    provider: { type: 'string', minLength: 1 },
    model: { type: 'string', minLength: 1 },
    key: { type: 'string' },
    keyFile: { type: 'string' },
    baseUrl: { type: 'string', format: 'uri' },
    modelParams: { type: 'object' },
    ephemerals: { type: 'object' },
    promptConfig: { type: 'object' }
  },
  required: ['provider', 'model'],
  additionalProperties: false
};
```

**Usage**:
```typescript
import { SchemaValidator } from '@vybestack/llxprt-code-core';
import { PROFILE_JSON_SCHEMA } from '../config/profileJsonSchema.js';

const error = SchemaValidator.validate(PROFILE_JSON_SCHEMA, parsed);
if (error) throw new Error(`Invalid profile: ${error}`);
```

### Option C: Update Spec to Match Reality (No Validation)
Update specification.md to reflect that validation will be added as part of this feature:

**Changes needed**:
1. Line 23: Change to "Validation: NEW Zod schema for profile JSON validation"
2. Line 25: Change to "New dependency: Zod schemas for profile validation"
3. Line 64: Change to "Will CREATE new Zod schemas in `/packages/core/src/types/profileSchemas.ts`"
4. Add section: "## New Files Required" listing profileSchemas.ts

## Recommendation

**Option A (Create Zod Schema)** is recommended because:
1. Zod is already a dependency
2. Other parts of the codebase use Zod
3. Better type inference and error messages
4. Aligns with the specification's intent
5. Provides runtime safety for CI/CD use case

## Required Specification Updates

Regardless of chosen option, update specification.md:

1. **Line 64** - Change from:
   ```markdown
   - Will use EXISTING Zod schemas from `/packages/core/src/types/modelParams.ts`
   ```
   To:
   ```markdown
   - Will CREATE new Zod schemas in `/packages/core/src/types/profileSchemas.ts`
   ```

2. **Add to "Files Modified" section** (around line 45):
   ```markdown
   - `/packages/core/src/types/profileSchemas.ts` (NEW)
     - Zod schema for Profile validation
     - Exported ProfileSchema for runtime validation
   ```

3. **Add import statement examples** in pseudocode sections:
   ```typescript
   import { ProfileSchema } from '@vybestack/llxprt-code-core';
   // or
   import { ProfileSchema } from '../../core/src/types/profileSchemas.js';
   ```

4. **Update data flow diagram** (line 30):
   ```markdown
   CLI args → parseBootstrapArgs() → JSON.parse(profileJson) → 
   ProfileSchema.parse() [NEW] → ProfileApplicationResult → 
   Existing profile application logic → ProviderRuntimeContext
   ```

## Impact Assessment

### Low Risk
- Creating Zod schema is additive
- Existing Profile interface can coexist
- No changes to existing profile loading

### Medium Effort
- Create profileSchemas.ts (~50 lines)
- Add validation in parseInlineProfile() (~10 lines)
- Write tests for schema validation (~100 lines)

### High Value
- Runtime safety for CI/CD JSON input
- Better error messages for invalid profiles
- Prevents silent failures from malformed JSON
