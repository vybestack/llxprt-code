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
/model gpt-5.6-sol
```

This uses OAuth to authenticate with your ChatGPT subscription.

#### Model geometry & recommended settings (Codex)

- Context: 262,144 tokens (Codex OAuth)
- gpt-5.x reasoning models do NOT support temperature — use `/set reasoning.effort` instead
- Reasoning effort: `minimal`, `low`, `medium`, `high`, `xhigh`, `max`

```bash
/set context-limit 262144
/set modelparam max_tokens 8192
/set reasoning.effort high
```

**Common models:** `gpt-5.6-sol` (default), `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`

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

#### Or API Key

```bash
/key save gemini your-gemini-key
```

Note: Set the key before your first request to that provider.

> **Important (Gemini "Login with Google" removed):** Google has removed the free consumer "Login with Google" flow for the Gemini CLI entirely. Use a Gemini **API key** (`GEMINI_API_KEY`) or **Vertex AI** credentials instead. See [Google Cloud auth](../cli/google-cloud-auth.md).

#### Model geometry & recommended settings (Gemini)

Common models: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite` (stable). Preview models `gemini-3-pro-preview` and `gemini-3-flash-preview` are also selectable.

Guidance:

- Context-limit up to 1048576 (API key) for Gemini 2.5 models; lower if you see provider limit errors.
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
/model gpt-5.6-sol
```

#### Model geometry & recommended settings (OpenAI)

Common models: `gpt-5.6` (Sol alias), `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`

GPT-5.6+ models automatically use the Responses API on canonical OpenAI (`api.openai.com`); custom OpenAI-compatible base URLs stay on Chat Completions.

Guidance:

- Context: up to 1,048,576 tokens on the OpenAI API (vs. 262,144 via Codex OAuth — see the Codex section above)
- gpt-5.x reasoning models do NOT support temperature — use `/set reasoning.effort` instead
- Reasoning effort: `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. `max` is model/provider-specific; project `minimal` maps to wire `none` for GPT-5.6 Responses.

```bash
/set context-limit 400000 # adjust to your model's actual window (check provider docs)
/set modelparam max_tokens 8192
/set reasoning.effort high
```

### Kimi (Moonshot AI)

Kimi ships the K3 frontier model with deep reasoning, multi-step tool orchestration, and native multimodal vision. There are two ways to reach it:

- **`kimi-for-coding`** — the subscription-served model (Kimi Code subscription). Use the `kimi` provider alias, which points at the `/coding/v1` endpoint. Thinking is always on.
- **`kimi-k3`** — the pay-per-token model on the raw Moonshot API (`https://api.moonshot.ai/v1`). Same K3 capabilities, billed per token.

> **Note:** The `kimi` alias's `defaultModel` is `kimi-for-coding` (the subscription path). To use the pay-per-token `kimi-k3` on the Moonshot API, point the alias at the raw endpoint with `/baseurl https://api.moonshot.ai/v1` and `/model kimi-k3`.

#### Using the subscription (kimi-for-coding)

```bash
/provider kimi
/keyfile ~/.kimi_key
/model kimi-for-coding
```

#### Using the Moonshot API pay-per-token (kimi-k3)

```bash
/provider kimi
/baseurl https://api.moonshot.ai/v1
/keyfile ~/.moonshot_key
/model kimi-k3
```

#### Model geometry & recommended settings (Kimi K3)

- Context: 1,000,000 tokens (1M)
- Max output: 131,072 tokens (default; up to 1,048,576 max)
- Architecture: Frontier MoE with always-on thinking
- Strengths: Deep reasoning, 200-300 sequential tool calls, native vision (images **and** video)
- Reasoning effort: `low` / `high` / `max` (default `max`). **There is no `medium` for K3.** Thinking is always on and cannot be disabled.
- Vision: Native, but requires base64 or `ms://<file-id>` inputs — public image URLs are not accepted.

```bash
/set context-limit 1000000
/set modelparam max_tokens 131072
/set reasoning.effort max
/set reasoning.enabled true
/set reasoning.includeInResponse true
```

**Profile JSON (pay-per-token kimi-k3 on the Moonshot API):**

```json
{
  "version": 1,
  "provider": "kimi",
  "model": "kimi-k3",
  "modelParams": { "max_tokens": 131072 },
  "ephemeralSettings": {
    "context-limit": 1000000,
    "base-url": "https://api.moonshot.ai/v1",
    "reasoning.effort": "max",
    "reasoning.enabled": true,
    "reasoning.includeInResponse": true
  }
}
```

#### Pricing (Kimi K3)

- **Subscription (`kimi-for-coding`)** — flat-rate Kimi Code subscription plan; usage is covered by the subscription.
- **Pay-per-token (`kimi-k3` on the Moonshot API)** — $0.30 / 1M cached input tokens, $3.00 / 1M non-cached input tokens, $15.00 / 1M output tokens (flat).

#### Kimi K3 via Synthetic/Chutes

Kimi K3 is also available through third-party providers:

```bash
# Via Synthetic
/provider synthetic
/keyfile ~/.synthetic_key
/model hf:moonshotai/Kimi-K3

# Via Chutes
/provider chutes-ai
/keyfile ~/.chutes_key
/model moonshotai/Kimi-K3
```

### Synthetic (Hugging Face Models)

```bash
/provider synthetic
/key your-synthetic-key
/model hf:zai-org/GLM-4.7
```

#### Model geometry & recommended settings (Synthetic)

Popular models: `hf:zai-org/GLM-4.7`, `hf:moonshotai/Kimi-K3`

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

## AI Gateways / Proxies

### LiteLLM

[LiteLLM](https://github.com/BerriAI/litellm) is an open-source AI gateway that provides a unified OpenAI-compatible interface to 100+ LLM providers (Azure OpenAI, AWS Bedrock, Vertex AI, Groq, Together, and more).

```bash
/provider litellm      # Has built-in alias
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

#### Model geometry & recommended settings (LiteLLM)

Context and output limits depend on the underlying model routed through the proxy. Start with conservative defaults and adjust:

```bash
/set context-limit 128000
/set modelparam max_tokens 4096
```

**Profile JSON:**

```json
{
  "version": 1,
  "provider": "litellm",
  "model": "anthropic/claude-sonnet-4-20250514",
  "modelParams": { "max_tokens": 4096 },
  "ephemeralSettings": { "context-limit": 200000 }
}
```

**Environment variable:** `export LITELLM_API_KEY=sk-...`

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

**Two** providers support OAuth for authentication: Anthropic and Codex (ChatGPT).

```bash
# Enable OAuth provider (lazy authentication - happens on first use)
/auth anthropic enable
/auth codex enable

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
