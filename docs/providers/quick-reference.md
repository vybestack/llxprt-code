# Provider Setup Quick Reference

Concise setup instructions for configuring LLM providers in LLxprt Code. For
complete documentation, see the [full provider guide](../cli/providers.md). For
specific model names, context windows, pricing, and recommended runtime tuning,
see [Provider Models and Limits](./models-and-limits.md).

## How to configure a provider

LLxprt Code supports two configuration methods. Most providers have a built-in
alias for quick setup; providers without an alias use the OpenAI-compatible
endpoint approach.

### Using a built-in alias

```bash
/provider anthropic
/key sk-your-api-key
/model claude-opus-5
```

### Using an OpenAI-compatible endpoint

For providers without an alias, or custom endpoints:

```bash
/provider openai
/baseurl https://provider-api-url/v1/
/key your-api-key
/model model-name
```

## Built-in provider aliases

LLxprt Code ships with these aliases. Use `/provider <alias>` to switch. The
alias name is what you type after `/provider`.

| Provider                   | Alias           | Default model                | Auth method                    |
| -------------------------- | --------------- | ---------------------------- | ------------------------------ |
| Anthropic (API key)        | `anthropic`     | `claude-opus-5`              | API key (`ANTHROPIC_API_KEY`)  |
| Claude Code (subscription) | `claudecode`    | `claude-opus-5`              | OAuth                          |
| Google Gemini              | `gemini`        | `gemini-2.5-pro`             | API key (`GEMINI_API_KEY`)     |
| OpenAI (API)               | `openai`        | `gpt-5.5`                    | API key (`OPENAI_API_KEY`)     |
| OpenAI Codex (ChatGPT sub) | `codex`         | `gpt-5.6-sol`                | OAuth                          |
| Qwen (DashScope)           | `qwen`          | `qwen3-coder-plus`           | API key (`DASHSCOPE_API_KEY`)  |
| Kimi                       | `kimi`          | `kimi-for-coding`            | API key                        |
| xAI (Grok)                 | `xai`           | `grok-4`                     | API key (`XAI_API_KEY`)        |
| DeepSeek                   | `deepseek`      | `deepseek-v4-flash`          | API key (`DEEPSEEK_API_KEY`)   |
| Z.AI                       | `zai`           | `glm-5`                      | API key (`ZAI_API_KEY`)        |
| Synthetic                  | `synthetic`     | `hf:zai-org/GLM-4.7`         | API key                        |
| Chutes AI                  | `chutes-ai`     | `zai-org/GLM-5-TEE`          | API key (`CHUTES_API_KEY`)     |
| Makora                     | `makora`        | `nvidia/Kimi-K2.6-NVFP4`     | API key (`MAKORA_API_KEY`)     |
| Fireworks                  | `fireworks`     | `fireworks/minimax-m3`       | API key (`FIREWORKS_API_KEY`)  |
| OpenRouter                 | `openrouter`    | `nvidia/nemotron-nano-9b-v2` | API key (`OPENROUTER_API_KEY`) |
| Cerebras Code              | `cerebras-code` | `qwen-3-coder-480b`          | API key (`CEREBRAS_API_KEY`)   |
| Mistral                    | `mistral`       | `mistral-large-latest`       | API key (`MISTRAL_API_KEY`)    |
| LiteLLM (gateway)          | `litellm`       | `gpt-4o`                     | API key (`LITELLM_API_KEY`)    |
| Ollama Cloud (hosted)      | `ollama-cloud`  | `kimi-k2.6`                  | API key (`OLLAMA_API_KEY`)     |
| LM Studio (local)          | `lm-studio`     | `gemma-3b-it`                | None required                  |
| llama.cpp (local)          | `llama-cpp`     | `local-model`                | None required                  |

For model-specific setup details, context windows, and pricing, see
[Provider Models and Limits](./models-and-limits.md).

## Subscription and OAuth providers

Two providers support OAuth for authentication:

- **Claude Code** (`claudecode`) — Claude.ai subscription OAuth
- **Codex** (`codex`) — ChatGPT Plus/Pro subscription OAuth

```bash
# Enable OAuth for a subscription provider
/auth claudecode enable
/provider claudecode
/model claude-opus-5

# Or for Codex
/auth codex enable
/provider codex
/model gpt-5.6-sol
```

OAuth is lazy — authentication happens when you first use the provider, not when
you enable it. Check OAuth status with `/auth`, and log out with
`/auth <provider> logout`.

> **Note:** Anthropic API keys and Claude.ai subscription OAuth are separate
> identities. `anthropic` is API-key access (no OAuth). `claudecode` is
> subscription OAuth. `/auth anthropic` does not perform OAuth; it redirects
> subscription users to `/auth claudecode` and API-key users to
> `/provider anthropic` plus `/key` or `/keyfile`.

## Authentication methods

### API keys

Set a key directly or load it from a file:

```bash
# Set key directly (session-only)
/key sk-your-api-key

# Load from a file
/keyfile ~/.keys/your-provider.key
```

### Environment variables

Set keys in your shell environment. LLxprt Code auto-detects the standard
environment variable for each provider's alias:

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GEMINI_API_KEY="..."
```

The environment variable name for each alias is listed in the
[alias table](#built-in-provider-aliases) above.

### Keyfiles

A keyfile loads an API key from a file on disk, which is more secure than
passing the key inline:

```bash
/keyfile ~/.kimi_key
```

## Saving configuration as profiles

Save your provider setup for reuse across sessions:

```bash
# After configuring your provider
/profile save my-setup

# Load later
/profile load my-setup

# Use at startup
llxprt --profile-load my-setup
```

See [Settings and Profiles](../settings-and-profiles.md) for complete profile
management.

## Provider setup examples

### Anthropic (Claude)

Using an Anthropic API key:

```bash
/provider anthropic
/key sk-ant-your-key
/model claude-opus-5
```

Or Claude Code OAuth (Claude.ai subscription):

```bash
/auth claudecode enable
/provider claudecode
/model claude-opus-5
```

### Google Gemini

```bash
/provider gemini
/key your-gemini-key
/model gemini-2.5-pro
```

> **Note:** Google has removed the free consumer "Login with Google" flow for
> the Gemini CLI. Use a Gemini API key (`GEMINI_API_KEY`) or Vertex AI
> credentials. See [Google Cloud auth](../cli/google-cloud-auth.md).

### OpenAI (API key)

```bash
/provider openai
/keyfile ~/.openai_key
/model gpt-5.5
```

### Qwen

```bash
/provider qwen
/key your-dashscope-key
/model qwen3-coder-plus
```

> **Note:** Qwen is API-key-only. The free OAuth tier ended 2026-04-15 and the
> OAuth provider has been removed. Use a DashScope API key
> (`DASHSCOPE_API_KEY`) or an OpenRouter API key. See
> [authentication](../cli/authentication.md) for details.

### Kimi

Kimi's `kimi` alias defaults to the subscription path (`kimi-for-coding`). For
the pay-per-token Moonshot API, point the alias at the raw endpoint:

```bash
# Subscription (kimi-for-coding)
/provider kimi
/keyfile ~/.kimi_key
/model kimi-for-coding

# Pay-per-token (kimi-k3 on the Moonshot API)
/provider kimi
/baseurl https://api.moonshot.ai/v1
/keyfile ~/.moonshot_key
/model kimi-k3
```

See [Provider Models and Limits](./models-and-limits.md) for Kimi K3 context
windows, pricing, and multimodal support details.

### Synthetic (Hugging Face models)

```bash
/provider synthetic
/key your-synthetic-key
/model hf:zai-org/GLM-4.7
```

### Chutes AI

```bash
/provider chutes-ai
/key your-chutes-key
/model zai-org/GLM-5-TEE
```

### DeepSeek

```bash
/provider deepseek
/key your-deepseek-key
/model deepseek-v4-flash
```

### Z.AI

```bash
/provider zai
/key your-zai-key
/model glm-5
```

### Makora

```bash
/provider makora
/key your-makora-key
/model nvidia/Kimi-K2.6-NVFP4
```

### xAI (Grok)

```bash
/provider xai
/key your-xai-key
/model grok-4
```

### OpenRouter

```bash
/provider openrouter
/key your-openrouter-key
/model nvidia/nemotron-nano-9b-v2
```

### Fireworks

```bash
/provider fireworks
/key your-fireworks-key
/model fireworks/minimax-m3
```

### Cerebras Code

```bash
/provider cerebras-code
/key your-cerebras-key
/model qwen-3-coder-480b
```

> **Note:** The `/provider qwen` alias is for Qwen's own DashScope service, not
> for Cerebras.

### Mistral

```bash
/provider mistral
/key your-mistral-key
/model mistral-large-latest
```

## AI gateways and proxies

### LiteLLM

[LiteLLM](https://github.com/BerriAI/litellm) is an open-source AI gateway that
provides a unified OpenAI-compatible interface to 100+ LLM providers (Azure
OpenAI, AWS Bedrock, Vertex AI, Groq, Together, and more).

```bash
/provider litellm
/key your-litellm-key
/model anthropic/claude-sonnet-4-20250514
```

Or without the alias:

```bash
/provider openai
/baseurl http://127.0.0.1:4000/v1/
/key your-litellm-key
/model gpt-4o
```

**Environment variable:** `export LITELLM_API_KEY=sk-...`

## Local models

For complete local-model guidance, see [Using Local Models](../local-models.md).

### LM Studio

```bash
/provider lm-studio
/model your-local-model
```

Or without the alias:

```bash
/provider openai
/baseurl http://127.0.0.1:1234/v1/
/model your-local-model
```

### llama.cpp

```bash
/provider llama-cpp
/model your-model
```

Or without the alias:

```bash
/provider openai
/baseurl http://localhost:8080/v1/
/model your-model
```

### Ollama (local)

Ollama exposes an OpenAI-compatible endpoint. There is no separate local `ollama`
alias — the `ollama-cloud` alias is for the hosted ollama.com service:

```bash
/provider openai
/baseurl http://localhost:11434/v1/
/key dummy-key        # Ollama may require a non-empty key
/model qwen2.5-coder
```

For the hosted Ollama Cloud service:

```bash
/provider ollama-cloud
/key your-ollama-key
/model kimi-k2.6
```

## Provider commands reference

| Command     | Description                                                 |
| ----------- | ----------------------------------------------------------- |
| `/provider` | List all providers or switch to one                         |
| `/model`    | List available models or switch models                      |
| `/baseurl`  | Set a custom API endpoint (for OpenAI-compatible providers) |
| `/key`      | Set the API key for the current session                     |
| `/keyfile`  | Load an API key from a file                                 |
| `/auth`     | Manage OAuth authentication                                 |
| `/profile`  | Save, load, and manage configuration profiles               |
| `/set`      | Set model parameters or ephemeral settings                  |

## Next steps

1. **Configure your provider** using the examples above
2. **Save as profile** for easy reuse: `/profile save my-config`
3. **Adjust model parameters**: `/set modelparam temperature 0.7`
4. **Check model limits and pricing**: [Provider Models and Limits](./models-and-limits.md)
5. **Learn about profiles**: [Settings and Profiles](../settings-and-profiles.md)

See the [complete CLI provider documentation](../cli/providers.md) for advanced
configuration.
