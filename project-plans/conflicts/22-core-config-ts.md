# Task: Resolve packages/core/src/config/config.ts Conflict

## Objective

Resolve the merge conflict in core config to support provider configuration while preserving config improvements from main.

## File

`packages/core/src/config/config.ts`

## Context

- **multi-provider branch**: Added provider configuration structures
- **main branch**: Config improvements and new options

## Resolution Strategy

1. Merge configuration structures
2. Keep provider config support
3. Include new config options from main
4. Ensure type safety

## Key Items to Preserve

### From multi-provider:

- Provider configuration interfaces
- Multi-provider config validation
- Provider-specific settings

### From main:

- Config validation improvements
- New configuration options
- Better defaults
- Type enhancements

## Commands to Execute

```bash
# After resolution:
git add packages/core/src/config/config.ts
```

## Validation

1. Config loads correctly
2. All options accessible
3. Type checking passes
4. Validation works
