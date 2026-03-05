# Playbook: Add extension settings info to /extensions list

**Upstream SHA:** `ec11b8afbf38`
**Upstream Subject:** Add extension settings info to /extensions list
**Upstream Stats:** 4 files, 86 insertions

## What Upstream Does

Enhances extension listing to display configured settings with their current values. Adds ExtensionSetting and ResolvedExtensionSetting interfaces to track setting definitions and resolved values (with redaction for sensitive settings). When loading extensions, resolves all settings from the custom environment and stores them on the extension object. Updates ExtensionsList UI component to display settings with proper formatting. Updates ExtensionManager.formatExtensionInfo() to include settings in output.

## LLxprt Adaptation Strategy

Direct mapping - LLxprt has parallel extension system. Changes span:
- Core config types for extension settings interfaces
- ExtensionManager loading logic to resolve settings
- CLI UI components for display
- ExtensionManager formatting utility

Need to verify:
- LLxprt has GeminiCLIExtension interface in core config
- ExtensionManager.loadExtension resolves customEnv
- ExtensionsList component exists in UI

Files likely exist but may have different locations than upstream gemini-cli.

## Files to Create/Modify

**Modify:**
- `packages/core/src/config/config.ts` - Add ExtensionSetting and ResolvedExtensionSetting interfaces, update GeminiCLIExtension
- `packages/cli/src/config/extension-manager.ts` - Resolve settings when loading extensions, update formatExtensionInfo
- `packages/cli/src/ui/components/views/ExtensionsList.tsx` - Display settings in extension list
- `packages/cli/src/ui/components/views/ExtensionsList.test.tsx` - Test settings display

## Implementation Steps

1. **Add type definitions to config.ts**:
   - Open `packages/core/src/config/config.ts`
   - Add after existing extension interfaces:
     ```typescript
     export interface ExtensionSetting {
       name: string;
       description: string;
       envVar: string;
       sensitive?: boolean;
     }

     export interface ResolvedExtensionSetting {
       name: string;
       envVar: string;
       value: string;
       sensitive: boolean;
     }
     ```
   - Update GeminiCLIExtension interface:
     ```typescript
     export interface GeminiCLIExtension {
       // ... existing fields
       settings?: ExtensionSetting[];
       resolvedSettings?: ResolvedExtensionSetting[];
     }
     ```

2. **Resolve settings in ExtensionManager.loadExtension**:
   - Open `packages/cli/src/config/extension-manager.ts`
   - Find loadExtension method (or equivalent extension loading logic)
   - After resolveEnvVarsInObject(config, customEnv):
     ```typescript
     const resolvedSettings: ResolvedExtensionSetting[] = [];
     if (config.settings) {
       for (const setting of config.settings) {
         const value = customEnv[setting.envVar];
         resolvedSettings.push({
           name: setting.name,
           envVar: setting.envVar,
           value: value === undefined
             ? '[not set]'
             : setting.sensitive
               ? '***'
               : value,
           sensitive: setting.sensitive ?? false,
         });
       }
     }
     ```
   - Add to extension object:
     ```typescript
     const extension: GeminiCLIExtension = {
       // ... existing fields
       settings: config.settings,
       resolvedSettings,
     };
     ```

3. **Update formatExtensionInfo in ExtensionManager**:
   - Find formatExtensionInfo method
   - After tools output section:
     ```typescript
     const resolvedSettings = extension.resolvedSettings;
     if (resolvedSettings && resolvedSettings.length > 0) {
       output += `\n Settings:`;
       resolvedSettings.forEach((setting) => {
         output += `\n  ${setting.name}: ${setting.value}`;
       });
     }
     ```

4. **Update ExtensionsList component**:
   - Open `packages/cli/src/ui/components/views/ExtensionsList.tsx`
   - Find the extension item rendering (Box with ext.name)
   - Change outer Box to flexDirection="column" and add marginBottom={1}
   - After extension name/version/status Text:
     ```typescript
     {ext.resolvedSettings && ext.resolvedSettings.length > 0 && (
       <Box flexDirection="column" paddingLeft={2}>
         <Text>settings:</Text>
         {ext.resolvedSettings.map((setting) => (
           <Text key={setting.name}>
             - {setting.name}: {setting.value}
           </Text>
         ))}
       </Box>
     )}
     ```

5. **Add test for settings display**:
   - Open `packages/cli/src/ui/components/views/ExtensionsList.test.tsx`
   - Add test:
     ```typescript
     it('should render resolved settings for an extension', () => {
       mockUIState(new Map());
       const extensionWithSettings = {
         ...mockExtensions[0],
         resolvedSettings: [
           {
             name: 'sensitiveApiKey',
             value: '***',
             envVar: 'API_KEY',
             sensitive: true,
           },
           {
             name: 'maxTokens',
             value: '1000',
             envVar: 'MAX_TOKENS',
             sensitive: false,
           },
         ],
       };
       const { lastFrame, unmount } = render(
         <ExtensionsList extensions={[extensionWithSettings]} />,
       );
       const output = lastFrame();
       expect(output).toContain('settings:');
       expect(output).toContain('- sensitiveApiKey: ***');
       expect(output).toContain('- maxTokens: 1000');
       unmount();
     });
     ```

6. **Verify impact on extension loading**:
   - Ensure customEnv is populated before resolving settings
   - Verify config.settings structure matches ExtensionSetting interface
   - Check that extension object creation includes the new fields

## Execution Notes

- **Batch group:** Extensions (execute after ec79fe1)
- **Dependencies:** ec79fe1 (previous extensions commit)
- **Verification:** `npm run typecheck && npm run test -- packages/cli/src/ui/components/views/ExtensionsList packages/cli/src/config/extension`
- **Note:** Visual change to /extensions list output - verify formatting looks good in terminal
