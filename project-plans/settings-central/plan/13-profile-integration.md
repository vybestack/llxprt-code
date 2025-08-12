# Phase 13: Profile System Integration

## Goal
Connect ProfileManager to save/load settings through SettingsService API.

## Context
ProfileManager currently saves/loads directly to files. It needs to work through SettingsService to ensure consistency.

## Implementation Steps

1. **Update ProfileManager.save()**
   ```typescript
   async save(profileName: string): Promise<void> {
     const settings = await this.settingsService.exportForProfile();
     // Save to file
   }
   ```

2. **Update ProfileManager.load()**
   ```typescript
   async load(profileName: string): Promise<void> {
     const profileData = // Load from file
     await this.settingsService.importFromProfile(profileData);
   }
   ```

3. **Add Profile Tracking**
   - Track current profile name in SettingsService
   - Add "profileLoaded" event
   - Support "modified" flag

4. **Profile Data Structure**
   ```typescript
   interface Profile {
     version: 1;
     provider: string;
     model: string;
     modelParams: ModelParams;
     ephemeralSettings: EphemeralSettings;
     // All coordinated through SettingsService
   }
   ```

5. **Profile Change Events**
   - Fire events on profile load
   - Track unsaved changes
   - Notify on profile switch

## Key Files to Modify

- `/packages/core/src/config/profileManager.ts`
- `/packages/cli/src/ui/commands/profileCommand.ts`
- `/packages/core/src/settings/SettingsService.ts`

## Profile Operations Flow

```
User: /profile load myprofile
  ↓
ProfileCommand
  ↓
ProfileManager.load()
  ↓
SettingsService.importFromProfile()
  ↓
- Update provider settings
- Update model params
- Update ephemeral settings
- Fire change events
  ↓
All systems updated
```

## Testing Requirements

1. **Save/Load Tests**
   - Profile captures all settings
   - Load restores exact state
   - No data loss

2. **Profile Switch Tests**
   - Settings update correctly
   - Events fire properly
   - Diagnostics shows right data

3. **Modification Tracking**
   - Unsaved changes detected
   - Save updates profile
   - Load overwrites changes

## Success Criteria

- Profiles work through SettingsService
- All settings captured in profiles
- Profile switches update everything
- Diagnostics reflects loaded profile