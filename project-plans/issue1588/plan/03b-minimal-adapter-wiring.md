# Phase 03b: Minimal Compile-Only Adapter Module

## Phase ID

`PLAN-20260608-ISSUE1588.P03b`

## Purpose

Create the minimal core-owned adapter module and type-only settings package references that P04b vertical-slice integration tests require to compile and exercise real import paths. P03b does **not** wire production configConstructor to call the adapter — that production call-site switch is deferred to P06 after settings implementation exists.

This resolves the P04b/P06 sequencing contradiction safely: P04b integration tests exercise the adapter module directly (not through globally-used production config paths), and P06 applies the production call-site change only after the adapter has real behavioral implementation.

**Key change from prior plan**: P03b no longer wires `configConstructor.ts` to call `activateSettingsRuntimeContext()`. Wiring a throwing stub into globally-used production config construction risks breaking unrelated tests and violates the "no reverse testing / no NotYetImplemented testing" rule from PLAN.md. The production call-site switch from `registerSettingsService()` to `activateSettingsRuntimeContext()` is a P06 task.

This phase creates **compile-only** adapter stubs — enough for P04b to import and call the adapter module in isolated tests, not enough for full behavioral correctness. Full implementation and production wiring belong in P06.

## Prerequisites

- Required: Phase 03a verified (decoupling stubs compile).
- Settings package scaffold exists with type/contract stubs (P03).
- Core runtime context and config type stubs compile.

## Requirements Implemented (Expanded)

### REQ-SVC-001: Settings Service Instance Management (Compile-Level)

**Full Text**: Core-owned adapter module exists for import-level integration tests. Production configConstructor wiring is deferred to P06.

**Behavior**:

- GIVEN P03 stubs only
- WHEN P03b adapter module is created
- THEN core → settings import paths exist for P04b integration tests to target, and production config construction is not broken

**Why This Matters**: P04b integration tests need the adapter module to exist so they can import and call it directly. But wiring a throwing stub into `configConstructor.ts` would break all existing config construction tests. Deferring the production wiring to P06 is safe because P04b tests exercise the adapter directly, not through configConstructor.

## Implementation Tasks

### Adapter: `settingsRuntimeAdapter.ts`

Create `packages/core/src/runtime/settingsRuntimeAdapter.ts` with compile-only stub implementations:

```typescript
// Compile-only adapter for P04b integration tests
// Full behavioral implementation and production wiring deferred to P06
// P04b tests exercise this module directly, not through configConstructor

import type { SettingsService } from '@vybestack/llxprt-code-settings';

/**
 * Activate a runtime context with the given settings service.
 * P03b stub: logs a console warning and returns without creating context.
 * P06 replaces this with full behavioral implementation and wires configConstructor to call it.
 */
export function activateSettingsRuntimeContext(settingsService: SettingsService, runtimeId?: string): void {
  // P03b compile-only stub: transparent no-op that does not throw.
  // This allows existing config construction and other production code to continue working.
  // P06 replaces this with: create context, set active, register settings service.
  console.warn('[settingsRuntimeAdapter] activateSettingsRuntimeContext called before full implementation (P06). No-op.');
}

/**
 * Deactivate the current runtime context and reset settings state.
 * P03b stub: no-op. P06 replaces with full implementation.
 */
export function deactivateSettingsRuntimeContext(): void {
  // P03b compile-only stub: transparent no-op.
  // P06 replaces this with: clear active context, reset settings service.
  console.warn('[settingsRuntimeAdapter] deactivateSettingsRuntimeContext called before full implementation (P06). No-op.');
}
```

**Important**: P03b does NOT wire configConstructor to call this adapter. The adapter module exists for P04b to import and call directly in tests. The production call-site switch from `registerSettingsService()` to `activateSettingsRuntimeContext()` is deferred to P06, where the adapter has real behavioral implementation. This avoids breaking all existing config construction tests with a throwing stub.

**Important**: P03b does NOT wire configConstructor to call this adapter. The adapter module exists for P04b to import and call directly in tests. The production call-site switch from `registerSettingsService()` to `activateSettingsRuntimeContext()` is deferred to P06, where the adapter has real behavioral implementation. This avoids breaking existing core tests with a throwing stub.

P04b integration tests exercise the adapter module directly (importing `activateSettingsRuntimeContext`/`deactivateSettingsRuntimeContext` and calling them with settings service instances), not through the configConstructor production path.

### Config Type Imports: Minimal Settings Package References

Update `packages/core/src/config/configBaseCore.ts` and `packages/core/src/config/configTypes.ts` to add `import type` references to settings package types (type-only imports compile without runtime dependency):

```typescript
import type { SettingsService, ProfileManager, Storage } from '@vybestack/llxprt-code-settings';
```

These are type-only imports and do NOT require settings package runtime at this phase. They establish the planned import paths that P04b integration tests will verify.

### Standardized TypeScript Path Alias Strategy

All packages use a consistent tsconfig path alias strategy that resolves to the **source entrypoint** (not `src/` directory). This matches the package entrypoint/export behavior where root resolves to `index.ts`:

**Root alias** — resolves to the package entrypoint file:
```json
"@vybestack/llxprt-code-settings": ["../settings/index.ts"]
```

**Subpath alias** — resolves to source subdirectories:
```json
"@vybestack/llxprt-code-settings/*": ["../settings/src/*"]
```

This is the same convention used by `packages/core/tsconfig.json` for its self-reference (`"@vybestack/llxprt-code-core": ["./index.ts"]`). All three consumer packages (core, providers, CLI) use the same target for settings.

**Critical: `include`/`rootDir`/`references` strategy for consumer packages.** Currently:
- `packages/cli/tsconfig.json` has `"rootDir": ".."` and includes `"../providers/index.ts"` and `"../providers/src/**/*.ts"` in its `include` array, plus a `"references": [{ "path": "../core" }]`.
- `packages/providers/tsconfig.json` has no `rootDir` override and includes `"../core/src/types/wasm.d.ts"` in its `include`.
- `packages/core/tsconfig.json` has no `rootDir` override and no references.

Adding settings path aliases to each consumer requires consistent handling:

1. **Providers**: Add path alias entries (`@vybestack/llxprt-code-settings` and `@vybestack/llxprt-code-settings/*`). If providers includes core source files in its `include`, it should also include the settings source entrypoint `../settings/index.ts` for type resolution. If providers has a `references` array, add `{ "path": "../settings" }`. **Verification**: After adding, `npm run typecheck --workspace @vybestack/llxprt-code-providers` MUST pass, proving the TypeScript compiler resolves settings imports through the path aliases.

2. **CLI**: Add path alias entries. CLI has `"rootDir": ".."` and includes provider sources. It must also include `"../settings/index.ts"` and `"../settings/src/**/*.ts"` (or at minimum `"../settings/src/types.ts"` for type-only imports) in its `include` array so TypeScript resolves settings source files. Add `{ "path": "../settings" }` to the `references` array alongside the existing `{ "path": "../core" }`. **Verification**: After adding, `npm run typecheck --workspace @vybestack/llxprt-code` MUST pass.

3. **Core**: Add path alias entries. Core does not currently have `references` or broad `include` of other packages, so it only needs the path aliases (TypeScript resolves through `paths` without `include` extensions when using path aliases for package imports). **Verification**: After adding, `npm run typecheck --workspace @vybestack/llxprt-code-core` MUST pass.

After adding aliases/dependencies in each consumer, **mandatory typecheck verification** must confirm that the TypeScript compiler resolves settings imports correctly. If a typecheck fails with "cannot find module" or module resolution errors, the tsconfig `include`/`references` must be updated to cover settings source files.

Specifically:
- **Providers**: If providers has a `references` array in tsconfig.json, add `{ "path": "../settings" }`. If providers includes core source files in its `include` array, also add `"../settings/index.ts"` and `"../settings/src/**/*.ts"`. Verify with `npm run typecheck --workspace @vybestack/llxprt-code-providers`.
- **CLI**: CLI has `"rootDir": ".."` and includes provider sources. It must add `"../settings/index.ts"` and `"../settings/src/**/*.ts"` (or at minimum `"../settings/src/types.ts"` for type-only imports) to its `include` array. Add `{ "path": "../settings" }` to the `references` array alongside the existing `{ "path": "../core" }`. Verify with `npm run typecheck --workspace @vybestack/llxprt-code`.
- **Core**: Core does not currently have `references` or broad `include` of other packages. It only needs the path aliases (TypeScript resolves through `paths` without `include` extensions when using path aliases for package imports). However, if typecheck fails, add `"../settings/index.ts"` to core's `include` array. Verify with `npm run typecheck --workspace @vybestack/llxprt-code-core`.

### Add Settings Path Aliases in Core

Add to `packages/core/tsconfig.json` paths:

```json
"@vybestack/llxprt-code-settings": ["../settings/index.ts"],
"@vybestack/llxprt-code-settings/*": ["../settings/src/*"]
```

This is the SAME pattern core uses for its self-reference. Required for compilation.

### Add Settings Dependency + Path Aliases in Providers AND CLI

P04b core integration tests live in `packages/core/src/__tests__/settings-integration/`. Provider and CLI vertical-slice integration tests are deferred to P07, so their aliases/dependencies are still needed in P03b for P07 tests to compile later.

**Providers package updates in P03b:**

- `packages/providers/package.json` — ADD `@vybestack/llxprt-code-settings: file:../settings` dependency (in `dependencies` section)
- `packages/providers/tsconfig.json` — ADD settings path alias entries (standardized strategy):

```json
"@vybestack/llxprt-code-settings": ["../settings/index.ts"],
"@vybestack/llxprt-code-settings/*": ["../settings/src/*"]
```

- `packages/providers/vitest.config.ts` — ADD settings workspace source alias entry following the same pattern as existing core/providers alias plugin entries

**CLI package updates in P03b:**

- `packages/cli/package.json` — ADD `"@vybestack/llxprt-code-settings": "file:../settings"` dependency (in `dependencies` section)
- `packages/cli/tsconfig.json` — ADD settings path alias entries (standardized strategy):

```json
"@vybestack/llxprt-code-settings": ["../settings/index.ts"],
"@vybestack/llxprt-code-settings/*": ["../settings/src/*"]
```

- `packages/cli/vitest.config.ts` — ADD settings workspace source alias entries for both root and subpaths. The CLI vitest config uses a `workspaceAliasPlugin` with a `resolveId` function and a helper `resolveTsSource` that does `.js`-to-`.ts` conversion. Add the settings package prefix, entry, and src directory following the exact pattern of the existing providers/core entries:

```typescript
// Add these constants near existing providers/core constants:
const settingsPackagePrefix = '@vybestack/llxprt-code-settings/';
const settingsEntry = resolve(__dirname, '../settings/index.ts');
const settingsSrcDir = resolve(__dirname, '../settings/src/') + '/';

// Add these conditions inside workspaceAliasPlugin.resolveId(source):
if (source === '@vybestack/llxprt-code-settings') {
  return settingsEntry;
}
if (source.startsWith(settingsPackagePrefix)) {
  return resolveTsSource(
    settingsSrcDir,
    source.slice(settingsPackagePrefix.length),
  );
}
```

This matches the providers precedent exactly: root alias resolves to `../settings/index.ts` and subpaths resolve through `../settings/src/` with `.js`-to-`.ts` conversion handled by `resolveTsSource`. The `resolveTsSource` function (already defined in `packages/cli/vitest.config.ts`) converts `.js` specifiers to `.ts` when the `.ts` file exists — so `@vybestack/llxprt-code-settings/settings/SettingsService.js` resolves to `../settings/src/settings/SettingsService.ts`. **Verification after adding**: run `npm run typecheck --workspace @vybestack/llxprt-code` and confirm CLI tests resolve settings source correctly.

These are required NOW because P07 vertical-slice integration tests in providers and CLI will import `@vybestack/llxprt-code-settings`. Without these aliases, P07 tests cannot compile. Previously, only core and providers received vitest alias updates, leaving CLI tests resolving stale dist artifacts.

**CLI Vitest settings alias verification**: After adding the CLI vitest settings alias, verify that CLI test commands resolve settings source correctly. The root alias MUST resolve to `../settings/index.ts` (the source entrypoint):

```bash
# Verify CLI vitest resolves settings to source, not dist
npm run typecheck --workspace @vybestack/llxprt-code
npm run test --workspace @vybestack/llxprt-code -- --run src/__tests__/settings-integration 2>&1 | head -20
# The above command may fail at P03b (no test file yet), but should show module resolution
# succeeding for @vybestack/llxprt-code-settings, not falling back to dist
# Verify the workspaceAliasPlugin has settingsEntry pointing to ../settings/index.ts
grep -n 'settingsEntry\|settingsPackagePrefix\|settingsSrcDir' packages/cli/vitest.config.ts
```

## Compile-Only Verification (No Blast-Radius Gate Needed)

P03b does NOT wire configConstructor to call the adapter. The adapter module exists as a transparent no-op stub. Since no production code paths call `activateSettingsRuntimeContext()` or `deactivateSettingsRuntimeContext()` after P03b, there is no blast-radius concern. All existing core tests must pass unchanged.

The production configConstructor call-site switch (from `registerSettingsService()` to `activateSettingsRuntimeContext()`) is a P06 task, applied after the adapter has real behavioral implementation.

## Files to Create/Modify

- `packages/core/src/runtime/settingsRuntimeAdapter.ts` — NEW adapter module (transparent no-op stub implementations, NOT wired to configConstructor — P06 wires configConstructor)
- `packages/core/src/config/configBaseCore.ts` — ADD type-only imports from settings (do NOT remove existing imports yet — duplicates are allowed per temporary duplicate policy)
- `packages/core/src/config/configTypes.ts` — ADD type-only imports from settings (temporary duplicates allowed)
- `packages/core/src/config/configConstructor.ts` — NO CHANGES in P03b (P06 wires the call to `activateSettingsRuntimeContext`)
- `packages/core/tsconfig.json` — ADD settings path alias entries
- `packages/core/package.json` — ADD `@vybestack/llxprt-code-settings` dependency stub
- `packages/providers/package.json` — ADD `@vybestack/llxprt-code-settings: file:../settings` dependency
- `packages/providers/tsconfig.json` — ADD settings path alias entries
- `packages/providers/vitest.config.ts` — ADD settings workspace source alias entry
- `packages/cli/package.json` — ADD `@vybestack/llxprt-code-settings: file:../settings` dependency
- `packages/cli/tsconfig.json` — ADD settings path alias entries
- `packages/cli/vitest.config.ts` — ADD settings workspace source alias entry

All new code must include `@plan PLAN-20260608-ISSUE1588.P03b` markers.

## Verification Commands

```bash
# Verify core compilation with settings references
npm run typecheck --workspace @vybestack/llxprt-code-core
# Verify adapter file exists with transparent no-op stubs
ls packages/core/src/runtime/settingsRuntimeAdapter.ts
# Verify adapter exports both functions (transparent no-op stubs, NOT throwing NotYetImplemented)
rg -n "activateSettingsRuntimeContext|deactivateSettingsRuntimeContext" packages/core/src/runtime/settingsRuntimeAdapter.ts
rg -n "@vybestack/llxprt-code-settings" packages/core/tsconfig.json packages/core/package.json
# Verify core tsconfig root alias points to index.ts (standardized strategy)
rg -n '"@vybestack/llxprt-code-settings".*index\.ts' packages/core/tsconfig.json || echo "FAIL: core root alias must resolve to ../settings/index.ts"
# Providers compilation with settings path alias + dependency
npm run typecheck --workspace @vybestack/llxprt-code-providers
rg -n "@vybestack/llxprt-code-settings" packages/providers/tsconfig.json packages/providers/package.json packages/providers/vitest.config.ts
# Verify providers tsconfig root alias points to index.ts (standardized strategy)
rg -n '"@vybestack/llxprt-code-settings".*index\.ts' packages/providers/tsconfig.json || echo "FAIL: providers root alias must resolve to ../settings/index.ts"
# CLI compilation with settings path alias + dependency + vitest alias
npm run typecheck --workspace @vybestack/llxprt-code
rg -n "@vybestack/llxprt-code-settings" packages/cli/tsconfig.json packages/cli/package.json packages/cli/vitest.config.ts
# Verify CLI tsconfig root alias points to index.ts (standardized strategy)
rg -n '"@vybestack/llxprt-code-settings".*index\.ts' packages/cli/tsconfig.json || echo "FAIL: CLI root alias must resolve to ../settings/index.ts"
# CLI Vitest settings alias verification: confirm settings resolves to source, not dist
npm run test --workspace @vybestack/llxprt-code -- --run src/__tests__/settings-integration 2>&1 | head -20
# Expected: may fail at P03b (no test file yet), but module resolution for @vybestack/llxprt-code-settings
# should succeed (resolving to source via alias), not fall back to dist
# No settings-to-consumer imports (enforcing: must return zero)
SETTINGS_IMPORTS=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['"]" packages/settings/src --glob '*.ts' --glob '*.tsx' 2>/dev/null || true)
test -z "$SETTINGS_IMPORTS" && echo "OK: settings has no consumer imports" || { echo "FAIL: forbidden imports in settings:"; echo "$SETTINGS_IMPORTS"; exit 1; }
# Explicit npm install (NOT pnpm) — required after dependency changes
npm install
# Lockfile verification: npm lockfile present, pnpm absent, focused diff
test -f package-lock.json && echo "npm lockfile present"
test ! -f pnpm-lock.yaml && echo "no pnpm lockfile"
git diff --stat package-lock.json
# Record package-lock diff evidence in phase completion marker
git diff package-lock.json | head -50 > /tmp/p03b-lockfile-diff.txt
# Verify diff contains only settings-related changes
node -e "const diff=require('fs').readFileSync('/tmp/p03b-lockfile-diff.txt','utf8'); const lines=diff.split('\n'); const settingsLines=lines.filter(l=>l.includes('settings')); const unrelatedLines=lines.filter(l=>!l.includes('settings')&&!l.startsWith('---')&&!l.startsWith('+++')&&!l.startsWith('@@')&&l.trim()!==''); if(unrelatedLines.length>5){console.error('FAIL: unrelated lockfile changes detected. Investigate before proceeding.');console.error('Unrelated lines:',unrelatedLines.slice(0,10));process.exit(1);}else{console.log('OK: lockfile diff appears focused on settings-related changes');}"
# Build ordering verification: settings builds before consumers
npm run build --workspace @vybestack/llxprt-code-settings
# After settings builds, verify consumers still compile
npm run typecheck
```

### Root Build And Script Ordering Verification

After P03 workspace registration, verify that root build scripts correctly order settings before core/providers/CLI. Inspect `scripts/build.js` and root `package.json` scripts to confirm settings builds before consumers:

```bash
# 1. Verify root build script logic
node -e "const p=require('./package.json'); console.log('build script:', p.scripts.build || 'none')"
# 2. Inspect scripts/build.js for hard-coded package lists or explicit ordering
cat scripts/build.js | grep -E 'workspaces|build|packages/' || echo "No explicit package ordering in build.js"
# 3. Check scripts that enumerate packages for hard-coded lists needing settings
grep -rn 'packages/core.*packages/providers' scripts/ --include='*.js' --include='*.ts' || echo "OK: no hard-coded package lists in scripts"
# 4. Verify settings builds independently first
npm run build --workspace @vybestack/llxprt-code-settings
# 5. Full root build must succeed (settings must build before core/providers/CLI)
npm run build
# 6. Verify no stale dist artifacts in core/providers/CLI from before settings existed
ls packages/core/dist/src/settings/ 2>/dev/null && echo "FAIL: core dist still has settings dir at this phase — unexpected" || echo "OK: core dist has no settings dir"
# 7. Verify root predocs:settings script builds core (which now depends on settings)
npm run predocs:settings 2>&1 | tail -3
# 8. Verify schema/docs scripts still reference correct paths
node -e "const p=require('./package.json'); const s={...p.scripts}; for (const k of Object.keys(s)) { if (k.includes('settings') || k.includes('schema') || k.includes('docs')) console.log(k, s[k]); }"
```

If `npm run build --workspaces` does not respect dependency order (it may build in workspace-array order instead), the implementation must either: (a) update `scripts/build.js` to explicitly build settings first, or (b) update root `package.json` workspaces array to list `packages/settings` before `packages/core`. Option (b) is preferred. Record evidence of which approach was taken in the phase completion marker.

**predocs:settings handling**: The `predocs:settings` script currently runs `npm run build --workspace @vybestack/llxprt-code-core`. After settings extraction, core depends on settings. If `predocs:settings` only builds core, it will fail because core type-checks against settings. The implementation must update `predocs:settings` to build settings first: either `npm run build --workspace @vybestack/llxprt-code-settings && npm run build --workspace @vybestack/llxprt-code-core` or `npm run build` (full build). Record which approach was taken.

Expected: typecheck passes for core, providers, and CLI; adapter file exists with transparent no-op stubs; settings path aliases present in all three packages; no settings-to-core imports introduced; no pnpm-lock.yaml created; build ordering verified; lockfile diff shows focused settings-related changes; all existing core tests pass (adapter is not wired to configConstructor yet, so no blast-radius concern).

## Semantic Verification Checklist

- [ ] Adapter stubs compile and are transparent no-ops (console.warn on invocation, no throw, no behavior change).
- [ ] `configConstructor.ts` is NOT modified in P03b. Production call-site switch deferred to P06.
- [ ] Type-only imports do not alter existing runtime behavior.
- [ ] Existing core imports of core-local settings files are NOT removed yet (temporary duplicates allowed until P08 migration).
- [ ] No settings-to-core import introduced.
- [ ] tsconfig paths use standardized strategy in core, providers, AND CLI: root alias resolves to `../settings/index.ts` (source entrypoint), wildcard resolves to `../settings/src/*`.
- [ ] Providers tsconfig.json has settings path alias entries AND appropriate `include`/`references` for settings source resolution.
- [ ] CLI tsconfig.json has settings path alias entries AND appropriate `include`/`references` for settings source resolution.
- [ ] CLI vitest.config.ts has settings root and subpath alias entries.
- [ ] CLI Vitest alias verification confirms settings resolves to source, not stale dist.
- [ ] No pnpm-lock.yaml created; only package-lock.json updated.
- [ ] `npm install` was run explicitly (not `pnpm install`) after workspace/dependency changes in this phase.
- [ ] `git diff --stat package-lock.json` shows focused changes (settings-related entries and workspace metadata). Unrelated lockfile churn was investigated.
- [ ] `npm run check:lockfile` or equivalent Node.js validation confirms lockfile integrity after workspace changes (see lockfile validation guidance in `analysis/phase-verification-matrix.md`).
- [ ] Lockfile diff evidence recorded in phase completion marker (`git diff --stat package-lock.json` output and diff recording).
- [ ] Root build ordering verified: settings builds before core/providers/CLI (evidence recorded).
- [ ] `scripts/build.js` inspected for hard-coded package lists that need settings added.
- [ ] All core tests pass with adapter module present but not wired (transparent no-op stub).
- [ ] `predocs:settings` script updated to build settings before core (or uses full build).
- [ ] TypeScript typecheck verification passed for core, providers, AND CLI after adding settings path aliases — proving aliases, `include`, and `references` are sufficient for type resolution (not just alias/dependency additions).

## Success Criteria

Core compiles with settings package references. P04b integration tests can import `activateSettingsRuntimeContext` and settings types directly (not through configConstructor). The adapter module exists with transparent no-op stubs. All existing core tests pass.

## Failure Recovery

Revert P03b files. Do not proceed to P04b without adapter module and type-only imports working.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P03b.md`.