# Technical Specification: Model Parameters and Profiles

## Overview

This specification defines the exact technical implementation for model parameters and profiles feature, focusing on v1 scope: OpenAI Provider chat completions only.

## Architecture

### Component Structure

```
packages/
  core/
    src/
      providers/
        IProvider.ts           # Interface extension
        openai/
          OpenAIProvider.ts    # Implementation
      config/
        profileManager.ts      # Profile save/load logic
      types/
        modelParams.ts         # Type definitions
  cli/
    src/
      ui/
        commands/
          setCommand.ts        # /set command implementation
          saveCommand.ts       # /save command
          loadCommand.ts       # /load command
```

## Type Definitions

### Model Parameters

```typescript
// packages/core/src/types/modelParams.ts

/**
 * Parameters that are sent directly to the model API
 */
export interface ModelParams {
  /** Sampling temperature (0-2 for OpenAI) */
  temperature?: number;
  /** Maximum tokens to generate */
  max_tokens?: number;
  /** Nucleus sampling parameter */
  top_p?: number;
  /** Top-k sampling parameter */
  top_k?: number;
  /** Presence penalty (-2 to 2) */
  presence_penalty?: number;
  /** Frequency penalty (-2 to 2) */
  frequency_penalty?: number;
  /** Random seed for reproducibility */
  seed?: number;
  /** Additional provider-specific parameters */
  [key: string]: unknown;
}

/**
 * Settings that affect client behavior, not sent to API
 */
export interface EphemeralSettings {
  /** Maximum context window in tokens */
  'context-limit'?: number;
  /** When to compress history (0-1) */
  'compression-threshold'?: number;
  /** API authentication key */
  'auth-key'?: string;
  /** Path to key file */
  'auth-keyfile'?: string;
  /** API base URL */
  'base-url'?: string;
  /** Tool format override */
  'tool-format'?: string;
  /** API version (for Azure) */
  'api-version'?: string;
  /** Custom HTTP headers */
  'custom-headers'?: Record<string, string>;
}

/**
 * Complete profile configuration
 */
export interface Profile {
  /** Profile format version */
  version: 1;
  /** Provider name */
  provider: string;
  /** Model name */
  model: string;
  /** Model parameters */
  modelParams: ModelParams;
  /** Ephemeral settings */
  ephemeralSettings: EphemeralSettings;
}
```

### IProvider Extension

```typescript
// packages/core/src/providers/IProvider.ts

export interface IProvider {
  // Existing methods...

  /**
   * Set model parameters to be included in API calls
   * @param params Parameters to merge with existing
   */
  setModelParams?(params: Record<string, unknown>): void;

  /**
   * Get current model parameters
   * @returns Current parameters or undefined if not set
   */
  getModelParams?(): Record<string, unknown> | undefined;
}
```

## Implementation Details

### OpenAI Provider

The OpenAIProvider must:

1. Store model params in private property
2. Merge new params with existing (not replace)
3. Spread params into chat.completions.create() call
4. Not validate params (let API handle)

```typescript
class OpenAIProvider implements IProvider {
  private modelParams?: Record<string, unknown>;

  setModelParams(params: Record<string, unknown>): void {
    this.modelParams = { ...this.modelParams, ...params };
  }

  getModelParams(): Record<string, unknown> | undefined {
    return this.modelParams;
  }

  async *generateChatCompletion(...) {
    const stream = await this.openai.chat.completions.create({
      model: this.currentModel,
      messages: messages,
      stream: true,
      stream_options: { include_usage: true },
      tools: formattedTools,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      ...this.modelParams  // Spread params here
    });
    // ... rest of implementation
  }
}
```

### CLI Commands

#### /set modelparam

```typescript
// Command: /set modelparam <key> <value>
// Example: /set modelparam temperature 0.7

interface SetModelParamArgs {
  key: string;
  value: string; // Will be parsed based on key
}
```

#### /set (ephemeral)

```typescript
// Command: /set <key> <value>
// Example: /set context-limit 32000

interface SetEphemeralArgs {
  key: keyof EphemeralSettings;
  value: string;
}
```

#### /save

```typescript
// Command: /save "<profile-name>"
// Example: /save "LocalGPT4"

interface SaveArgs {
  profileName: string;
}

// Saves to: ~/.llxprt/profiles/<profileName>.json
```

#### /load

```typescript
// Command: /load "<profile-name>"
// Example: /load "LocalGPT4"

interface LoadArgs {
  profileName: string;
}
```

### Profile Storage

**Location**: `~/.llxprt/profiles/<ProfileName>.json`

**Directory Creation**: Create `~/.llxprt/profiles/` if doesn't exist

**File Format**:

```json
{
  "version": 1,
  "provider": "openai",
  "model": "gpt-4",
  "modelParams": {
    "temperature": 0.7,
    "max_tokens": 4096,
    "top_p": 0.95,
    "presence_penalty": 0,
    "frequency_penalty": 0
  },
  "ephemeralSettings": {
    "base-url": "http://localhost:1234/v1",
    "auth-keyfile": "~/.keys/localai",
    "context-limit": 32000,
    "compression-threshold": 0.8,
    "tool-format": "hermes"
  }
}
```

## Data Flow

### Setting Model Parameters

1. User: `/set modelparam temperature 0.7`
2. CLI: Parse command, extract key and value
3. CLI: Get current provider from config
4. CLI: Check if provider supports setModelParams
5. If yes: Call provider.setModelParams({ temperature: 0.7 })
6. If no: Show warning "Model parameters not supported by [provider]"
7. Provider: Merge with existing params

### Saving Profile

1. User: `/save "FireworksGPT"`
2. CLI: Gather current state:
   - provider name
   - model name
   - modelParams from provider.getModelParams()
   - ephemeralSettings from various sources
3. CLI: Create Profile object
4. CLI: Write to ~/.llxprt/profiles/FireworksGPT.json
5. CLI: Confirm "Profile 'FireworksGPT' saved"

### Loading Profile

1. User: `/load "FireworksGPT"`
2. CLI: Read ~/.llxprt/profiles/FireworksGPT.json
3. CLI: Parse and validate as Profile
4. CLI: Apply settings in order:
   - Set provider
   - Set model
   - Apply ephemeralSettings
   - Call provider.setModelParams() if supported
5. CLI: Confirm "Profile 'FireworksGPT' loaded"

### CLI Mode

1. User: `llxprt --load "FireworksGPT" --prompt "Hello"`
2. CLI: Load profile before initializing
3. CLI: Apply all settings
4. CLI: Execute prompt with loaded configuration

## Error Handling

### File Operations

- Missing profile: "Profile 'X' not found"
- Invalid JSON: "Profile 'X' is corrupted"
- Write failure: "Failed to save profile: [error]"

### Provider Support

- No setModelParams: "Model parameters not supported by [provider]"
- Provider not found: "Provider '[name]' not available"

### Parameter Validation

- No validation in v1 - pass through to API
- API errors bubble up to user

## Test Scenarios

### IProvider Tests

1. Provider accepts model params
2. Params are merged, not replaced
3. getModelParams returns current state
4. Undefined when not set

### OpenAI Provider Tests

1. Temperature passed to API
2. Multiple params passed correctly
3. No params = default behavior
4. Params persist across calls

### Command Tests

1. /set modelparam parses correctly
2. /set handles ephemeral settings
3. /save creates profile file
4. /load applies all settings
5. Missing profile handled gracefully

### Integration Tests

1. Full flow: set → save → load → use
2. CLI --load works correctly
3. Override behavior works
4. Multiple profiles work

## Example Usage Scenarios

### Scenario 1: Local Model

```bash
/provider openai
/baseurl http://localhost:8080/v1
/model llama-70b
/set modelparam temperature 0.3
/set modelparam max_tokens 8192
/set context-limit 32000
/save "LocalLlama"

# Next session
/load "LocalLlama"
```

### Scenario 2: Fireworks High Output

```bash
/provider openai
/baseurl https://api.fireworks.ai/inference/v1
/model accounts/fireworks/models/qwen3-480b
/keyfile ~/.fireworks-key
/set modelparam max_tokens 16384
/set modelparam temperature 0.6
/save "FireworksQwen"

# CLI usage
llxprt --load "FireworksQwen" --prompt "Generate a detailed report"
```

## Success Metrics

1. Model params correctly passed to OpenAI API
2. Profiles persist across sessions
3. No regression in existing functionality
4. Clear error messages for unsupported operations
5. Seamless CLI and interactive mode support
