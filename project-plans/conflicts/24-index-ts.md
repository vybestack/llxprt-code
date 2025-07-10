# Task: Resolve packages/core/src/index.ts Conflict

## Objective

Resolve the merge conflict in the core index file to export all necessary interfaces and classes from both branches.

## File

`packages/core/src/index.ts`

## Context

- **multi-provider branch**: Added provider-related exports
- **main branch**: Added new feature exports

## Resolution Strategy

1. Export all provider interfaces and classes
2. Include new exports from main
3. Organize exports logically
4. Avoid naming conflicts

## Key Items to Preserve

### From multi-provider:

- Provider interfaces (IProvider, IMessage, etc.)
- Provider implementations
- Provider utilities
- Todo tool exports

### From main:

- New utility exports
- Command interfaces
- Memory management exports
- Error types

## Export Structure

```typescript
// Provider exports
export * from './providers/types';
export * from './providers/ProviderManager';

// Core exports
export * from './core/client';
export * from './core/contentGenerator';

// Tool exports
export * from './tools/todo-read';
export * from './tools/todo-write';

// New features from main
export * from './commands/...';
```

## Commands to Execute

```bash
# After resolution:
git add packages/core/src/index.ts
```

## Validation

1. All exports accessible
2. No circular dependencies
3. Type exports included
4. Build succeeds
