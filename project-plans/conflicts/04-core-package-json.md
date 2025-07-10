# Task: Resolve packages/core/package.json Conflict

## Objective

Resolve the merge conflict in `packages/core/package.json`, preserving core functionality dependencies from both branches.

## File

`packages/core/package.json`

## Context

- **multi-provider branch**: May have added core dependencies for provider support
- **main branch**: Updated core dependencies and added new utilities

## Resolution Strategy

1. Open the conflicted file
2. Merge all dependencies, using newer versions for duplicates
3. Ensure all type definitions are included
4. Preserve all scripts and configurations

## Key Items to Preserve

### From multi-provider:

- Any new utility libraries for provider support
- Token counting libraries
- Additional type definitions

### From main:

- Updated Google AI SDK versions
- New utility functions
- Testing improvements

## Commands to Execute

```bash
# After manual resolution:
git add packages/core/package.json
```

## Validation

1. JSON validity check
2. Ensure compatibility with CLI package dependencies
3. No circular dependency issues
