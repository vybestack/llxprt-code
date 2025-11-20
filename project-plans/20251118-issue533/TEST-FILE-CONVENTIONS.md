# Test File Naming and Location Conventions

## Overview
This document specifies the test file naming and location conventions for the llxprt-code project.

## Convention: __tests__/ Subdirectories

### Primary Test Location Pattern
Test files MUST be placed in `__tests__/` subdirectories adjacent to the code they test.

**Pattern:**
```
packages/[package-name]/src/[module-path]/
  __tests__/
    [module-name].test.ts
  [module-name].ts
```

### Example: Config Module Tests
```
packages/cli/src/config/
  __tests__/
    profileBootstrap.test.ts
    nonInteractiveTools.test.ts
  profileBootstrap.ts
  auth.ts
  config.ts
```

### Example: Runtime Module Tests
```
packages/cli/src/runtime/
  __tests__/
    profileApplication.test.ts
    runtimeIsolation.test.ts
  profileApplication.ts
  runtimeSettings.ts
```

## Exceptions: Legacy .test.ts Files

Some legacy test files exist adjacent to source files (not in `__tests__/`):
- `packages/cli/src/config/auth.test.ts`
- `packages/cli/src/config/config.test.ts`
- `packages/cli/src/config/settings.test.ts`

**Note:** These are grandfathered exceptions. All NEW test files should follow the `__tests__/` convention.

## Integration Tests

Integration tests may be placed in dedicated directories:
```
packages/cli/src/integration-tests/
  cli-args.integration.test.ts
```

## Test File Naming

- **Unit Tests:** `[module-name].test.ts`
- **Integration Tests:** `[feature-name].integration.test.ts`
- **Runtime State Tests:** `[module-name].runtimeState.test.ts`

## Verification Commands

### Find all test files in __tests__/ directories
```bash
find packages -name "__tests__" -type d -not -path "*/node_modules/*" -not -path "*/dist/*"
```

### Find all .test.ts files
```bash
find packages -name "*.test.ts" -not -path "*/node_modules/*" -not -path "*/dist/*"
```

### Check test location for specific module
```bash
ls -la packages/cli/src/config/__tests__/
```

## Migration Guidelines

When adding tests for existing modules:
1. Create `__tests__/` subdirectory if it doesn't exist
2. Place new test files in the `__tests__/` directory
3. Do NOT move existing legacy test files unless specifically requested
4. Follow the naming convention: `[module-name].test.ts`

## Project-Specific Examples

### profileBootstrap Module
- **Source:** `packages/cli/src/config/profileBootstrap.ts`
- **Tests:** `packages/cli/src/config/__tests__/profileBootstrap.test.ts`

### profileApplication Module
- **Source:** `packages/cli/src/runtime/profileApplication.ts`
- **Tests:** `packages/cli/src/runtime/__tests__/profileApplication.test.ts`

### nonInteractiveTools Module
- **Source:** `packages/cli/src/config/profileBootstrap.ts` (contains the function)
- **Tests:** `packages/cli/src/config/__tests__/nonInteractiveTools.test.ts`

## References

This convention is evidenced by:
- Existing `__tests__/` directories in `packages/cli/src/config/`
- Existing `__tests__/` directories in `packages/cli/src/runtime/`
- Existing `__tests__/` directories in `packages/core/src/core/`
- Recent project plans referencing `__tests__/` structure
- dev-docs/RULES.md (Testing Framework: Vitest)
