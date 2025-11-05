# Provider Quick Reference

This guide provides concise setup instructions for common LLM providers. For complete documentation, see the [full provider guide](../cli/providers.md).

## Provider Configuration Methods

LLxprt Code supports two main ways to configure providers:

### 1. Using Built-in Aliases

Many popular providers have built-in aliases for quick setup:

```bash
# Use the alias (recommended for supported providers)
/provider anthropic
/provider gemini
/provider qwen
/provider synthetic

# Then set your key and model
/key sk-your-api-key
/model your-model-name
```

### 2. Using OpenAI-Compatible Endpoint

For providers without aliases, use the OpenAI protocol:

```bash
/provider openai
/baseurl https://provider-api-url/v1/
/key your-api-key
/model model-name
```

## Common Providers

### OpenAI

```bash
/provider openai
/key sk-your-openai-key
/model o3-mini
```

**Common models:** `o3-mini`, `o1-preview`, `gpt-4o`, `gpt-4.1`

**Environment variable:** `export OPENAI_API_KEY=sk-...`

### Anthropic (Claude)

#### Using Alias (Recommended)

```bash
/provider anthropic
/key sk-ant-your-key
/model claude-sonnet-4-20250115
```

#### Or OAuth (Claude Pro/Max)

```bash
/auth anthropic enable
```

Note: OAuth is lazy - authentication happens when you first use the provider.

**Common models:** `claude-sonnet-4-20250115`, `claude-opus-4`, `claude-sonnet-3.5`

**Environment variable:** `export ANTHROPIC_API_KEY=sk-ant-...`

### Google Gemini

#### Using Alias

```bash
/provider gemini
/key your-gemini-key
/model gemini-2.0-flash
```

#### Or OAuth

```bash
/auth gemini enable
```

Note: OAuth is lazy - authentication happens when you first use the provider.

**Common models:** `gemini-2.0-flash`, `gemini-pro`

**Environment variable:** `export GEMINI_API_KEY=...`

### Synthetic (Hugging Face Models)

```bash
/provider synthetic
/key your-synthetic-key
/model hf:zai-org/GLM-4.6
```

**Popular models:** `hf:zai-org/GLM-4.6`, `hf:mistralai/Mixtral-8x7B`

### Qwen (Free)

#### OAuth (Free)

```bash
/auth qwen enable
```

#### Using Alias with API Key

```bash
/provider qwen
/key your-qwen-key
/model qwen3-coder-pro
```

### Models Requiring Custom BaseURL

These providers use the OpenAI-compatible endpoint approach:

#### xAI (Grok)

```bash
/provider openai
/baseurl https://api.x.ai/v1/
/key your-xai-key
/model grok-3
```

#### OpenRouter

```bash
/provider openai
/baseurl https://openrouter.ai/api/v1/
/key your-openrouter-key
/model qwen/qwen3-coder
```

#### Fireworks

```bash
/provider openai
/baseurl https://api.fireworks.ai/inference/v1/
/key your-fireworks-key
/model accounts/fireworks/models/llama-v3p3-70b-instruct
```

#### Cerebras

```bash
/provider openai
/baseurl https://api.cerebras.ai/v1/
/key your-cerebras-key
/model qwen-3-coder-480b
```

#### Chutes AI

```bash
/provider chutes    # Has built-in alias
# OR
/provider openai
/baseurl https://api.chutes.ai/v1/
/key your-chutes-key
/model your-model
```

## Local Models

### LM Studio

```bash
/provider lm-studio    # Has built-in alias
# OR
/provider openai
/baseurl http://127.0.0.1:1234/v1/
/model your-local-model
```

### llama.cpp

```bash
/provider llama-cpp    # Has built-in alias
# OR
/provider openai
/baseurl http://localhost:8080/v1/
/model your-model
```

### Ollama

```bash
/provider ollama      # Has built-in alias
# OR
/provider openai
/baseurl http://localhost:11434/v1/
/key dummy-key        # Ollama may require a dummy key
/model codellama:13b
```

## Authentication Methods

### API Keys

Set directly with `/key` or load from file:

```bash
# Set key directly
/key sk-your-api-key

# Load from file (more secure)
/keyfile ~/.keys/your-provider.key
```

### OAuth

Three providers support OAuth for authentication:

```bash
# Enable OAuth provider (lazy authentication - happens on first use)
/auth anthropic enable
/auth gemini enable
/auth qwen enable

# Check OAuth status
/auth

# Logout from provider
/auth provider-name logout
```

### Environment Variables

Set keys in your shell environment (auto-detected):

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GEMINI_API_KEY="..."
```

## Saving Configuration as Profiles

Save your provider setup for reuse:

```bash
# After configuring your provider
/profile save my-setup

# Load later
/profile load my-setup

# Use at startup
llxprt --profile-load my-setup
```

**See [Settings and Profiles](../settings-and-profiles.md) for complete profile management**

## Provider Commands Reference

- `/provider` - List all providers or switch to one
- `/model` - List available models or switch models
- `/baseurl` - Set custom API endpoint (for OpenAI-compatible providers)
- `/key` - Set API key for current session
- `/keyfile` - Load key from file
- `/auth` - OAuth authentication
- `/profile save` - Save current provider configuration

## Next Steps

1. **Configure your provider** using the examples above
2. **Save as profile** for easy reuse: `/profile save my-config`
3. **Adjust model parameters** like temperature: `/set modelparam temperature 0.7`
4. **Learn about profiles**: [Settings and Profiles Guide](../settings-and-profiles.md)

**See [complete CLI provider documentation](../cli/providers.md) for advanced configuration**
