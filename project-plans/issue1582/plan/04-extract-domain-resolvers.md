# Phase 4: Extract Domain Resolvers from loadCliConfig

**Subagent:** `typescriptexpert`
**Prerequisite:** Phase 3 parser extraction passes verification
**Verification:** `npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

## Goal

Extract complex resolution logic from `loadCliConfig` into cohesive domain modules. Each resolver is a **pure function** with typed inputs/outputs, no side effects. After this phase, loadCliConfig shrinks significantly as logic moves into focused modules.

**Critical rule:** No backward compatibility re-exports. DTOs colocate in each module that defines them. When a DTO is shared by 2+ modules, extract to a domain-scoped contract file.

## What To Read First

- `project-plans/issue1582/plan/00-overview.md` — architecture overview, critical ordering guarantees, design principles
- `packages/cli/src/config/config.ts` — focus on loadCliConfig lines 838-1329 (profile resolution, context, approval, provider/model)
- `packages/cli/src/config/profileBootstrap.ts` — already 792 lines, must NOT be extended

## Task 4.1: Create `approvalModeResolver.ts`

**Extract from loadCliConfig lines ~1140-1194:**
```typescript
interface ApprovalModeInput {
  cliApprovalMode: string | undefined;
  cliYolo: boolean | undefined;
  disableYoloMode: boolean | undefined;
  secureModeEnabled: boolean | undefined;
  trustedFolder: boolean;
}

/**
 * Resolves the approval mode from CLI args, settings, and trust status.
 * Throws if YOLO mode is requested but disabled by admin.
 */
function resolveApprovalMode(input: ApprovalModeInput): ApprovalMode
```

Encapsulates:
- `--approval-mode` vs `--yolo` precedence
- Security overrides (`disableYoloMode`, `secureModeEnabled`) that throw on YOLO
- Folder trust override (untrusted → force DEFAULT)
- Warning logging for YOLO mode

## Task 4.2: Create `providerModelResolver.ts`

**Extract from loadCliConfig lines ~1274-1329:**
```typescript
interface ProviderModelInput {
  cliProvider: string | undefined;
  profileProvider: string | undefined;
  envDefaultProvider: string | undefined;        // process.env.LLXPRT_DEFAULT_PROVIDER
  cliModel: string | undefined;
  profileModel: string | undefined;
  settingsModel: string | undefined;
  envDefaultModel: string | undefined;           // process.env.LLXPRT_DEFAULT_MODEL
  envGeminiModel: string | undefined;            // process.env.GEMINI_MODEL
  defaultGeminiModel: string;                    // DEFAULT_GEMINI_MODEL constant
}

interface ProviderModelResult {
  provider: string;
  model: string;
}

/**
 * Resolves provider (4-level precedence) and model (6-level precedence).
 * Provider: CLI --provider > profile > LLXPRT_DEFAULT_PROVIDER env > 'gemini'
 * Model: CLI --model > profile > settings > env vars > alias default > Gemini default
 *
 * The alias defaultModel lookup (lines 1295-1307) is internal to this resolver —
 * it's used as a fallback in the model precedence chain but not exposed in the result.
 */
function resolveProviderAndModel(input: ProviderModelInput): ProviderModelResult
```

## Task 4.3: Create `profileResolution.ts` (pure)

This module handles all **pure** profile resolution logic — no runtime side effects.

**What moves from loadCliConfig:**

1. `prepareProfileForApplication()` (lines 838-890) — currently a nested function:
```typescript
interface ProfilePreparationResult {
  profileProvider: string | undefined;
  profileModel: string | undefined;
  profileModelParams: Record<string, unknown> | undefined;
  profileBaseUrl: string | undefined;
  effectiveSettings: Settings;
}

function prepareProfileForApplication(
  profile: Profile,
  profileSource: string,
  argv: CliArgs,
  baseSettings: Settings,
): ProfilePreparationResult
```

2. Profile resolution chain (lines 928-953):
```typescript
interface ProfileResolutionInput {
  bootstrapArgs: { profileName: string | null; profileJson: string | null };
  settings: Settings;
  cliProvider: string | undefined;
}

interface ProfileResolutionResult {
  profileToLoad: string | undefined;
  profileExplicitlySpecified: boolean;
}

function resolveProfileToLoad(input: ProfileResolutionInput): ProfileResolutionResult
```

3. Profile loading with fallback (lines 892-1014):
```typescript
interface ProfileLoadResult {
  effectiveSettings: Settings;
  profileModel: string | undefined;
  profileProvider: string | undefined;
  profileModelParams: Record<string, unknown> | undefined;
  profileBaseUrl: string | undefined;
  loadedProfile: Profile | null;
  profileWarnings: string[];
}

async function loadAndPrepareProfile(input: {
  bootstrapArgs: { profileName: string | null; profileJson: string | null };
  settings: Settings;
  argv: CliArgs;
  profileToLoad: string | undefined;
  profileExplicitlySpecified: boolean;
}): Promise<ProfileLoadResult>
```

## Task 4.4: Create `profileRuntimeApplication.ts` (impure)

This module is the **sole owner** of profile-to-runtime side effects — calling `applyProfileSnapshot`, creating synthetic profiles, updating provider/model state based on profile application results.

**Ownership boundary:** `postConfigRuntime.ts` (Phase 5) orchestrates the call to `applyProfileToRuntime` (i.e., it calls it in the right order) but does NOT contain any profile-specific logic. All profile application decisions live here.

**Extract from loadCliConfig lines 1576-1667:**
```typescript
interface ProfileRuntimeApplicationInput {
  loadedProfile: Profile | null;
  profileToLoad: string | undefined;
  bootstrapArgs: BootstrapProfileArgs;
  argv: CliArgs;
  finalModel: string;
  finalProvider: string;
  profileWarnings: string[];
}

interface ProfileSnapshotResult {
  providerName: string;
  modelName: string;
  baseUrl: string | undefined;
  warnings: string[];
}

interface ProfileRuntimeApplicationResult {
  appliedResult: ProfileSnapshotResult | null;
  resolvedProviderAfterProfile: string | undefined;
  resolvedModelAfterProfile: string | undefined;
  resolvedBaseUrlAfterProfile: string | undefined;
  resolvedFinalProvider: string;
  profileWarnings: readonly string[];
}

async function applyProfileToRuntime(input: ProfileRuntimeApplicationInput): Promise<ProfileRuntimeApplicationResult>
```

Note: `ProfileSnapshotResult` is our own DTO — we do NOT use `Awaited<ReturnType<typeof applyProfileSnapshot>>` in the contract. The mapping from `applyProfileSnapshot`'s return type to our DTO happens inside this module.

## Task 4.5: Create `interactiveContext.ts`

**Extract from loadCliConfig lines ~1016-1130 and ~1196-1203:**

**Important subtlety:** The current code uses `settings.folderTrust` (original settings) for the folderTrust flag, but `isWorkspaceTrusted(settings)` (also original settings) for trustedFolder. This is NOT the effectiveSettings (profile-merged). This distinction must be preserved.

```typescript
interface ContextResolutionInput {
  argv: CliArgs;
  effectiveSettings: Settings;
  originalSettings: Settings;  // folderTrust and workspace trust use original, not profile-merged
  cwd: string;
  extensions: GeminiCLIExtension[];
  extensionEnablementManager: ExtensionEnablementManager;
}

interface ContextResolutionResult {
  debugMode: boolean;
  memoryImportFormat: 'flat' | 'tree';
  ideMode: boolean;
  folderTrust: boolean;
  trustedFolder: boolean;
  fileService: FileDiscoveryService;
  fileFiltering: FileFilteringOptions;
  memoryFileFiltering: FileFilteringOptions;
  includeDirectories: string[];
  resolvedLoadMemoryFromIncludeDirectories: boolean;
  jitContextEnabled: boolean;
  interactive: boolean;
  allExtensions: AnnotatedExtension[];
  activeExtensions: GeminiCLIExtension[];
  extensionContextFilePaths: string[];
}
```

### REQUIRED sub-function split

The `resolveContextAndEnvironment` function **MUST** be split into the following mandatory sub-functions. This is not optional — the sub-functions are required to keep `resolveContextAndEnvironment` under 80 lines and to maintain clear separation of concerns within context resolution:

```typescript
// MANDATORY sub-functions (each <40 lines):
function resolveTrustAndIdeContext(input: ContextResolutionInput): Pick<ContextResolutionResult, 'debugMode' | 'memoryImportFormat' | 'ideMode' | 'folderTrust' | 'trustedFolder'>
function resolveFiltering(effectiveSettings: Settings): Pick<ContextResolutionResult, 'fileFiltering' | 'memoryFileFiltering'>
function resolveIncludeDirectories(argv: CliArgs, effectiveSettings: Settings): Pick<ContextResolutionResult, 'includeDirectories' | 'resolvedLoadMemoryFromIncludeDirectories'>
function resolveExtensions(extensions: GeminiCLIExtension[], cwd: string, manager: ExtensionEnablementManager): Pick<ContextResolutionResult, 'allExtensions' | 'activeExtensions' | 'extensionContextFilePaths'>
function resolveInteractiveMode(argv: CliArgs): boolean

// Main function orchestrates sub-functions (<80 lines):
function resolveContextAndEnvironment(input: ContextResolutionInput): ContextResolutionResult
```

All five sub-functions above are **mandatory** — the implementer must create all of them. If any sub-function would be trivially small (under ~5 lines), it may be inlined, but the default expectation is that all five exist as named functions. The orchestrator `resolveContextAndEnvironment` calls them in sequence and assembles the result.

**Memory loading (lines 1114-1130):**
The `loadMemoryContent` helper stays in `environmentLoader.ts` (alongside the existing `loadHierarchicalLlxprtMemory` it wraps). It's a thin conditional wrapper (~16 lines) and cohesive with the env/memory loading domain:
```typescript
// In environmentLoader.ts
async function loadMemoryContent(input: {
  jitContextEnabled: boolean;
  cwd: string;
  includeDirectories: readonly string[];
  resolvedLoadMemoryFromIncludeDirectories: boolean;
  debugMode: boolean;
  fileService: FileDiscoveryService;
  effectiveSettings: Settings;
  allExtensions: GeminiCLIExtension[];
  trustedFolder: boolean;
  memoryImportFormat: 'flat' | 'tree';
  memoryFileFiltering: FileFilteringOptions;
}): Promise<{ memoryContent: string; fileCount: number; filePaths: string[] }>
```
The orchestrator in `config.ts` calls `environmentLoader.loadMemoryContent()` after context resolution.

## Task 4.6: Define DTOs (pragmatic approach)

**Strategy:** Each module defines its own input/output DTOs inline (colocated). When a DTO is needed by 2+ modules, extract to a domain-scoped contract file:

- `profileContracts.ts` — `ProfilePreparationResult`, `ProfileSnapshotResult`, `ProfileRuntimeApplicationResult`, etc.
- `configBuildContracts.ts` — `ConfigBuildInput`, `PostConfigInput`, `TelemetryConfigDTO`, etc.

**Do NOT pre-create all contract files.** Create them on-demand during implementation when actual cross-module sharing is needed. Most DTOs should stay colocated in their module.

## Constraints

- No file >800 lines, no function >80 lines
- Pure functions should NOT call `process.env` directly — receive env values as parameters
- Use `readonly` arrays/records in all DTO interfaces
- Each extracted function receives only the fields it needs (minimal function inputs)
- All parity tests from Phase 1 must still pass
- Existing tests must still pass (loadCliConfig still calls inline logic at this point — the orchestrator wiring happens in Phase 6)
