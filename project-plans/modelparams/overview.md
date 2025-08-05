# Model Parameters and Profiles Feature Overview

## Problem Statement

Currently, users must specify multiple parameters every time they use a non-standard provider or model configuration:

- `--provider openai --model gpt-4 --key xxx --baseurl http://localhost:1234/v1`
- Or use multiple commands: `/provider`, `/model`, `/key`, `/baseurl`

This becomes especially cumbersome for:

- Local models requiring custom base URLs
- Alternative providers (Fireworks, OpenRouter, etc.)
- Models with specific parameter requirements
- Different context limits affecting memory management

## Solution: Profiles and Model Parameters

Allow users to save and load complete configuration profiles that bundle:

1. **Model parameters** - Settings sent to the API (temperature, max_tokens, etc.)
2. **Ephemeral settings** - Client-side behavior (context limits, auth, base URLs)

## Core Features

### 1. Model Parameter Management

Interactive commands:

```
/set modelparam temperature 0.7
/set modelparam max_tokens 4096
/set modelparam top_p 0.95
```

### 2. Ephemeral Settings Management

Interactive commands:

```
/set context-limit 32000
/set compression-threshold 0.8
```

Note: Existing commands like `/baseurl`, `/key`, `/keyfile` continue to work as ephemeral settings.

### 3. Profile Save/Load

Interactive mode:

```
# Configure everything
/provider openai
/model gpt-4
/baseurl http://localhost:1234/v1
/keyfile ~/.keys/localai
/set modelparam temperature 0.5
/set context-limit 8000

# Save profile
/save "LocalGPT4"

# Later sessions
/load "LocalGPT4"
```

CLI mode:

```bash
# Load saved profile
llxprt --load "LocalGPT4" --prompt "Hello"

# Override specific settings
llxprt --load "LocalGPT4" --model gpt-3.5-turbo --prompt "Hello"
```

## Implementation Details

### Model Parameters (sent to API)

- `temperature` - Sampling temperature (0-2 for OpenAI)
- `max_tokens` / `output_tokens` - Maximum response length
- `top_p` - Nucleus sampling
- `top_k` - Top-k sampling
- `presence_penalty` - Penalize repeated topics (-2 to 2)
- `frequency_penalty` - Penalize repeated tokens (-2 to 2)
- `seed` - For reproducible outputs
- Provider-specific parameters as needed

### Ephemeral Settings (client behavior)

- `context-limit` - Maximum context window size
- `compression-threshold` - When to compress history (0-1, percentage)
- `auth-key` - API key (existing `/key` command)
- `auth-keyfile` - Path to key file (existing `/keyfile` command)
- `base-url` - API endpoint (existing `/baseurl` command)
- `tool-format` - Tool calling format override
- `api-version` - For Azure OpenAI compatibility
- `custom-headers` - Additional HTTP headers

### Profile Storage

Location: `~/.llxprt/profiles/<ProfileName>.json`

Example profile:

```json
{
  "provider": "openai",
  "model": "gpt-4",
  "ephemeralSettings": {
    "base-url": "http://localhost:1234/v1",
    "auth-keyfile": "~/.keys/localai",
    "context-limit": 32000,
    "tool-format": "hermes"
  },
  "modelParams": {
    "temperature": 0.7,
    "max_tokens": 4096,
    "top_p": 0.95
  }
}
```

### Security Considerations

For v1:

- API keys stored in plaintext in profiles (document this clearly)
- Recommend using `auth-keyfile` instead of `auth-key` for better security
- Environment variables (e.g., `OPENAI_API_KEY`) continue to work as fallback
- Future versions may add encryption or keychain integration

### Override Behavior

Settings are applied in order:

1. Default values
2. Existing settings files
3. Environment variables
4. Loaded profile (if specified)
5. Command-line arguments
6. Interactive commands

Later settings override earlier ones.

## User Experience Examples

### Local Model User

```
# One-time setup
/provider openai
/baseurl http://localhost:8080/v1
/model llama-3.1-70b
/set context-limit 8192
/set modelparam temperature 0.3
/save "LocalLlama"

# Daily use
llxprt --load "LocalLlama" --prompt "Refactor this code"
```

### OpenRouter User

```
# Setup
/provider openai
/baseurl https://openrouter.ai/api/v1
/keyfile ~/.openrouter-key
/model anthropic/claude-3.5-sonnet
/set context-limit 200000
/save "OpenRouterClaude"

# Use
/load "OpenRouterClaude"
```

### Multiple Configurations

```
/save "FastDrafting"     # High temp, smaller model
/save "CarefulReview"    # Low temp, larger model
/save "LocalTesting"     # Local model for offline work

# Switch between them
/load "FastDrafting"
```

## Implementation Phases

### Phase 1 (MVP) - OpenAI Provider Only

- Basic `/set modelparam` command
- Basic `/set` for ephemeral settings
- `/save` and `/load` commands
- CLI `--load` flag
- Profile storage in JSON files

### Phase 2 (Future)

- Extend to other providers (Anthropic, Google)
- Profile encryption/security
- Profile sharing/export
- Auto-detection of model capabilities
- `/list-profiles` command
- Profile validation on load

## Success Criteria

1. Users can configure a local model once and reuse easily
2. Switching between providers requires one command
3. Model-specific parameters are discoverable and settable
4. Context limits properly affect memory management
5. No regression in existing functionality
