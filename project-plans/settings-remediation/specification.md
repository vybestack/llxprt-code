# Feature Specification: Settings Service Remediation

## Purpose

Fix the completely backwards SettingsService implementation that currently does PERSISTENCE when it should be an in-memory EPHEMERAL settings coordinator. The current implementation is the exact opposite of what was requested.

## Current Problem

**What exists (WRONG):**
- SettingsService writes to `~/.llxprt/centralized-settings.json` (persistence)
- Config maintains local `ephemeralSettings` in memory
- Async "fire-and-forget" updates from Config to SettingsService
- FileSystemSettingsRepository for JSON persistence
- Dual sources of truth causing inconsistency

**What was requested (RIGHT):**
- SettingsService as in-memory runtime coordinator for ephemeral settings
- Config handles persistence (profiles, saved settings)
- Synchronous access to ephemeral settings
- Single source of truth for runtime settings
- NO FILE SYSTEM operations in SettingsService

## Architectural Decisions

- **Pattern**: In-Memory Service with Event-Driven Updates
- **Technology Stack**: TypeScript, Node.js EventEmitter
- **Data Flow**: Commands → SettingsService (memory) → Consumers via events
- **Integration Points**: Config class for persistence ONLY when needed

## Project Structure

```
packages/core/src/
  settings/
    SettingsService.ts        # In-memory ephemeral coordinator
    types.ts                  # Type definitions
    settingsServiceInstance.ts # Singleton instance
  config/
    config.ts                 # Uses SettingsService for ephemeral
```

## Technical Environment
- **Type**: Core Service
- **Runtime**: Node.js 20.x
- **Dependencies**: No file system dependencies for SettingsService

## Integration Points (MANDATORY SECTION)

### Existing Code That Will Use This Feature
- `/packages/core/src/config/config.ts` - Will delegate ephemeral settings to SettingsService
- `/packages/cli/src/ui/commands/setCommand.ts` - Will update settings via SettingsService
- `/packages/cli/src/ui/commands/diagnosticsCommand.ts` - Will read from SettingsService
- `/packages/cli/src/ui/commands/providerCommand.ts` - Will update provider settings
- `/packages/cli/src/ui/commands/modelCommand.ts` - Will update model via SettingsService
- `/packages/cli/src/ui/App.tsx` - Will listen to SettingsService events for UI updates

### Existing Code To Be Replaced
- `/packages/core/src/settings/FileSystemSettingsRepository.ts` - DELETE ENTIRELY
- Config's `ephemeralSettings` object - Replace with SettingsService calls
- Config's `setEphemeralInSettingsService()` - Remove async persistence logic
- Config's `queueSettingsUpdate()` - Remove queuing logic
- Config's `loadEphemeralSettingsFromService()` - Remove loading from file

### User Access Points
- CLI: `/set` command for ephemeral settings
- CLI: `/model`, `/provider`, `/baseurl` commands
- API: Config.setEphemeralSetting() method
- API: Config.getEphemeralSetting() method

### Migration Requirements
- Remove `~/.llxprt/centralized-settings.json` file
- Update all Config consumers to handle synchronous operations
- Remove all async patterns around ephemeral settings

## Formal Requirements

[REQ-001] In-Memory Ephemeral Settings
  [REQ-001.1] SettingsService stores settings in memory ONLY
  [REQ-001.2] NO file system operations in SettingsService
  [REQ-001.3] Synchronous get/set operations
  [REQ-001.4] Settings cleared on application restart

[REQ-002] Config Integration
  [REQ-002.1] Config delegates ephemeral operations to SettingsService
  [REQ-002.2] Config retains profile/persistence responsibilities
  [REQ-002.3] Remove local ephemeralSettings from Config
  [REQ-002.4] Synchronous access patterns

[REQ-003] Event System
  [REQ-003.1] SettingsService emits events on changes
  [REQ-003.2] Consumers update via event listeners
  [REQ-003.3] Events include old and new values
  [REQ-003.4] Type-safe event definitions

[REQ-INT-001] Integration Requirements
  [REQ-INT-001.1] Replace Config.ephemeralSettings with SettingsService
  [REQ-INT-001.2] Update all CLI commands to use SettingsService
  [REQ-INT-001.3] Remove all file system operations from SettingsService
  [REQ-INT-001.4] Delete FileSystemSettingsRepository entirely

## Data Schemas

```typescript
// Ephemeral settings structure (in memory only)
interface EphemeralSettings {
  // Provider-specific settings
  providers: Record<string, {
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
    toolFormat?: string;
  }>;
  
  // Global ephemeral settings
  global: {
    compressionThreshold?: number;
    contextLimit?: number;
    streamOptions?: any;
  };
  
  // Active provider reference
  activeProvider?: string;
}

// Event definitions
interface SettingsChangeEvent {
  key: string;
  oldValue: unknown;
  newValue: unknown;
  provider?: string;
}
```

## Example Data

```json
{
  "ephemeralSettings": {
    "providers": {
      "openai": {
        "model": "gpt-4",
        "baseUrl": "https://api.openai.com/v1",
        "temperature": 0.7
      }
    },
    "global": {
      "compressionThreshold": 4000,
      "contextLimit": 100000
    },
    "activeProvider": "openai"
  }
}
```

## Constraints

- NO file system operations in SettingsService
- NO async operations for ephemeral settings
- NO persistence of ephemeral settings
- Settings must be cleared on restart
- Must maintain backward compatibility with Config API

## Performance Requirements

- Setting read: <1ms (direct memory access)
- Setting write: <1ms (memory update + event emission)
- Event propagation: <5ms
- Zero I/O operations for ephemeral settings