# Settings and Profile Management

This guide covers how to configure LLxprt Code using ephemeral settings, model parameters, and profiles.

## Table of Contents

- [Overview](#overview)
- [Ephemeral Settings](#ephemeral-settings)
- [Model Parameters](#model-parameters)
- [Profile Management](#profile-management)
- [Command Line Usage](#command-line-usage)
- [Examples](#examples)
- [Important Notes](#important-notes)

## Overview

LLxprt Code uses three types of settings:

1. **Persistent Settings**: Saved to `~/.llxprt/settings.json` (theme, default provider, etc.)
2. **Ephemeral Settings**: Session-only settings that aren't saved unless explicitly stored in a profile
3. **Model Parameters**: Provider-specific parameters passed directly to the AI model

## Ephemeral Settings

Ephemeral settings are runtime configurations that last only for your current session. They can be saved to profiles for reuse.

### Available Ephemeral Settings

| Setting                 | Description                        | Example                         |
| ----------------------- | ---------------------------------- | ------------------------------- |
| `context-limit`         | Maximum tokens for context window  | `100000`                        |
| `compression-threshold` | When to compress history (0.0-1.0) | `0.7` (70% of context)          |
| `auth-key`              | API authentication key             | `sk-ant-api03-...`              |
| `auth-keyfile`          | Path to file containing API key    | `~/.keys/anthropic.key`         |
| `base-url`              | Custom API endpoint                | `https://api.anthropic.com`     |
| `tool-format`           | Tool format override               | `openai`, `anthropic`, `hermes` |
| `api-version`           | API version (Azure)                | `2024-02-01`                    |
| `custom-headers`        | HTTP headers as JSON               | `{"X-Custom": "value"}`         |

### Setting Ephemeral Values

```bash
# Set context limit
/set context-limit 100000

# Set compression threshold (70% of context)
/set compression-threshold 0.7

# Set custom headers
/set custom-headers {"X-Organization": "my-org", "X-Project": "my-project"}

# Set API key (not recommended - use keyfile instead)
/set auth-key sk-ant-api03-...

# Set keyfile path (recommended)
/set auth-keyfile ~/.keys/anthropic.key
```

### Unsetting Values

```bash
# Remove a setting
/set unset context-limit

# Remove a specific header
/set unset custom-headers X-Organization
```

## Model Parameters

Model parameters are provider-specific settings passed directly to the AI API. These are **not validated** by LLxprt Code, allowing you to use any current or future parameters.

### Common Parameters

Different providers support different parameters:

**OpenAI/Anthropic:**

- `temperature` (0.0-2.0 for OpenAI, 0.0-1.0 for others)
- `max_tokens`
- `top_p`
- `presence_penalty` (-2.0 to 2.0)
- `frequency_penalty` (-2.0 to 2.0)
- `seed`
- `stop` or `stop_sequences`

**Anthropic Specific:**

- `thinking` (for Claude's thinking mode)
- `top_k`

**Gemini Specific:**

- `maxOutputTokens` (camelCase)
- `topP` (camelCase)
- `topK` (camelCase)
- `candidateCount`
- `stopSequences`

### Setting Model Parameters

```bash
# Basic parameters
/set modelparam temperature 0.8
/set modelparam max_tokens 4096

# Claude's thinking mode
/set modelparam thinking {"type":"enabled","budget_tokens":4096}

# Multiple stop sequences
/set modelparam stop_sequences ["END", "DONE", "---"]

# Provider-specific parameters
/set modelparam top_k 40  # Anthropic/Gemini
/set modelparam seed 12345  # OpenAI for reproducibility
```

### Viewing Current Parameters

```bash
# List all model parameters (if provider implements this)
/set modelparam

# List all ephemeral settings
/set
```

### Unsetting Model Parameters

```bash
# Remove a specific parameter
/set unset modelparam temperature

# Clear ALL model parameters
/set unset modelparam
```

## Profile Management

Profiles save your current configuration (provider, model, parameters, and ephemeral settings) for easy reuse.

### Profile Storage Location

Profiles are stored in: `~/.llxprt/profiles/<profile-name>.json`

### Creating Profiles

```bash
# Save current configuration to a profile
/profile save my-writing-assistant

# Profile will include:
# - Current provider and model
# - All model parameters
# - All ephemeral settings (including auth)
```

### Loading Profiles

```bash
# Load a profile interactively
/profile load

# Load a specific profile
/profile load my-writing-assistant
```

### Listing Profiles

```bash
# Show all saved profiles
/profile list
```

### Profile Structure

A profile JSON file looks like:

```json
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-3-5-sonnet-20240620",
  "modelParams": {
    "temperature": 0.7,
    "max_tokens": 4096,
    "thinking": {
      "type": "enabled",
      "budget_tokens": 4096
    }
  },
  "ephemeralSettings": {
    "context-limit": 200000,
    "compression-threshold": 0.8,
    "auth-keyfile": "~/.keys/anthropic.key",
    "custom-headers": {
      "X-Organization": "my-org"
    }
  }
}
```

## Command Line Usage

### Loading Profiles at Startup

```bash
# Start with a specific profile
llxprt --profile-load my-writing-assistant

# Provide API key via command line (overrides profile)
llxprt --profile-load my-profile --key sk-ant-...

# Use a keyfile
llxprt --keyfile ~/.keys/anthropic.key

# Set provider and model
llxprt --provider anthropic --model claude-3-5-sonnet-20240620
```

### Authentication Best Practices

1. **Use Keyfiles** instead of embedding keys:

   ```bash
   # Create a keyfile with proper permissions
   echo "sk-ant-api03-..." > ~/.keys/anthropic.key
   chmod 600 ~/.keys/anthropic.key

   # Use it
   /set auth-keyfile ~/.keys/anthropic.key
   ```

2. **Never commit API keys** to version control

3. **Use environment variables** for CI/CD:
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-..."
   export OPENAI_API_KEY="sk-..."
   ```

## Examples

### Example 1: Creative Writing Setup

```bash
# Configure for creative writing
/provider anthropic
/model claude-3-5-sonnet-20240620
/set modelparam temperature 0.9
/set modelparam max_tokens 8000
/set context-limit 150000
/profile save creative-writing
```

### Example 2: Code Analysis Setup

```bash
# Configure for code analysis
/provider openai
/model o3-mini
/set modelparam temperature 0.2
/set modelparam max_tokens 4096
/set modelparam seed 42  # For reproducibility
/set compression-threshold 0.7
/profile save code-analysis
```

### Example 3: Local Model Setup

```bash
# Configure for local LLM
/provider openai  # Local servers use OpenAI protocol
/baseurl http://localhost:8080/v1
/model local-model-name
/set modelparam temperature 0.7
/profile save local-llm
```

### Example 4: Using Claude's Thinking Mode

```bash
# Enable thinking for complex reasoning
/provider anthropic
/model claude-3-5-sonnet-20240620
/set modelparam thinking {"type":"enabled","budget_tokens":8192}
/profile save deep-thinking
```

## Important Notes

### Model Parameter Validation

⚠️ **Warning**: LLxprt Code does **not** validate model parameters. This means:

- You can set any parameter, even if the provider doesn't support it
- Typos in parameter names won't be caught
- Invalid values might cause API errors
- Different models support different parameters

Always check your provider's documentation for:

- Correct parameter names (e.g., `max_tokens` vs `maxTokens`)
- Valid value ranges
- Model-specific features

### Security Considerations

1. **API Keys are sensitive**: Never share profiles containing API keys
2. **Use keyfiles**: Store keys in separate files with restricted permissions
3. **Environment isolation**: Different environments should use different keyfiles
4. **Profile sharing**: Remove auth settings before sharing profiles:
   ```bash
   /set unset auth-key
   /set unset auth-keyfile
   /profile save shareable-profile
   ```

### Provider Differences

Each provider has its own:

- Parameter names (snake_case vs camelCase)
- Value ranges (temperature 0-2 for OpenAI, 0-1 for others)
- Specific features (thinking mode, vision, etc.)
- Rate limits and pricing

Always consult your provider's documentation for the most up-to-date information.

### Troubleshooting

**"Invalid parameter" errors**: Check the exact parameter name for your provider

**Settings not persisting**: Remember that ephemeral settings are session-only unless saved to a profile

**Profile not loading**: Check that the profile exists in `~/.llxprt/profiles/`

**API errors after loading profile**: Verify that model parameters are valid for the current provider/model

**Authentication failures**: Ensure keyfiles have correct permissions (600) and valid keys
