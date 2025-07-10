# Task: Resolve packages/cli/src/ui/hooks/useGeminiStream.ts Conflict

## Objective

Resolve the merge conflict in useGeminiStream hook to support multi-provider streaming while preserving improvements from main.

## File

`packages/cli/src/ui/hooks/useGeminiStream.ts`

## Context

- **multi-provider branch**: Modified to work with multiple providers through ProviderManager
- **main branch**: Performance improvements and better error handling

## Resolution Strategy

1. Keep provider-agnostic streaming approach
2. Apply performance improvements from main
3. Merge error handling enhancements
4. Ensure backward compatibility

## Key Items to Preserve

### From multi-provider:

- Provider-agnostic streaming interface
- ProviderManager integration
- Multi-provider stream handling
- Provider-specific adaptations

### From main:

- Stream optimization
- Better error recovery
- Memory management
- Performance metrics

## Expected Structure

```typescript
// Should work with any provider
const stream = await providerManager.generateStream(...)
// Apply optimizations from main
// Handle errors gracefully
```

## Commands to Execute

```bash
# After resolution:
git add packages/cli/src/ui/hooks/useGeminiStream.ts
```

## Validation

1. Streaming works for all providers
2. Performance not degraded
3. Error handling robust
4. Types properly defined
