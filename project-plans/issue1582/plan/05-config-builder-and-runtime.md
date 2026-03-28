# Phase 5: Extract Config Builder + Post-Config Runtime

**Subagent:** `typescriptexpert`
**Prerequisite:** Phase 4 domain resolver extraction passes verification
**Verification:** `npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

## Goal

Extract Config object construction and all post-Config side effects into focused modules. After this phase, all the logic has been extracted from loadCliConfig and exists in dedicated modules. Phase 6 then wires it together.

**Critical rule:** No backward compatibility re-exports. Mandatory sub-splitting for any function >80 lines.

## What To Read First

- `project-plans/issue1582/plan/00-overview.md` — architecture overview, critical ordering guarantees (steps 9-17)
- `packages/cli/src/config/config.ts` — focus on loadCliConfig lines 1379-1910 (Config construction and post-Config side effects)
- Changes from Phase 4 (the new resolver modules)

## Task 5.1: Create `configBuilder.ts`

**Extract from loadCliConfig lines ~1379-1534.**

The Config constructor call is ~155 lines. This MUST be split into mandatory sub-builders:

```typescript
interface ConfigBuildInput {
  sessionId: string;
  cwd: string;
  argv: CliArgs;
  effectiveSettings: Settings;
  context: ContextResolutionResult;
  approvalMode: ApprovalMode;
  providerModel: ProviderModelResult;
  sandboxConfig: SandboxConfigResult;
  mcpResult: McpFilterResult;
  excludeTools: string[];
  memoryResult: MemoryResult;
  policyEngineConfig: PolicyEngineConfigResult;
  question: string;
  screenReader: boolean;
  useRipgrepSetting: boolean;
  mcpEnabled: boolean;
  extensionsEnabled: boolean;
  adminSkillsEnabled: boolean;
  outputFormat: OutputFormat;
}

// Mandatory sub-builders (each <40 lines):
function buildTelemetryConfig(argv: CliArgs, settings: Settings): TelemetryConfigDTO
function buildSanitizationConfig(settings: Settings): SanitizationConfigDTO
function buildHooksConfig(settings: Settings, adminSkillsEnabled: boolean, cwd: string): HooksConfigDTO

// Main builder orchestrates sub-builders (<80 lines):
function buildConfig(input: ConfigBuildInput): Config
```

## Task 5.2: Create `postConfigRuntime.ts`

**This is a new module that handles ALL post-Config side effects. Extracts from loadCliConfig lines ~1536-1909.**

**Ownership rule:** This module orchestrates side effects in order. It calls `profileRuntimeApplication.applyProfileToRuntime()` for profile-specific logic (step 4) but does NOT duplicate or re-implement any profile resolution logic. Profile decisions are owned by `profileResolution.ts` (pure) and `profileRuntimeApplication.ts` (impure). This module just sequences calls.

MUST be split into mandatory sub-functions (each <80 lines):

```typescript
interface PostConfigInput {
  config: Config;
  runtimeState: BootstrapRuntimeState;
  bootstrapArgs: BootstrapProfileArgs;
  argv: CliArgs;
  effectiveSettings: Settings;
  profileLoadResult: ProfileLoadResult;
  providerModelResult: ProviderModelResult;
  toolGovernanceResult: ToolGovernanceResult;
  defaultDisabledTools: string[];
  runtimeOverrides: { settingsService?: SettingsService };
}

// Mandatory sub-functions:

/**
 * Steps 1-3: Set disabled hooks, set runtime context, re-register provider infra.
 * Canonical steps 10-11: Set runtime context, re-register provider infra.
 * Note: registerCliProviderInfrastructure is called here AGAIN (conditionally,
 * via dynamic import) after runtime context is set. The first registration
 * happened inside prepareRuntimeForProfile() during bootstrap (canonical step 2).
 * This dual-registration is intentional and must be preserved.
 */
async function setupRuntimeContext(input: PostConfigInput): Promise<void>

/** Canonical steps 12-13: Apply profile snapshot, switch active provider */
async function activateProviderAndProfile(input: PostConfigInput): Promise<void>

/** Canonical step 14: Reapply CLI model override + CLI arg overrides after provider switch */
async function reapplyCliOverrides(input: PostConfigInput): Promise<void>

/** Canonical step 15: Apply tool governance policy (ephemeral settings for allowed/excluded tools) */
function applyToolPolicies(input: PostConfigInput): void

/** Canonical step 16: Apply emojifilter, profile ephemeral settings, CLI /set args, disabled hooks */
function applyEphemeralSettings(input: PostConfigInput): void

/** Canonical step 17: Seed default disabled tools + store profile model params + bootstrap args + log warnings */
function finalizeMetadata(input: PostConfigInput): void

/**
 * Orchestrates all post-Config side effects in correct order.
 * Maps to overview steps 10-17 of the canonical 17-step ordering:
 *
 * Step 10: setCliRuntimeContext()
 * Step 11: registerCliProviderInfrastructure() — re-registration, conditional, dynamic import
 * Step 12: applyProfileToRuntime() — snapshot application
 * Step 13: switchActiveProvider()
 * Step 14: reapplyCliOverrides() — CLI args win after provider switch clears ephemerals
 * Step 15: applyToolGovernance() — tool policy (ephemeral settings for allowed/excluded tools)
 * Step 16: applyEphemeralSettings() — emojifilter, profile ephemerals, CLI /set args, disabled hooks
 * Step 17: finalizeMetadata() — seed default disabled tools, store model params, store bootstrap args, log warnings
 */
async function finalizeConfig(input: PostConfigInput): Promise<Config>
```

`finalizeConfig` itself is just a thin orchestrator calling the sub-functions in order (<30 lines).

This consolidates ALL the scattered mutation logic that currently lives in the tail end of `loadCliConfig` into one clearly documented, ordered module.

**Critical: Preserve dynamic import semantics.** Two dynamic imports in the loadCliConfig tail (`import('../runtime/runtimeSettings.js')`) use lazy loading intentionally. Preserve this pattern in `postConfigRuntime.ts`.

## Constraints

- No file >800 lines, no function >80 lines
- `postConfigRuntime.ts` target: ~280 lines with 6 sub-functions + orchestrator
- `configBuilder.ts` target: ~200 lines with 3 sub-builders + orchestrator
- All parity tests from Phase 1 must still pass
- Existing tests must still pass
- At this point, loadCliConfig still contains the original logic — it just also has the extracted modules available as siblings. The actual orchestrator wiring is Phase 6.
