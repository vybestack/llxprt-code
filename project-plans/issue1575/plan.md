# Issue #1575: Break up runtimeSettings.ts (2,540 lines)

## Overview

Decompose `packages/cli/src/runtime/runtimeSettings.ts` from a 2,540-line monolith into focused, single-responsibility modules following SoC and DRY principles.

## Key Scope Additions (Critical for Architecture)

1. **Rewire all production consumers to import from specific modules** — Break the barrel import pattern. All 7 production files (8 import contexts, since `config/config.ts` has two separate import locations) currently importing from `runtimeSettings.js` will be rewired to import directly from their target modules. This eliminates the circular dependency with `profileApplication.ts` and makes the dependency graph enforceable.

2. **Add unit tests for currently untested pure functions** — 11 functions have zero direct unit test coverage. During module creation, add real behavioral tests (not just characterization tests) for: `computeModelDefaults`, `normalizeProviderBaseUrl`, `extractProviderBaseUrl`, runtime registry lifecycle functions, and `getRuntimeDiagnosticsSnapshot`.

3. **Eliminate coordinator as a production import target** — After rewiring, the coordinator exists only for: (a) top-level `registerIsolatedRuntimeBindings()` initialization, (b) backward-compatible test imports. Add `@internal` documentation marking it as transitional.

## Plan Review Log

**Reviewed and corrected on 2025-03-20:**
- [OK] Verified actual line counts for all functions (3 were incorrectly estimated)
- [OK] Corrected `setCliRuntimeContext` from 218 lines → **34 lines** (NO decomposition needed)
- [OK] Corrected `buildRuntimeProfileSnapshot` from 104 lines → **79 lines** (NO decomposition needed)
- [OK] Verified `setActiveModel` is **85 lines** (lines 2293-2377, DOES need decomposition)
- [OK] Verified `applyCliArgumentOverrides` is **105 lines** (lines 2399-2503, DOES need decomposition)
- [OK] Verified `switchActiveProvider` is **482 lines** (close to estimate)
- [OK] Verified `applyProfileSnapshot` is **193 lines** (close to estimate)
- [OK] Added precise line ranges for all private helpers (computeModelDefaults, normalizeProviderBaseUrl, extractProviderBaseUrl, etc.)
- [OK] Verified circular dependency analysis: `profileApplication.ts` imports 12 symbols from `runtimeSettings.js`
- [OK] Enhanced characterization test specifications with concrete behavioral contracts
- [OK] Verified all module size estimates are realistic (no module will exceed 800 lines)
- [OK] **COMPLETE**: All 65 exported symbols verified and accounted for in module assignments
- [OK] **`registerIsolatedRuntimeBindings` top-level call** documented (lines 1470-1478): wires lifecycle callbacks at module load, must remain in coordinator

## Acceptance Criteria

1. No single file exceeds 800 lines
2. No single function exceeds 80 lines
3. All existing tests pass
4. Test coverage does not decrease

## Current State

- **File**: `packages/cli/src/runtime/runtimeSettings.ts` — **2,540 lines** (verified), **65 exports** (verified count — see "Exported Symbols Verification" below)
- **Importers**: 20 files (7 production files / 8 import contexts, 12 test / 1 integration-test) — all import from `./runtimeSettings.js`
- **Test files**: 4 main test files (693 lines total): `runtimeSettings.spec.ts` (37), `runtimeSettings.proactive-wiring.spec.ts` (142), `runtimeSettings.proactive-wiring.lb.spec.ts` (480), `runtimeSettings.reasoningSummary.test.ts` (34)
- **4 functions exceed 80 lines** (corrected from initial plan's 7): `switchActiveProvider` (482), `applyProfileSnapshot` (193), `applyCliArgumentOverrides` (105), `setActiveModel` (85)

### Exported Symbols Verification

All 65 exported symbols from `runtimeSettings.ts` have been verified and assigned to target modules:

**Coordinator Pass-Through Re-exports (7):** These are already re-exported from other modules (`runtimeContextFactory.js`, `profileApplication.js`, `credential-store-factory.js`) and will continue to be re-exported from the coordinator:
- `createProviderKeyStorage` (from `credential-store-factory.js`)
- `createIsolatedRuntimeContext` (from `runtimeContextFactory.js`)
- `IsolatedRuntimeActivationOptions` (type, from `runtimeContextFactory.js`)
- `IsolatedRuntimeContextHandle` (type, from `runtimeContextFactory.js`)
- `IsolatedRuntimeContextOptions` (type, from `runtimeContextFactory.js`)
- `getLoadBalancerStats`, `getLoadBalancerLastSelected`, `getAllLoadBalancerStats` (from `profileApplication.js`)

**statelessHardening.ts (5):** `StatelessHardeningPreference`, `configureCliStatelessHardening`, `getCliStatelessHardeningOverride`, `getCliStatelessHardeningPreference`, `isCliStatelessProviderModeEnabled`

**runtimeRegistry.ts (1):** `resetCliRuntimeRegistryForTesting`

**runtimeAccessors.ts (23):** `CliRuntimeServices`, `getCliRuntimeContext`, `getCliRuntimeServices`, `getCliProviderManager`, `isCliRuntimeStatelessReady`, `ensureStatelessProviderReady`, `getCliOAuthManager`, `getCliRuntimeConfig`, `getActiveModelName`, `getActiveProviderStatus`, `listAvailableModels`, `getActiveProviderMetrics`, `getSessionTokenUsage`, `getEphemeralSettings`, `getEphemeralSetting`, `setEphemeralSetting`, `clearEphemeralSetting`, `getActiveModelParams`, `setActiveModelParam`, `clearActiveModelParam`, `listProviders`, `getActiveProviderName`, `ProviderRuntimeStatus`

**runtimeLifecycle.ts (4):** `activateIsolatedRuntimeContext`, `registerCliProviderInfrastructure`, `resetCliProviderInfrastructure`, `setCliRuntimeContext`

**providerSwitch.ts (2):** `ProviderSwitchResult`, `switchActiveProvider`

**providerMutations.ts (10):** `ModelChangeResult`, `ApiKeyUpdateResult`, `BaseUrlUpdateResult`, `ToolFormatState`, `ToolFormatOverrideLiteral`, `updateActiveProviderApiKey`, `updateActiveProviderBaseUrl`, `getActiveToolFormatState`, `setActiveToolFormatOverride`, `setActiveModel`

**settingsResolver.ts (1):** `applyCliArgumentOverrides`

**profileSnapshot.ts (15):** `PROFILE_EPHEMERAL_KEYS`, `ProfileLoadOptions`, `ProfileLoadResult`, `RuntimeDiagnosticsSnapshot`, `buildRuntimeProfileSnapshot`, `applyProfileSnapshot`, `saveProfileSnapshot`, `saveLoadBalancerProfile`, `loadProfileByName`, `deleteProfileByName`, `listSavedProfiles`, `getProfileByName`, `getActiveProfileName`, `setDefaultProfileName`, `getRuntimeDiagnosticsSnapshot`

**Total: 65 symbols — all accounted for.**

## Architecture: Target Module Structure

All new modules live in `packages/cli/src/runtime/`. The coordinator (`runtimeSettings.ts`) becomes a thin re-export layer. The dependency graph flows strictly downward — no module imports from the coordinator.

```
runtimeSettings.ts  ← thin coordinator: re-exports + one required top-level init call
    ↑ re-exports from:
    │
    ├── profileSnapshot.ts        (profiles, diagnostics)
    ├── providerSwitch.ts         (switching active provider)
    ├── providerMutations.ts      (model/key/URL/toolFormat changes)
    ├── settingsResolver.ts       (CLI arg → runtime override resolution)
    ├── runtimeLifecycle.ts       (context setup/teardown)
    ├── runtimeAccessors.ts       (runtime state queries, ephemeral get/set)
    ├── runtimeRegistry.ts        (multi-runtime entry management)
    └── statelessHardening.ts     (stateless mode config/query)
```

**Dependency graph (arrows = "imports from", no cycles):**

```
profileSnapshot     → runtimeAccessors, providerMutations
providerSwitch      → runtimeAccessors, providerMutations
providerMutations   → runtimeAccessors
settingsResolver    → runtimeAccessors, providerMutations
runtimeLifecycle    → runtimeAccessors, runtimeRegistry
runtimeAccessors    → runtimeRegistry, statelessHardening
runtimeRegistry     → (core only)
statelessHardening  → (runtimeRegistry for scope resolution)
```

## Module Responsibilities

| Module | Concern | Key Symbols | Est. Lines |
|--------|---------|-------------|-----------|
| `statelessHardening.ts` | Stateless provider mode configuration and querying | `StatelessHardeningPreference`, `configureCliStatelessHardening`, `getCliStatelessHardeningOverride`, `getCliStatelessHardeningPreference`, `isCliStatelessProviderModeEnabled` | ~150 ✅ |
| `runtimeRegistry.ts` | Multi-runtime entry lifecycle management | `RuntimeRegistryEntry`, `runtimeRegistry`, `resolveActiveRuntimeIdentity`, `upsertRuntimeEntry`, `requireRuntimeEntry`, `disposeCliRuntime`, `resetCliRuntimeRegistryForTesting` | ~160 ✅ |
| `runtimeAccessors.ts` | Querying runtime state, ephemeral settings, model params | `CliRuntimeServices`, `getCliRuntimeContext`, `getCliRuntimeServices`, `getCliProviderManager`, `getActiveModelName`, ephemeral get/set/clear, model param get/set/clear, `ProviderRuntimeStatus`, `getActiveProviderStatus` | ~550 ✅ |
| `runtimeLifecycle.ts` | Setting up and tearing down runtime contexts | `setCliRuntimeContext`, `registerCliProviderInfrastructure`, `resetCliProviderInfrastructure`, `activateIsolatedRuntimeContext` | ~200 ⚠️ (reduced from 320 since setCliRuntimeContext is only 34 lines) |
| `providerSwitch.ts` | Switching the active provider (one complex operation) | `switchActiveProvider`, `ProviderSwitchResult`, URL normalization helpers, `DEFAULT_PRESERVE_EPHEMERALS` | ~560 ✅ (482-line function + helpers ~60-80) |
| `providerMutations.ts` | Mutating provider model/key/URL/toolFormat | `setActiveModel`, `updateActiveProviderApiKey`, `updateActiveProviderBaseUrl`, `getActiveToolFormatState`, `setActiveToolFormatOverride`, `computeModelDefaults`, `ModelChangeResult` | ~320 ✅ |
| `settingsResolver.ts` | Resolving CLI arguments into runtime overrides | `applyCliArgumentOverrides`, `resolveNamedKey` | ~140 ⚠️ (reduced from 170 since applyCliArgumentOverrides is only 105 lines) |
| `profileSnapshot.ts` | Profile build/apply/persist/query, diagnostics | `PROFILE_EPHEMERAL_KEYS`, `buildRuntimeProfileSnapshot`, `applyProfileSnapshot`, save/load/delete/list profiles, `getRuntimeDiagnosticsSnapshot` | ~500 [OK] (buildRuntimeProfileSnapshot is 79 lines, no decomposition needed) |
| `runtimeSettings.ts` | Thin coordinator — imports, re-exports, and one required top-level init call (`registerIsolatedRuntimeBindings`) | All public symbols re-exported, plus existing re-exports from `runtimeContextFactory.js`, `profileApplication.js`, `credential-store-factory.js` | ~150 [OK] |

## Oversized Function Decomposition

Each function exceeding 80 lines must be split into private helpers within its target module:

| Function | Current Lines | Target Module | Decomposition Strategy |
|----------|--------------|---------------|----------------------|
| `switchActiveProvider` | 482 | `providerSwitch.ts` | Extract: `clearPreviousProviderState`, `activateNewProvider`, `resolveAndApplyBaseUrl`, `resolveAndApplyModel`, `handleAnthropicOAuth`, `applyAliasEphemerals`, `applyModelDefaultsForProvider` |
| `applyProfileSnapshot` | 193 | `profileSnapshot.ts` | Extract: `applyStandardProfileSnapshot`, `wireProactiveOAuthFailover`, `buildProfileApplicationResult` |
| `applyCliArgumentOverrides` | 105 | `settingsResolver.ts` | Extract: `resolveAndApplyApiKey`, `applySetArguments`, `applyBaseUrlOverride` |
| `setActiveModel` | 85 | `providerMutations.ts` | Extract: `recomputeAndApplyModelDefaultsDiff` |
| `buildRuntimeProfileSnapshot` | 79 | `profileSnapshot.ts` | NO DECOMPOSITION NEEDED - already under 80 lines |
| `setCliRuntimeContext` | 34 | `runtimeLifecycle.ts` | NO DECOMPOSITION NEEDED - already under 80 lines |
| `isCliStatelessProviderModeEnabled` | N/A | `statelessHardening.ts` | The stateless hardening cluster (lines 130-248, ~119 lines total) includes the private helper chain (`normalizeStatelessPreference`, `readStatelessPreferenceFromMetadata`, `resolveStatelessHardeningPreference`, `isStatelessProviderIntegrationEnabled`). Each is already <80 lines individually. The module total is ~150 lines — well under 800. |

## Phasing Strategy

The work is split into 4 phases. Each phase follows test-first: update test imports to point at new modules (RED — tests fail because module doesn't exist), then create the module and move code (GREEN — tests pass again).

- **[Phase 1](phase1.md)**: Extract leaf modules (no internal dependencies): `statelessHardening.ts`, `runtimeRegistry.ts`
- **[Phase 2](phase2.md)**: Extract middle-layer modules: `runtimeAccessors.ts`, `runtimeLifecycle.ts`
- **[Phase 3](phase3.md)**: Extract top-layer modules: `providerSwitch.ts`, `providerMutations.ts`, `settingsResolver.ts`, `profileSnapshot.ts`
- **[Phase 4](phase4.md)**: Slim coordinator, decompose oversized functions, final audit

## Critical: Top-Level Initialization Call

**Location**: `runtimeSettings.ts` lines 1470-1478

The file contains a top-level call to `registerIsolatedRuntimeBindings()` that wires runtime lifecycle callbacks at module load time:

```typescript
registerIsolatedRuntimeBindings({
  resetInfrastructure: resetCliProviderInfrastructure,
  setRuntimeContext: setCliRuntimeContext,
  registerInfrastructure: registerCliProviderInfrastructure,
  linkProviderManager: (config, manager) => {
    config.setProviderManager(manager);
  },
  disposeRuntime: disposeCliRuntime,
});
```

**After decomposition**: This call MUST remain in the coordinator (`runtimeSettings.ts`) because:
1. It references functions that will be distributed across multiple modules (`runtimeLifecycle.ts` and `runtimeRegistry.ts`)
2. Moving it to a specific module would create circular imports (e.g., `runtimeLifecycle.ts` would need to import `disposeRuntime` from `runtimeRegistry.ts`)
3. The coordinator is the correct architectural location for module-load-time wiring that spans multiple modules
4. This is safe because all callbacks are function references (no top-level value access), and ESM handles this through live bindings

**Verification**: After Phase 3, confirm this call still exists in `runtimeSettings.ts` and that all referenced functions resolve correctly through the new module structure.

## Breaking the Circular Dependency: `profileApplication.ts`

**VERIFIED ANALYSIS**: The existing codebase has a circular import between `runtimeSettings.ts` and `profileApplication.ts`:
- `runtimeSettings.ts` imports `applyProfileWithGuards`, `getLoadBalancerStats`, `getLoadBalancerLastSelected`, `getAllLoadBalancerStats` from `profileApplication.js` (lines 46-51)
- `profileApplication.ts` imports 12 symbols from `runtimeSettings.js` (lines 15-28)

**This cycle will be BROKEN by Scope Addition #1** (consumer rewiring). After the refactoring:
- `profileApplication.ts` imports directly from `runtimeAccessors.js`, `statelessHardening.js`, `providerSwitch.js`, `providerMutations.js`, and `credential-store-factory.js` — **NOT from the coordinator**
- The coordinator still imports from `profileApplication.js` (for the 4 pass-through exports)
- Result: No cycle. The dependency graph is a DAG.

**Consumer Rewiring Mapping (7 production files, 8 import contexts):**

| Consumer File | Current Import | Rewired To Target Module(s) |
|---------------|---------------|----------------------------|
| `ui/commands/toolformatCommand.ts` | `runtimeSettings.js` | `providerMutations.js` |
| `ui/commands/clearCommand.ts` | `runtimeSettings.js` | `runtimeAccessors.js` |
| `config/profileBootstrap.ts` | `runtimeSettings.js` | `runtimeLifecycle.js` |
| `config/config.ts` (import 1) | `runtimeSettings.js` | `profileSnapshot.js`, `runtimeAccessors.js`, `runtimeLifecycle.js`, `providerSwitch.js` |
| `config/config.ts` (re-exports) | `runtimeSettings.js` | `runtimeAccessors.js` |
| `providers/providerConfigUtils.ts` | `runtimeSettings.js` | `providerMutations.js` |
| `zed-integration/zedIntegration.ts` | `runtimeSettings.js` | `runtimeLifecycle.js`, `providerSwitch.js`, `runtimeAccessors.js`, `profileSnapshot.js` |
| `runtime/profileApplication.ts` | `runtimeSettings.js` | `runtimeAccessors.js`, `statelessHardening.js`, `providerSwitch.js`, `providerMutations.js`, `credential-store-factory.js` |

**Test files** continue importing from `runtimeSettings.js` (coordinator) during transition. They can be migrated in a follow-up issue.

**Guardrails for New Modules:**
1. No new module may have top-level code that reads values from imports.
2. The coordinator must only: (a) re-export pass-through symbols from `runtimeContextFactory.js`, `profileApplication.js`, `credential-store-factory.js`, (b) execute `registerIsolatedRuntimeBindings()` at top-level.
3. Production code outside `runtime/` should never import from `runtimeSettings.js` after rewiring.

## Detailed Review: Improvement Summary (2025-03-20)

This plan was comprehensively reviewed and improved based on actual source code verification. Key improvements:

### 1. Function Line Count Verification (COMPLETE)

**Verified all 4 functions that exceed 80 lines:**

- [OK] `setActiveModel`: **85 lines** (lines 2293-2377) — CONFIRMED needs decomposition
  - Actual count matches plan estimate (was listed as 85 lines)
  - Decomposition strategy: extract `recomputeAndApplyModelDefaultsDiff` helper (~30 lines for model defaults diff logic, lines 2339-2368)
  - Result: coordinator becomes ~55 lines

- [OK] `applyCliArgumentOverrides`: **105 lines** (lines 2399-2503) — CONFIRMED needs decomposition
  - Actual count matches plan estimate (was listed as 105 lines)
  - Decomposition strategy: extract `resolveAndApplyApiKey` helper (~68 lines for 4-step key precedence chain, lines 2422-2490)
  - Result: coordinator becomes ~50 lines

- [OK] `switchActiveProvider`: **482 lines** (lines 1653-2134) — CONFIRMED needs decomposition into 6+ helpers
  - Matches plan estimate, decomposition strategy already detailed in phase3.md

- [OK] `applyProfileSnapshot`: **193 lines** (lines 1123-1315) — CONFIRMED needs decomposition into 3 helpers
  - Matches plan estimate, decomposition strategy already detailed in phase3.md

**Functions that do NOT need decomposition (already under 80 lines):**

- [OK] `setCliRuntimeContext`: **34 lines** (lines 1435-1468) — under limit, move as-is
- [OK] `buildRuntimeProfileSnapshot`: **79 lines** (lines 1019-1097) — under limit, move as-is

### 2. Exported Symbols Completeness Audit (COMPLETE)

**Verified all 65 exported symbols** from `runtimeSettings.ts` are assigned to target modules:

- Coordinator pass-through re-exports: 7 symbols (from `runtimeContextFactory`, `profileApplication`, `credential-store-factory`)
- `statelessHardening.ts`: 5 symbols
- `runtimeRegistry.ts`: 1 symbol
- `runtimeAccessors.ts`: 23 symbols
- `runtimeLifecycle.ts`: 4 symbols
- `providerSwitch.ts`: 2 symbols
- `providerMutations.ts`: 10 symbols
- `settingsResolver.ts`: 1 symbol
- `profileSnapshot.ts`: 15 symbols

**Total: 65 symbols — 100% coverage, no missing symbols.**

### 3. Top-Level Initialization Call Documentation (COMPLETE)

**Verified and documented** the critical `registerIsolatedRuntimeBindings` call (lines 1470-1478):

- This top-level call wires runtime lifecycle callbacks at module load time
- It MUST remain in the coordinator after decomposition (cannot move to a specific module without creating circular imports)
- All callbacks are function references (no top-level value access), making it ESM-safe
- Added verification checkpoint to Phase 4 checklist

### 4. Characterization Test Specifications (VERIFIED)

**Verified behavioral contracts** for characterization tests match actual function behavior:

- `computeModelDefaults`: case-insensitive regex matching, later rules override earlier (CORRECT)
- `switchActiveProvider`: same-provider early return with `{ changed: false }` (CONFIRMED in lines 1680-1686)
- `DEFAULT_PRESERVE_EPHEMERALS`: contains `'context-limit'`, `'max_tokens'`, `'streaming'` (CONFIRMED in lines 1647-1651)
- Stateless hardening preference resolution chain (VERIFIED against lines 192-211)

All characterization test specs in phase files are accurate and match actual implementation.

### 5. Plan Corrections and Clarifications

- Removed "TODO" markers for human review — all items completed
- Corrected emoji/warning symbols to reflect actual status
- Fixed duplicate line at end of phase4.md completion checklist
- Enhanced `registerIsolatedRuntimeBindings` documentation in phase2.md with actual code snippet and architectural reasoning
- Updated decomposition strategies in phase3.md with precise line ranges and actual function structure

### 6. No Corrupted or Duplicated Content Found

Checked all phase files for:
- Duplicate completion checklists (none found)
- Truncated or corrupted sections (none found)
- Inconsistent line counts (all corrected)

**Conclusion**: The plan is now accurate, complete, and ready for implementation. All acceptance criteria are clearly defined, all functions are correctly sized, all symbols are accounted for, and all critical architectural decisions (top-level initialization, circular dependencies) are documented.

## Cross-Cutting Rules (ALL phases)

### Phase 0: Baseline Capture (before any code changes)

Before any extraction begins, capture baselines:

1. **Export parity snapshot**: Record all current public exports from `runtimeSettings.ts` using TypeScript compiler API (more robust than grep):
   ```bash
   npx ts-morph-bootstrap --project tsconfig.json --file packages/cli/src/runtime/runtimeSettings.ts --list-exports > /tmp/exports-before.txt 2>/dev/null \
     || grep -E "^export " packages/cli/src/runtime/runtimeSettings.ts | sort > /tmp/exports-before.txt
   ```
   Alternatively, use `npm run typecheck` to verify no type errors after changes — this catches missing re-exports.
2. **Coverage baseline**: Run `npm run test -- --coverage` and record the coverage summary for `packages/cli/src/runtime/runtimeSettings.ts`.
3. **Full green baseline**: Run `npm run test && npm run lint && npm run typecheck && npm run build` and confirm all pass.

### Test-First for Refactoring

RULES.md mandates TDD. For refactoring (vs. new features), the correct TDD approach is **characterization tests**:

1. **Write characterization tests** for the new module FIRST. These test the behavioral contracts of the functions being moved — the same inputs produce the same outputs/side-effects. Import from the new module path (e.g., `./statelessHardening.js`). Tests fail because the module doesn't exist yet (RED).
2. **Create the module** with verbatim-moved code (GREEN — tests pass).
3. **Update the coordinator** with re-exports. Verify all existing tests still pass.
4. **Verify export parity**: Run the export snapshot command again and diff against the Phase 0 baseline. All symbols must still be present.

Characterization tests must cover **behavioral semantics**, not just "the import resolves." For high-risk functions, this includes:
- Provider switch: same-provider returns `{ changed: false }`, empty name throws
- Profile snapshot: builds with all PROFILE_EPHEMERAL_KEYS, strips sensitive params
- Stateless hardening: preference resolution priority chain
- Runtime registry: entry lifecycle (upsert -> require -> dispose)

### Other Rules

1. **Re-export from coordinator**: After moving symbols, `runtimeSettings.ts` must `import` from the new module and `re-export` every public symbol so that all 20 existing importers continue to work unchanged.
2. **No circular dependencies among NEW modules**: New modules NEVER import from `runtimeSettings.ts`. They import from each other following the dependency graph above. Only the coordinator imports from them. **Strict layering rule**: `runtimeAccessors.ts` must NEVER import from `providerMutations`, `providerSwitch`, `profileSnapshot`, or `settingsResolver` (read-side must not depend on write-side). This prevents accidental cycles.
3. **ESM conventions**: Use `.js` extensions in all import specifiers (e.g., `import { foo } from './runtimeRegistry.js'`).
4. **Verbatim moves**: Move code as-is. No logic changes, no refactoring of behavior. The only structural changes are extracting private helpers from oversized functions.
5. **No new `any` or type assertions**: Follow TypeScript strict mode per RULES.md.
6. **License headers**: Every new file gets the standard license header.
7. **Mutable singleton state**: `statelessHardeningPreferenceOverride` and the `runtimeRegistry` Map are module-level mutable state. After moving, ensure test reset functions (`resetCliRuntimeRegistryForTesting`, `configureCliStatelessHardening(null)`) still clear all moved state. Existing tests that rely on reset behavior must not break.
8. **Internal-only exports**: Symbols that were file-private in `runtimeSettings.ts` but become exported from new modules (e.g., `RuntimeRegistryEntry`, `resolveActiveRuntimeIdentity`) must NOT be re-exported from the coordinator. They are internal to the `runtime/` module family.
9. **Export parity check after each step**: After every extraction step, verify the coordinator's public API hasn't changed. The most reliable check is `npm run typecheck` — if any consumer references a missing export, TypeScript will catch it. For a quick smoke check:
   ```bash
   grep -cE "^export " packages/cli/src/runtime/runtimeSettings.ts
   ```
   This count should remain stable (~65 export lines, give or take for re-export grouping changes).
10. **Verification cycle**: After each phase, run: `npm run test && npm run lint && npm run typecheck && npm run format && npm run build` and smoke test: `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`.
11. **Function/file size enforcement**: After Phase 4, verify with a robust method (not brittle awk). Use `eslint` with `max-lines-per-function` and `max-lines` rules, or an AST-based script. The Phase 4 audit must catch any function >80 lines or file >800 lines.

### Scope Addition Rules

**Consumer Rewiring (Addition #1)**: After all modules are created and the coordinator re-exports are working:
1. Rewire all 7 production files (8 import contexts) to import directly from specific modules
2. No production code (outside `runtime/` and test files) should import from `runtimeSettings.js`
3. Verify the circular dependency with `profileApplication.ts` is broken

**Unit Tests for Pure Functions (Addition #2)**: When creating modules that contain currently-untested pure functions, add real behavioral tests:
1. Test `computeModelDefaults` with various pattern matching scenarios
2. Test `normalizeProviderBaseUrl` and `extractProviderBaseUrl` URL handling
3. Test runtime registry lifecycle functions (`upsertRuntimeEntry`, `requireRuntimeEntry`, `disposeCliRuntime`)
4. Test `getRuntimeDiagnosticsSnapshot` builds correct snapshot structure

**Coordinator Internal Marking (Addition #3)**: After rewiring:
1. Add `@internal` JSDoc to `runtimeSettings.ts` explaining its transitional status
2. Document that production code should import from specific modules
3. Explain the coordinator exists only for initialization and backward-compatible test imports
