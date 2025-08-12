# Phase 11: Config Class Integration

## Goal
Wire SettingsService into the existing Config class as the runtime coordinator for all ephemeral settings.

## Context
The Config class currently manages ephemeralSettings directly. We need to delegate this to SettingsService while maintaining backward compatibility.

## Implementation Steps

1. **Add SettingsService to Config**
   ```typescript
   private settingsService: SettingsService;
   ```

2. **Initialize in Constructor**
   - Create SettingsService instance
   - Migrate existing ephemeralSettings
   - Set up event listeners

3. **Update Ephemeral Settings Methods**
   - `getEphemeralSetting()` delegates to SettingsService
   - `setEphemeralSetting()` delegates to SettingsService
   - `getEphemeralSettings()` returns from SettingsService

4. **Maintain State Synchronization**
   - Listen for SettingsService changes
   - Update dependent systems
   - Trigger existing notifications

5. **Add Migration Path**
   - Keep old storage during transition
   - Log deprecation warnings
   - Provide migration utilities

## Key Files to Modify

- `/packages/core/src/config/config.ts`
- `/packages/core/src/config/types.ts`
- `/packages/core/src/settings/SettingsService.ts`

## Testing Requirements

1. **Backward Compatibility Tests**
   - Existing APIs continue working
   - No breaking changes in behavior
   - Settings persist correctly

2. **Integration Tests**
   - Settings changes propagate
   - Events fire correctly
   - State remains consistent

3. **Migration Tests**
   - Old settings migrate properly
   - No data loss occurs
   - Rollback is possible

## Success Criteria

- All ephemeral settings managed by SettingsService
- Existing Config API unchanged
- No regressions in functionality
- Event system working correctly