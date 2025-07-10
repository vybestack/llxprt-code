# Type Fix Shell Status

## Summary

Fixed TypeScript errors in `packages/core/src/tools/shell.ts` by replacing string type literals with Type enum values from '@google/genai'.

## Changes Made

1. **Added Type import**:
   - Added `import { Type } from '@google/genai';` at line 22

2. **Replaced string literals with Type enum values in parameter schema**:
   - Changed `type: 'object'` to `type: Type.OBJECT` at line 55
   - Changed `type: 'string'` to `type: Type.STRING` at lines 58, 62, and 67

## Files Modified

- `packages/core/src/tools/shell.ts`

## Verification

- No TypeScript errors related to shell.ts when running `npm run typecheck`
- The changes align with the pattern used in other tool files (e.g., read-file.ts)
- The Type enum is correctly imported from '@google/genai'

## Code Changes

```typescript
// Before
{
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description: 'Exact bash command to execute as `bash -c <command>`',
    },
    description: {
      type: 'string',
      description: '...',
    },
    directory: {
      type: 'string',
      description: '...',
    },
  },
  required: ['command'],
}

// After
{
  type: Type.OBJECT,
  properties: {
    command: {
      type: Type.STRING,
      description: 'Exact bash command to execute as `bash -c <command>`',
    },
    description: {
      type: Type.STRING,
      description: '...',
    },
    directory: {
      type: Type.STRING,
      description: '...',
    },
  },
  required: ['command'],
}
```
