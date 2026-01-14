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

| Setting                       | Description                                                                                          | Default                   | Example                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------- |
| `context-limit`               | Maximum tokens for context window (counts system prompt + LLXPRT.md)                                 | -                         | `100000`                           |
| `compression-threshold`       | When to compress history (0.0-1.0)                                                                   | -                         | `0.7` (70% of context)             |
| `base-url`                    | Custom API endpoint                                                                                  | -                         | `https://api.anthropic.com`        |
| `tool-format`                 | Tool format override                                                                                 | -                         | `openai`, `anthropic`, `hermes`    |
| `api-version`                 | API version (Azure)                                                                                  | -                         | `2024-02-01`                       |
| `custom-headers`              | HTTP headers as JSON                                                                                 | -                         | `{"X-Custom": "value"}`            |
| `stream-options`              | Stream options for OpenAI API                                                                        | `{"include_usage": true}` | `{"include_usage": false}`         |
| `streaming`                   | Enable or disable streaming responses (stored as `enabled`/`disabled` even if booleans are provided) | `enabled`                 | `disabled`                         |
| `socket-timeout`              | Request timeout in milliseconds for local / OpenAI-compatible servers                                | `60000`                   | `120000`                           |
| `socket-keepalive`            | Enable TCP keepalive for local AI server connections                                                 | `true`                    | `false`                            |
| `socket-nodelay`              | Enable TCP_NODELAY for local AI server connections                                                   | `true`                    | `false`                            |
| `tool-output-max-items`       | Maximum number of items/files/matches returned by tools                                              | `50`                      | `100`                              |
| `tool-output-max-tokens`      | Maximum tokens in tool output                                                                        | `50000`                   | `100000`                           |
| `tool-output-truncate-mode`   | How to handle exceeding limits                                                                       | `warn`                    | `warn`, `truncate`, or `sample`    |
| `tool-output-item-size-limit` | Maximum size per item/file in bytes                                                                  | `524288`                  | `1048576` (1MB)                    |
| `max-prompt-tokens`           | Maximum tokens allowed in any prompt sent to LLM                                                     | `200000`                  | `300000`                           |
| `shell-replacement`           | Allow command substitution ($(), <(), backticks)                                                     | `false`                   | `true`                             |
| `shell_default_timeout_ms`    | Default timeout for shell tool executions in milliseconds                                            | `60000`                   | `120000`                           |
| `shell_max_timeout_ms`        | Maximum timeout for shell tool executions in milliseconds                                            | `300000`                  | `600000`                           |
| `task_default_timeout_ms`     | Default timeout for task tool executions in milliseconds                                             | `60000`                   | `120000`                           |
| `task_max_timeout_ms`         | Maximum timeout for task tool executions in milliseconds                                             | `300000`                  | `600000`                           |
| `emojifilter`                 | Emoji filter mode for LLM responses                                                                  | `auto`                    | `allowed`, `auto`, `warn`, `error` |

**Note:** `auth-key` and `auth-keyfile` are no longer supported as ephemeral settings. Use `/key` and `/keyfile` commands instead.

### Setting Ephemeral Values

````bash
# Set context limit
/set context-limit 100000

# Set compression threshold (70% of context)
/set compression-threshold 0.7

# Set custom headers
/set custom-headers {"X-Organization": "my-org", "X-Project": "my-project"}

### Boot-time overrides

You can apply the same settings at startup via CLI flags:

```bash
llxprt --set streaming=disabled --set base-url=https://api.anthropic.com --provider anthropic

# Apply model parameters non-interactively
llxprt --set modelparam.temperature=0.7 --set modelparam.max_tokens=4096
````

The CLI parses each `--set key=value` just like `/set`, so CI jobs and scripts can configure ephemeral behavior without interactive prompts. Command-line values take precedence over profile/settings files. For model parameters, use the dotted syntax `--set modelparam.<name>=<value>` which mirrors `/set modelparam <name> <value>`.

# Configure streaming

/set streaming disabled # Disable streaming responses
/set stream-options {"include_usage": false} # OpenAI stream options

# Configure socket behavior for local/OpenAI-compatible servers

/set socket-timeout 120000
/set socket-keepalive true
/set socket-nodelay true

# Enable shell command substitution (use with caution)

/set shell-replacement true

# Tool timeout settings

/set shell_default_timeout_ms 120000
/set shell_max_timeout_ms 600000
/set task_default_timeout_ms 120000
/set task_max_timeout_ms 600000

# Tool output control settings

/set tool-output-max-items 100 # Allow up to 100 files/matches
/set tool-output-max-tokens 100000 # Allow up to 100k tokens in tool output
/set tool-output-truncate-mode truncate # Truncate instead of warning
/set tool-output-item-size-limit 1048576 # 1MB per file
/set max-prompt-tokens 300000 # Increase max prompt size

# Emoji filter settings

/set emojifilter auto # Silent filtering (default)
/set emojifilter warn # Filter with feedback
/set emojifilter error # Block content with emojis
/set emojifilter allowed # Allow emojis through

````

### Unsetting Values

```bash
# Remove a setting
/set unset context-limit

# Remove a specific header
/set unset custom-headers X-Organization
````

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
- `enable_thinking` (boolean to enable/disable thinking mode)
- `top_k`

**Reasoning Model Settings (Kimi K2-Thinking, etc.):**

- `reasoning.enabled` - enable reasoning/thinking mode
- `reasoning.includeInContext` - include reasoning in conversation context
- `reasoning.includeInResponse` - show reasoning in responses
- `reasoning.stripFromContext` (`none`, `all`, `allButLast`) - control reasoning in context history

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

### Deleting Profiles

```bash
# Delete a specific profile
/profile delete old-config

# Profile will be removed from ~/.llxprt/profiles/
```

### Setting Default Profile

```bash
# Set a profile to load automatically on startup
/profile set-default my-default-config

# Clear the default profile
/profile set-default none
```

When a default profile is set, it will be automatically loaded each time you start LLxprt Code. This is stored in your user settings (`~/.llxprt/settings.json`).

### Profile Structure

A profile JSON file looks like:

```json
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-sonnet-4-5-20250929",
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
llxprt --provider anthropic --model claude-sonnet-4-5-20250929
```

### Inline Profiles for CI/CD

For CI/CD environments, the `--profile` flag accepts inline JSON. However, for most use cases we recommend:

1. **Save profiles in the TUI** using `/profile save model <name>`
2. **Use `--profile-load`** in CI/CD to load saved profiles
3. **Store API keys securely** in CI secrets, passed via `--keyfile` or environment variables

```bash
# Recommended: Load saved profile
llxprt --profile-load my-ci-profile "Review this code"

# With keyfile from CI secrets
llxprt --profile-load my-ci-profile --keyfile /tmp/api_key "Review this code"
```

For advanced CI/CD scenarios where inline profiles are needed:

```bash
# Inline profile (advanced use case)
llxprt --profile '{"provider":"anthropic","model":"claude-sonnet-4-5-20250929"}' --keyfile /tmp/api_key "Review code"
```

**Important Notes:**

- `--profile` and `--profile-load` are mutually exclusive
- Prefer `--profile-load` with saved profiles over inline JSON
- Use `--keyfile` for API keys rather than embedding in JSON

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

## Tool Output Control

LLxprt Code provides fine-grained control over tool outputs to prevent context overflow and manage large responses. These settings are particularly useful when working with large codebases or extensive file operations.

### Tool Output Settings Explained

**`tool-output-max-items`**: Controls how many items (files, search results, etc.) a tool can return.

- Default: 50
- Use case: Increase when searching large codebases, decrease to save context

**`tool-output-max-tokens`**: Limits the total tokens in a tool's output.

- Default: 50000
- Use case: Prevent single tool calls from consuming too much context

**`tool-output-truncate-mode`**: Determines behavior when limits are exceeded.

- `warn` (default): Show warning but include all output
- `truncate`: Cut off output at the limit
- `sample`: Intelligently sample from the output

**`tool-output-item-size-limit`**: Maximum size per individual item (in bytes).

- Default: 524288 (512KB)
- Use case: Control how much of each file is read

**`max-prompt-tokens`**: Final safety limit on prompt size sent to the LLM.

- Default: 200000
- Use case: Prevent API errors from oversized prompts

### Example Configurations

```bash
# For large codebase exploration
/set tool-output-max-items 200
/set tool-output-max-tokens 150000
/set tool-output-truncate-mode sample
/profile save large-codebase

# For focused work with full file contents
/set tool-output-max-items 20
/set tool-output-item-size-limit 2097152  # 2MB per file
/set tool-output-truncate-mode warn
/profile save detailed-analysis

# For quick searches with minimal context usage
/set tool-output-max-items 10
/set tool-output-max-tokens 10000
/set tool-output-truncate-mode truncate
/profile save quick-search
```

## Examples

### Example 1: Creative Writing Setup

```bash
# Configure for creative writing
/provider anthropic
/model claude-sonnet-4-5-20250929
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
/model claude-sonnet-4-5-20250929
/set modelparam thinking {"type":"enabled","budget_tokens":8192}
/profile save deep-thinking
```

### Example 5: Using Reasoning Models (Kimi K2-Thinking)

```bash
# Configure for Kimi K2-Thinking via OpenAI-compatible API
/provider openai
/baseurl https://api.synthetic.new/openai/v1
/model hf:moonshotai/Kimi-K2-Thinking
/set reasoning.enabled true
/set reasoning.includeInContext true
/set reasoning.includeInResponse true
/set reasoning.stripFromContext none
/set streaming disabled  # Non-streaming recommended for reasoning models
/profile save k2-thinking
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
