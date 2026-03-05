# Playbook: Deprecate legacy confirmation settings and enforce Policy Engine

**Upstream SHA:** `dcd2449b1a16`
**Upstream Subject:** refactor: deprecate legacy confirmation settings and enforce Policy Engine
**Upstream Stats:** 17 files, 32 insertions / 107 deletions

## What Upstream Does

Removes the `enableMessageBusIntegration` setting and makes Policy Engine integration mandatory. The setting was a feature flag that allowed disabling policy-based tool confirmation. This commit removes the setting from schema, config, tests, and enforces that MessageBus is always connected to ToolRegistry and delegation tools. Also updates default test expectations to assume Policy Engine is active.

## LLxprt Adaptation Strategy

Direct removal - LLxprt has parallel code structure. Key difference: LLxprt may have already diverged on some file locations (e.g., CLI-specific configs). Need to:
- Check if LLxprt has `tools.enableMessageBusIntegration` in settingsSchema
- Remove from config loading logic
- Remove from all test mocks
- Ensure ToolRegistry.setMessageBus is always called (remove conditional)
- Remove BuiltinCommandLoader conditionals for policies command

Files to check that may differ from upstream paths:
- `packages/cli/src/config/settingsSchema.ts` (vs gemini-cli settingsSchema.ts)
- Settings migration map if present
- Test config mocks

## Files to Create/Modify

**Modify:**
- `packages/cli/src/config/settingsSchema.ts` - Remove enableMessageBusIntegration setting
- `packages/cli/src/config/settings.ts` - Remove from migration map if present
- `packages/cli/src/config/config.ts` - Remove setting loading, remove conditionals
- `packages/core/src/config/config.ts` - Remove enableMessageBusIntegration parameter and getter, remove conditionals
- `packages/core/src/config/config.test.ts` - Update mock expectations
- `packages/core/src/core/coreToolScheduler.ts` - Remove conditional, always subscribe
- Test files to update mocks (grep for `getEnableMessageBusIntegration` or `enableMessageBusIntegration`)

**Documentation:**
- `docs/cli/settings.md` - Remove setting entry
- `docs/get-started/configuration.md` - Remove setting documentation

## Implementation Steps

1. **Remove from settingsSchema**:
   - Open `packages/cli/src/config/settingsSchema.ts`
   - Find and remove `enableMessageBusIntegration` definition (under `tools` category)
   - Verify schema validation tests still pass

2. **Remove from settings migration**:
   - Open `packages/cli/src/config/settings.ts`
   - Check MIGRATION_MAP for `enableMessageBusIntegration` entry, remove if present

3. **Remove from CLI config loading**:
   - In `packages/cli/src/config/config.ts`:
     - Remove `const enableMessageBusIntegration = settings.tools?.enableMessageBusIntegration ?? true`
     - Remove from ConfigParameters passed to core Config constructor

4. **Remove from core Config**:
   - In `packages/core/src/config/config.ts`:
     - Remove `enableMessageBusIntegration` from ConfigParameters interface
     - Remove private field `enableMessageBusIntegration`
     - Remove assignment in constructor
     - Remove `getEnableMessageBusIntegration()` method
     - In `getToolRegistry()`, remove conditional - always call `registry.setMessageBus(this.messageBus)`
     - For DelegateToAgentTool creation, always pass messageBus (remove conditional)

5. **Update CoreToolScheduler**:
   - In `packages/core/src/core/coreToolScheduler.ts`:
     - Remove `if (this.config.getEnableMessageBusIntegration())` check
     - Always subscribe to MessageBus in constructor
     - Keep the WeakMap singleton pattern

6. **Update BuiltinCommandLoader (CLI)**:
   - In `packages/cli/src/services/BuiltinCommandLoader.ts`:
     - Remove conditional check for policies command
     - Always include `policiesCommand` in commands array
   - In `packages/cli/src/services/BuiltinCommandLoader.test.ts`:
     - Remove test for excluding policies command when disabled
     - Update test to always expect policies command

7. **Update test mocks**:
   - Search codebase for `getEnableMessageBusIntegration` and remove from all test mocks
   - Search for `enableMessageBusIntegration: false` in test setups and remove
   - Files to check:
     - `packages/a2a-server/src/utils/testing_utils.ts`
     - `packages/core/src/core/coreToolScheduler.test.ts`
     - `packages/core/src/core/nonInteractiveToolExecutor.test.ts`
     - `packages/cli/src/ui/hooks/useToolScheduler.test.ts`
     - Any other files found by grep

8. **Update config tests**:
   - In `packages/cli/src/config/config.test.ts`:
     - Remove test "should default enableMessageBusIntegration to true when unconfigured"
     - Replace with assertion that ApprovalMode defaults correctly
   - In `packages/core/src/config/config.test.ts`:
     - Add `setMessageBus` mock to ToolRegistry mock if missing
     - Update DelegateToAgentTool creation expectations to always expect messageBus

9. **Update settings repro test** (`packages/cli/src/__tests__/settings-repro.test.ts`):
   - In `packages/cli/src/config/settings_repro.test.ts`:
     - Replace `enableMessageBusIntegration: true` with another tools setting

10. **Update documentation**:
    - In `docs/cli/settings.md`, remove enableMessageBusIntegration row from table
    - In `docs/get-started/configuration.md`, remove enableMessageBusIntegration section

11. **Regenerate settings schema binary**:
    - Regenerate `schemas/settings.schema.json` after schema changes: `npm run generate:schema`

## Execution Notes

- **Batch group:** Policy (execute after 37be162)
- **Dependencies:** 37be162 (previous policy commit)
- **Verification:** `npm run typecheck && npm run test`
- **Note:** This is a breaking change for users who set `enableMessageBusIntegration: false` in settings. Policy Engine is now mandatory.
