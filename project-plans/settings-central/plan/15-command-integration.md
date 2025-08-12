# Phase 15: Command Integration Sweep

## Goal
Update all CLI commands to use SettingsService for setting modifications.

## Context
Various commands directly modify settings in different places. They all need to go through SettingsService.

## Commands to Update

### 1. keyCommand
**Current**: Directly sets API keys on providers
**New**: Use SettingsService.setApiKey(provider, key)

### 2. modelCommand  
**Current**: Sets model on provider and config separately
**New**: Use SettingsService.setModel(provider, model)

### 3. setCommand
**Current**: Directly modifies ephemeralSettings
**New**: Use SettingsService.setEphemeralSetting(key, value)

### 4. authCommand
**Current**: Manages auth separately
**New**: Coordinate with SettingsService for auth state

### 5. providerCommand
**Current**: Complex direct manipulation
**New**: Use SettingsService.switchProvider(name)

## Implementation Pattern

```typescript
// Before (direct access):
config.setEphemeralSetting('tool-output-max-tokens', 10000);
provider.setModel('gpt-4');

// After (through SettingsService):
settingsService.setEphemeralSetting('tool-output-max-tokens', 10000);
settingsService.setModel(provider, 'gpt-4');
```

## Key Files to Modify

- `/packages/cli/src/ui/commands/keyCommand.ts`
- `/packages/cli/src/ui/commands/modelCommand.ts`
- `/packages/cli/src/ui/commands/setCommand.ts`
- `/packages/cli/src/ui/commands/authCommand.ts`
- `/packages/cli/src/ui/commands/providerCommand.ts`

## providerCommand Special Handling

The provider command is most complex, currently doing:
1. Clearing ephemeral settings one by one
2. Setting provider directly
3. Updating model
4. Managing base URLs
5. Triggering UI updates

New flow:
```typescript
await settingsService.switchProvider(providerName, {
  clearEphemeral: true,
  defaultModel: getDefaultModel(providerName),
  baseUrl: getBaseUrl(providerName)
});
// SettingsService handles all coordination
```

## Testing Requirements

1. **Command Tests**
   - Each command updates SettingsService
   - Changes visible in diagnostics
   - No direct setting access

2. **Integration Tests**
   - Command chains work correctly
   - Settings persist appropriately
   - Events fire as expected

3. **Regression Tests**
   - All commands still function
   - Same user experience
   - Error handling intact

## Success Criteria

- All commands use SettingsService API
- No direct ephemeralSettings access
- Consistent behavior across commands
- Settings changes properly coordinated