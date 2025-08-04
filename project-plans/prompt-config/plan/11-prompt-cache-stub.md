# Task 11: PromptCache Component - Stub Implementation

## Objective

Create a minimal stub implementation of the PromptCache component for in-memory caching.

## Context

The PromptCache stores assembled prompts in memory for O(1) retrieval.

## Requirements to Implement

- **[REQ-006.1]** All files SHALL be loaded into memory on startup
- **[REQ-006.2]** Assembled prompts SHALL be cached with O(1) lookup
- **[REQ-006.4]** Cache keys SHALL include provider, model, tools, and environment

## File to Create

```
packages/core/src/prompt-config/PromptCache.ts
```

## Stub Implementation

```typescript
import { PromptContext } from './types';

export interface CacheEntry {
  assembledPrompt: string;
  metadata: {
    files: string[];
    tokenCount?: number;
    assemblyTimeMs: number;
  };
}

export class PromptCache {
  private cache: Map<string, CacheEntry>;

  constructor() {
    this.cache = new Map();
  }

  generateKey(context: PromptContext): string {
    throw new Error('NotYetImplemented');
  }

  set(context: PromptContext, prompt: string, metadata: CacheEntry['metadata']): void {
    throw new Error('NotYetImplemented');
  }

  get(context: PromptContext): CacheEntry | null {
    throw new Error('NotYetImplemented');
  }

  has(context: PromptContext): boolean {
    throw new Error('NotYetImplemented');
  }

  clear(): void {
    throw new Error('NotYetImplemented');
  }

  size(): number {
    throw new Error('NotYetImplemented');
  }
}
```

## Success Criteria

- Compiles with TypeScript
- All methods stubbed
- Cache Map initialized
- Under 100 lines