# Revision 10: Addressing Review-10 Material and Pedantic Issues

Plan ID: PLAN-20260608-ISSUE1588

## Summary

This revision addresses all 10 material issues and 10 pedantic improvements from review-10. The core changes are:

1. **P03b/P04b production wiring**: Defer configConstructor production call-site to P06; P03b uses transparent compile-only stubs; P04b tests intended behavior, not NotYetImplemented.
2. **Complete Storage/settings relative import inventories**: Added exhaustive inventories for core-relative `config/storage` imports, `settings/` relative imports, and `vi.mock` paths.
3. **Method-by-method Storage ownership classification**: Classified every Storage method with justification for temporary settings-package ownership.
4. **providerRuntimeContext replacement type**: Defined `ProviderRuntimeSettingsService` interface and required `settingsService` in `ProviderRuntimeContextInit`; inventoried call sites.
5. **Canonical boundary script**: Made `scripts/check-settings-boundary.js` authoritative for P08/P09/P10, replaced inline grep snippets, added 7 new checks (relative imports, vi.mock, deep imports, providerRuntimeContext rule, etc.).
6. **SettingsService event behavior tests**: Added explicit tests for `change`, `provider-change`, `cleared`, `settings_changed`/`onSettingsChanged`.
7. **Pedantic fixes**: Phase naming (P06), test path conventions, duplicate paragraphs, index.ts build outputs, JSON dependency checks, format rerun guidance, lockfile validation, safe Verbose test commands, zod version matching.

## Issue-to-File Mapping

| Review Issue | Files Changed |
|---|---|
| M1: Storage relative import inventory/migration/enforcement | `analysis/consumer-import-matrix.md`, `plan/08-consumer-migration-impl.md`, `plan/09-cleanup-no-shims.md`, `analysis/boundary-verification-script.md`, `plan/00-overview.md` |
| M2: Settings relative import/mocking inventory and P08/P09 migration | `analysis/consumer-import-matrix.md`, `plan/08-consumer-migration-impl.md`, `plan/09-cleanup-no-shims.md`, `analysis/boundary-verification-script.md`, `plan/00-overview.md` |
| M3: P03b unsafe throwing stub → defer production wiring to P06 | `plan/03b-minimal-adapter-wiring.md`, `plan/04b-vertical-slice-integration-tdd.md`, `plan/00-overview.md` |
| M4: P04b assert intended behavior, not NotYetImplemented | `plan/04b-vertical-slice-integration-tdd.md`, `plan/00-overview.md` |
| M5: providerRuntimeContext replacement type and call-site inventory | `analysis/final-architecture.md`, `analysis/integration-contract.md`, `plan/06-core-integration-stub.md`, `plan/00-overview.md` |
| M6: Storage method-by-method ownership classification and tests | `analysis/settings-move-map.md`, `analysis/final-architecture.md`, `analysis/behavioral-regression-matrix.md`, `plan/04-settings-package-tdd.md`, `plan/00-overview.md` |
| M7: Canonical blocklist for P08/P09/P10 moved-symbol scans | `plan/08-consumer-migration-impl.md`, `analysis/phase-verification-matrix.md`, `plan/00-overview.md` |
| M8: Boundary script as authoritative for P08/P09/P10 | `analysis/boundary-verification-script.md`, `plan/08-consumer-migration-impl.md`, `plan/09-cleanup-no-shims.md`, `plan/10-full-verification.md`, `plan/00-overview.md` |
| M9: settingsRuntimeAdapter single-owner enforcement in boundary script | `analysis/boundary-verification-script.md`, `plan/06-core-integration-stub.md`, `plan/00-overview.md` |
| M10: SettingsService event behavior tests | `analysis/behavioral-regression-matrix.md`, `plan/04-settings-package-tdd.md`, `plan/00-overview.md` |
| P1: Phase naming (P06 "stub" → "impl") | `plan/06-core-integration-stub.md`, `plan/00-overview.md`, `execution-tracker.md` |
| P2: Test path conventions | `plan/04-settings-package-tdd.md`, `plan/00-overview.md` |
| P3: Duplicate paragraphs | `plan/00-overview.md` (removed duplicated a2a-server conclusion, P04b sequencing, lockfile guidance) |
| P4: index.ts build output clarification | `plan/03-decoupling-stub.md`, `plan/00-overview.md` |
| P5: Exact JSON dependency checks | `analysis/phase-verification-matrix.md`, `plan/10-full-verification.md` |
| P6: Format/check rerun guidance | `plan/10-full-verification.md`, `analysis/phase-verification-matrix.md` |
| P7: package-lock validation after npm install | `plan/03b-minimal-adapter-wiring.md`, `plan/08-consumer-migration-impl.md`, `analysis/phase-verification-matrix.md` |
| P8: Avoid head/tail in verification gates | `plan/03b-minimal-adapter-wiring.md`, `analysis/phase-verification-matrix.md` |
| P9: zod version matching | `plan/03-decoupling-stub.md` |
| P10: Safe broad Vitest test commands | `plan/04-settings-package-tdd.md`, `analysis/phase-verification-matrix.md` |

## Detailed Change Descriptions

### Material Issue 1: Storage Relative Import Inventory

Added complete preflight inventory of core-relative `config/storage` imports to `analysis/consumer-import-matrix.md`, including:
- All 19 files listed in review evidence importing `Storage` via relative paths
- `vi.mock` paths referencing `../config/storage.js`
- P08 explicit migration tasks for each consumer
- P09 enforcing scans for relative `config/storage` imports and `vi.mock` paths
- Behavioral test requirements for every moved Storage helper path

### Material Issue 2: Settings Relative Import Inventory

Added complete relative settings import/mocking inventory to `analysis/consumer-import-matrix.md`:
- All 4 files with relative `settings/` imports
- `vi.mock` paths referencing `../settings/` relative paths
- P08 migration tasks for each match
- P09 enforcing scans before deleting `packages/core/src/settings`

### Material Issue 3: P03b Production Wiring

Revised `plan/03b-minimal-adapter-wiring.md`:
- **Removed** configConstructor production wiring from P03b. The adapter file now provides transparent pass-through stubs (compile-only) that do NOT throw NotYetImplemented in production paths.
- `activateSettingsRuntimeContext` and `deactivateSettingsRuntimeContext` are exported as no-ops that log a warning in P03b, allowing configConstructor to remain unwired until P06.
- Production call-site switch from `registerSettingsService()` to `activateSettingsRuntimeContext()` is **deferred to P06**. P03b adds only type-only imports and module existence, not runtime wiring.
- Removed the "blast-radius gate" that required NotYetImplemented (no longer applicable).
- P04b integration tests exercise the adapter module directly, not the configConstructor production path.

Revised `plan/04b-vertical-slice-integration-tdd.md`:
- P04b tests import and call `activateSettingsRuntimeContext` / `deactivateSettingsRuntimeContext` directly.
- Test assertions target **intended behavior**: after activation, `getSettingsService()` returns expected service; after deactivation, `getSettingsService()` throws or returns undefined.
- Red-phase verification confirms test runner exits nonzero with assertion failures, **not** NotYetImplemented.
- Removed all references to verifying "NotYetImplemented" in test output.

### Material Issue 4: P04b Behavioral Assertions

Updated P04b to assert intended behavior (service registered/retrieved correctly), not stub behavior. Red-phase verification checks for:
- Nonzero test runner exit
- No module resolution errors
- Behavioral assertion failures present (AssertionError, Expected/Received)

The verification command no longer greps for `NotYetImplemented`.

### Material Issue 5: providerRuntimeContext Replacement Type

Added to `analysis/final-architecture.md`:
- **`ProviderRuntimeSettingsService` interface**: A core-owned structural interface in `providerRuntimeContext.ts` with minimum methods core needs (`get`, `set`, `on`, `clear`). This replaces the direct `SettingsService` type reference.
- **Required `settingsService` in `ProviderRuntimeContextInit`**: The `settingsService` field becomes required (not optional). All `createProviderRuntimeContext()` call sites must provide a settings service.
- **Default construction**: `createProviderRuntimeContext({})` is no longer valid; callers must provide a settings service. Adapter provides it via `activateSettingsRuntimeContext(s)`.
- **Call-site inventory**: Listed all `createProviderRuntimeContext()` call sites, noting which provide `settingsService` and which need updating.

### Material Issue 6: Storage Ownership Classification

Added to `analysis/settings-move-map.md` a complete method-by-method classification table with categories:
- Settings/profile persistence (justified for settings package)
- General app storage (temporary, future extraction candidate)
- Policy storage (temporary)
- MCP auth storage (temporary)
- Skills/commands/history/session storage (temporary)

Each non-settings helper has explicit justification for temporary settings-package ownership and the internal storage seam marker.

Added to `analysis/behavioral-regression-matrix.md`:
- BVE-05 expanded with every Storage static method requiring behavioral tests
- Explicit path tests for: global LLxprt dir, user policies dir, system policies dir, user skills dir, MCP OAuth tokens path, installation ID path, provider accounts path, history/temp/checkpoint/project paths

### Material Issue 7: Canonical Blocklist for Scans

Updated `plan/08-consumer-migration-impl.md`:
- All moved-symbol scans now reference the canonical blocklist from `analysis/anti-shim-policy.md`
- Added type-only import detection and multiline import block detection
- Boundary script check 8 uses the full symbol list including `LoadBalancerConfig` and `LoadBalancerSubProfileConfig`

### Material Issue 8: Boundary Script Authoritative

Expanded `analysis/boundary-verification-script.md` with 7 new checks (total 19):
- Check 13: Relative core settings import scan
- Check 14: Relative core config/storage import scan
- Check 15: vi.mock path scan
- Check 16: Dynamic import path scan
- Check 17: ProviderRuntimeContext settings-agnostic rule
- Check 18: No packages/storage verification
- Check 19: No core shim exports scan

All P08/P09/P10 inline grep snippets replaced with `node scripts/check-settings-boundary.js` invocations.

### Material Issue 9: settingsRuntimeAdapter Single-Owner in Boundary Script

Added Check 20 to `analysis/boundary-verification-script.md` — alias/multiline/wrapper-aware single-owner enforcement that:
- Parses full file content for both import specifiers and function identifiers
- Checks for aliased imports and re-exported bridge helpers
- Reports exact violating files with line numbers

### Material Issue 10: SettingsService Event Behavior Tests

Added to `analysis/behavioral-regression-matrix.md`:
- BVE-02a: `'change'` event payload from `set`
- BVE-02b: `'provider-change'` event payload from `setProviderSetting`
- BVE-02c: `'cleared'` event from `clear`
- BVE-02d: `onSettingsChanged` / `'settings_changed'` behavior

Updated `plan/04-settings-package-tdd.md` to require explicit tests for each event name and payload.

### Pedantic Fixes Applied

- **P1**: P06 title changed from "Core Integration Stub" to "Core Runtime/Config Implementation" throughout all plan files.
- **P2**: Test path convention normalized: `src/__tests__/settingsRegistry.test.ts` for registry tests (co-located with `src/settings/` module structure), consistent with providers precedent.
- **P3**: Removed duplicate paragraphs from `plan/00-overview.md` (a2a-server conclusion appeared twice, P04b sequencing explained twice, lockfile guidance duplicated).
- **P4**: Added concrete `packages/settings/index.ts` snippet and `.d.ts` path verification for both barrel files.
- **P5**: All downstream package dependency checks now use Node JSON parsing (`node -e "const p=require(...)"`), not `rg`.
- **P6**: P10 verification now explicitly notes that `npm run format` may change files and requires rerunning relevant checks if so.
- **P7**: Added `npm run check:lockfile` (if available) and explicit `node -e` lockfile change validation after every `npm install`.
- **P8**: Removed `head`/`tail` from phase completion gates. Full output preserved for failing commands.
- **P9**: Added note that settings `zod` dependency must match core's current `zod` version exactly.
- **P10**: Replaced path-specific vitest commands with `npm run test --workspace @vybestack/llxprt-code-settings -- --run` (broad run, no path filtering).