# Feature Specification: Prompt Configuration System

## Purpose

Replace the hardcoded TypeScript prompt system with a flexible, file-based configuration system that allows users to customize prompts by provider and model while reducing token usage for limited-context models.

## Architectural Decisions

- **Pattern**: File-based Configuration with Hierarchical Resolution
- **Technology Stack**: 
  - TypeScript (strict mode)
  - Node.js fs module for file operations
  - Vitest for testing
  - No external dependencies for core functionality
- **Data Flow**: File System → Loader → Resolver → Cache → Application
- **Integration Points**: PromptService API consumed by all providers

## Project Structure

```
packages/core/src/
  prompt-config/
    types.ts              # Type definitions
    PromptService.ts      # Public API
    PromptResolver.ts     # Resolution logic
    PromptLoader.ts       # File I/O
    PromptCache.ts        # In-memory cache
    TemplateEngine.ts     # Variable substitution
    PromptInstaller.ts    # Default file installation
    defaults/             # Built-in default content
      core.ts
      providers.ts
      tools.ts
packages/core/test/
  prompt-config/
    PromptService.spec.ts
    PromptResolver.spec.ts
    PromptLoader.spec.ts
    PromptCache.spec.ts
    TemplateEngine.spec.ts
    PromptInstaller.spec.ts
    integration/
      prompt-assembly.spec.ts
      migration.spec.ts
```

## Technical Environment

- **Type**: Library/Service for CLI Tool
- **Runtime**: Node.js 20.x
- **Dependencies**: 
  - fs/promises (built-in)
  - path (built-in)
  - Optional: tiktoken for token counting

## Formal Requirements

### [REQ-001] File System Structure
  [REQ-001.1] Base directory SHALL be `~/.llxprt/prompts/`
  [REQ-001.2] Directory structure SHALL support core, env, tools, and providers subdirectories
  [REQ-001.3] Provider overrides SHALL be in `providers/{provider}/`
  [REQ-001.4] Model overrides SHALL be in `providers/{provider}/models/{model}/`

### [REQ-002] File Resolution
  [REQ-002.1] Resolution SHALL follow most-specific-first order
  [REQ-002.2] Search order SHALL be: model-specific → provider-specific → base
  [REQ-002.3] System SHALL use first file found, not accumulate multiple files
  [REQ-002.4] Missing files SHALL fall back to next level in hierarchy

### [REQ-003] Prompt Assembly
  [REQ-003.1] Assembly order SHALL be: core + environment + tools + user memory
  [REQ-003.2] Environment files SHALL be conditionally included based on runtime context
  [REQ-003.3] Tool files SHALL only be included for enabled tools
  [REQ-003.4] User memory SHALL be appended last (passed as parameter, not from file)

### [REQ-004] Template Processing
  [REQ-004.1] System SHALL support {{VARIABLE_NAME}} syntax
  [REQ-004.2] System SHALL substitute TOOL_NAME, MODEL, and PROVIDER variables
  [REQ-004.3] Malformed variables SHALL be left as-is in output
  [REQ-004.4] Variable substitution SHALL occur during file loading

### [REQ-005] Installation and Defaults
  [REQ-005.1] System SHALL create missing directories on startup
  [REQ-005.2] System SHALL install missing default files from built-in content
  [REQ-005.3] System SHALL NOT overwrite existing user files
  [REQ-005.4] Empty files SHALL be treated as intentional (no content desired)

### [REQ-006] Caching and Performance
  [REQ-006.1] All files SHALL be loaded into memory on startup
  [REQ-006.2] Assembled prompts SHALL be cached with O(1) lookup
  [REQ-006.3] System SHALL NOT perform file I/O during normal operation
  [REQ-006.4] Cache keys SHALL include provider, model, tools, and environment state

### [REQ-007] Error Handling
  [REQ-007.1] Missing ~/.llxprt SHALL result in creation attempt
  [REQ-007.2] Permission errors SHALL fail with clear error message
  [REQ-007.3] Missing override files SHALL NOT be treated as errors
  [REQ-007.4] File read errors SHALL log warning and use fallback

### [REQ-008] Tool Integration
  [REQ-008.1] Tool names SHALL be converted from PascalCase to kebab-case
  [REQ-008.2] System SHALL respect coreTools configuration
  [REQ-008.3] System SHALL respect excludeTools configuration
  [REQ-008.4] Disabled tools SHALL NOT have prompts loaded

### [REQ-009] Migration
  [REQ-009.1] Current hardcoded prompts SHALL be extracted to default files
  [REQ-009.2] System SHALL remove all hardcoded prompt logic from TypeScript
  [REQ-009.3] Default files SHALL be shipped with the package
  [REQ-009.4] No backward compatibility mode SHALL be provided

### [REQ-010] Debugging
  [REQ-010.1] When DEBUG=1, system SHALL log file resolution paths
  [REQ-010.2] When DEBUG=1, system SHALL log loaded files
  [REQ-010.3] When DEBUG=1, system SHALL log total token count if available
  [REQ-010.4] When DEBUG=1, system SHALL log variable substitutions

### [REQ-011] Prompt Compression
  [REQ-011.1] System SHALL compress prompts during loading to reduce token usage
  [REQ-011.2] Compression SHALL preserve code blocks exactly (between ``` markers)
  [REQ-011.3] Compression SHALL remove excessive whitespace from prose sections
  [REQ-011.4] Compression SHALL preserve semantic structure (headers, lists, emphasis)
  [REQ-011.5] Compression SHALL be applied consistently to all loaded prompts

## Data Schemas

```typescript
// Configuration context
import { z } from 'zod';

export const PromptContextSchema = z.object({
  provider: z.string(),
  model: z.string(),
  enabledTools: z.array(z.string()),
  environment: z.object({
    isGitRepository: z.boolean(),
    isSandboxed: z.boolean(),
    hasIdeCompanion: z.boolean()
  })
});

// File resolution result
export const ResolvedFileSchema = z.object({
  requestedPath: z.string(),
  resolvedPath: z.string().nullable(),
  content: z.string().optional(),
  source: z.enum(['model', 'provider', 'base', 'not-found'])
});

// Cache entry
export const CacheEntrySchema = z.object({
  key: z.string(),
  assembledPrompt: z.string(),
  metadata: z.object({
    files: z.array(z.string()),
    tokenCount: z.number().optional(),
    assemblyTimeMs: z.number()
  })
});

// Template variables
export const TemplateVariablesSchema = z.object({
  TOOL_NAME: z.string().optional(),
  MODEL: z.string(),
  PROVIDER: z.string()
}).passthrough();
```

## Example Data

```json
{
  "validContext": {
    "provider": "gemini",
    "model": "gemini-2.5-flash",
    "enabledTools": ["ReadFileTool", "ShellTool", "EditTool"],
    "environment": {
      "isGitRepository": true,
      "isSandboxed": false,
      "hasIdeCompanion": false
    }
  },
  "fileResolution": {
    "input": {
      "path": "core.md",
      "context": {
        "provider": "ollama",
        "model": "llama-3-8b"
      }
    },
    "output": {
      "requestedPath": "core.md",
      "resolvedPath": "providers/ollama/models/llama-3-8b/core.md",
      "source": "model"
    }
  },
  "templateSubstitution": {
    "input": "Use the {{TOOL_NAME}} tool for {{PROVIDER}} {{MODEL}}",
    "variables": {
      "TOOL_NAME": "ReadFile",
      "PROVIDER": "anthropic",
      "MODEL": "claude-3-opus"
    },
    "output": "Use the ReadFile tool for anthropic claude-3-opus"
  }
}
```

## Constraints

- No external HTTP calls during prompt loading
- File I/O only during initialization phase
- Maximum prompt assembly time: 100ms
- No code execution in templates
- No circular file references
- No symlink following (security)

## Performance Requirements

- Startup file loading: <500ms for 100 files
- Prompt assembly: <10ms from cache
- Cache memory usage: <10MB for 1000 cached prompts
- File resolution: <1ms per lookup