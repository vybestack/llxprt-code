# Settings/Configuration Audit - Full Accounting

## The Problem

We have settings scattered across multiple places instead of a single source of truth:

## Current State - Where Settings Live

### 1. Provider Class Members (DUPLICATED)

- `OpenAIProvider`:
  - `private baseURL?: string` (REMOVED but was there)
  - `private currentModel: string`
  - Auth handled via BaseProvider.getAuthToken()
- `AnthropicProvider`:
  - `private baseURL?: string` (REMOVED but was there)
  - `private currentModel: string`
- `GeminiProvider`:
  - `private baseURL?: string` (REMOVED but was there)
  - `private currentModel: string`

### 2. BaseProvider

- `protected baseProviderConfig: BaseProviderConfig` contains:
  - `baseURL?: string`
  - `apiKey?: string`
  - `name: string`
- `protected providerConfig?: IProviderConfig` contains another set

### 3. IProviderConfig

Located at: `packages/core/src/providers/types/IProviderConfig.ts`

- `apiKey?: string`
- `baseUrl?: string` (note: lowercase 'u')
- `defaultModel?: string`
- `maxTokens?: number`
- `temperature?: number`
- And many more...

### 4. SettingsService

Located at: `packages/core/src/settings/SettingsService.ts`

- Stores ephemeral settings (session-only)
- Stores persistent settings
- Has provider-specific settings
- BUT providers aren't consistently using it!

### 5. Config class

Located at: `packages/core/src/config/config.ts`

- Has ephemeral settings
- Has access to SettingsService
- Loads from profiles
- BUT providers get values directly from multiple places

### 6. Profile Loading

- `/profile load` sets ephemeral settings in Config
- Then SEPARATELY applies them to providers via:
  - `activeProvider.setApiKey(value)`
  - `activeProvider.setBaseUrl(value)`
- Instead of providers reading from a single source

## The Flow Problems

### When loading a profile (cerebrasqwen3):

1. Profile contains: `base-url: "https://api.cerebras.ai/v1"`
2. ProfileManager loads it
3. Config stores in ephemeral settings
4. gemini.tsx tries to apply to provider IF no CLI args
5. Provider has its own baseURL member OR baseProviderConfig.baseURL
6. When provider makes API call, it uses:
   - `this.providerConfig?.baseUrl` OR
   - `this.baseProviderConfig.baseURL` OR
   - Sometimes a class member `this.baseURL`

### When using /baseurl command:

1. Command calls `activeProvider.setBaseUrl(baseUrl)`
2. Provider stores in `this.baseProviderConfig.baseURL`
3. Some providers ALSO store in SettingsService
4. But NOT in ephemeral settings consistently

### When using /key or /keyfile:

1. Command calls `activeProvider.setApiKey(key)`
2. BaseProvider stores in SettingsService 'auth-key'
3. BUT keyfile path goes to ephemeral 'auth-keyfile'
4. AuthPrecedenceResolver checks multiple places

## The Solution We Need

### Single Source of Truth: SettingsService

All runtime settings should flow through SettingsService with clear precedence:

1. **Ephemeral Settings** (session-only, highest priority):
   - Set by: /key, /keyfile, /baseurl, profile load
   - Stored in: SettingsService ephemeral map
   - Keys: 'auth-key', 'auth-keyfile', 'base-url', model params

2. **Provider Settings** (persistent, provider-specific):
   - Set by: /set command, direct API
   - Stored in: SettingsService provider settings
   - Keys: Same as above but persistent

3. **Environment Variables** (fallback):
   - Read by: AuthPrecedenceResolver
   - Never stored, just read when needed

### Provider Refactoring Needed

1. **Remove ALL duplicate class members**:
   - No more `private baseURL`
   - No more storing apiKey separately
   - No more duplicate model storage

2. **Providers should ONLY read from**:
   - `this.providerConfig` (which gets from SettingsService)
   - Through helper methods that check SettingsService

3. **Consistent helper methods in BaseProvider**:

   ```typescript
   protected getBaseURL(): string | undefined {
     // Check ephemeral first
     const ephemeral = this.settingsService.getEphemeral('base-url');
     if (ephemeral) return ephemeral;

     // Then provider config
     if (this.providerConfig?.baseUrl) return this.providerConfig.baseUrl;

     // Then base config
     return this.baseProviderConfig.baseURL;
   }

   protected getApiKey(): string | undefined {
     // Let AuthPrecedenceResolver handle this
     return this.getAuthToken();
   }
   ```

4. **Commands should set in SettingsService**:
   - `/key` → settingsService.setEphemeral('auth-key', key)
   - `/keyfile` → settingsService.setEphemeral('auth-keyfile', path)
   - `/baseurl` → settingsService.setEphemeral('base-url', url)
   - `/profile load` → bulk set ephemeral settings

5. **Profile save should read from SettingsService**:
   - Get all ephemeral settings
   - Get current model/provider from provider settings
   - Save as complete snapshot

## Current Broken Example: cerebrasqwen3

Profile has: `"base-url": "https://api.cerebras.ai/v1"`

But when loaded:

1. [OK] Stored in Config ephemeral settings
2. [OK] Applied to provider via setBaseUrl()
3. [ERROR] Provider stores in baseProviderConfig.baseURL
4. [ERROR] When creating OpenAI client, uses undefined or wrong source
5. [ERROR] Results in 404 because hitting default OpenAI endpoint

## Files That Need Changes

1. `packages/core/src/providers/BaseProvider.ts` - Add unified getters
2. `packages/core/src/providers/openai/OpenAIProvider.ts` - Remove duplicates, use getters
3. `packages/core/src/providers/anthropic/AnthropicProvider.ts` - Same
4. `packages/core/src/providers/gemini/GeminiProvider.ts` - Same
5. `packages/cli/src/ui/commands/keyCommand.ts` - Use SettingsService
6. `packages/cli/src/ui/commands/keyfileCommand.ts` - Use SettingsService
7. `packages/cli/src/ui/commands/baseurlCommand.ts` - Use SettingsService
8. `packages/cli/src/ui/commands/profileCommand.ts` - Already uses ephemeral
9. `packages/cli/src/gemini.tsx` - Don't apply settings directly to providers
