# Complete Profile Loading Flow Analysis

## Executive Summary

This document traces the complete profile loading flow through the codebase, identifying all integration points where the new `--profile` flag needs to hook in.

## Profile Loading Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. CLI Entry Point                                               │
│    File: packages/cli/index.ts                                   │
│    Function: main()                                              │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. Main Application Start                                        │
│    File: packages/cli/src/gemini.tsx                            │
│    Function: main() [Line 295]                                  │
│    - Creates .llxprt directory                                   │
│    - Loads settings from workspace                               │
│    - Parses command-line arguments                               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. Argument Parsing                                              │
│    File: packages/cli/src/config/config.ts                      │
│    Function: parseArguments() [Line 148]                        │
│    - Uses yargs to parse CLI arguments                           │
│    - Defines --profile-load flag [Line 474]                      │
│    WARNING:  INTEGRATION POINT: Add --profile flag here                │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. Bootstrap Args Parsing (Early Phase)                         │
│    File: packages/cli/src/config/profileBootstrap.ts            │
│    Function: parseBootstrapArgs() [Line 75]                     │
│    - Parses raw argv[] before yargs                              │
│    - Extracts --profile-load, --provider, --model, etc.          │
│    - Creates BootstrapProfileArgs structure                      │
│    WARNING:  INTEGRATION POINT: Add --profile parsing here             │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. Config Loading                                                │
│    File: packages/cli/src/config/config.ts                      │
│    Function: loadCliConfig() [Line 605]                         │
│    - Calls parseBootstrapArgs()                                  │
│    - Calls prepareRuntimeForProfile()                            │
│    - Loads profile if --profile-load specified                   │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. Runtime Preparation                                           │
│    File: packages/cli/src/config/profileBootstrap.ts            │
│    Function: prepareRuntimeForProfile() [Line 237]              │
│    - Initializes SettingsService                                 │
│    - Creates ProviderManager                                     │
│    - Registers CLI infrastructure                                │
│    - Returns BootstrapRuntimeState                               │
│    WARNING:  INTEGRATION POINT: May need profileJson support          │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 7. Profile Loading Decision (in loadCliConfig)                  │
│    File: packages/cli/src/config/config.ts [Line 645-680]      │
│    - Checks if profileToLoad is set (from --profile-load)       │
│    - Normalizes profile name                                     │
│    WARNING:  INTEGRATION POINT: Check profileJson first before file   │
└─────────────────────────────────────────────────────────────────┘
                            ↓
        ┌─────────────────┴─────────────────┐
        ↓                                     ↓
┌──────────────────────┐          ┌──────────────────────┐
│ 8a. File-Based Path  │          │ 8b. Inline JSON Path │
│ (Current)            │          │ (New --profile flag) │
└──────────────────────┘          └──────────────────────┘
        ↓                                     ↓
┌──────────────────────┐          ┌──────────────────────┐
│ ProfileManager       │          │ Direct Parse         │
│ .loadProfile()       │          │ JSON.parse()         │
│ [Line 52]            │          │                      │
└──────────────────────┘          └──────────────────────┘
        ↓                                     ↓
        └─────────────────┬─────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ 9. Profile Application                                           │
│    File: packages/cli/src/config/config.ts [Line 1141]         │
│    Function: applyProfileSnapshot()                             │
│    - Both paths converge here                                    │
│    - Profile object (from file OR JSON) applied to runtime       │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 10. Runtime Application                                          │
│     File: packages/cli/src/runtime/runtimeSettings.ts           │
│     Function: applyProfileSnapshot() [Line 1020]                │
│     - Calls applyProfileWithGuards()                             │
│     - Sets current profile name in SettingsService               │
│     - Returns ProfileLoadResult                                  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 11. Post-Config Profile Reapplication (if needed)               │
│     File: packages/cli/src/gemini.tsx [Line 395-421]           │
│     - After provider manager is fully initialized                │
│     - Checks LLXPRT_BOOTSTRAP_PROFILE env var                   │
│     - Calls loadProfileByName() if needed                        │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 12. Profile Loading Helper                                      │
│     File: packages/cli/src/runtime/runtimeSettings.ts           │
│     Function: loadProfileByName() [Line 1058]                   │
│     - Uses ProfileManager to load from disk                      │
│     - Calls applyProfileSnapshot()                               │
│     WARNING:  NOTE: This is the post-init reapplication path          │
└─────────────────────────────────────────────────────────────────┘
```

## Integration Points for --profile Flag

### WARNING: CRITICAL: Integration Point 1 - Argument Definition
**File:** `packages/cli/src/config/config.ts`  
**Location:** Line ~474 (after `--profile-load` option)  
**What:** Add yargs option definition for `--profile`

```typescript
.option('profile', {
  type: 'string',
  description: 'Load profile configuration from inline JSON string',
})
```

### WARNING: CRITICAL: Integration Point 2 - Bootstrap Parsing
**File:** `packages/cli/src/config/profileBootstrap.ts`  
**Location:** Line ~75 in `parseBootstrapArgs()`  
**What:** Parse `--profile` from raw argv[] and add to BootstrapProfileArgs

**Current structure:**
```typescript
export interface BootstrapProfileArgs {
  profileName: string | null;
  providerOverride: string | null;
  modelOverride: string | null;
  keyOverride: string | null;
  keyfileOverride: string | null;
  baseurlOverride: string | null;
  setOverrides: string[] | null;
}
```

**Needs:**
```typescript
export interface BootstrapProfileArgs {
  profileName: string | null;
  profileJson: string | null;  // ⬅ ADD THIS
  providerOverride: string | null;
  // ... rest unchanged
}
```

### WARNING: CRITICAL: Integration Point 3 - Profile Source Selection
**File:** `packages/cli/src/config/config.ts`  
**Location:** Line ~645-680 in `loadCliConfig()`  
**What:** Check `profileJson` before loading from file

**Current logic:**
```typescript
const profileToLoad = normaliseProfileName(
  argv.profileLoad ?? process.env.LLXPRT_BOOTSTRAP_PROFILE,
);

if (profileToLoad) {
  const profile = await manager.loadProfile(profileToLoad);
  // ... apply profile
}
```

**Needs to become:**
```typescript
// Priority: inline JSON > file-based > none
if (bootstrapArgs.profileJson) {
  // Parse inline JSON and apply
  const profile = JSON.parse(bootstrapArgs.profileJson);
  // ... validate and apply profile
} else if (profileToLoad) {
  // Load from file (existing path)
  const profile = await manager.loadProfile(profileToLoad);
  // ... apply profile
}
```

### WARNING: INTEGRATION POINT 4 - Type Definitions
**File:** `packages/cli/src/config/config.ts` (CliArgs interface)  
**Location:** Near other CLI arg type definitions  
**What:** Add `profile?: string` to CliArgs type

### WARNING: INTEGRATION POINT 5 - Post-Init Reapplication
**File:** `packages/cli/src/gemini.tsx`  
**Location:** Line ~395-421  
**What:** Handle inline JSON in post-initialization profile reapplication

**Current code:**
```typescript
const bootstrapProfileName =
  argv.profileLoad?.trim() ||
  (typeof process.env.LLXPRT_BOOTSTRAP_PROFILE === 'string'
    ? process.env.LLXPRT_BOOTSTRAP_PROFILE.trim()
    : '');

if (bootstrapProfileName !== '') {
  await loadProfileByName(bootstrapProfileName);
}
```

**NOTE:** This may need to skip reapplication if inline JSON was used, since it was already applied during bootstrap.

## Data Flow Summary

### Current Flow (--profile-load)
1. `--profile-load myprofile` → yargs parsing
2. `parseBootstrapArgs()` extracts profile name
3. `loadCliConfig()` checks profileName
4. `ProfileManager.loadProfile()` reads `~/.llxprt/profiles/myprofile.json`
5. `applyProfileSnapshot()` applies to runtime

### New Flow (--profile)
1. `--profile '{"provider":"openai"...}'` → yargs parsing
2. `parseBootstrapArgs()` extracts JSON string
3. `loadCliConfig()` checks profileJson FIRST
4. `JSON.parse()` directly (skip ProfileManager)
5. `applyProfileSnapshot()` applies to runtime

## Files Requiring Modification

| File | Function | Line | Change Required |
|------|----------|------|-----------------|
| `packages/cli/src/config/config.ts` | `parseArguments()` | ~474 | Add `.option('profile', ...)` |
| `packages/cli/src/config/config.ts` | CliArgs interface | TBD | Add `profile?: string` |
| `packages/cli/src/config/profileBootstrap.ts` | BootstrapProfileArgs | ~18 | Add `profileJson: string \| null` |
| `packages/cli/src/config/profileBootstrap.ts` | `parseBootstrapArgs()` | ~75-200 | Parse `--profile` flag |
| `packages/cli/src/config/config.ts` | `loadCliConfig()` | ~645-680 | Check profileJson before profileName |
| `packages/cli/src/gemini.tsx` | `main()` | ~395-421 | Handle inline JSON in post-init (if needed) |

## Test Coverage Requirements

Based on the specification, these integration points need test coverage:

1. **Unit Tests** (`packages/cli/src/config/__tests__/profileBootstrap.test.ts`)
   - `parseBootstrapArgs()` with `--profile` flag
   - Invalid JSON handling
   - Priority: profileJson > profileName

2. **Integration Tests** (`packages/cli/src/runtime/__tests__/profileApplication.test.ts`)
   - Complete flow from CLI arg to runtime application
   - Verify profile applied correctly
   - Verify settings service updated

3. **E2E Tests** (scripts/start.js usage)
   - Actual CLI invocation with `--profile` flag
   - Verify provider/model configured correctly

## Security Considerations

All integration points must validate:
1. JSON parsing errors → graceful failure
2. Missing required fields → validation error
3. Invalid provider/model → clear error message
4. No file system access for inline JSON

## Missing from Specification

The current specification does NOT account for:

1. **Post-initialization reapplication** (gemini.tsx:395-421)
   - Need to clarify if inline JSON should be reapplied
   - Current code would fail since loadProfileByName expects file

2. **LLXPRT_BOOTSTRAP_PROFILE environment variable**
   - Should inline JSON be supported via env var?
   - Current spec only mentions CLI flag

3. **Error message clarity**
   - Where should JSON parse errors be caught/displayed?
   - User experience for malformed JSON

## Recommendations

1. [OK] Add explicit handling in gemini.tsx for inline JSON during post-init
2. [OK] Document that LLXPRT_BOOTSTRAP_PROFILE does NOT support inline JSON (file names only)
3. [OK] Add JSON validation error handling at parse time (not just in applyProfileSnapshot)
4. [OK] Consider adding `--profile-validate` flag to test JSON without applying

## Conclusion

The specification correctly identifies the main integration points in:
- `parseBootstrapArgs()` - argument extraction
- `loadCliConfig()` - profile source selection
- Yargs option definition

However, it **MISSES** the post-initialization reapplication flow in gemini.tsx which may need explicit handling to avoid attempting to load inline JSON as a file name.

**Action Required:** Update specification to account for gemini.tsx:395-421 integration point.
