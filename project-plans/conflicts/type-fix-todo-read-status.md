# Type Fix: todo-read.ts Status

## Issue

TypeScript error in `packages/core/src/tools/todo-read.ts` where `'object'` string literal was used instead of the proper `Type.OBJECT` enum value.

## Changes Made

### File: packages/core/src/tools/todo-read.ts

1. **Added import statement** (line 10):

   ```typescript
   import { Type } from '@google/genai';
   ```

2. **Updated schema type** (line 23):
   - Changed from: `type: 'object'`
   - Changed to: `type: Type.OBJECT`

## Context

The schema parameter in the BaseTool constructor expects the Type enum from the Google GenAI library, not a string literal. This change ensures type safety and consistency with other tool implementations in the codebase.

## Verification

- The fix follows the same pattern used in other tool files like `grep.ts`, `edit.ts`, etc.
- No other changes were needed as the file was already properly structured
