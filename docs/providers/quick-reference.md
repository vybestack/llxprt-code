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

## Model Geometry and Budgeting (all providers)

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

> **Auth-variant note:** Context windows often differ between API-key access and OAuth/subscription access for the same model. The numbers below name the variant where it matters. When in doubt, start lower and increase until you hit a provider limit error.

> **Reasoning tips:**
> Interleaved-thinking models (e.g. MiniMax, Kimi) rely on prior reasoning tokens, so keep recent reasoning in context (`/set reasoning.stripFromContext none`).
> When you need to manage a large window, trim older reasoning while surfacing recent thinking blocks (`/set reasoning.stripFromContext allButLast` or `all`).

## Subscription & OAuth Providers

### OpenAI Codex (ChatGPT Plus/Pro OAuth)

Use your ChatGPT Plus or Pro subscription directly — no API key needed:

```bash
/auth codex enable
/provider codex
/model gpt-5.5
```

This uses OAuth to authenticate with your ChatGPT subscription.

#### Model geometry & recommended settings (Codex)

- Context: 262,144 tokens (Codex OAuth)
- gpt-5.x reasoning models do NOT support temperature — use `/set reasoning.effort` instead
- Reasoning effort: `low`, `medium`, `high`, `xhigh`

```bash
/set context-limit 262144
/set modelparam max_tokens 8192
/set reasoning.effort high
```

**Common models:** `gpt-5.5`, `gpt-5.3-codex`, `gpt-5.2-codex`

### Anthropic (Claude)

#### Using Alias (Recommended)

```bash
/provider anthropic
/key sk-ant-your-key
/model claude-opus-4-8
```

#### Or OAuth (Claude Pro/Max)

```bash
/auth anthropic enable
```

Note: OAuth is lazy — authentication happens when you first use the provider.

#### Model geometry & recommended settings (Anthropic)

Common models: `claude-opus-4-8`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-haiku-4-5`

Guidance:

- Default context-limit 200000 (Opus). Sonnet may support a larger window depending on your Anthropic plan; the very large (1M-class) windows are plan/credit-gated rather than always-on. Check Anthropic's documentation for your current limits.
- If you enable thinking, increase max_tokens as needed and keep ≥1k tokens of safety.

```bash
/set context-limit 200000
/set modelparam max_tokens 4096
/set reasoning.effort high
```

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-opus-4-8",
  "modelParams": { "max_tokens": 4096 },
  "ephemeralSettings": { "context-limit": 200000 }
}
```

**Environment variable:** `export ANTHROPIC_API_KEY=sk-ant-...`

### Google Gemini

#### Using Alias

```bash
/provider gemini
/key your-gemini-key
/model gemini-2.5-pro
```

#### Or OAuth

```bash
/auth gemini enable
```

Note: OAuth is lazy — authentication happens when you first use the provider.

> **Important (gemini-cli → Antigravity):** Google ended free consumer "Login with Google" access for the Gemini CLI integration in mid-2026, directing individual users to **Antigravity**. OAuth via `/auth gemini` still works for **paid Gemini API keys** and **Gemini Code Assist Standard/Enterprise** accounts. If a free personal Google login no longer authorizes, use a Gemini **API key** instead. See [Google Cloud auth](../cli/google-cloud-auth.md).

#### Model geometry & recommended settings (Gemini)

Common models: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite` (stable). Preview models `gemini-3-pro-preview` and `gemini-3-flash-preview` are also selectable.

Guidance:

- Context-limit up to 1048576 (API key) for Gemini 2.5 models; lower if you see provider limit errors. OAuth/Code-Assist windows can be smaller depending on plan.
- Max output tokens: up to 65536

```bash
/set context-limit 1048576
/set modelparam max_tokens 4096
```

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "gemini",
  "model": "gemini-2.5-pro",
  "modelParams": { "temperature": 0.7, "max_tokens": 4096 },
  "ephemeralSettings": { "context-limit": 1048576 }
}
```

**Environment variable:** `export GEMINI_API_KEY=...`

### Qwen

#### Using Alias with API Key

```bash
/provider qwen
/key your-dashscope-key
/model qwen3-coder-plus
```

> **Qwen is now API-key-only.** Qwen's free OAuth tier ended 2026-04-15 and the OAuth provider has been removed. Use a DashScope API key (`DASHSCOPE_API_KEY`) or an OpenRouter API key. See [authentication](../cli/authentication.md) for details.

#### Model geometry & recommended settings (Qwen)

Common models: `qwen3-coder-plus`, `qwen3-coder`

Guidance:

- Start with context-limit 200000; lower if you hit provider limits.
- This alias is for Qwen's own service. It is **not** used for Cerebras.

```bash
/set context-limit 200000
/set modelparam max_tokens 4096
```

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "qwen",
  "model": "qwen3-coder-plus",
  "modelParams": { "temperature": 0.7, "max_tokens": 4096 },
  "ephemeralSettings": { "context-limit": 200000 }
}
```

## API-Key Providers (with aliases)

### OpenAI (API Key)

```bash
/provider openai
/keyfile ~/.openai_key
/model gpt-5.5
```

#### Model geometry & recommended settings (OpenAI)

Common models: `gpt-5.5`, `gpt-5.4`, `gpt-5.2`

Guidance:

- gpt-5.x reasoning models do NOT support temperature — use `/set reasoning.effort` instead
- Reasoning effort: `low`, `medium`, `high`, `xhigh`

```bash
/set context-limit 400000 # adjust to your model's actual window (check provider docs)
/set modelparam max_tokens 8192
/set reasoning.effort high
```

### Kimi (Moonshot AI)

Kimi offers the K2-family models with deep reasoning and multi-step tool orchestration.

#### Using API Key

```bash
/provider kimi
/keyfile ~/.kimi_key
/model kimi-for-coding
```

#### Model geometry & recommended settings (Kimi)

- Context: 262,144 tokens
- Max output: 32,768 tokens
- Architecture: Trillion-parameter MoE (32B active)
- Strengths: Deep reasoning, 200-300 sequential tool calls, native thinking mode

```bash
/set context-limit 262144
/set modelparam max_tokens 32768
/set reasoning.enabled true
/set reasoning.includeInResponse true
```

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "kimi",
  "model": "kimi-for-coding",
  "modelParams": { "max_tokens": 32768 },
  "ephemeralSettings": {
    "context-limit": 262144,
    "reasoning.enabled": true,
    "reasoning.includeInResponse": true
  }
}
```

#### Kimi K2 via Synthetic/Chutes

Kimi K2 is also available through third-party providers:

```bash
# Via Synthetic
/provider synthetic
/keyfile ~/.synthetic_key
/model hf:moonshotai/Kimi-K2.7-Code

# Via Chutes
/provider chutes-ai
/keyfile ~/.chutes_key
/model moonshotai/Kimi-K2.7-Code
```

### Synthetic (Hugging Face Models)

```bash
/provider synthetic
/key your-synthetic-key
/model hf:zai-org/GLM-4.7
```

#### Model geometry & recommended settings (Synthetic)

Popular models: `hf:zai-org/GLM-4.7`, `hf:moonshotai/Kimi-K2.7-Code`

Guidance:

- Context varies by model/runtime. Start with context-limit 200000 and adjust.

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
  "ephemeralSettings": { "context-limit": 200000 }
}
```

### Chutes AI

```bash
/provider chutes-ai    # Has built-in alias
# OR
/provider openai
/baseurl https://api.chutes.ai/v1/
/key your-chutes-key
/model zai-org/GLM-5-TEE
```

#### Model geometry & recommended settings (Chutes AI)

```bash
/set context-limit 200000
/set modelparam max_tokens 4096
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

## Models Requiring Custom BaseURL

These providers use the OpenAI-compatible endpoint approach (most also have built-in aliases shown above).

### xAI (Grok)

```bash
/provider xai          # Has built-in alias
# OR
/provider openai
/baseurl https://api.x.ai/v1/
/key your-xai-key
/model grok-4
```

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "openai",
  "model": "grok-4",
  "modelParams": { "max_tokens": 4096, "temperature": 0.7 },
  "ephemeralSettings": {
    "context-limit": 200000,
    "base-url": "https://api.x.ai/v1"
  }
}
```

### OpenRouter

```bash
/provider openrouter   # Has built-in alias
# OR
/provider openai
/baseurl https://openrouter.ai/api/v1/
/key your-openrouter-key
/model nvidia/nemotron-nano-9b-v2
```

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "openai",
  "model": "nvidia/nemotron-nano-9b-v2",
  "modelParams": { "max_tokens": 4096, "temperature": 0.7 },
  "ephemeralSettings": {
    "context-limit": 200000,
    "base-url": "https://openrouter.ai/api/v1"
  }
}
```

### Fireworks

```bash
/provider fireworks    # Has built-in alias
# OR
/provider openai
/baseurl https://api.fireworks.ai/inference/v1/
/key your-fireworks-key
/model fireworks/minimax-m3
```

### Cerebras Code

```bash
/provider cerebras-code   # Has built-in alias
# OR
/provider openai
/baseurl https://api.cerebras.ai/v1/
/key your-cerebras-key
/model qwen-3-coder-480b
# Recommended runtime tuning:
/set context-limit 131000
/set modelparam max_tokens 10000
```

**Notes:**

- The Cerebras endpoint may limit context below a model's full window; budget room for completions.
- Effective prompt budget = context-limit − max_tokens − safety.
- The `/provider qwen` alias is for Qwen's own service, not for Cerebras.

## Local Models

For complete local-model guidance, see [Using Local Models](../local-models.md).

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

#### Model geometry & recommended settings (Local)

Context depends on your local runtime and model build. Start small and increase:

```bash
/set context-limit 32000
/set modelparam max_tokens 2048
```

### Ollama

Ollama exposes an OpenAI-compatible endpoint. Use the `openai` provider with a local base URL (there is no separate local `ollama` alias; the built-in `ollama-cloud` alias is for the hosted ollama.com service):

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

**Three** providers support OAuth for authentication: Anthropic, Codex (ChatGPT), and Gemini.

```bash
# Enable OAuth provider (lazy authentication - happens on first use)
/auth anthropic enable
/auth codex enable
/auth gemini enable

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
