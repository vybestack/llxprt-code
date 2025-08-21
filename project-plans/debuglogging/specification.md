# Feature Specification: Debug Logging System

## Purpose

Replace ad-hoc `if(DEBUG)` patterns with a structured, performant debug logging system that provides namespace-based filtering, lazy evaluation, and file-based output for debugging multi-provider issues in the llxprt CLI.

## Architectural Decisions

- **Pattern**: Wrapper/Facade pattern around `debug` npm package
- **Technology Stack**: TypeScript strict mode, `debug` npm package as core engine
- **Data Flow**: Logger instances → namespace filtering → lazy evaluation → file output
- **Integration Points**: All provider implementations, core services, CLI commands

## Project Structure

```
packages/core/src/debug/
  types.ts               # Type definitions for debug system
  DebugLogger.ts         # Main logger class with lazy evaluation
  ConfigurationManager.ts # Settings hierarchy management  
  FileOutput.ts          # File writing and rotation
  index.ts               # Public API exports

packages/cli/src/ui/commands/
  debugCommands.ts       # /debug command handlers

~/.llxprt/debug/         # Log output directory
  [timestamp]-[namespace].log
```

## Technical Environment
- **Type**: CLI Tool enhancement
- **Runtime**: Node.js 20.x
- **Dependencies**: 
  - `debug@^4.3.4` - Core namespace filtering engine
  - No other external dependencies

## Integration Points (MANDATORY SECTION)

### Existing Code That Will Use This Feature
- `/packages/core/src/providers/openai/OpenAIProvider.ts` - Replace if(DEBUG) patterns
- `/packages/core/src/providers/openai/streaming.ts` - Debug streaming responses
- `/packages/core/src/providers/openai/tools.ts` - Debug tool calls
- `/packages/core/src/providers/gemini/*.ts` - All Gemini provider files
- `/packages/core/src/providers/anthropic/*.ts` - All Anthropic provider files
- `/packages/core/src/services/*.ts` - Core service debug logging
- `/packages/cli/src/index.ts` - CLI initialization and command processing

### Existing Code To Be Replaced
- All `if (process.env.DEBUG)` patterns throughout codebase
- All `if (DEBUG)` conditional logging
- Direct `console.log` calls used for debugging
- Ad-hoc string concatenation for debug output

### User Access Points
- CLI: `/debug enable [namespace]` - Enable debug logging
- CLI: `/debug disable [namespace]` - Disable debug logging
- CLI: `/debug level [level]` - Set log level
- CLI: `/debug status` - Show current configuration
- CLI: `/debug persist` - Save settings to user config
- ENV: `DEBUG=llxprt:*` - Environment variable control
- Config: `~/.llxprt/settings.json` - Persistent configuration

### Migration Requirements
- Clean break from DEBUG=1 pattern
- All if(DEBUG) patterns removed during migration
- Users must use new DEBUG=llxprt:* format

## Formal Requirements

[REQ-001] Core Debug Framework
  [REQ-001.1] Implement DebugLogger class wrapping debug package
  [REQ-001.2] Support lazy evaluation via function arguments
  [REQ-001.3] TypeScript strict mode with no any types
  
[REQ-002] Namespace Filtering  
  [REQ-002.1] Hierarchical namespaces (llxprt:provider:component)
  [REQ-002.2] Wildcard support (llxprt:openai:*)
  [REQ-002.3] Multiple namespace selection

[REQ-003] Configuration Hierarchy
  [REQ-003.1] CLI flags (highest priority)
  [REQ-003.2] Environment variables
  [REQ-003.3] User config file (~/.llxprt/settings.json)
  [REQ-003.4] Project config (.llxprt/config.json)
  [REQ-003.5] Code defaults (lowest priority)

[REQ-004] Runtime Control
  [REQ-004.1] /debug commands for runtime configuration
  [REQ-004.2] Ephemeral settings (like emojifilter)
  [REQ-004.3] Persist command to save settings

[REQ-005] File Output
  [REQ-005.1] Output to ~/.llxprt/debug/ directory
  [REQ-005.2] Automatic log rotation
  [REQ-005.3] Configurable retention
  [REQ-005.4] Async writes for performance

[REQ-006] Performance
  [REQ-006.1] Zero overhead when disabled
  [REQ-006.2] Lazy evaluation of expensive operations
  [REQ-006.3] No string concatenation when disabled

[REQ-INT-001] Integration Requirements
  [REQ-INT-001.1] Replace all if(DEBUG) patterns in OpenAI provider (Phase 1)
  [REQ-INT-001.2] Replace all if(DEBUG) patterns in remaining code (Phase 2)
  [REQ-INT-001.3] Remove old debug patterns during migration

## Data Schemas

```typescript
import { z } from 'zod';

// Debug settings schema
export const DebugSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  namespaces: z.union([
    z.array(z.string()),
    z.record(z.string(), z.object({
      level: z.enum(['trace', 'debug', 'info', 'warn', 'error']).optional(),
      enabled: z.boolean().optional(),
    }))
  ]).default([]),
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('debug'),
  output: z.object({
    target: z.enum(['file', 'stderr', 'both']).default('file'),
    directory: z.string().default('~/.llxprt/debug'),
    rotate: z.enum(['daily', 'size', 'never']).default('daily'),
    maxSize: z.string().default('10MB'),
    retention: z.number().default(7), // days
  }).default({}),
  lazyEvaluation: z.boolean().default(true),
  redactPatterns: z.array(z.string()).default([
    'apiKey', 'api_key', 'token', 'password', 'secret'
  ]),
});

export type DebugSettings = z.infer<typeof DebugSettingsSchema>;

// Namespace configuration
export const NamespaceConfigSchema = z.object({
  pattern: z.string(), // e.g., "llxprt:openai:*"
  enabled: z.boolean(),
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error']).optional(),
});

export type NamespaceConfig = z.infer<typeof NamespaceConfigSchema>;
```

## Example Data

```json
{
  "debugSettings": {
    "enabled": true,
    "namespaces": ["llxprt:openai:*", "llxprt:gemini:tools"],
    "level": "debug",
    "output": {
      "target": "file",
      "directory": "~/.llxprt/debug",
      "rotate": "daily",
      "maxSize": "10MB",
      "retention": 7
    },
    "lazyEvaluation": true,
    "redactPatterns": ["apiKey", "token", "password"]
  },
  
  "logEntry": {
    "timestamp": "2025-01-20T10:30:00Z",
    "namespace": "llxprt:openai:streaming",
    "level": "debug",
    "message": "Stream chunk received",
    "data": {
      "chunkSize": 1024,
      "sequenceNumber": 42
    }
  }
}
```

## Constraints

- Must work with TypeScript strict mode
- No external dependencies beyond `debug` package
- Clean break from DEBUG=1 (no backward compatibility)
- File I/O must be async and non-blocking
- No console output by default (file only)
- Must support concurrent log writes
- Settings changes must take effect immediately

## Performance Requirements

- Zero overhead when disabled (< 0.1ms check)
- Lazy evaluation prevents expensive operations
- Namespace matching < 1ms
- File write latency < 10ms (async)
- Memory usage < 10MB for typical session
- No performance degradation with multiple namespaces