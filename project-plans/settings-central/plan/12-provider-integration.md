# Phase 12: Provider Settings Integration

## Goal
Make all providers use SettingsService for configuration management.

## Context
Providers currently manage their own settings (model params, API keys, base URLs). We need to centralize this in SettingsService.

## Implementation Steps

1. **Update BaseProvider Class**
   ```typescript
   protected settingsService: SettingsService;
   ```

2. **Migrate Model Parameters**
   - Move from provider-specific storage to SettingsService
   - Maintain provider namespace in settings
   - Update getModelParams/setModelParams

3. **Centralize API Key Management**
   - Store keys in SettingsService
   - Add secure key retrieval
   - Update hasApiKey() methods

4. **Base URL Configuration**
   - Move base URLs to SettingsService
   - Support per-provider URLs
   - Handle custom endpoints

5. **Provider Switch Coordination**
   - Update providerCommand.ts
   - Ensure settings follow provider
   - Clear provider-specific settings on switch

## Key Files to Modify

- `/packages/core/src/providers/BaseProvider.ts`
- `/packages/core/src/providers/openai/OpenAIProvider.ts`
- `/packages/core/src/providers/anthropic/AnthropicProvider.ts`
- `/packages/core/src/providers/gemini/GeminiProvider.ts`
- `/packages/cli/src/ui/commands/providerCommand.ts`

## Provider-Specific Settings Structure

```typescript
{
  "providers": {
    "openai": {
      "model": "gpt-4",
      "apiKey": "...",
      "baseUrl": "https://api.openai.com",
      "modelParams": {
        "temperature": 0.7,
        "maxTokens": 4096
      }
    },
    "anthropic": {
      "model": "claude-3-opus",
      "apiKey": "...",
      "baseUrl": "https://api.anthropic.com",
      "modelParams": {
        "temperature": 0.7,
        "maxTokens": 4096
      }
    }
  },
  "activeProvider": "openai"
}
```

## Testing Requirements

1. **Provider Switch Tests**
   - Settings follow provider changes
   - Old provider settings preserved
   - New provider gets defaults

2. **Model Parameter Tests**
   - Parameters persist correctly
   - Provider-specific params isolated
   - Changes propagate to provider

3. **API Key Tests**
   - Keys stored securely
   - Provider-specific keys work
   - Key validation works

## Success Criteria

- All provider settings in SettingsService
- Provider switches work seamlessly
- No direct provider setting storage
- Backward compatibility maintained