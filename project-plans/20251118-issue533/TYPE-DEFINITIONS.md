# Type Definitions for Issue #533 Implementation

**Last Updated**: 2025-11-19  
**Status**: BLOCKER RESOLVED

## Overview

This document clarifies the **actual type definitions** in the codebase for implementing the `--profile` flag. The original plan assumed `ProfileApplicationResult` didn't exist, but it DOES exist in TWO locations with slightly different structures.

---

## ProfileApplicationResult (Primary/Full Version)

**Location**: `/packages/cli/src/runtime/profileApplication.ts` (lines 35-45)

```typescript
export interface ProfileApplicationResult {
  providerName: string;          // Provider identifier (e.g., "openai", "anthropic")
  modelName: string;             // Model identifier (e.g., "gpt-4", "claude-sonnet-4")
  infoMessages: string[];        // Informational messages during application
  warnings: string[];            // Warning messages (non-fatal issues)
  providerChanged: boolean;      // Whether provider was switched
  authType?: AuthType;           // Authentication method used
  didFallback: boolean;          // Whether fallback provider was used
  requestedProvider: string | null;  // Originally requested provider
  baseUrl?: string;              // Custom API endpoint (if specified)
}
```

**Usage**: Returned by `applyProfileToRuntime()` in `profileApplication.ts`

---

## ProfileApplicationResult (Simplified Version)

**Location**: `/packages/cli/src/config/profileBootstrap.ts` (lines 47-52)

```typescript
export interface ProfileApplicationResult {
  providerName: string;
  modelName: string;
  baseUrl?: string;
  warnings: string[];
}
```

**Usage**: Used within `BootstrapResult` for the bootstrap process. This is a **minimal subset** of the full version containing only essential fields.

---

## BootstrapResult

**Location**: `/packages/cli/src/config/profileBootstrap.ts` (lines 54-60)

```typescript
export interface BootstrapResult {
  runtime: ProviderRuntimeContext;
  providerManager: ProviderManager;
  oauthManager?: OAuthManager;
  bootstrapArgs: BootstrapProfileArgs;
  profile: ProfileApplicationResult;  // Uses simplified version above
}
```

**Usage**: Returned by `bootstrapProfile()` - the top-level bootstrap function

---

## BootstrapProfileArgs (To Be Extended)

**Location**: `/packages/cli/src/config/profileBootstrap.ts` (lines 17-24)

**Current Structure**:
```typescript
export interface BootstrapProfileArgs {
  profileName: string | null;      // From --profile-load flag
  providerOverride: string | null;
  modelOverride: string | null;
  keyOverride: string | null;
  keyfileOverride: string | null;
  baseurlOverride: string | null;
  setOverrides: string[] | null;
}
```

**Required Change for Issue #533**:
```typescript
export interface BootstrapProfileArgs {
  profileName: string | null;      // From --profile-load flag
  profileJson: string | null;      // NEW: From --profile flag
  providerOverride: string | null;
  modelOverride: string | null;
  keyOverride: string | null;
  keyfileOverride: string | null;
  baseurlOverride: string | null;
  setOverrides: string[] | null;
}
```

---

## ParsedBootstrapArgs

**Location**: `/packages/cli/src/config/profileBootstrap.ts` (lines 35-39)

```typescript
export interface ParsedBootstrapArgs {
  bootstrapArgs: BootstrapProfileArgs;
  runtimeMetadata: RuntimeBootstrapMetadata;
}
```

**Usage**: Returned by `parseBootstrapArgs()` function

---

## Implementation Guidelines

### For parseInlineProfile() Function

The new `parseInlineProfile()` function should return the **simplified** `ProfileApplicationResult`:

```typescript
function parseInlineProfile(jsonString: string): ProfileApplicationResult {
  // ... parsing and validation logic ...
  
  return {
    providerName: validatedProfile.provider,  // Note: field name is providerName
    modelName: validatedProfile.model,        // Note: field name is modelName
    baseUrl: validatedProfile.baseUrl,
    warnings: []
  };
}
```

**Key Points**:
- [OK] Use `providerName` (NOT `provider`)
- [OK] Use `modelName` (NOT `model`)
- [OK] Return simplified version matching `profileBootstrap.ts:47-52`
- [OK] Matches the pattern used by existing profile loading code

### For Type References in Tests

When writing tests that check the `BootstrapResult.profile` field:

```typescript
// Correct type expectations
expect(result.profile.providerName).toBe('openai');  // [OK]
expect(result.profile.modelName).toBe('gpt-4');      // [OK]

// WRONG - these fields don't exist in simplified version
expect(result.profile.infoMessages).toBeDefined();    // [ERROR]
expect(result.profile.providerChanged).toBe(false);  // [ERROR]
```

---

## Related Functions

### parseBootstrapArgs()

**Location**: `/packages/cli/src/config/profileBootstrap.ts` (line 75)

```typescript
export function parseBootstrapArgs(): ParsedBootstrapArgs
```

**Changes Required**: Add parsing logic for `--profile` flag to extract `profileJson` field

### bootstrapProfile()

**Location**: `/packages/cli/src/config/profileBootstrap.ts` (line 214)

```typescript
export async function bootstrapProfile(...): Promise<BootstrapResult>
```

**Changes Required**: Add conditional logic to call `parseInlineProfile()` when `bootstrapArgs.profileJson` is present

---

## Resolution of Original Blockers

### BLOCKER #1: Type Safety in Phase P07
**Status**: [OK] RESOLVED

The plan's reference to `ProfileApplicationResult` as the return type for `parseInlineProfile()` is **CORRECT**. The type exists and is properly defined in the codebase.

### BLOCKER #2: Missing ProfileApplicationResult Type
**Status**: [OK] RESOLVED

`ProfileApplicationResult` EXISTS at two locations:
1. Full version in `profileApplication.ts` (10 fields)
2. Simplified version in `profileBootstrap.ts` (4 fields)

The simplified version should be used for `parseInlineProfile()` return type.

---

## Common Pitfalls to Avoid

1. [ERROR] **Using `provider` instead of `providerName`**
   - The JSON input will have `"provider": "openai"`
   - But the result type uses `providerName: string`
   
2. [ERROR] **Using `model` instead of `modelName`**
   - The JSON input will have `"model": "gpt-4"`
   - But the result type uses `modelName: string`

3. [ERROR] **Trying to set fields that don't exist in simplified version**
   - Don't set `infoMessages`, `providerChanged`, `didFallback`, etc.
   - These only exist in the FULL version from `profileApplication.ts`

4. [ERROR] **Confusing the two ProfileApplicationResult versions**
   - Use simplified version for `parseInlineProfile()` return
   - Full version is only for `applyProfileToRuntime()` internal use

---

## Next Steps

With these type definitions clarified:

1. [OK] Proceed with Phase P06 (profile parsing stub) using correct types
2. [OK] Update all test expectations to use `providerName` and `modelName`
3. [OK] Implement `parseInlineProfile()` returning simplified `ProfileApplicationResult`
4. [OK] Extend `BootstrapProfileArgs` to include `profileJson: string | null`

**Implementation can now proceed without type-related blockers.**
