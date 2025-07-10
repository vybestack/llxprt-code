# Task: Resolve packages/core/src/core/contentGenerator.ts Conflict

## Objective

Resolve the merge conflict in content generator to support provider-aware generation while preserving enhancements from main.

## File

`packages/core/src/core/contentGenerator.ts`

## Context

- **multi-provider branch**: Made content generation provider-aware
- **main branch**: Added new generation features and optimizations

## Resolution Strategy

1. Keep provider-aware architecture
2. Include new generation features
3. Merge optimization improvements
4. Preserve type safety

## Key Items to Preserve

### From multi-provider:

- Provider-specific content formatting
- Multi-provider generation support
- Provider adaptation logic
- Tool call formatting per provider

### From main:

- Generation optimizations
- New content types
- Improved streaming
- Better error handling

## Expected Structure

```typescript
class ContentGenerator {
  // Provider-aware generation
  async generate(provider: IProvider, ...) {
    // Format content for specific provider
    const formatted = this.formatForProvider(provider, ...)
    // Apply optimizations from main
    return provider.generate(formatted)
  }
}
```

## Commands to Execute

```bash
# After resolution:
git add packages/core/src/core/contentGenerator.ts
```

## Validation

1. Generation works for all providers
2. Optimizations applied
3. Type safety maintained
4. No formatting errors
