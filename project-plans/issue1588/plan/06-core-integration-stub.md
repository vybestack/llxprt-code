# Phase 06: Core Runtime/Config Implementation

> **Note on phase naming and scope**: This phase is a full core adapter implementation (not a stub). The title "Core Runtime/Config Implementation" reflects the actual scope — replacing P03b adapter stubs with real behavioral implementation AND wiring configConstructor to call the adapter. P03b created a transparent no-op adapter module but did NOT wire configConstructor; P06 wires the production call-site switch from `registerSettingsService()` to `activateSettingsRuntimeContext()`.

## Phase ID

`PLAN-20260608-ISSUE1588.P06`

## Prerequisites

- Required: Phase 05a verified.

## Requirements Implemented (Expanded)

### REQ-SVC-001: Settings Service Instance Management

**Full Text**: Settings service instance APIs must remain usable by runtime code while living in settings package and without importing core runtime context.

**Behavior**:

- GIVEN settings-owned singleton helpers
- WHEN core runtime context activates/clears contexts
- THEN settings package active service follows the runtime context

**Important semantic change**: Current `registerSettingsService()` creates a `ProviderRuntimeContext` when none exists. In the target architecture, settings `registerSettingsService()` only sets the module-level singleton — it does NOT create core objects. Core-owned adapter code bridges context creation. Tests must cover register-before-context and context-activation semantic change (see BVE-06a through BVE-06d in `analysis/behavioral-regression-matrix.md`).

**Why This Matters**: Providers rely on `getSettingsService` during runtime calls.

## Implementation Tasks

### Core-Owned Runtime Context Adapter (NEW)

Create `packages/core/src/runtime/settingsRuntimeAdapter.ts`:

- `activateSettingsRuntimeContext(settingsService, runtimeId?)`: Creates a `ProviderRuntimeContext`, calls `setActiveProviderRuntimeContext()`, and calls `registerSettingsService()` from settings package.
- `deactivateSettingsRuntimeContext()`: Calls `clearActiveProviderRuntimeContext()` and `resetSettingsService()` from settings package.

This adapter replaces the old behavior where `registerSettingsService` could create a `ProviderRuntimeContext`. The only production call site needing this is `configConstructor.ts` (classified as `CONTEXT-ACTIVATE` in `analysis/call-site-migration-matrix.md`).

**Single-owner rule**: `settingsRuntimeAdapter.ts` is the SOLE production file that bridges settings-package singleton functions with core runtime-context functions. No other file — including `providerRuntimeContext.ts` — may call both `registerSettingsService`/`resetSettingsService` AND `setActiveProviderRuntimeContext`/`clearActiveProviderRuntimeContext`. This prevents double-registration bugs where both the adapter AND providerRuntimeContext attempt to sync settings state.

**Lifecycle single-owner clarification**: `settingsRuntimeAdapter.ts` is the sole owner that calls both runtime-context helpers (`setActiveProviderRuntimeContext`/`clearActiveProviderRuntimeContext`) and settings singleton helpers (`registerSettingsService`/`resetSettingsService`). `providerRuntimeContext.ts` stays settings-agnostic — it does NOT import or call any settings-package functions. When runtime context is activated or cleared, `providerRuntimeContext.ts` manages its own context state only; the adapter handles syncing settings state alongside.

### Files to Modify

- `packages/core/src/runtime/providerRuntimeContext.ts` — **DO NOT** add imports of `registerSettingsService` or `resetSettingsService` from settings package. The adapter module (`settingsRuntimeAdapter.ts`) is the sole bridge. providerRuntimeContext must remain settings-agnostic. If any existing code in providerRuntimeContext currently calls settings functions, move those calls into the adapter or into caller code that uses the adapter.
- `packages/core/src/runtime/settingsRuntimeAdapter.ts` — **REPLACE P03b transparent no-op stub with full behavioral implementation**. P03b created this file with transparent no-op stubs. P06 replaces them with real implementation: activation creates `ProviderRuntimeContext`, sets it active, and calls `registerSettingsService(s)`; deactivation clears context and resets.
- `packages/core/src/config/configBaseCore.ts` — import `SettingsService`, `ProfileManager`, `Storage` types from settings package for field types.
- `packages/core/src/config/configConstructor.ts` — **WIRE** the production call-site switch from `registerSettingsService()` to `activateSettingsRuntimeContext()`. P03b did NOT wire this; P06 owns the wiring. This is the only production call site that needs the adapter (classified as `CONTEXT-ACTIVATE` in `analysis/call-site-migration-matrix.md`).
- `packages/core/src/config/configTypes.ts` — update type imports for settings-owned types.
- `packages/core/src/config/subagentManager.ts` — update `ProfileManager` type import to settings package.
- `packages/core/src/config/toolRegistryFactory.ts` — update any `ProfileManager` type references to settings package.
- `packages/core/src/tools/task.ts` — update any `ProfileManager` or profile type imports to settings package.
- `packages/core/src/core/subagentOrchestrator.ts` — update any `ProfileManager` or profile type imports to settings package.
- any core tests needed to compile against settings package

Follow `analysis/pseudocode/settings-service.md` lines 16-29 and `analysis/call-site-migration-matrix.md`.

### Required Adapter Tests

- `TEST-ADAPTER-01`: `activateSettingsRuntimeContext(s)` creates a `ProviderRuntimeContext` AND calls `registerSettingsService(s)`. After call, `getSettingsService()` returns `s`.
- `TEST-ADAPTER-02`: `deactivateSettingsRuntimeContext()` clears the active context AND resets settings state. After call, `getSettingsService()` throws.
- `TEST-ADAPTER-03`: `activateSettingsRuntimeContext(s2)` after `activateSettingsRuntimeContext(s1)` switches active context.
- `TEST-ADAPTER-04`: Settings package `registerSettingsService()` called without adapter does NOT create a `ProviderRuntimeContext`.
- `TEST-ADAPTER-05`: `resetSettingsService()` from settings package does NOT call `clearActiveProviderRuntimeContext()`.

### Adapter Idempotency And Call-Count Tests

- `TEST-ADAPTER-06`: `activateSettingsRuntimeContext(s)` called twice with the same service is idempotent: second call replaces the first context. `registerSettingsService` is called each time (verified by call count).
- `TEST-ADAPTER-07`: `deactivateSettingsRuntimeContext()` called when no context is active does not throw.
- `TEST-ADAPTER-08`: Single owner verification: only `settingsRuntimeAdapter.ts` may call both `registerSettingsService` from settings AND core `setActiveProviderRuntimeContext` in the same function. Other core code must use one or the other, not both (verified by grep scan). **providerRuntimeContext.ts must NOT import settings-package functions** — it must not call `registerSettingsService` or `resetSettingsService`.

### Adapter Permitted Bridge Scan

After P06 implementation, run this **enforcing** scan to verify the single-owner rule. The scan MUST fail (exit nonzero) if any violation is found:

**What it checks**: Only `settingsRuntimeAdapter.ts` may import/call BOTH settings-package singleton lifecycle functions (`registerSettingsService`, `resetSettingsService`) AND core runtime-context activation functions (`setActiveProviderRuntimeContext`, `clearActiveProviderRuntimeContext`, `createProviderRuntimeContext`) in the same production file. Ordinary settings reads — importing `SettingsService` type, calling `getSettingsService()` for reading — are ALLOWED in any consumer. Only bridging register/reset WITH context creation/clearing is restricted to the adapter.

**Explicit decision**: `providerRuntimeContext.ts` MUST NOT import, construct, or reference `SettingsService` from the settings package. It is agnostic of settings entirely. The sole bridge between settings and runtime context is `settingsRuntimeAdapter.ts`. This rule is enforced by a separate scan that checks for both settings singleton function names AND `SettingsService` type/import references.

```bash
# Enforcing single-owner bridge scan (deterministic Node.js script)
# Exits 1 on violation, 0 on success.
# Logic:
# 1. Grep for production .ts files in packages/core/src that import registerSettingsService or resetSettingsService
#    (excluding settingsRuntimeAdapter.ts and test files)
# 2. For each match, check if it also contains setActiveProviderRuntimeContext, clearActiveProviderRuntimeContext,
#    or createProviderRuntimeContext
# 3. Any file matching both conditions is a single-owner violation
# 4. Separately verify providerRuntimeContext.ts does NOT import settings singleton functions

node -e "
  const { execSync } = require('child_process');
  try {
    // Step 1: Find production files importing register/reset (excluding adapter + tests)
    let singletonFiles;
    try {
      singletonFiles = execSync(
        'grep -rl \"registerSettingsService|resetSettingsService\" packages/core/src --include=\"*.ts\" | grep -v settingsRuntimeAdapter | grep -v .test. | grep -v __tests__',
        { encoding: 'utf8' }
      ).trim();
    } catch (e) {
      // grep returns non-zero when no matches — that is OK (no violations possible)
      console.log('OK: no production files import register/reset outside adapter');
      process.exit(0);
    }

    if (!singletonFiles) {
      console.log('OK: no production files import register/reset outside adapter');
      process.exit(0);
    }

    const files = singletonFiles.split(String.fromCharCode(10)).filter(Boolean);
    const violations = [];
    for (const f of files) {
      try {
        const content = execSync('cat \"' + f + '\"', { encoding: 'utf8' });
        if (content.includes('setActiveProviderRuntimeContext') || content.includes('clearActiveProviderRuntimeContext') || content.includes('createProviderRuntimeContext')) {
          violations.push(f);
        }
      } catch {}
    }
    if (violations.length > 0) {
      console.error('FAIL: single-owner violation — these files bridge both settings singleton AND runtime context:');
      violations.forEach(v => console.error('  ' + v));
      console.error('Only settingsRuntimeAdapter.ts may bridge both.');
      process.exit(1);
    }
    console.log('OK: no single-owner violations. Files importing register/reset but not bridging context:', files.join(', '));
  } catch (e) {
    console.log('OK: no production files import register/reset outside adapter');
    process.exit(0);
  }
"

# Enforcing check: providerRuntimeContext.ts must NOT import or reference SettingsService or settings singleton functions
# Exits 1 if settings imports/references are found, 0 if settings-agnostic
SETTINGS_FN_RESULTS=$(rg -n "SettingsService|registerSettingsService|resetSettingsService|getSettingsService|from ['"]@vybestack/llxprt-code-settings" packages/core/src/runtime/providerRuntimeContext.ts 2>/dev/null || true)
test -z "$SETTINGS_FN_RESULTS" && echo "OK: providerRuntimeContext is settings-agnostic" || { echo "FAIL: providerRuntimeContext imports/references settings functions"; echo "$SETTINGS_FN_RESULTS"; exit 1; }
```

Expected: enforcing scan exits 0; only `settingsRuntimeAdapter.ts` bridges both settings and runtime context; `providerRuntimeContext.ts` has zero settings singleton function references.

### LLXPRT_CONFIG_DIR / MemoryTool Coupling Resolution

`packages/core/src/config/storage.ts` defines its own `LLXPRT_DIR = '.llxprt'` constant (line 12), while `packages/core/src/tools/memoryTool.ts` defines `LLXPRT_CONFIG_DIR = '.llxprt'` (line 83). Currently `configBaseCore.ts` imports `LLXPRT_CONFIG_DIR` from `memoryTool.ts`. This coupling must be resolved so settings does not import core/tools.

**Resolution**: When Storage moves to settings in P05, its `LLXPRT_DIR` constant moves with it. In P06, `configBaseCore.ts` replaces the import from `memoryTool.ts` with a local constant. Tests must prove both resolve to the same value.

**P06 implementation task**:
- `packages/core/src/config/configBaseCore.ts`: Remove the import of `LLXPRT_CONFIG_DIR` from `memoryTool.ts` and define `const LLXPRT_DIR = '.llxprt'` locally. This eliminates the `configBaseCore → memoryTool` dependency chain.
- No import from settings for this constant — both packages own their own literal.

**Required test**: `packages/core/src/config/config.test.ts` must assert `config.getLlxprtDir()` returns `path.join(targetDir, '.llxprt')` using the core-local constant. Settings `Storage.test.ts` must assert `Storage.getGlobalLlxprtDir()` returns `path.join(os.homedir(), '.llxprt')` using the settings-owned constant. A dedicated cross-package consistency test in settings proves `LLXPRT_DIR === '.llxprt'` without importing core/tools.

### LLXPRT_DIR Constant Identity Test

Verify that both settings-owned and core-owned `LLXPRT_DIR` constants resolve to `.llxprt` without cross-package imports:

```bash
# Settings test proves LLXPRT_DIR equals '.llxprt' without importing core/tools
rg -n "LLXPRT_DIR" packages/settings/src/storage/Storage.ts
rg -n "LLXPRT_CONFIG_DIR|LLXPRT_DIR" packages/core/src/config/configBaseCore.ts
# Verify configBaseCore NO LONGER imports from memoryTool for LLXPRT_CONFIG_DIR
rg -n "from.*memoryTool" packages/core/src/config/configBaseCore.ts && echo "FAIL: configBaseCore still imports memoryTool" || echo "OK: configBaseCore uses local LLXPRT_DIR"
# Verify settings Storage does NOT import from core/tools
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-tools" packages/settings/src/storage/Storage.ts && echo "FAIL: Storage imports from core/tools" || echo "OK: Storage uses own LLXPRT_DIR"
```

## Verification Commands

```bash
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code-core -- --run src/runtime src/config
# Rerun P04b core integration test as pass gate (provider/CLI vertical-slice tests deferred to P07)
npm run test --workspace @vybestack/llxprt-code-core -- --run src/__tests__/settings-integration
# LLXPRT_DIR constant identity verification
rg -n "from.*memoryTool" packages/core/src/config/configBaseCore.ts && echo "FAIL: configBaseCore still imports memoryTool" || echo "OK: configBaseCore uses local LLXPRT_DIR"
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-tools" packages/settings/src/storage/Storage.ts && echo "FAIL: Storage imports from core/tools" || echo "OK: Storage uses own LLXPRT_DIR"
```

Expected: core compiles with settings package integration. Runtime context tests prove settings isolation. Adapter tests pass. P04b core integration test that previously failed against stubs now passes with settings implementation + core adapter.

## Semantic Verification Checklist

- [ ] Core imports settings package, not moved core-local files.
- [ ] Runtime context activation calls `registerSettingsService(context.settingsService)` from settings.
- [ ] Runtime context clearing calls `resetSettingsService()` from settings.
- [ ] No code in settings package creates core `ProviderRuntimeContext`.
- [ ] `registerSettingsService` called without context stores service in settings-package state only.
- [ ] `configConstructor.ts` uses `activateSettingsRuntimeContext()` instead of direct `registerSettingsService()`.
- [ ] `settingsRuntimeAdapter.ts` exists and provides both activate/deactivate helpers.
- [ ] Runtime isolation tests exercise two settings services and prove no stale cross-context reads.
- [ ] Register-before-context test passes.
- [ ] Context-activation-updates-settings test passes.
- [ ] Reset-settings-state-only test passes (settings `resetSettingsService()` does NOT clear runtime context).
- [ ] Adapter idempotency: `activateSettingsRuntimeContext` called twice is idempotent.
- [ ] Double-deactivation: `deactivateSettingsRuntimeContext` when no context active does not throw.
- [ ] Single-owner scan: only `settingsRuntimeAdapter.ts` bridges both settings and runtime context calls.
- [ ] `providerRuntimeContext.ts` does NOT import or call settings-package singleton functions (`registerSettingsService`, `resetSettingsService`, `getSettingsService`) or import/reference `SettingsService` from the settings package — it stays settings-agnostic.
- [ ] `configBaseCore.ts` does NOT import `LLXPRT_CONFIG_DIR` from `memoryTool.ts` (uses local `LLXPRT_DIR = '.llxprt'` constant instead).
- [ ] Settings `Storage.ts` uses its own `LLXPRT_DIR` constant (does NOT import from core/tools).
- [ ] Test proves `Storage.getGlobalLlxprtDir()` returns `path.join(os.homedir(), '.llxprt')` using settings-owned constant only.
- [ ] Test proves `config.getLlxprtDir()` returns `path.join(targetDir, '.llxprt')` using core-local constant.
- [ ] Adapter permitted bridge scan passes: no production file (excluding test files and the adapter itself) bridges both settings singleton and runtime context.

## Success Criteria

Core is wired to settings package enough for consumer migration. Core-owned adapter correctly bridges settings lifecycle with runtime context lifecycle.

## Failure Recovery

Return to P06 after correcting integration contract.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P06.md`.
