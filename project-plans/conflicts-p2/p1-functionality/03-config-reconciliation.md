# Task: Configuration Reconciliation

## Objective

Unify provider settings with main configuration system to prevent desynchronization and ensure settings persist correctly.

## Files to Modify

### Priority 1 - Configuration Structure:

1. **`packages/core/src/config/config.ts`**
   - Add provider settings to main config interface
   - Ensure backward compatibility
   - Handle provider-specific settings

2. **`packages/cli/src/config/config.ts`**
   - Merge provider configuration logic
   - Ensure settings load from correct sources
   - Handle environment variable fallbacks

3. **`packages/cli/src/config/settings.ts`**
   - Add provider settings paths
   - Ensure proper file structure
   - Handle migration from old format

### Priority 2 - Provider Settings:

4. **`packages/cli/src/providers/enhanceConfigWithProviders.ts`**
   - Review enhancement logic
   - Ensure proper config merging
   - Handle missing settings gracefully

5. **Provider-specific config files** (if any)
   - Migrate to unified structure
   - Ensure no duplicate storage
   - Update references

## Specific Changes Needed

### Config Interface Updates:

```typescript
// Add to main config interface:
interface Config {
  // ... existing fields ...
  providers?: {
    active?: string;
    openai?: {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
    };
    anthropic?: {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
    };
    // ... other providers
  };
}
```

### Environment Variable Loading:

1. Ensure these are checked in order:
   - Command line arguments
   - Environment variables (OPENAI_API_KEY, etc.)
   - Config file settings
   - Default values

### Settings Persistence:

1. When provider settings change, update main config
2. Ensure atomic writes to prevent corruption
3. Handle concurrent access gracefully

## Verification Steps

1. Test setting API key via `/auth` command
2. Verify settings persist across restarts
3. Test environment variable override
4. Check provider switching updates config
5. Verify backward compatibility

## Dependencies

- P0 tasks must be complete

## Estimated Time

45 minutes

## Notes

- Maintain backward compatibility with existing configs
- Ensure sensitive data (API keys) are stored securely
- Consider migration path for existing users
- Test with multiple configuration scenarios
