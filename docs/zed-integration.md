# Zed Editor Integration

LLxprt Code integrates with the [Zed editor](https://zed.dev) as an AI assistant using the Agent Communication Protocol (ACP). This guide covers setup, configuration, and usage.

## Prerequisites

- **Zed Editor**: Download from [zed.dev](https://zed.dev)
- **LLxprt Code**: Installed globally via npm (`npm install -g @vybestack/llxprt-code`)
- **Provider API Keys**: API keys for your chosen provider(s)

## Quick Start

### 1. Find Your LLxprt Binary Path

First, locate your llxprt installation:

```bash
# On macOS/Linux
which llxprt

# Or use whereis
whereis llxprt

# Common locations:
# - macOS (Homebrew): /opt/homebrew/bin/llxprt or /usr/local/bin/llxprt
# - Linux: /usr/local/bin/llxprt or ~/.npm-global/bin/llxprt
# - npm global: Check with: npm config get prefix
```

### 2. Configure Zed Settings

Open Zed settings (`Cmd+,` on macOS, `Ctrl+,` on Linux) and add llxprt under `agent_servers`:

```json
{
  "agent_servers": {
    "llxprt": {
      "command": "/path/to/llxprt",
      "args": ["--experimental-acp"]
    }
  }
}
```

Replace `/path/to/llxprt` with the path from step 1.

## Configuration Approaches

There are two main ways to configure LLxprt for Zed:

### Approach 1: Profile-Based (Recommended)

**Best for**: Users who want to save configurations and easily switch between them.

First, create and save a profile in LLxprt:

```bash
# Launch llxprt interactively
llxprt

# Inside llxprt, configure your provider
/provider anthropic
/model claude-sonnet-4-5-20250929
/auth anthropic enable  # or use /key or /keyfile

# Save the profile
/profile save my-claude-profile

# Set as default (optional)
/profile set-default my-claude-profile
```

Then configure Zed to use the profile:

```json
{
  "agent_servers": {
    "llxprt-claude": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": [
        "--experimental-acp",
        "--profile-load",
        "my-claude-profile",
        "--yolo"
      ]
    }
  }
}
```

**Flags explained**:

- `--experimental-acp`: Enables ACP mode for Zed integration (required)
- `--profile-load <name>`: Loads a saved profile configuration
- `--yolo`: Auto-approves actions without confirmation prompts (optional)

### Approach 2: Direct Flags

**Best for**: Users who want explicit control or don't want to manage profiles.

Configure provider, model, and authentication directly in Zed settings:

```json
{
  "agent_servers": {
    "llxprt-claude": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": [
        "--experimental-acp",
        "--provider",
        "anthropic",
        "--model",
        "claude-sonnet-4-5-20250929",
        "--keyfile",
        "/Users/username/.config/anthropic/api-key.txt",
        "--yolo"
      ]
    }
  }
}
```

**Available flags**:

- `--provider <name>`: Provider to use (anthropic, openai, gemini, groq, etc.)
- `--model <name>`: Model name/ID
- `--key <apikey>`: API key directly (not recommended for security)
- `--keyfile <path>`: Path to file containing API key
- `--baseurl <url>`: Custom base URL for OpenAI-compatible providers
- `--set <key=value>`: Set ephemeral settings (can be repeated)
- `--yolo`: Auto-approve all actions

## Provider-Specific Examples

### Claude (Anthropic)

**Profile-based**:

```json
{
  "agent_servers": {
    "llxprt-claude": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": [
        "--experimental-acp",
        "--profile-load",
        "claude-profile",
        "--yolo"
      ]
    }
  }
}
```

**Direct flags**:

```json
{
  "agent_servers": {
    "llxprt-claude": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": [
        "--experimental-acp",
        "--provider",
        "anthropic",
        "--model",
        "claude-sonnet-4-5-20250929",
        "--keyfile",
        "~/.config/anthropic/key.txt",
        "--yolo"
      ]
    }
  }
}
```

### OpenAI

**Profile-based**:

```json
{
  "agent_servers": {
    "llxprt-gpt4": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": ["--experimental-acp", "--profile-load", "openai-profile"]
    }
  }
}
```

**Direct flags**:

```json
{
  "agent_servers": {
    "llxprt-gpt4": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": [
        "--experimental-acp",
        "--provider",
        "openai",
        "--model",
        "gpt-4-turbo-preview",
        "--keyfile",
        "~/.config/openai/key.txt"
      ]
    }
  }
}
```

### Google Gemini

**Profile-based**:

```json
{
  "agent_servers": {
    "llxprt-gemini": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": ["--experimental-acp", "--profile-load", "gemini-profile"]
    }
  }
}
```

**Direct flags**:

```json
{
  "agent_servers": {
    "llxprt-gemini": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": [
        "--experimental-acp",
        "--provider",
        "gemini",
        "--model",
        "gemini-2.0-flash-exp",
        "--keyfile",
        "~/.config/gemini/key.txt"
      ]
    }
  }
}
```

### Cerebras (via OpenAI-compatible API)

**Profile-based**:

```json
{
  "agent_servers": {
    "llxprt-cerebras": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": [
        "--experimental-acp",
        "--profile-load",
        "cerebrasqwen3",
        "--yolo"
      ]
    }
  }
}
```

**Direct flags**:

```json
{
  "agent_servers": {
    "llxprt-cerebras": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": [
        "--experimental-acp",
        "--provider",
        "openai",
        "--baseurl",
        "https://api.cerebras.ai/v1",
        "--model",
        "llama3.3-70b",
        "--keyfile",
        "~/.config/cerebras/key.txt",
        "--set",
        "temperature=0.7",
        "--yolo"
      ]
    }
  }
}
```

### Local Models (Ollama/LM Studio)

**Direct flags for Ollama**:

```json
{
  "agent_servers": {
    "llxprt-local": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": [
        "--experimental-acp",
        "--provider",
        "openai",
        "--baseurl",
        "http://localhost:11434/v1",
        "--model",
        "qwen2.5-coder:32b",
        "--key",
        "dummy"
      ]
    }
  }
}
```

## Advanced Configuration

### Using --set for Model Parameters

The `--set` flag allows you to override ephemeral settings:

```json
{
  "agent_servers": {
    "llxprt-custom": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": [
        "--experimental-acp",
        "--provider",
        "openai",
        "--model",
        "gpt-4",
        "--keyfile",
        "~/.openai-key.txt",
        "--set",
        "temperature=0.3",
        "--set",
        "max-tokens=4096",
        "--set",
        "base-url=https://custom-endpoint.com"
      ]
    }
  }
}
```

### Multiple Agent Configurations

You can configure multiple agents for different providers:

```json
{
  "agent_servers": {
    "llxprt-claude": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": ["--experimental-acp", "--profile-load", "claude"]
    },
    "llxprt-gpt4": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": ["--experimental-acp", "--profile-load", "openai"]
    },
    "llxprt-local": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": [
        "--experimental-acp",
        "--provider",
        "openai",
        "--baseurl",
        "http://localhost:11434/v1",
        "--model",
        "qwen2.5-coder",
        "--key",
        "dummy"
      ]
    }
  }
}
```

Switch between agents in Zed using the assistant panel.

## Debug Logging

### Enable Debug Logs

Add the `DEBUG` environment variable to enable detailed logging:

```json
{
  "agent_servers": {
    "llxprt-debug": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": ["--experimental-acp", "--profile-load", "myprofile"],
      "env": {
        "DEBUG": "llxprt:*"
      }
    }
  }
}
```

**Warning**: Debug logging creates large log files in `~/.llxprt/debug/`. Only enable when troubleshooting.

### Debug Namespaces

You can target specific components:

```json
"env": {
  "DEBUG": "llxprt:zed-integration"
}
```

Common namespaces:

- `llxprt:*` - All debug output
- `llxprt:zed-integration` - Zed integration only
- `llxprt:providers:*` - All provider debug output
- `llxprt:providers:anthropic` - Anthropic provider only
- `llxprt:providers:openai` - OpenAI provider only
- `llxprt:core:client` - Core client operations

## Troubleshooting

### Issue: "Command not found" or agent won't start

**Solution**: Verify the llxprt binary path is correct:

```bash
which llxprt
# Update the "command" field in Zed settings with this path
```

### Issue: Authentication failures

**Solutions**:

- Verify API key is valid: `cat ~/.config/provider/key.txt`
- Check keyfile path is absolute (not relative)
- For OAuth: Run `llxprt` and complete `/auth <provider> enable` flow first
- Try using `--key` directly for testing (not recommended for production)

### Issue: Agent appears in list but doesn't respond

**Solutions**:

- Enable debug logging (add `"env": {"DEBUG": "llxprt:*"}`)
- Check `~/.llxprt/debug/` for error messages
- Verify model name is correct for your provider
- Try with `--yolo` flag to avoid confirmation prompts

### Issue: "Failed to load profile"

**Solutions**:

- List available profiles: `llxprt` then `/profile list`
- Verify profile name matches exactly (case-sensitive)
- Create profile if missing: `/profile save <name>`
- Use direct flags approach instead

### Issue: Wrong model or provider being used

**Solutions**:

- Check for conflicting environment variables (`LLXPRT_DEFAULT_PROVIDER`, etc.)
- Use `--provider` and `--model` flags explicitly
- Avoid mixing `--profile-load` with conflicting flags

### Issue: Rate limiting or quota errors

**Solutions**:

- Check provider dashboard for quota/limits
- Verify billing is active for your provider account
- Try a different model or provider
- Use `--set` to adjust request parameters

## Best Practices

1. **Security**: Use `--keyfile` instead of `--key` to avoid exposing keys in config files
2. **Simplicity**: Use profile-based approach for cleaner configurations
3. **Multiple Providers**: Configure multiple agents to easily switch between providers
4. **Debug Sparingly**: Only enable debug logging when troubleshooting
5. **YOLO Mode**: Use `--yolo` to streamline workflow, but understand it auto-approves all actions

## Related Documentation

- [Zed External Agents Documentation](https://zed.dev/docs/ai/external-agents)
- [LLxprt Configuration Guide](./cli/configuration.md)
- [LLxprt Provider Guide](./cli/providers.md)
- [LLxprt Profiles Documentation](./cli/profiles.md)
- [LLxprt Authentication Guide](./cli/authentication.md)

## See Also

- [Issue #1116](https://github.com/vybestack/llxprt-code/issues/1116) - Documentation improvement tracking
- [Discussion #209](https://github.com/vybestack/llxprt-code/discussions/209) - Community discussion on Zed integration
