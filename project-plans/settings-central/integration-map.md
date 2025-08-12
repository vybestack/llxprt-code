# Integration Map: SettingsService Wiring Points

## Executive Summary

The SettingsService exists as a runtime coordinator but is not connected to the existing system. This document maps all touchpoints where the SettingsService needs to be integrated with the current Config, ProfileManager, CLI settings, and provider systems.

## 1. Config Class Integration Points

### Ephemeral Settings Access Patterns

The Config class currently manages ephemeral settings through direct field access:

```typescript
// Current implementation in Config class
private ephemeralSettings: Record<string, unknown> = {};

// Direct access methods
getEphemeralSetting(key: string): unknown { return this.ephemeralSettings[key]; }
setEphemeralSetting(key: string, value: unknown): void { this.ephemeralSettings[key] = value; }
getEphemeralSettings(): Record<string, unknown> { return { ...this.ephemeralSettings }; }
```

**Files requiring integration:**
- `/packages/core/src/config/config.ts` (lines 271, 941-951)

**Usage patterns found:**
1. **Tool output limiting** (`/packages/core/src/utils/toolOutputLimiter.ts`)
   - `tool-output-max-tokens`
   - `tool-output-truncate-mode` 
   - `tool-output-item-size-limit`

2. **Tool registry management** (`/packages/core/src/tools/tool-registry.ts`)
   - `disabled-tools` (array of disabled tool names)

3. **Chat context limiting** (`/packages/core/src/core/geminiChat.ts`)
   - `max-prompt-tokens`

4. **Shell replacement** (`/packages/core/src/utils/shell-utils.ts`)
   - `shell-replacement` (boolean)

5. **Todo continuation** (`/packages/core/src/tools/todo-pause.ts`)
   - `todo-continuation` (boolean)

## 2. ProfileManager Integration Points  

### Profile Structure Requirements

ProfileManager expects profiles to contain ephemeralSettings:

```typescript
// From /packages/core/src/config/profileManager.ts
interface Profile {
  version: 1;
  provider: string;
  model: string;
  modelParams: ModelParams;
  ephemeralSettings: EphemeralSettings; // This needs SettingsService integration
}
```

**Integration needs:**
- Profile save operations must extract ephemeralSettings from SettingsService
- Profile load operations must populate SettingsService with stored ephemeralSettings
- Profile validation must work with SettingsService schemas

## 3. Provider Integration Touchpoints

### Provider Settings Access Patterns

**Current provider settings management:**
- OpenAI Provider: Uses Config.getEphemeralSetting() for tool format overrides
- Provider Manager: Accesses various provider-specific configurations
- Tool format commands: Read/write provider tool format overrides

**Files with provider settings access:**
- `/packages/core/src/providers/openai/OpenAIProvider.ts`
- `/packages/core/src/providers/ProviderManager.ts`  
- `/packages/cli/src/ui/commands/toolformatCommand.ts`

### Provider Settings Categories

1. **Authentication Settings**
   - API keys (`auth-key`, `OPENAI_API_KEY`, etc.)
   - Base URLs (`base-url`)
   - OAuth configurations

2. **Model Parameters**
   - Model names
   - Temperature, max_tokens, top_p, etc.
   - Provider-specific parameters

3. **Tool Format Overrides**
   - Per-provider tool format settings
   - Auto-detection vs manual override states

## 4. CLI Settings Integration Points

### Current CLI Settings Architecture

The CLI has its own sophisticated settings system:

```typescript
// From /packages/cli/src/config/settings.ts
export enum SettingScope {
  User = 'User',
  Workspace = 'Workspace', 
  System = 'System',
}

class LoadedSettings {
  readonly system: SettingsFile;
  readonly user: SettingsFile;
  readonly workspace: SettingsFile;
  get merged(): Settings { return this._merged; }
}
```

**Integration challenges:**
- CLI settings use scoped precedence (System → User → Workspace)
- SettingsService uses flat global + provider structure
- Both systems need to coexist during transition

### CLI Settings Categories Overlapping with Core

1. **Provider Management**
   - Default provider selection
   - Provider-specific configurations
   - Tool format overrides

2. **Runtime Behavior**
   - Memory limits and discovery settings
   - Tool output limits
   - Debug and logging settings

## 5. Command Integration Analysis

### Commands Accessing Settings

**Commands that modify ephemeral settings:**

1. **toolformatCommand** (`/packages/cli/src/ui/commands/toolformatCommand.ts`)
   - Currently uses `settings.merged.providerToolFormatOverrides`
   - Needs to integrate with SettingsService provider settings

2. **Various provider commands** (inferred from patterns)
   - Provider switching commands
   - API key configuration commands
   - Model parameter adjustment commands

## 6. Runtime Integration Dependencies

### Initialization Sequence Requirements

Current Config initialization pattern:
```typescript
// From Config.initialize()
this.initialized = true;
this.getFileService();
this.promptRegistry = new PromptRegistry();
this.toolRegistry = await this.createToolRegistry();
this.geminiClient = new GeminiClient(this);
```

**SettingsService integration points:**
1. Config constructor should create SettingsService instance
2. Config.initialize() should await SettingsService initialization
3. Provider registration should sync with SettingsService

### Event Propagation Needs

Settings changes need to propagate to:
- Provider instances (for re-authentication, model changes)
- Tool registry (for disabled tools updates)
- Chat context (for limit changes)
- CLI UI (for theme/display changes)

## 7. Backward Compatibility Requirements

### Methods That Must Remain Functional

```typescript
// These Config methods are used throughout the codebase
getEphemeralSetting(key: string): unknown
setEphemeralSetting(key: string, value: unknown): void  
getEphemeralSettings(): Record<string, unknown>
```

**Compatibility strategy:**
- Keep existing Config methods as facade
- Delegate to SettingsService internally
- Maintain exact same return types and behavior

### Provider Interface Compatibility

Providers expect certain method signatures:
- `config.getEphemeralSetting('auth-key')` 
- `config.getEphemeralSetting('base-url')`
- `config.getEphemeralSetting('tool-format')`

## 8. Testing Integration Points

### Test Files Requiring Updates

**Files with ephemeral settings tests:**
- `/packages/core/src/config/config.ephemeral.test.ts`
- `/packages/core/src/providers/openai/OpenAIProvider.test.ts`
- `/packages/core/src/tools/tool-registry.test.ts`
- Multiple tool-specific test files

**Testing strategy needs:**
- Mock SettingsService for unit tests
- Integration tests for Config ↔ SettingsService interaction
- Provider switching tests with settings persistence

## 9. Critical Integration Challenges

### 1. Dual Settings Systems

**Challenge:** CLI has System/User/Workspace scopes, SettingsService has Global/Provider structure

**Impact:** Settings precedence and persistence conflicts

### 2. Ephemeral vs Persistent Settings

**Challenge:** Some ephemeral settings should persist (tool format overrides), others shouldn't (runtime state)

**Impact:** Need to classify settings by persistence requirements

### 3. Provider Settings Validation

**Challenge:** SettingsService has provider-specific validation, existing code doesn't

**Impact:** Need validation integration without breaking existing flows

### 4. Event Coordination

**Challenge:** Multiple systems need to react to settings changes

**Impact:** Need coordinated event propagation system

## 10. Integration Priority Matrix

| Component | Integration Complexity | Business Impact | Priority |
|-----------|----------------------|-----------------|----------|
| Config ephemeral settings | Medium | Critical | P0 |
| Provider authentication | High | Critical | P0 |
| Tool registry settings | Low | High | P1 |
| CLI settings merge | High | Medium | P1 |
| Profile Manager | Medium | Medium | P2 |
| Command integration | Medium | Low | P2 |

## Next Steps

1. **Phase 1**: Create SettingsService facade in Config class
2. **Phase 2**: Migrate ephemeral settings to SettingsService backend
3. **Phase 3**: Integrate provider settings management
4. **Phase 4**: Merge CLI settings system
5. **Phase 5**: Update ProfileManager integration

Each phase maintains backward compatibility while progressively moving functionality to the centralized SettingsService.