# Phase 4: Slim Coordinator, Final Audit, Verification

Finalize `runtimeSettings.ts` as a thin re-export coordinator and verify all acceptance criteria.

## Step 4.1: Slim the Coordinator

After Phases 1-3, `runtimeSettings.ts` should contain only:

1. **License header** (~6 lines)
2. **Imports from new modules** (~40 lines)
3. **Re-exports of all public symbols** (~50 lines)
4. **Existing re-exports** from `runtimeContextFactory.js`, `profileApplication.js`, `credential-store-factory.js` (~15 lines)
5. **The `logger` instance** (1 line -- if still needed by remaining code; otherwise remove)
6. **Top-level `registerIsolatedRuntimeBindings` call** (lines 1470-1478, ~9 lines) — **MUST remain in coordinator** as it wires runtime lifecycle hooks at module load time

**Target: ~150 lines total.**

### What stays in the coordinator:
- Re-exports only. No function bodies. No interfaces. No types defined here.
- The existing pattern of re-exporting from `runtimeContextFactory.js` and `profileApplication.js` remains.

### Actions:
1. Remove all function bodies, interface definitions, type definitions, and constants that were moved in Phases 1-3.
2. Replace with `import` + `export` (or `export { ... } from '...'`) statements.
3. Verify no business logic/function bodies remain -- the file should contain only imports, re-exports, and the required top-level `registerIsolatedRuntimeBindings(...)` call.
4. Run full test suite to confirm all 20 importers still resolve their symbols.

---

## Step 4.2: Function Size Audit

Audit every function across all new and modified files. Verify each is under 80 lines.

### Functions requiring decomposition (should already be done in Phase 2-3):

| Function | Module | Phase Decomposed | Status |
|----------|--------|-----------------|--------|
| `switchActiveProvider` (482 lines) | `providerSwitch.ts` | Phase 3, Step 3.2 | MUST decompose |
| `applyProfileSnapshot` (193 lines) | `profileSnapshot.ts` | Phase 3, Step 3.4 | MUST decompose |
| `applyCliArgumentOverrides` (105 lines) | `settingsResolver.ts` | Phase 3, Step 3.3 | MUST decompose |
| `setActiveModel` (85 lines) | `providerMutations.ts` | Phase 3, Step 3.1 | MUST decompose |
| `buildRuntimeProfileSnapshot` (79 lines) | `profileSnapshot.ts` | N/A | NO DECOMPOSITION NEEDED |
| `setCliRuntimeContext` (34 lines) | `runtimeLifecycle.ts` | N/A | NO DECOMPOSITION NEEDED |

### Audit process:
Use multiple approaches (awk is a quick heuristic, but typecheck is authoritative):

1. **Quick heuristic** (catches most issues):
```bash
for f in packages/cli/src/runtime/{statelessHardening,runtimeRegistry,runtimeAccessors,runtimeLifecycle,providerSwitch,providerMutations,settingsResolver,profileSnapshot}.ts; do
  echo "=== $f ==="
  awk '/^(export )?(async )?function /{name=$0; start=NR} /^}$/{if(start && NR-start+1 > 40) print NR-start+1, name; start=0}' "$f"
done
```

2. **Authoritative check**: Run `npm run lint` — the project's eslint config includes `max-lines-per-function` rules. Any violation will be reported.

Any function exceeding 80 lines must be further decomposed with private helpers.

---

## Step 4.3: File Size Audit

Verify every file is under 800 lines:

```bash
wc -l packages/cli/src/runtime/{statelessHardening,runtimeRegistry,runtimeAccessors,runtimeLifecycle,providerSwitch,providerMutations,settingsResolver,profileSnapshot,runtimeSettings}.ts
```

Expected results:

| File | Expected Lines | Under 800? |
|------|---------------|-----------|
| `statelessHardening.ts` | ~150 | Yes |
| `runtimeRegistry.ts` | ~160 | Yes |
| `runtimeAccessors.ts` | ~550 | Yes |
| `runtimeLifecycle.ts` | ~200 | Yes |
| `providerSwitch.ts` | ~560 | Yes |
| `providerMutations.ts` | ~320 | Yes |
| `settingsResolver.ts` | ~170 | Yes |
| `profileSnapshot.ts` | ~520 | Yes |
| `runtimeSettings.ts` | ~150 | Yes |

If any file exceeds 800 lines, identify additional extraction opportunities and split further.

---

## Step 4.4: Circular Dependency Check

**Scope**: The 8 new modules must be acyclic among themselves. The pre-existing cycle `profileApplication.ts <-> runtimeSettings.ts` is **BROKEN** by consumer rewiring (Scope Addition #1). After Phase 4:
- `profileApplication.ts` imports from specific modules (`runtimeAccessors.js`, `statelessHardening.js`, `providerSwitch.js`, `providerMutations.js`, `credential-store-factory.js`)
- No production code outside `runtime/` imports from `runtimeSettings.js`
- Test files may still import from `runtimeSettings.js` during transition

Verify no circular imports exist among the new modules:

```bash
# Check that no new module imports from runtimeSettings.ts
grep -l "from.*['\"].*runtimeSettings" packages/cli/src/runtime/{statelessHardening,runtimeRegistry,runtimeAccessors,runtimeLifecycle,providerSwitch,providerMutations,settingsResolver,profileSnapshot}.ts
```

This command should produce **no output**. If any new module imports from `runtimeSettings.ts`, it must be refactored to import from the specific module instead.

Additionally verify the dependency direction matches the plan:
- `profileSnapshot.ts` may import from `runtimeAccessors`, `providerMutations`, `statelessHardening`
- `providerSwitch.ts` may import from `runtimeAccessors`, `providerMutations`
- `providerMutations.ts` may import from `runtimeAccessors`
- `settingsResolver.ts` may import from `runtimeAccessors`, `providerMutations`
- `runtimeLifecycle.ts` may import from `runtimeAccessors`, `runtimeRegistry`
- `runtimeAccessors.ts` may import from `runtimeRegistry`, `statelessHardening`
- `runtimeRegistry.ts` -- imports from `runtimeContextFactory.ts` only (for `getCurrentRuntimeScope`, `enterRuntimeScope`)
- `statelessHardening.ts` -- may import from `runtimeRegistry` (for scope resolution)

**Final verification**: Ensure `profileApplication.ts` no longer imports from `runtimeSettings.js`:
```bash
grep "from.*runtimeSettings" packages/cli/src/runtime/profileApplication.ts
```
This should produce **no output** after rewiring.

---

## Step 4.5: Full Verification Suite

Run the complete verification:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

All must pass with zero errors.

---

## Step 4.6: Coverage Verification

Compare test coverage before and after. Coverage should not decrease:

```bash
npm run test -- --coverage
```

Since all code was moved verbatim and all existing tests exercise functions through re-exports, coverage should remain identical. If any gap appears, add focused behavioral tests in the new module's spec file.

---

## Step 4.7: Rewire All Production Consumers (Scope Addition #1)

Break the barrel import pattern by rewiring all 7 production files (8 import contexts) to import directly from their target modules.

### Consumer rewiring mapping (7 production files, 8 import contexts):

| # | Consumer File | Target Module(s) | Symbols to Import |
|---|---------------|-----------------|-------------------|
| 1 | `ui/commands/toolformatCommand.ts` | `providerMutations.js` | `ToolFormatOverrideLiteral` |
| 2 | `ui/commands/clearCommand.ts` | `runtimeAccessors.js` | `getCliRuntimeServices` |
| 3 | `config/profileBootstrap.ts` | `runtimeLifecycle.js` | `registerCliProviderInfrastructure` |
| 4a | `config/config.ts` (direct imports) | `profileSnapshot.js`, `runtimeAccessors.js`, `runtimeLifecycle.js`, `providerSwitch.js` | `applyProfileSnapshot`, `getCliRuntimeContext`, `setCliRuntimeContext`, `switchActiveProvider` |
| 4b | `config/config.ts` (re-exports) | `runtimeAccessors.js` | `getCliRuntimeConfig`, `getCliRuntimeServices`, `getCliProviderManager`, `getActiveProviderStatus`, `listProviders` |
| 5 | `providers/providerConfigUtils.ts` | `providerMutations.js` | `updateActiveProviderApiKey`, `updateActiveProviderBaseUrl` |
| 6 | `zed-integration/zedIntegration.ts` | `runtimeLifecycle.js`, `providerSwitch.js`, `runtimeAccessors.js`, `profileSnapshot.js` | `setCliRuntimeContext`, `switchActiveProvider`, `setActiveModelParam`, `clearActiveModelParam`, `getActiveModelParams`, `getActiveProfileName`, `loadProfileByName` |
| 7 | `runtime/profileApplication.ts` | `runtimeAccessors.js`, `statelessHardening.js`, `providerSwitch.js`, `providerMutations.js`, `credential-store-factory.js` | `clearActiveModelParam`, `getActiveModelParams`, `getCliRuntimeServices`, `isCliRuntimeStatelessReady`, `setActiveModel`, `setActiveModelParam`, `setEphemeralSetting`, `switchActiveProvider`, `updateActiveProviderApiKey`, `updateActiveProviderBaseUrl`, `createProviderKeyStorage`, `isCliStatelessProviderModeEnabled` |

Note: `config/config.ts` has two separate import contexts (direct imports at lines ~65-75, re-exports at lines ~2015-2025) that must both be rewired.

### Rewiring steps:

1. For each consumer file, update imports to reference the specific target module(s) instead of `runtimeSettings.js`.
2. Use `.js` extension in all import specifiers per ESM convention.
3. Run `npm run typecheck` after each file to verify imports resolve.
4. After all rewiring is complete, verify the circular dependency is broken:
   ```bash
   grep "from.*runtimeSettings" packages/cli/src/runtime/profileApplication.ts
   ```
   Should produce no output.

### Verification:

```bash
# No production code should import from runtimeSettings.js except tests
find packages/cli/src -name "*.ts" -not -path "*/__tests__/*" -not -name "*.spec.ts" -not -name "*.test.ts" \
  | xargs grep -l "from.*runtimeSettings" \
  | grep -v integration-tests
```

Expected: Only `runtimeSettings.ts` itself should appear (if grep finds it). All other production files should have been rewired.

---

## Step 4.8: Mark Coordinator as Internal (Scope Addition #3)

Add documentation marking `runtimeSettings.ts` as internal/transitional:

```typescript
/**
 * @internal
 * 
 * This file is a transitional coordinator. It exists for two purposes only:
 * 1. Execute registerIsolatedRuntimeBindings() at module load time to wire runtime lifecycle hooks
 * 2. Re-export symbols from runtimeContextFactory.js, profileApplication.js, and credential-store-factory.js for backward-compatible test imports
 * 
 * Production code should import directly from specific runtime modules:
 * - runtimeAccessors.js for runtime state queries
 * - runtimeLifecycle.js for context setup/teardown
 * - providerSwitch.js for provider switching
 * - providerMutations.js for model/key/URL mutations
 * - profileSnapshot.js for profile operations
 * - settingsResolver.js for CLI argument resolution
 * 
 * Future work: Migrate all test imports to specific modules, then delete this file entirely.
 */
```

---

## Phase 4 Completion Checklist (Final)

- [ ] `runtimeSettings.ts` is a thin coordinator (~150 lines, re-exports + top-level `registerIsolatedRuntimeBindings` call, no business logic)
- [ ] No function in any file exceeds 80 lines
- [ ] No file exceeds 800 lines
- [ ] No circular dependencies among new modules
- [ ] All new modules use `.js` extensions in import specifiers
- [ ] All new files have license headers
- [ ] All existing tests pass (`npm run test`)
- [ ] Lint passes (`npm run lint`)
- [ ] **Scope Addition #1**: All 7 production files (8 import contexts) rewired to import from specific modules (no production code imports from `runtimeSettings.js`)
- [ ] **Scope Addition #2**: Unit tests added for pure functions (`computeModelDefaults`, `normalizeProviderBaseUrl`, `extractProviderBaseUrl`, runtime registry lifecycle)
- [ ] **Scope Addition #3**: Coordinator marked as `@internal` with documentation explaining transitional status
- [ ] Circular dependency with `profileApplication.ts` is BROKEN (verified via grep)
- [ ] Type check passes (`npm run typecheck`)
- [ ] Format is clean (`npm run format`)
- [ ] Build succeeds (`npm run build`)
- [ ] Smoke test passes (`node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`)
- [ ] Test coverage has not decreased
