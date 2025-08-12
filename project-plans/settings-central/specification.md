# Feature Specification: Settings Centralization

## Purpose

Solve the multi-source-of-truth problem where settings are scattered across Provider instances, Config object, Settings files, ProviderManager, and ephemeral settings, causing synchronization issues and stale data display.

## Architectural Decisions

- **Pattern**: Service-Oriented Architecture with Central Repository
- **Technology Stack**: TypeScript 5.x, Node.js 20.x, Zod for validation
- **Data Flow**: All settings modifications go through central ISettingsService
- **Integration Points**: Provider instances, Config system, File system, UI commands

## Project Structure

```
packages/core/src/
  settings/
    types.ts              # Settings type definitions
    SettingsService.ts    # Central settings service
    SettingsRepository.ts # Persistence layer
    validators.ts         # Zod schemas for settings
packages/core/test/
  settings/
    SettingsService.spec.ts
    SettingsRepository.spec.ts
    integration/
      settings-sync.spec.ts
```

## Technical Environment
- **Type**: CLI Tool with Core Library
- **Runtime**: Node.js 20.x
- **Dependencies**: 
  - zod@^3.22.0
  - node:fs/promises
  - EventEmitter from node:events

## Formal Requirements

[REQ-001] Settings Service Architecture
  [REQ-001.1] Central ISettingsService interface for all settings operations
  [REQ-001.2] Single source of truth in memory with file persistence
  [REQ-001.3] Event-driven updates to notify all consumers
  [REQ-001.4] Atomic operations with rollback on failure

[REQ-002] Settings Synchronization
  [REQ-002.1] Provider instances auto-update when settings change
  [REQ-002.2] Config object reflects current settings immediately
  [REQ-002.3] UI commands read from central service, not cached values
  [REQ-002.4] File changes trigger in-memory updates

[REQ-003] Settings Operations
  [REQ-003.1] Get current settings for any provider
  [REQ-003.2] Update settings with validation
  [REQ-003.3] Switch active provider atomically
  [REQ-003.4] Reset to defaults per provider

[REQ-004] Data Consistency
  [REQ-004.1] Validate all settings against provider-specific schemas
  [REQ-004.2] Prevent invalid state transitions
  [REQ-004.3] Maintain backup before destructive operations
  [REQ-004.4] Provide rollback mechanism for failed updates

## Data Schemas

```typescript
// Provider settings
const ProviderSettingsSchema = z.object({
  provider: z.enum(['openai', 'qwen', 'gemini', 'anthropic', 'glm']),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  model: z.string(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  toolFormat: z.enum(['auto', 'openai', 'qwen', 'gemini']).optional()
});

// Global settings
const GlobalSettingsSchema = z.object({
  activeProvider: z.enum(['openai', 'qwen', 'gemini', 'anthropic', 'glm']),
  providers: z.record(ProviderSettingsSchema),
  ui: z.object({
    theme: z.enum(['light', 'dark', 'auto']).optional(),
    showDiagnostics: z.boolean().optional()
  }).optional()
});

// Settings change event
const SettingsChangeEventSchema = z.object({
  type: z.enum(['provider-switch', 'settings-update', 'reset']),
  provider: z.string().optional(),
  changes: z.record(z.unknown()).optional(),
  timestamp: z.date()
});
```

## Example Data

```json
{
  "validProviderSwitch": {
    "from": "openai",
    "to": "qwen",
    "settings": {
      "provider": "qwen",
      "baseUrl": "https://portal.qwen.ai/v1",
      "model": "qwen3-coder-plus",
      "apiKey": "qwen_xxx"
    }
  },
  "invalidSettingsUpdate": {
    "provider": "openai",
    "changes": {
      "temperature": 3.5
    },
    "error": "Temperature must be between 0 and 2"
  },
  "settingsSnapshot": {
    "activeProvider": "qwen",
    "providers": {
      "qwen": {
        "provider": "qwen",
        "baseUrl": "https://portal.qwen.ai/v1",
        "model": "qwen3-coder-plus",
        "apiKey": "qwen_xxx"
      },
      "openai": {
        "provider": "openai",
        "model": "gpt-4",
        "apiKey": "sk-xxx"
      }
    }
  }
}
```

## Constraints

- No direct file system access outside SettingsRepository
- All settings changes must emit events
- Provider instances must not cache settings
- UI must not maintain separate settings state
- Validation must occur before persistence

## Performance Requirements

- Settings read: <1ms from memory cache
- Settings write: <10ms including file persistence
- Event propagation: <5ms to all listeners
- Provider switch: <50ms including reinitialization