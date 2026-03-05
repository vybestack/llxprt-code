# Playbook: Inform user of missing settings on extensions update

**Upstream SHA:** `4c67eef0f299`
**Upstream Subject:** Inform user of missing settings on extensions update
**Upstream Stats:** 4 files, 357 insertions

## What Upstream Does

Removes the auto-update blocker when extension settings change and instead warns users about missing settings after update. Adds `getMissingSettings()` function to check which required settings are not configured. Updates ExtensionManager.installOrUpdateExtension to call getMissingSettings and emit warnings via debugLogger and coreEvents. Adds comprehensive test suite for missing settings detection and update flow. Previously, extensions with setting changes would fail auto-update with error - now they update successfully but warn about unconfigured settings.

## LLxprt Adaptation Strategy

Direct mapping with careful testing - LLxprt has parallel extension settings system. Changes involve:
- Extension settings utilities - adding getMissingSettings function
- ExtensionManager update logic - removing settings change blocker, adding warning
- Comprehensive test suite - new test file

Need to verify:
- LLxprt has extensionSettings.ts with getEnvContents function
- LLxprt has KeychainTokenStorage for sensitive settings
- LLxprt has coreEvents.emitFeedback for warnings
- Settings are loaded from both .env files and keychain

## Files to Create/Modify

**Create:**
- `packages/cli/src/config/extensions/extensionUpdates.test.ts` - Test suite for update warnings

**Modify:**
- `packages/cli/src/config/extension-manager.ts` (or extension.ts) - Remove settings blocker, add warning
- `packages/cli/src/config/extensions/extensionSettings.ts` - Add getMissingSettings function
- `packages/cli/src/config/extension.test.ts` - Update auto-update test to expect success

## Implementation Steps

1. **Add getMissingSettings to extensionSettings.ts**:
   - Open `packages/cli/src/config/extensions/extensionSettings.ts`
   - Add export function at end:
     ```typescript
     export async function getMissingSettings(
       extensionConfig: ExtensionConfig,
       extensionId: string,
     ): Promise<ExtensionSetting[]> {
       const { settings } = extensionConfig;
       if (!settings || settings.length === 0) {
         return [];
       }

       const existingSettings = await getEnvContents(extensionConfig, extensionId);
       const missingSettings: ExtensionSetting[] = [];

       for (const setting of settings) {
         if (existingSettings[setting.envVar] === undefined) {
           missingSettings.push(setting);
         }
       }

       return missingSettings;
     }
     ```

2. **Remove settings change blocker in ExtensionManager**:
   - Open `packages/cli/src/config/extension-manager.ts` (or extension.ts)
   - Find installOrUpdateExtension method
   - Locate code that checks settings changes (after loadExtensionConfig):
     ```typescript
     if (isUpdate && installMetadata.autoUpdate) {
       const oldSettings = new Set(previousExtensionConfig.settings?.map(s => s.name) || []);
       const newSettings = new Set(newExtensionConfig.settings?.map(s => s.name) || []);
       const settingsAreEqual = ...
       if (!settingsAreEqual && installMetadata.autoUpdate) {
         throw new Error('Extension has settings changes and cannot be auto-updated...');
       }
     }
     ```
   - Remove entire settings comparison block

3. **Add missing settings warning**:
   - In same method, after loadExtensionConfig and before copyExtension
   - Import getMissingSettings from extensionSettings
   - Add:
     ```typescript
     const missingSettings = await getMissingSettings(
       newExtensionConfig,
       extensionId,
     );
     if (missingSettings.length > 0) {
       const message = `Extension "${newExtensionConfig.name}" has missing settings: ${missingSettings
         .map((s) => s.name)
         .join(', ')}. Please run "gemini extensions settings ${newExtensionConfig.name} <setting-name>" to configure them.`;
       debugLogger.warn(message);
       coreEvents.emitFeedback('warning', message);
     }
     ```
   - Ensure coreEvents is imported from @google/gemini-cli-core

4. **Update existing auto-update test**:
   - Open `packages/cli/src/config/extension.test.ts`
   - Find test "should fail auto-update if settings have changed"
   - Change to "should auto-update if settings have changed"
   - Change expectation from `rejects.toThrow` to successful update
   - Verify version is updated: `expect(updatedExtension.version).toBe('1.1.0')`

5. **Create extensionUpdates.test.ts**:
   - Create new test file in `packages/cli/src/config/extensions/`
   - Mock dependencies:
     - `node:fs` with existsSync mock
     - `@google/gemini-cli-core` for KeychainTokenStorage, debugLogger, coreEvents
     - `node:os` for homedir
   - Setup temp directories for test isolation
   - Test getMissingSettings:
     - Returns empty for all settings present
     - Identifies missing non-sensitive settings
     - Identifies missing sensitive settings (from keychain)
     - Respects workspace vs user settings
   - Test ExtensionManager integration:
     - Mock ExtensionManager methods to avoid real I/O
     - Create scenario: old extension with no settings, new version adds setting
     - Call installOrUpdateExtension
     - Verify debugLogger.warn called with missing settings message
     - Verify coreEvents.emitFeedback called with warning

6. **Setup test mocks properly**:
   - KeychainTokenStorage mock should use in-memory store
   - ExtensionStorage.getExtensionDir should return temp directory
   - Mock fs.promises methods (mkdir, writeFile, rm) to avoid real I/O
   - Mock loadExtension, uninstallExtension, enableExtension as needed

7. **Verify coreEvents integration**:
   - Check that LLxprt has coreEvents.emitFeedback
   - Verify it accepts ('warning', message) signature
   - If not present, use only debugLogger.warn

8. **Test with real extension update flow** (manual verification):
   - Create extension v1.0 with no settings
   - Install it
   - Update extension config to v1.1 with new setting
   - Run update
   - Verify warning appears in output

## Execution Notes

- **Batch group:** Extensions (execute after ec11b8a)
- **Dependencies:** ec11b8a (adds settings display)
- **Verification:** `npm run typecheck && npm run test -- packages/cli/src/config/extension packages/cli/src/config/extensions/extensionUpdates.test.ts`
- **Breaking change:** Extensions with auto-update no longer fail on settings changes - they update and warn instead
- **Note:** Test suite is comprehensive (300+ lines) - ensure all scenarios covered
