# Phase 14: Diagnostics Command Integration

## Goal
Update diagnostics command to pull all data from centralized SettingsService.

## Context
Diagnostics currently pulls from multiple sources causing inconsistencies. It needs to use SettingsService as the single source of truth.

## Current Problem Areas

```typescript
// Currently pulls from scattered sources:
config.getProviderManager().getActiveProvider()  // Source 1
config.getModel()                                // Source 2
config.getEphemeralSettings()                    // Source 3
settings.merged                                  // Source 4
activeProvider.getModelParams()                  // Source 5
```

## Implementation Steps

1. **Create Diagnostics API in SettingsService**
   ```typescript
   getDiagnosticsData(): DiagnosticsInfo {
     return {
       provider: this.getActiveProvider(),
       model: this.getCurrentModel(),
       ephemeralSettings: this.getEphemeralSettings(),
       modelParams: this.getModelParams(),
       profile: this.getCurrentProfile(),
       // ... all in one place
     };
   }
   ```

2. **Update diagnosticsCommand.ts**
   - Get SettingsService instance
   - Call getDiagnosticsData()
   - Format for display
   - Remove scattered access

3. **Ensure Real-time Accuracy**
   - Data always reflects current state
   - No caching issues
   - Profile loads immediately visible

4. **Backward Compatibility**
   - Keep UI settings from LoadedSettings
   - System info from Config
   - Only centralize runtime settings

## Key Files to Modify

- `/packages/cli/src/ui/commands/diagnosticsCommand.ts`
- `/packages/core/src/settings/SettingsService.ts`

## Expected Output Structure

```
# LLxprt Diagnostics

## Provider Information
- Active Provider: openai        ← From SettingsService
- Current Model: gpt-4           ← From SettingsService
- Current Profile: myprofile     ← From SettingsService

## Ephemeral Settings            ← All from SettingsService
### Authentication
- auth-key: ****1234
### Other
- base-url: "https://api.openai.com"

## Model Parameters              ← From SettingsService
- temperature: 0.7
- max_tokens: 4096

## Settings                      ← Keep from LoadedSettings (UI layer)
- Theme: Green Screen
```

## Testing Requirements

1. **Accuracy Tests**
   - Load profile → check diagnostics
   - Switch provider → check diagnostics
   - Change settings → check diagnostics

2. **Consistency Tests**
   - All data from single source
   - No stale information
   - Real-time updates

3. **Regression Tests**
   - All sections still display
   - Format unchanged
   - No missing data

## Success Criteria

- Diagnostics shows accurate data after profile load
- Provider switches immediately reflected
- All settings from SettingsService
- No more scattered data access