# Task: Resolve packages/core/src/core/turn.ts Conflict

## Objective

Resolve the merge conflict in turn.ts to support provider-specific turn handling while keeping improvements from main.

## File

`packages/core/src/core/turn.ts`

## Context

- **multi-provider branch**: Modified turn handling for multiple providers
- **main branch**: Turn handling improvements and optimizations

## Resolution Strategy

1. Keep provider-aware turn structure
2. Apply optimizations from main
3. Merge turn validation improvements
4. Preserve type definitions

## Key Items to Preserve

### From multi-provider:

- Provider-specific turn formatting
- Multi-provider turn validation
- Turn adaptation logic

### From main:

- Turn optimization
- Better validation
- Performance improvements
- Enhanced types

## Commands to Execute

```bash
# After resolution:
git add packages/core/src/core/turn.ts
```

## Validation

1. Turns process correctly
2. Provider compatibility maintained
3. Performance not degraded
4. Types correct
