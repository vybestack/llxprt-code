# Actual Function Reference for Issue #533

**Created**: 2025-11-19  
**Purpose**: Document the ACTUAL functions that exist in the codebase (vs. incorrect references in the original plan)

---

## Critical Corrections

### [ERROR] DOES NOT EXIST
- `bootstrapProviderRuntimeWithProfile()` - **THIS FUNCTION DOES NOT EXIST**

### [OK] ACTUAL FUNCTIONS

## 1. Argument Parsing

**File**: `packages/cli/src/config/profileBootstrap.ts`  
**Line**: 75  
**Function**:
```typescript
export function parseBootstrapArgs(): ParsedBootstrapArgs
```

**Returns**:
```typescript
interface ParsedBootstrapArgs {
  bootstrapArgs: BootstrapProfileArgs;
  runtimeMetadata: RuntimeBootstrapMetadata;
}
```

**Current Fields in BootstrapProfileArgs**:
```typescript
export interface BootstrapProfileArgs {
  profileName: string | null;       // From --profile-load
  providerOverride: string | null;  // From --provider
  modelOverride: string | null;     // From --model
  keyOverride: string | null;       // From --key
  keyfileOverride: string | null;   // From --keyfile
  baseurlOverride: string | null;   // From --baseurl
  setOverrides: string[] | null;    // From --set
}
```

**Required Change**: Add `profileJson: string | null;` field to `BootstrapProfileArgs`

---

## 2. Runtime Preparation

**File**: `packages/cli/src/config/profileBootstrap.ts`  
**Line**: 237  
**Function**:
```typescript
export async function prepareRuntimeForProfile(
  parsed: ParsedBootstrapArgs,
): Promise<BootstrapRuntimeState>
```

**Returns**:
```typescript
interface BootstrapRuntimeState {
  runtime: ProviderRuntimeContext;
  providerManager: ProviderManager;
  oauthManager: OAuthManager | null;
}
```

**Current Behavior**:
- Creates `SettingsService` instance
- Initializes `ProviderRuntimeContext`
- Creates provider manager via `createProviderManager()`
- Registers CLI provider infrastructure

**Required Changes**:
- Will need to handle `profileJson` from `ParsedBootstrapArgs`
- Should call `applyProfileWithGuards()` when `profileJson` is present

---

## 3. Profile Application

**File**: `packages/cli/src/runtime/profileApplication.ts`  
**Line**: 110  
**Function**:
```typescript
export async function applyProfileWithGuards(
  profileInput: Profile,
  _options: ProfileApplicationOptions = {},
): Promise<ProfileApplicationResult>
```

**Parameters**:
```typescript
interface Profile {
  provider: string | null;
  model: string;
  key?: string;
  baseUrl?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  // ... other ModelParams fields
}

interface ProfileApplicationOptions {
  profileName?: string;
}
```

**Returns**:
```typescript
interface ProfileApplicationResult {
  providerName: string;
  modelName: string;
  infoMessages: string[];
  warnings: string[];
  providerChanged: boolean;
  modelChanged: boolean;
  paramsChanged: boolean;
  modelParamsApplied: Record<string, unknown>;
}
```

**Current Behavior**:
- Validates provider exists in available providers
- Switches provider if needed via `switchActiveProvider()`
- Sets model via `setActiveModel()`
- Applies model parameters via `setActiveModelParam()`
- Updates API key/baseUrl if provided
- Returns detailed result with change tracking

---

## 4. Helper Functions

### Provider Selection

**File**: `packages/cli/src/runtime/profileApplication.ts`  
**Line**: 65  
**Function**:
```typescript
export function selectAvailableProvider(
  requested: string | null | undefined,
  available: string[],
): ProviderSelectionResult
```

### Bootstrap Result Creation

**File**: `packages/cli/src/config/profileBootstrap.ts`  
**Line**: 289  
**Function**:
```typescript
export function createBootstrapResult(input: {
  runtime: ProviderRuntimeContext;
  providerManager: ProviderManager;
  oauthManager: OAuthManager | null;
  profileResult?: ProfileApplicationResult;
  bootstrapArgs: BootstrapProfileArgs;
}): BootstrapResult
```

---

## 5. Integration Point

**File**: `packages/cli/src/config/config.ts`  
**Line**: 632  
**Usage**:
```typescript
const runtimeState = await prepareRuntimeForProfile(parsedWithOverrides);
```

**Context**:
- Called from main CLI configuration setup
- Result is used for provider initialization
- Profile loading happens AFTER this call in current implementation
- CLI overrides (--provider, --model, etc.) are applied AFTER profile

---

## Implementation Strategy

### Phase Flow

1. **parseBootstrapArgs()** - Add `profileJson` field
   - Check for `--profile` flag
   - Parse and validate JSON structure
   - Store in `BootstrapProfileArgs.profileJson`

2. **prepareRuntimeForProfile()** - Handle inline profiles
   - Check if `profileJson` is present
   - If yes, parse JSON into `Profile` object
   - Call `applyProfileWithGuards()` with parsed profile
   - Store result in `BootstrapRuntimeState`

3. **Integration in config.ts** - No changes needed
   - Existing call to `prepareRuntimeForProfile()` works as-is
   - Profile already applied when runtime state returns
   - CLI overrides still work via existing logic

### Data Flow

```
CLI Args
  ↓
parseBootstrapArgs()
  ↓ (ParsedBootstrapArgs with profileJson)
prepareRuntimeForProfile()
  ↓ (detects profileJson)
applyProfileWithGuards()
  ↓ (ProfileApplicationResult)
BootstrapRuntimeState
  ↓
config.ts (existing integration)
```

### Key Differences from Original Plan

| Original Plan | Actual Codebase |
|---------------|-----------------|
| `bootstrapProviderRuntimeWithProfile()` | `prepareRuntimeForProfile()` |
| Single monolithic function | Separated concerns (prepare vs. apply) |
| Profile parsing inline | Uses `applyProfileWithGuards()` |
| Direct profile application | Provider validation + stateless runtime |

---

## Required Changes Summary

### 1. Type Extension (BootstrapProfileArgs)
```typescript
// Add to existing interface
export interface BootstrapProfileArgs {
  // ... existing fields ...
  profileJson: string | null;  // NEW: from --profile flag
}
```

### 2. Argument Parsing (parseBootstrapArgs)
```typescript
// Add to parseBootstrapArgs() around line 100
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  
  // ... existing argument handling ...
  
  if (arg === '--profile') {
    if (i + 1 >= argv.length) {
      throw new Error('--profile requires a JSON string argument');
    }
    bootstrapArgs.profileJson = argv[++i];
  }
}

// Add mutual exclusivity check
if (bootstrapArgs.profileJson && bootstrapArgs.profileName) {
  throw new Error('Cannot use both --profile and --profile-load');
}
```

### 3. Profile Application (prepareRuntimeForProfile)
```typescript
// Add after line 260 (after runtime setup, before return)
if (parsed.bootstrapArgs.profileJson) {
  const profile = JSON.parse(parsed.bootstrapArgs.profileJson);
  // Validate schema using existing Zod validators
  const profileResult = await applyProfileWithGuards(profile);
  // Store result for later use
}
```

---

## Files Actually Modified

1. `/packages/cli/src/config/profileBootstrap.ts`
   - Line ~30: Add `profileJson` to `BootstrapProfileArgs` interface
   - Line ~100: Parse `--profile` argument in `parseBootstrapArgs()`
   - Line ~260: Handle inline profile in `prepareRuntimeForProfile()`

2. `/packages/cli/src/runtime/profileApplication.ts`
   - No changes needed (existing `applyProfileWithGuards()` handles everything)

3. `/packages/cli/src/config/config.ts`
   - No changes needed (existing call to `prepareRuntimeForProfile()` at line 632)

---

## Testing Strategy

### Unit Tests Target

1. **parseBootstrapArgs()** tests:
   - Parsing `--profile` flag
   - JSON validation
   - Mutual exclusivity with `--profile-load`

2. **prepareRuntimeForProfile()** tests:
   - Inline profile application
   - Integration with `applyProfileWithGuards()`
   - Result propagation

3. **applyProfileWithGuards()** tests:
   - Already exists for file-based profiles
   - Verify same behavior for inline profiles

### Integration Tests

- End-to-end CLI invocation with `--profile '{...}'`
- Override precedence (inline profile vs. CLI flags)
- Error handling (malformed JSON, invalid providers)

---

## References

- Issue #533: https://github.com/vybestack/llxprt-code/issues/533
- Original Plan: `project-plans/20251118-issue533/PLAN.md`
- Plan Review: `project-plans/20251118-issue533/PLAN-REVIEW.md`
- Specification: `project-plans/20251118-issue533/specification.md`
