# Task: Resolve packages/core/src/core/client.ts Conflict

## Objective

Resolve the merge conflict in the core client file to support provider abstraction while keeping improvements from main.

## File

`packages/core/src/core/client.ts`

## Context

- **multi-provider branch**: Modified to work with provider abstraction
- **main branch**: Added new client features and improvements

## Resolution Strategy

1. Preserve provider abstraction layer
2. Include new client capabilities from main
3. Ensure backward compatibility
4. Merge initialization logic

## Key Items to Preserve

### From multi-provider:

- Provider-agnostic client interface
- Support for multiple provider backends
- Provider initialization logic
- Abstracted API calls

### From main:

- New client methods
- Improved error handling
- Better retry logic
- Performance optimizations

## Expected Architecture

```typescript
class Client {
  // Provider-agnostic interface
  constructor(provider: IProvider) { ... }

  // Methods work with any provider
  async generate(...) {
    return this.provider.generate(...)
  }

  // New features from main
  async clearContext() { ... }
  // etc.
}
```

## Commands to Execute

```bash
# After resolution:
git add packages/core/src/core/client.ts
```

## Validation

1. Client works with all providers
2. New features accessible
3. No breaking changes
4. Tests pass
