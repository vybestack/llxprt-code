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

### Model geometry and budgeting (all providers)

When you set a model, configure both context-limit (ephemeral) and max_tokens (model param):

- **context-limit**: The total tokens allowed for the entire request (prompt + output)
- **max_tokens**: The maximum tokens reserved for the model's response (output only)
- **Effective prompt budget** = context-limit − max_tokens − safety-margin

**Important constraint**: You cannot set context-limit + max_tokens to exceed the model's actual limit. For example:

- If a model supports 200k total context, you CANNOT set context-limit=200000 AND max_tokens=100000
- The system needs room for both your prompt AND the response within the limit

**Safety margin**: 256–2048 tokens (recommend 1024) to avoid last-second overflows from tool wrappers, system prompt, and LLXPRT.md.

**Tip**: If you see "would exceed the token context window" errors, lower max_tokens first or reduce LLXPRT.md size.

Examples:

- Large coding session: context-limit 121000, max_tokens 10000 → prompt budget ≈ 110k (minus safety).
- Writing mode: context-limit 190000, max_tokens 8000 → prompt budget ≈ 181k (minus safety).

> **Reasoning tips:**  
> MiniMax M2.1 relies on interleaved thinking tokens, so keep prior reasoning in context (`/set reasoning.stripFromContext none`).  
> Kimi K2 can trim older reasoning when you need to manage its 256k window (`/set reasoning.stripFromContext allButLast` or `all`) while still surfacing recent thinking blocks.

### OpenAI (API Key)

```bash
/provider openai
/keyfile ~/.openai_key
/model gpt-5.2
```

#### Model geometry & recommended settings (OpenAI)

Common models: gpt-5.2, gpt-5.2-nano

Guidance:

- gpt-5.2 context: 200k (via Codex/API key), max output 32k
- gpt-5.2-nano: Faster, smaller variant for simpler tasks
- **Note**: gpt-5.2 does NOT support temperature - use `/set reasoning.effort` instead
- Reasoning effort: `low`, `medium`, `high`, `xhigh`
- Example setup:

```bash
/set context-limit 200000
/set modelparam max_tokens 4096
/set reasoning.effort high  # replaces temperature for reasoning models
```

**Common models:** `gpt-5.2`, `gpt-5.2-nano`

### OpenAI Codex (ChatGPT Plus/Pro OAuth)

Use your ChatGPT Plus or Pro subscription directly:

```bash
/auth codex enable
/provider codex
/model gpt-5.2
```

This uses OAuth to authenticate with your ChatGPT subscription - no API key needed.

### Kimi (Moonshot AI)

Kimi offers the K2 Thinking model with deep reasoning and multi-step tool orchestration.

#### Using OAuth (Subscription)

```bash
/auth kimi enable
/provider kimi
/model kimi-k2-thinking
```

#### Using API Key

```bash
/provider kimi
/keyfile ~/.kimi_key
/model kimi-k2-thinking
```

#### Model geometry & recommended settings (Kimi)

- Context: 262,144 tokens
- Architecture: Trillion-parameter MoE (32B active)
- Strengths: Deep reasoning, 200-300 sequential tool calls, native thinking mode

Example setup:

```bash
/set context-limit 262000
/set modelparam max_tokens 8192
/set reasoning.enabled true
/set reasoning.includeInResponse true
```

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "kimi",
  "model": "kimi-k2-thinking",
  "modelParams": { "max_tokens": 8192 },
  "ephemeralSettings": {
    "context-limit": 262000,
    "reasoning.enabled": true,
    "reasoning.includeInResponse": true
  }
}
```

#### Kimi K2 via Synthetic/Chutes

Kimi K2 Thinking is also available through third-party providers:

```bash
# Via Synthetic
/provider synthetic
/keyfile ~/.synthetic_key
/model hf:moonshotai/Kimi-K2-Thinking

# Via Chutes
/provider chutes
/keyfile ~/.chutes_key
/model kimi-k2-thinking
```

### Anthropic (Claude)

#### Using Alias (Recommended)

```bash
/provider anthropic
/key sk-ant-your-key
/model claude-sonnet-4-5-20250929
```

#### Or OAuth (Claude Pro/Max)

```bash
/auth anthropic enable
```

Note: OAuth is lazy - authentication happens when you first use the provider.

#### Model geometry & recommended settings (Anthropic)

Common models: claude-haiku-4-5-20251001, claude-sonnet-4-5-20250929, claude-opus-4-5-20251101

Guidance:

- Start with context-limit 200000.
- If you enable thinking, increase max_tokens as needed and keep ≥1k tokens of safety.
- Example setup:

```bash
 /set context-limit 200000
 /set modelparam max_tokens 4096
 /set modelparam temperature 0.7
```

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-sonnet-4-5-20250929",
  "modelParams": { "temperature": 0.7, "max_tokens": 4096 },
  "ephemeralSettings": { "context-limit": 200000 }
}
```

**Common models:** `claude-haiku-4-5-20251001`, `claude-sonnet-4-5-20250929`, `claude-opus-4-5-20251101`

**Environment variable:** `export ANTHROPIC_API_KEY=sk-ant-...`

### Google Gemini

#### Using Alias

```bash
/provider gemini
/key your-gemini-key
/model gemini-3-flash-preview
```

#### Model geometry & recommended settings (Gemini)

Common models: gemini-3-flash-preview, gemini-3-pro-preview

Guidance:

- Use context-limit 1048576 for Gemini 3 models; lower if you see provider limit errors.
- Max output tokens: 65536
- Example setup:

```bash
/set context-limit 1048576
/set modelparam max_tokens 4096   # Gemini often uses camelCase params in native SDKs, but LLxprt forwards what you set
```

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "gemini",
  "model": "gemini-3-flash-preview",
  "modelParams": { "temperature": 0.7, "max_tokens": 4096 },
  "ephemeralSettings": { "context-limit": 1048576 }
}
```

#### Model geometry & recommended settings (Synthetic)

Popular models: hf:zai-org/GLM-4.7, hf:mistralai/Mixtral-8x7B

Guidance:

- Context varies by model/runtime. Start with context-limit 200000 and adjust.
- Example setup:

```bash
/set context-limit 200000
/set modelparam max_tokens 4096
```

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "synthetic",
  "model": "hf:zai-org/GLM-4.7",
  "modelParams": { "temperature": 0.7, "max_tokens": 4096 },
  "ephemeralSettings": {}
}
```

#### Or OAuth

```bash
/auth gemini enable
```

Note: OAuth is lazy - authentication happens when you first use the provider.

**Common models:** `gemini-3-flash-preview`, `gemini-3-pro-preview`

**Environment variable:** `export GEMINI_API_KEY=...`

### Synthetic (Hugging Face Models)

````bash
/provider synthetic
/key your-synthetic-key

#### Model geometry & recommended settings (Qwen)

Common models: qwen3-coder-pro, qwen3-coder

Guidance:
- Use /auth qwen enable for OAuth (free) or /provider qwen for API key usage.
- Start with context-limit 200000; lower if you hit provider limits.
- Example setup:
```bash
/set context-limit 200000
/set modelparam max_tokens 4096
````

**Important:** This alias is for Qwen's own service. It is not used for Cerebras.

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "qwen",
  "model": "qwen3-coder-pro",
  "modelParams": { "temperature": 0.7, "max_tokens": 4096 },
  "ephemeralSettings": { "context-limit": 200000 }
}
```

/model hf:zai-org/GLM-4.7

````

**Popular models:** `hf:zai-org/GLM-4.7`, `hf:mistralai/Mixtral-8x7B`

### Qwen (Free)

#### OAuth (Free)


#### Model geometry & recommended settings (xAI)

Model: grok-3 (example)

- Example setup:
```bash
/set context-limit 200000
/set modelparam max_tokens 4096
````

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "openai",
  "model": "grok-3",
  "modelParams": { "max_tokens": 4096, "temperature": 0.7 },
  "ephemeralSettings": {
    "context-limit": 200000,
    "base-url": "https://api.x.ai/v1"
  }
}
```

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

````bash
/provider openai
/baseurl https://openrouter.ai/api/v1/
/key your-openrouter-key

#### Model geometry & recommended settings (OpenRouter)

Example model: qwen/qwen3-coder

- Example setup:
```bash
/set context-limit 200000
/set modelparam max_tokens 4096
````

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "openai",
  "model": "qwen/qwen3-coder",
  "modelParams": { "max_tokens": 4096, "temperature": 0.7 },
  "ephemeralSettings": {
    "context-limit": 200000,
    "base-url": "https://openrouter.ai/api/v1"
  }
}
```

#### Model geometry & recommended settings (Fireworks)

Example model: accounts/fireworks/models/llama-v3p3-70b-instruct

- Example setup:

```bash
/set context-limit 200000
/set modelparam max_tokens 4096
```

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "openai",
  "model": "accounts/fireworks/models/llama-v3p3-70b-instruct",
  "modelParams": { "max_tokens": 4096, "temperature": 0.7 },
  "ephemeralSettings": {
    "context-limit": 200000,
    "base-url": "https://api.fireworks.ai/inference/v1"
  }
}
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

#### Cerebras (GLM-4.7)

```bash
/provider openai
/baseurl https://api.cerebras.ai/v1/
/key your-cerebras-key
/model zai-glm-4.7
# Recommended runtime tuning:
/set context-limit 131000
/set modelparam max_tokens 10000
/set modelparam temperature 1
```

**Notes:**

- GLM-4.7 model supports 200k context, but **Cerebras endpoint limits to ~131k**.
- Budget room for completions: effective prompt budget = context-limit − max_tokens − safety.
- The /provider qwen alias is for Qwen's own service, not for Cerebras.

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "openai",
  "model": "zai-glm-4.7",
  "modelParams": {
    "temperature": 1,
    "max_tokens": 10000
  },
  "ephemeralSettings": {
    "context-limit": 131000,
    "base-url": "https://api.cerebras.ai/v1",
    "shell-replacement": true
  }
}
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

#### Model geometry & recommended settings (Chutes AI)

- Example setup:

```bash
/set context-limit 200000
/set modelparam max_tokens 4096
```

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "openai",
  "model": "your-model",
  "modelParams": { "max_tokens": 4096, "temperature": 0.7 },
  "ephemeralSettings": {
    "context-limit": 200000,
    "base-url": "https://api.chutes.ai/v1"
  }
}
```

### LM Studio

```bash
/provider lm-studio    # Has built-in alias
# OR
/provider openai
/baseurl http://127.0.0.1:1234/v1/
/model your-local-model
```

### llama.cpp

````bash
/provider llama-cpp    # Has built-in alias
# OR
/provider openai

### Model geometry & recommended settings (Local)

Context depends on your local runtime and model build. Start with:
```bash
/set context-limit 32000
/set modelparam max_tokens 2048
# Increase gradually as your runtime allows.
````

**Ollama tip:**

```bash
/provider openai
/baseurl http://localhost:11434/v1
/key dummy-key
/model codellama:13b
```

/baseurl http://localhost:8080/v1/
/model your-model

````

### Ollama

```bash
/provider ollama      # Has built-in alias
# OR
/provider openai
/baseurl http://localhost:11434/v1/
/key dummy-key        # Ollama may require a dummy key
/model codellama:13b
````

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
