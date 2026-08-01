# Provider Models and Limits

**As of:** 2026-08-01
**Owner:** the LLxprt Code maintainers
**Companion page:** [Provider Setup Quick Reference](./quick-reference.md)

This page lists model names, context windows, and recommended runtime tuning for
the providers LLxprt Code supports. Model names, context windows, pricing, and
provider-side limits **change frequently**. The values here reflect what is
configured in LLxprt Code's built-in provider aliases as of the date above.

> **Before relying on a limit or price, verify it against the provider's own
> documentation.** Use the links in each section to check for the most current
> data. LLxprt Code cannot guarantee that a provider has not changed a model
> name, context window, or price since this page was last reviewed.

## How model limits are resolved

Default model limits are data-driven and layered. Each layer takes precedence
over the one below it:

1. **User override** — `/set context-limit <N>` or a profile
   `ephemeralSettings.context-limit`. Always wins.
2. **Provider alias configuration** — built-in defaults shipped with LLxprt
   Code, including per-model `contextWindow` and `context-limit` values.
3. **Core fallback catalog** — a built-in safety net for models not covered by
   an alias config. The default fallback limit is 200,000 tokens.

You can override any limit at runtime:

```bash
/set context-limit 200000
/set modelparam max_tokens 4096
```

## Model geometry and budgeting

When you set a model, configure both `context-limit` (total request budget) and
`max_tokens` (reserved for the response):

- **`context-limit`** — the total tokens allowed for the entire request
  (prompt + output).
- **`max_tokens`** — the maximum tokens reserved for the model's response
  (output only).
- **Effective prompt budget** = `context-limit` − `max_tokens` − safety margin.

You cannot set `context-limit` + `max_tokens` to exceed the model's actual
context window. For example, if a model supports 200k total context, you cannot
set `context-limit=200000` **and** `max_tokens=100000`.

**Safety margin:** 256–2048 tokens (1,024 recommended) to avoid overflows from
tool wrappers, the system prompt, and project memory files.

> **Tip:** If you see "would exceed the token context window" errors, lower
> `max_tokens` first or reduce the size of your project memory files.

> **Auth-variant note:** Context windows can differ between API-key access and
> OAuth/subscription access for the same model. When in doubt, start lower and
> increase until you hit a provider limit error.

## Anthropic (Claude)

[Anthropic documentation](https://docs.anthropic.com/) ·
[Anthropic models](https://docs.anthropic.com/en/docs/about-claude/models)

### Anthropic API key (`anthropic` alias)

Configured context-limit for current-generation models (`claude-opus-5`,
`claude-opus-4-8`, `claude-fable-5`, `claude-sonnet-4-6`, `claude-sonnet-5`):
**1,000,000 tokens**.

Max output tokens configured: **128,000**.

Reasoning is enabled by default for `claude-(opus|sonnet|haiku|fable)` models,
with `reasoning.effort` set to `high`. Temperature, `top_p`, and `top_k` are
disallowed for these models (reasoning models manage sampling internally).

Common models: `claude-opus-5`, `claude-sonnet-5`, `claude-sonnet-4-6`,
`claude-haiku-4-5`.

> **Note:** The 1,000,000-token context is the value configured in the alias.
> Anthropic may gate large context windows by plan or credit tier. Check
> Anthropic's documentation for your account's actual limits.

Recommended settings:

```bash
/set context-limit 200000
/set modelparam max_tokens 4096
```

**Profile JSON (API key):**

```json
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-opus-5",
  "modelParams": { "max_tokens": 4096 },
  "ephemeralSettings": { "context-limit": 200000 }
}
```

**Environment variable:** `export ANTHROPIC_API_KEY=sk-ant-...`

### Claude Code OAuth (`claudecode` alias)

Same context and output limits as the `anthropic` alias for current-generation
models. Available static models include: `claude-opus-5`, `claude-fable-5`,
`claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-5`,
`claude-sonnet-4-6`, and earlier versions.

See [Provider Setup Quick Reference](./quick-reference.md#subscription-and-oauth-providers)
for OAuth setup instructions.

### Pricing

Pricing for Anthropic models is not tracked on this page. Check
[Anthropic's pricing page](https://www.anthropic.com/pricing) for current rates.

## OpenAI (API)

[OpenAI documentation](https://platform.openai.com/docs/) ·
[OpenAI models](https://platform.openai.com/docs/models)

### OpenAI API key (`openai` alias)

For `gpt-5.6` models, the configured context-limit is **1,050,000 tokens** with
max output tokens of **128,000**. Reasoning is enabled by default with
`reasoning.effort` set to `high`.

GPT-5.x reasoning models do **not** support `temperature`, `top_p`, `top_k`,
`frequency_penalty`, or `presence_penalty`. Use `/set reasoning.effort` instead.

Reasoning effort values: `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

Common models: `gpt-5.6`, `gpt-5.5`.

> **Note:** The actual context window for your model depends on your OpenAI API
> plan. The configured limit is a default; check OpenAI's documentation for your
> model's actual window.

Recommended settings:

```bash
/set context-limit 400000    # adjust to your model's actual window
/set modelparam max_tokens 8192
/set reasoning.effort high
```

### OpenAI Codex OAuth (`codex` alias)

The `codex` alias uses the ChatGPT subscription backend and has a configured
context-limit of **262,144 tokens** — lower than the OpenAI API key path.

Common Codex models: `gpt-5.6-sol` (default), `gpt-5.6-terra`, `gpt-5.6-luna`,
`gpt-5.5`, `gpt-5.3-codex-spark` (131,072 context).

See [Provider Setup Quick Reference](./quick-reference.md#subscription-and-oauth-providers)
for OAuth setup instructions.

### Pricing

Pricing for OpenAI models is not tracked on this page. Check
[OpenAI's pricing page](https://openai.com/api/pricing/) for current rates.

## Google Gemini

[Google AI documentation](https://ai.google.dev/docs) ·
[Gemini models](https://ai.google.dev/gemini-api/docs/models)

### Gemini API key (`gemini` alias)

The core fallback catalog lists these context windows for Gemini 2.5 models:

- `gemini-2.5-pro`: **1,048,576 tokens**
- `gemini-2.5-flash`: **1,048,576 tokens**
- `gemini-2.5-flash-lite`: **1,048,576 tokens**

> **Note:** The maximum context window for Gemini models may depend on your API
> plan and tier. Check Google's documentation for your account's actual limits.

Common models: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`.

Recommended settings:

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

### Pricing

Pricing for Gemini models is not tracked on this page. Check
[Google AI's pricing page](https://ai.google.dev/pricing) for current rates.

## Qwen (DashScope)

[DashScope documentation](https://help.aliyun.com/zh/dashscope/)

### Qwen API key (`qwen` alias)

Configured context-limit for `qwen3-coder-plus`: **1,000,000 tokens**. Max
output tokens: **65,536**.

Common models: `qwen3-coder-plus`.

> **Note:** The `qwen` alias is for Qwen's own DashScope service. It is not used
> for Cerebras.

Recommended settings:

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

**Environment variable:** `export DASHSCOPE_API_KEY=...`

### Pricing

Pricing for Qwen models is not tracked on this page. Check Alibaba Cloud's
DashScope documentation for current rates.

## Kimi (Moonshot AI)

[Moonshot AI documentation](https://platform.moonshot.ai/docs)

The `kimi` alias supports two paths:

- **`kimi-for-coding`** — the subscription-served model. Context window:
  **262,144 tokens**. Max output: **32,768 tokens**. This is the alias default.
- **`kimi-k3`** — the pay-per-token model on the raw Moonshot API. Context
  window: **1,048,576 tokens**. Max output: **131,072 tokens**.

To use `kimi-k3`, point the alias at the raw Moonshot endpoint:

```bash
/provider kimi
/baseurl https://api.moonshot.ai/v1
/keyfile ~/.moonshot_key
/model kimi-k3
```

### Recommended settings (kimi-for-coding)

```bash
/set context-limit 262144
/set modelparam max_tokens 32768
/set reasoning.effort medium
```

### Recommended settings (kimi-k3)

```bash
/set context-limit 1000000
/set modelparam max_tokens 131072
/set reasoning.effort max
```

**Profile JSON (pay-per-token kimi-k3):**

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

### Multimodal support (Kimi)

The `kimi` alias declares media capabilities:

| Capability          | Status (per alias config)     | Notes                                                                                                                                       |
| ------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Inline images       | Enabled                       | Images in user messages and tool responses flow as `image_url` content parts.                                                               |
| PDF/document upload | Enabled                       | Base64 PDFs are uploaded with `purpose: file-extract` and referenced by file id, keeping large documents out of the token budget.           |
| Video               | Experimental (off by default) | Base64 videos are uploaded with `purpose: video`, then sent as `video_url` content with an `ms://<file-id>` URL on Kimi/Moonshot endpoints. |

To enable experimental video forwarding:

```bash
/set kimi.experimental-video true
```

This is gated behind both the `kimi.experimental-video` setting and the alias's
`mediaSupport.videoSupport` capability flag. Third-party aliases (Chutes,
Synthetic) do not declare this capability.

### Pricing

Pricing for Kimi/Moonshot models is not tracked on this page. Check
[Moonshot AI's pricing page](https://platform.moonshot.ai/docs/pricing) for
current rates.

## Other API-key providers

The following providers use the OpenAI-compatible protocol. LLxprt Code does not
ship verified context windows or pricing for these — check the provider's
documentation and start with a conservative `context-limit`:

| Provider      | Alias           | Default model                |
| ------------- | --------------- | ---------------------------- |
| xAI (Grok)    | `xai`           | `grok-4`                     |
| OpenRouter    | `openrouter`    | `nvidia/nemotron-nano-9b-v2` |
| Fireworks     | `fireworks`     | `fireworks/minimax-m3`       |
| Cerebras Code | `cerebras-code` | `qwen-3-coder-480b`          |
| DeepSeek      | `deepseek`      | `deepseek-v4-flash`          |
| Z.AI          | `zai`           | `glm-5`                      |
| Makora        | `makora`        | `nvidia/Kimi-K2.6-NVFP4`     |
| Synthetic     | `synthetic`     | `hf:zai-org/GLM-4.7`         |
| Chutes AI     | `chutes-ai`     | `zai-org/GLM-5-TEE`          |
| Mistral       | `mistral`       | `mistral-large-latest`       |

For these providers, start with a conservative limit and adjust:

```bash
/set context-limit 200000
/set modelparam max_tokens 4096
```

The core fallback catalog provides a default limit of 200,000 tokens for models
not explicitly listed.

## Local models

Context windows for local models (LM Studio, llama.cpp, Ollama) depend entirely
on your local runtime and model build. Start small and increase:

```bash
/set context-limit 32000
/set modelparam max_tokens 2048
```

See [Using Local Models](../local-models.md) for complete guidance.

## Related

- [Provider Setup Quick Reference](./quick-reference.md) — how to configure each
  provider
- [Full provider guide](../cli/providers.md) — advanced configuration
- [Settings and Profiles](../settings-and-profiles.md) — profile management
- [Authentication](../cli/authentication.md) — credential setup
