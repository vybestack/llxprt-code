# Task: Resolve packages/cli/src/config/config.ts Conflict

## Objective

Resolve the merge conflict in the main CLI configuration file, ensuring multi-provider configuration support is preserved along with new config features from main.

## File

`packages/cli/src/config/config.ts`

## Context

- **multi-provider branch**: Added provider selection, API configuration, and provider-specific settings
- **main branch**: Added new configuration options and improvements

## Resolution Strategy

1. Examine conflict markers carefully
2. Preserve the provider configuration structure
3. Include new configuration options from main
4. Ensure backward compatibility

## Key Items to Preserve

### From multi-provider:

- Provider selection logic
- Provider-specific configuration (baseUrl, apiKey, models)
- `activeProvider` configuration
- Provider initialization code
- Enhanced config structure for multiple providers

### From main:

- New command configurations
- Performance settings
- Memory management options
- Improved validation

## Expected Structure

```typescript
interface Config {
  // Existing Gemini config
  gemini: { ... };

  // Multi-provider additions
  providers?: {
    active?: string;
    openai?: { apiKey?: string; baseUrl?: string; model?: string };
    anthropic?: { apiKey?: string; baseUrl?: string; model?: string };
  };

  // New features from main
  commands?: { ... };
  memory?: { ... };
}
```

## Commands to Execute

```bash
# After resolution:
git add packages/cli/src/config/config.ts
```

## Validation

1. TypeScript compilation passes
2. Config loading works for all providers
3. Backward compatibility maintained
4. New features accessible
