# Architecture Alignment Documentation

**Issue**: #533 - Add `--profile` CLI flag for inline JSON profiles  
**Date**: 2025-11-19  
**Resolution**: File Structure Mismatch (Issue #3)

## Problem Statement

The initial specification incorrectly referenced a non-existent file `packages/cli/src/runtime/prepareRuntime.ts` and function `bootstrapProviderRuntimeWithProfile()`. This document clarifies the actual architecture and aligns the specification with the real codebase structure.

## Actual File Structure

### Primary File: `packages/cli/src/config/profileBootstrap.ts`

This single file contains ALL the logic needed for the `--profile` feature:

1. **Argument Parsing** (Line ~75)
   - Function: `parseBootstrapArgs()`
   - Responsibility: Parse CLI arguments including new `--profile` flag
   - Returns: `ParsedBootstrapArgs` containing `BootstrapProfileArgs` and metadata

2. **Profile Application** (Line ~237)
   - Function: `prepareRuntimeForProfile()`
   - Responsibility: Apply profile configuration to runtime context
   - This is where inline JSON profiles will be handled
   - Returns: `BootstrapRuntimeState` with configured provider manager

### Supporting File: `packages/cli/src/runtime/profileApplication.ts`

Contains profile application logic that works with parsed Profile objects:

- **Function**: `applyProfileWithGuards()`
- **Responsibility**: Provider selection, validation, and configuration merging
- **No Changes Required**: This function receives pre-parsed Profile objects and doesn't need to know whether they came from a file or inline JSON

### Type Definitions: `packages/core/src/types/modelParams.ts`

Contains the Profile schema and validation logic:

- **No Changes Required**: Existing Zod schemas already validate Profile objects
- Used by both file-based and inline profile flows

## Data Flow

```
CLI Arguments
    ↓
parseBootstrapArgs() [profileBootstrap.ts:75]
    ↓
BootstrapProfileArgs { profileJson: string | null, profileName: string | null, ... }
    ↓
prepareRuntimeForProfile() [profileBootstrap.ts:237]
    ↓
    ├─ If profileJson exists → parseInlineProfile() → Profile object
    ├─ If profileName exists → Load from file → Profile object
    └─ Else → Default configuration
    ↓
applyProfileWithGuards() [profileApplication.ts]
    ↓
ProviderRuntimeContext
```

## Implementation Strategy

### Phase Distribution

All implementation phases modify **one file**: `packages/cli/src/config/profileBootstrap.ts`

#### Phase 05: Argument Parsing Extension
- **File**: `profileBootstrap.ts`
- **Line**: ~75
- **Function**: `parseBootstrapArgs()`
- **Change**: Add `--profile` case to switch statement

#### Phase 06-08: Profile Parsing Helpers
- **File**: `profileBootstrap.ts`
- **New Functions**: 
  - `parseInlineProfile(jsonString: string)`
  - `getMaxNestingDepth(obj: any, depth: number)`
  - `formatValidationErrors(errors: any[])`

#### Phase 09-11: Bootstrap Integration
- **File**: `profileBootstrap.ts`
- **Line**: ~237
- **Function**: `prepareRuntimeForProfile()`
- **Change**: Check for `profileJson` BEFORE `profileName`

### No Changes Required

These files/functions work correctly with the new feature WITHOUT modification:

1. `packages/cli/src/runtime/profileApplication.ts:applyProfileWithGuards()`
   - Receives Profile objects, doesn't care about the source

2. `packages/core/src/types/modelParams.ts`
   - Schema validation works for both file and inline profiles

3. `packages/cli/src/index.ts`
   - Uses `parseBootstrapArgs()` which now handles `--profile`

## Specification Corrections

### Before (Incorrect)

```
Integration Points:
- packages/cli/src/config/profileBootstrap.ts:parseBootstrapArgs()
- packages/cli/src/runtime/prepareRuntime.ts (DOES NOT EXIST)
- packages/cli/src/config/profileBootstrap.ts:bootstrapProviderRuntimeWithProfile() (DOES NOT EXIST)
```

### After (Correct)

```
Integration Points:
- packages/cli/src/config/profileBootstrap.ts:parseBootstrapArgs() [Line ~75]
- packages/cli/src/config/profileBootstrap.ts:prepareRuntimeForProfile() [Line ~237]
- packages/cli/src/runtime/profileApplication.ts:applyProfileWithGuards() (NO CHANGES)
```

## Key Architectural Principles

### 1. Single Responsibility Per File

`profileBootstrap.ts` handles:
- Argument parsing (parseBootstrapArgs)
- Profile source selection (prepareRuntimeForProfile)
- Profile parsing (parseInlineProfile - NEW)

### 2. Separation of Concerns

`profileApplication.ts` handles:
- Provider selection and fallback
- Configuration validation
- Runtime context updates

### 3. Type Safety

All Profile objects flow through the same Zod validation regardless of source.

### 4. Backward Compatibility

Existing `--profile-load` flow is unchanged. New `--profile` flow converges at the same point.

## Testing Strategy

### Unit Tests: `profileBootstrap.test.ts`

Test both functions in the same file:
- `parseBootstrapArgs()` - argument parsing tests
- `prepareRuntimeForProfile()` - profile application tests

### Integration Tests: `cli-args.integration.test.ts`

Test end-to-end CLI invocation with `--profile` flag.

## Summary

The actual codebase architecture is **simpler and more cohesive** than the initial specification suggested:

- **One file** (`profileBootstrap.ts`) handles both argument parsing and profile application
- **No new files** required
- **Minimal changes** to existing logic
- **Natural integration** with existing profile system

This alignment ensures the implementation follows the actual codebase patterns and doesn't introduce unnecessary complexity or architectural mismatches.
