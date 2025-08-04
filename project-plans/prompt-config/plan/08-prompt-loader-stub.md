# Task 08: PromptLoader Component - Stub Implementation

## Objective

Create a minimal stub implementation of the PromptLoader component that handles file I/O with compression.

## Context

The PromptLoader reads markdown files from disk and applies compression to reduce token usage.

## Requirements to Implement

- **[REQ-011]** Prompt Compression requirements
- **[REQ-007.4]** File read errors SHALL log warning and use fallback

## Files to Create

```
packages/core/src/prompt-config/PromptLoader.ts
```

## Stub Implementation

```typescript
import { promises as fs } from 'fs';
import { TemplateVariables } from './types';

export class PromptLoader {
  async loadFile(path: string): Promise<string> {
    throw new Error('NotYetImplemented');
  }

  async fileExists(path: string): Promise<boolean> {
    throw new Error('NotYetImplemented');
  }

  private compressContent(content: string): string {
    throw new Error('NotYetImplemented');
  }

  private isInCodeBlock(line: string, inBlock: boolean): boolean {
    throw new Error('NotYetImplemented');
  }

  private compressLine(line: string): string {
    throw new Error('NotYetImplemented');
  }
}
```

## Constraints

1. Maximum 100 lines including imports
2. All methods throw NotYetImplemented
3. Must compile with strict TypeScript
4. Include fs import for file operations

## Commands to Run

```bash
cd packages/core

# Create file
touch src/prompt-config/PromptLoader.ts

# Verify compilation
npm run typecheck

# Verify stub only
grep -v "throw new Error('NotYetImplemented')" src/prompt-config/PromptLoader.ts | \
  grep -E "return|if|for|while" && echo "FAIL: Logic found"
```

## Success Criteria

- File created and compiles
- All methods stubbed
- No implementation logic
- Under 100 lines