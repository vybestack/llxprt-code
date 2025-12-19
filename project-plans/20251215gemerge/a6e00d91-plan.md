# Implementation Plan: a6e00d91 - Extension Update Fixes

## Summary of Upstream Changes

Upstream commit `a6e00d91` ("Fix rough edges around extension updates (#10926)"):
- **RENAMED** `installExtension` → `installOrUpdateExtension` (not a new function)
- Modified function to handle both install and update scenarios via `previousExtensionConfig` parameter
- Changed `uninstallExtension` signature to accept `isUpdate: boolean` parameter
- Update flow now preserves extension enablement state
- Only enables extension on fresh install, not on update
- Modified update.ts to call `installOrUpdateExtension` directly instead of separate uninstall/install calls
- Updated all command files to use renamed function

**Changes in 7 files** (not 2):
1. `packages/cli/src/config/extension.ts` - Core rename and logic changes
2. `packages/cli/src/config/extensions/update.ts` - Simplified update flow
3. `packages/cli/src/commands/extensions/install.ts` - Function rename
4. `packages/cli/src/commands/extensions/link.ts` - Function rename
5. `packages/cli/src/commands/extensions/uninstall.ts` - Added `isUpdate: false` parameter
6. `packages/cli/src/config/extension.test.ts` - Extensive test updates
7. `packages/cli/src/commands/extensions/install.test.ts` - Test updates

**WARNING:** Upstream bundled Clearcut logging - DO NOT PORT TELEMETRY

## Detailed Changes by File

### 1. extension.ts - Core Logic Changes

**Function Rename:**
```typescript
// OLD: export async function installExtension(
// NEW: export async function installOrUpdateExtension(
export async function installOrUpdateExtension(
  installMetadata: ExtensionInstallMetadata,
  requestConsent: (consent: string) => Promise<boolean>,
  cwd: string = process.cwd(),
  previousExtensionConfig?: ExtensionConfig,  // ALREADY EXISTS - just rename from current usage
): Promise<string>
```

**CURRENT STATE (line 443-448):**
- Function is named `installExtension` (needs rename to `installOrUpdateExtension`)
- Parameter `previousExtensionConfig?: ExtensionConfig` ALREADY EXISTS at line 447
- This is a RENAME operation, not adding a new parameter

**Key Logic Changes:**
1. Detect update mode: `const isUpdate = !!previousExtensionConfig;`
2. Skip "already installed" check (lines 509-518) if `isUpdate` is true - wrap in `if (!isUpdate) { ... }`
3. If `isUpdate`, call `uninstallExtension(newExtensionName, isUpdate, cwd)` AFTER line 524 (after consent check, before copying)
4. LLXPRT note: extensions are enabled by default unless explicitly disabled; do not auto-enable as part of install/update.
5. Skip telemetry in our port (we don't have telemetry system)

**uninstallExtension Signature Change:**
```typescript
// OLD (line 662-664):
// export async function uninstallExtension(
//   extensionIdentifier: string,
//   cwd: string = process.cwd(),
// ): Promise<void>

// NEW:
export async function uninstallExtension(
  extensionIdentifier: string,
  isUpdate: boolean,  // NEW parameter - INSERT AFTER extensionIdentifier
  cwd: string = process.cwd(),  // MOVES TO THIRD POSITION
): Promise<void>
```

**CRITICAL:** Parameter order changes from `(identifier, cwd)` to `(identifier, isUpdate, cwd)`. ALL call sites must be updated.

**uninstallExtension Logic Changes (line 662-693):**
1. Preserve enablement state on update:
   - If `isUpdate` is `false` (user uninstall): keep existing `ExtensionEnablementManager.remove(...)` behavior.
   - If `isUpdate` is `true` (update flow): DO NOT call `ExtensionEnablementManager.remove(...)`.
2. Always delete the extension directory on disk (both uninstall and update) to avoid stale files.
3. Skip telemetry in our port (we don't have telemetry)

**Import Changes:**
- Skip: `ExtensionUpdateEvent`, `logExtensionUpdateEvent` (telemetry - not in our codebase)

### 2. update.ts - Simplified Update Flow

**OLD flow:**
```typescript
await copyExtension(extension.path, tempDir);
const previousExtensionConfig = await loadExtensionConfig(...);
await uninstallExtension(extension.name, cwd);
await installExtension(installMetadata, requestConsent, cwd, previousExtensionConfig ?? undefined);
```

**NEW flow:**
```typescript
await copyExtension(extension.path, tempDir);
const previousExtensionConfig = await loadExtensionConfig(...);
await installOrUpdateExtension(installMetadata, requestConsent, cwd, previousExtensionConfig ?? undefined);
```

**Key changes:**
- Keep rollback backup/restore in `update.ts` (do not create an “empty rollback”).
- Remove separate `uninstallExtension()` call (handled internally by `installOrUpdateExtension` in update mode).
- Import change: `installExtension, uninstallExtension` → `installOrUpdateExtension`

### 3. install.ts - Function Rename

```typescript
// OLD: import { installExtension, ... } from '../../config/extension.js';
// NEW: import { installOrUpdateExtension, ... } from '../../config/extension.js';

// OLD: const name = await installExtension(installMetadata, requestConsentNonInteractive);
// NEW: const name = await installOrUpdateExtension(installMetadata, requestConsentNonInteractive);
```

### 4. link.ts - Function Rename

```typescript
// OLD: import { installExtension, ... } from '../../config/extension.js';
// NEW: import { installOrUpdateExtension, ... } from '../../config/extension.js';

// OLD: const extensionName = await installExtension(installMetadata, requestConsentNonInteractive);
// NEW: const extensionName = await installOrUpdateExtension(installMetadata, requestConsentNonInteractive);
```

### 5. uninstall.ts - Add isUpdate Parameter

**CRITICAL:** Must update call site to match new signature `(identifier, isUpdate, cwd)`

Find all `uninstallExtension` calls and update parameter order:
```typescript
// OLD: await uninstallExtension(args.name);
// NEW: await uninstallExtension(args.name, false);  // false = not an update
```

### 5a. extension.ts - Update performWorkspaceExtensionMigration

**Location:** Line 119 in `performWorkspaceExtensionMigration()`

**CURRENT (line 119):**
```typescript
await installExtension(installMetadata, requestConsent);
```

**NEW:**
```typescript
await installOrUpdateExtension(installMetadata, requestConsent);
```

This is a call site that was missed in the original plan - must be updated as part of the function rename.

### 6. extension.test.ts - Test Updates

**File:** `/packages/cli/src/config/extension.test.ts` (NOT in commands directory)

**Key changes:**
- Replace all `installExtension` calls with `installOrUpdateExtension`
- Skip adding mock for `logExtensionUpdateEvent` (telemetry - not in our codebase)
- Add new test suite with `describe.each([true, false])` testing both install and update modes
- Test that updates preserve enablement state
- Test that fresh installs don't preserve enablement state
- Skip telemetry event verification (we don't have telemetry system)

### 7. install.test.ts - Test Updates

- Replace all `installExtension` calls with `installOrUpdateExtension`

## LLxprt Implementation Steps

### Step 1: Update extension.ts

1. **Rename function (line 443):**
   - Change `export async function installExtension` → `export async function installOrUpdateExtension`
   - Parameter `previousExtensionConfig?: ExtensionConfig` ALREADY EXISTS at line 447 - no need to add

2. **Add update detection logic (after line 448):**
   ```typescript
   const isUpdate = !!previousExtensionConfig;
   ```

3. **Modify duplicate check (wrap lines 509-518):**
   - Wrap existing "already installed" check in `if (!isUpdate) { ... }`

4. **Add pre-install uninstall for updates (after line 524, before line 525):**
   - After consent check, before mkdir:
   ```typescript
   if (isUpdate) {
     await uninstallExtension(newExtensionName, true, cwd);
   }
   ```

5. **Update performWorkspaceExtensionMigration (line 119):**
   - Change: `await installExtension(installMetadata, requestConsent);`
   - To: `await installOrUpdateExtension(installMetadata, requestConsent);`

6. **Update uninstallExtension signature (line 662):**
   - OLD: `uninstallExtension(extensionIdentifier: string, cwd: string = process.cwd())`
   - NEW: `uninstallExtension(extensionIdentifier: string, isUpdate: boolean, cwd: string = process.cwd())`
   - Insert `isUpdate: boolean` as SECOND parameter

7. **Update uninstallExtension logic:**
   - Wrap the enablement manager removal in `if (!isUpdate) { ... }`.
   - Always delete the extension directory on disk (do not early-return before deletion).

### Step 2: Update update.ts

1. **Change imports:**
   - Remove: `installExtension, uninstallExtension`
   - Add: `installOrUpdateExtension`

2. **Simplify update flow:**
   - Remove `uninstallExtension(extension.name, cwd)` call
   - Change `installExtension` → `installOrUpdateExtension`
   - Keep both rollback operations:
     - Keep `copyExtension(extension.path, tempDir)` before the update starts
     - Keep `copyExtension(tempDir, extension.path)` in the catch block

### Step 3: Update Command Files

1. **install.ts:**
   - Import: `installExtension` → `installOrUpdateExtension`
   - Call: `installExtension` → `installOrUpdateExtension`

2. **link.ts:**
   - Import: `installExtension` → `installOrUpdateExtension`
   - Call: `installExtension` → `installOrUpdateExtension`

3. **uninstall.ts:**
   - **CRITICAL:** Update ALL `uninstallExtension` calls to match new signature
   - Search for ALL occurrences of `uninstallExtension(` in the file
   - Old signature: `(extensionIdentifier, cwd?)`
   - New signature: `(extensionIdentifier, isUpdate, cwd?)`
   - Example: `uninstallExtension(args.name)` → `uninstallExtension(args.name, false)`
   - Must pass `false` for isUpdate since this is user-initiated uninstall, not an update

### Step 4: Update Tests

1. **extension.test.ts** (`/packages/cli/src/config/extension.test.ts`):
   - Replace all `installExtension` calls with `installOrUpdateExtension`
   - Update all `uninstallExtension` mock calls to include `isUpdate` parameter
   - Add test suite for update vs install behavior using `describe.each([true, false])`:
     - Test that updates preserve enablement state
     - Test that fresh installs enable by default
   - Skip all telemetry-related mock setup and assertions (we don't have telemetry system)

2. **install.test.ts** (`/packages/cli/src/commands/extensions/install.test.ts`):
   - Replace all `installExtension` calls with `installOrUpdateExtension`
   - No other changes needed

## Files to Modify

| File | Change Type |
|------|-------------|
| `packages/cli/src/config/extension.ts` | Rename installExtension→installOrUpdateExtension, add update logic, update performWorkspaceExtensionMigration, modify uninstallExtension signature |
| `packages/cli/src/config/extensions/update.ts` | Simplify update flow, use renamed function |
| `packages/cli/src/commands/extensions/install.ts` | Function rename in import and call |
| `packages/cli/src/commands/extensions/link.ts` | Function rename in import and call |
| `packages/cli/src/commands/extensions/uninstall.ts` | Add isUpdate parameter to ALL uninstallExtension calls |
| `packages/cli/src/config/extension.test.ts` | Update all calls, update uninstallExtension mocks, add update behavior tests |
| `packages/cli/src/commands/extensions/install.test.ts` | Update all installExtension calls to installOrUpdateExtension |

## Critical Notes

1. **DO NOT PORT TELEMETRY:**
   - Skip all `ExtensionUpdateEvent` and `logExtensionUpdateEvent` additions
   - Skip telemetry-related test assertions
   - We use a different logging system

2. **This is a RENAME, not a new function:**
   - All existing calls to `installExtension` must be updated
   - The function signature changed to add `previousExtensionConfig` parameter
   - Default behavior (no previousExtensionConfig) is same as old installExtension

3. **Core Benefit:**
   - Extension enablement state is preserved across updates
   - User doesn't need to re-enable extensions after updating
   - Cleaner update flow (single function call instead of uninstall + install)

## Acceptance Criteria

### extension.ts Changes
- [ ] `installExtension` renamed to `installOrUpdateExtension` at line 443
- [ ] Update mode detected via `isUpdate = !!previousExtensionConfig` (after line 448)
- [ ] Duplicate check (lines 509-518) wrapped in `if (!isUpdate) { ... }`
- [ ] `uninstallExtension` called with `(newExtensionName, true, cwd)` if update mode (after line 524)
- [ ] `performWorkspaceExtensionMigration` updated to call `installOrUpdateExtension` at line 119
- [ ] `uninstallExtension` signature updated with `isUpdate` parameter as SECOND param at line 662
- [ ] Enablement removal (lines 682-686) wrapped in `if (!isUpdate) { ... }`
- [ ] Directory deletion happens for both uninstall and update (to avoid stale files), while enablement is preserved on update

### Other File Changes
- [ ] update.ts uses `installOrUpdateExtension` and removes separate uninstall, while keeping rollback backup/restore (copyExtension to/from tempDir)
- [ ] install.ts import and call updated to `installOrUpdateExtension`
- [ ] link.ts import and call updated to `installOrUpdateExtension`
- [ ] uninstall.ts ALL calls pass `false` for isUpdate parameter in correct position

### Test Updates
- [ ] extension.test.ts: All `installExtension` calls → `installOrUpdateExtension`
- [ ] extension.test.ts: All `uninstallExtension` mocks include `isUpdate` parameter
- [ ] extension.test.ts: Tests verify enablement preservation on update
- [ ] install.test.ts: All calls updated to `installOrUpdateExtension`
- [ ] No telemetry code added anywhere

### Verification
- [ ] All tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Lint passes (`npm run lint`)
- [ ] Type check passes (`npm run typecheck`)
