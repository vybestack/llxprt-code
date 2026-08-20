# Reasoning Wire Formats

Use reasoning wire settings when a provider-neutral `reasoning.enabled` or
`reasoning.effort` value must be translated into a provider-specific request.
This is especially useful for local servers, gateways, and models whose effort
ladder differs from LLxprt Code's generic ladder.

The four settings on this page are **supported**. They persist when you save a
profile. Provider APIs and model restrictions can change, so verify model value
sets against the linked provider documentation before relying on them.

**As of:** 2026-08-20

**Owner:** the LLxprt Code maintainers

## Configure a local OpenAI-compatible server

A custom Chat Completions endpoint is treated conservatively under `auto`.
Select `openai` when the server accepts top-level `reasoning_effort`:

```json
{
  "version": 1,
  "provider": "openai",
  "model": "local-reasoning-model",
  "modelParams": {},
  "ephemeralSettings": {
    "base-url": "http://127.0.0.1:8000/v1",
    "requires-auth": false,
    "responses-mode": "chat",
    "reasoning.enabled": true,
    "reasoning.effort": "high",
    "reasoning.effortWireFormat": "openai"
  }
}
```

The reasoning portion of the Chat Completions request is:

```json
{
  "reasoning_effort": "high"
}
```

Without the explicit selector, an unknown custom Chat endpoint receives no
reasoning field and LLxprt Code logs a warning. LLxprt Code does not probe the
server or send several reasoning representations to discover which one works.

## Supported settings

### Selectors

| Setting                       | Valid values                                                                                                             | Default | Profile |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------- | ------- |
| `reasoning.effortWireFormat`  | `auto`, `openai`, `openai-responses`, `anthropic`, `anthropic-budget`, `openrouter`, `gemini`, `template-kwargs`, `none` | `auto`  | yes     |
| `reasoning.enabledWireFormat` | `auto`, `openai`, `openai-responses`, `openrouter`, `thinking`, `gemini`, `template-kwargs`, `none`                      | `auto`  | yes     |
| `reasoning.effortMap`         | JSON object described in [Effort maps](#effort-maps)                                                                     | none    | yes     |
| `reasoning.enabledMap`        | JSON object described in [Enablement maps](#enablement-maps)                                                             | none    | yes     |

A selector must also be compatible with the active transport. An incompatible
explicit selector fails before the request is sent.

### Effort selector matrix

The request fragments below show an emitted `high` effort, except for the
numeric Anthropic budget example.

| Selector           | Compatible transport       | Request fragment                                               |
| ------------------ | -------------------------- | -------------------------------------------------------------- |
| `auto`             | Any supported transport    | Uses the [automatic selection table](#automatic-selection)     |
| `openai`           | OpenAI-compatible Chat     | `{ "reasoning_effort": "high" }`                               |
| `openai-responses` | OpenAI Responses and Codex | `{ "reasoning": { "effort": "high" } }`                        |
| `anthropic`        | Native Anthropic           | `{ "output_config": { "effort": "high" } }`                    |
| `anthropic-budget` | OpenAI Chat or Anthropic   | `{ "thinking": { "type": "enabled", "budget_tokens": 8192 } }` |
| `openrouter`       | OpenAI Chat for OpenRouter | `{ "reasoning": { "effort": "high" } }`                        |
| `gemini`           | Native Gemini              | Gemini-owned `thinkingConfig`                                  |
| `template-kwargs`  | OpenAI-compatible Chat     | `{ "chat_template_kwargs": { "reasoning_effort": "high" } }`   |
| `none`             | Any supported transport    | No effort field; logs a warning when effort was configured     |

`anthropic-budget` requires either `reasoning.budgetTokens` or a numeric entry
in `reasoning.effortMap`. LLxprt Code does not convert a generic effort to a
token budget by formula.

### Enablement selector matrix

| Selector           | Compatible transport       | Request fragment or behavior                                                                          |
| ------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `auto`             | Any supported transport    | Uses the [automatic selection table](#automatic-selection)                                            |
| `openai`           | OpenAI-compatible Chat     | `{ "reasoning_effort": "none" }` when `false` maps to `"none"`                                        |
| `openai-responses` | OpenAI Responses and Codex | `{ "reasoning": { "effort": "none" } }` when `false` maps to `"none"`                                 |
| `openrouter`       | OpenAI Chat for OpenRouter | `{ "reasoning": { "enabled": true } }` or `{ "reasoning": { "enabled": false } }`                     |
| `thinking`         | OpenAI Chat or Anthropic   | `{ "thinking": { "type": "enabled" } }`, `adaptive`, or `disabled`, subject to model support          |
| `gemini`           | Native Gemini              | Gemini-owned `thinkingConfig`                                                                         |
| `template-kwargs`  | OpenAI-compatible Chat     | `{ "chat_template_kwargs": { "enable_thinking": true } }`                                             |
| `none`             | Any supported transport    | No enablement field; logs a warning unless emitted effort already represents `reasoning.enabled=true` |

The `openai` and `openai-responses` enablement selectors require a string map
when enablement cannot be represented by an emitted effort. For example,
`"false": "none"` expresses disablement on an API that accepts `none` as its
effort value.

### Automatic selection

| Active API or Chat host                 | Effort format      | Enablement format |
| --------------------------------------- | ------------------ | ----------------- |
| Official OpenAI Chat, `api.openai.com`  | `openai`           | `none`            |
| OpenAI Responses and Codex              | `openai-responses` | `none`            |
| OpenRouter Chat, `openrouter.ai`        | `openrouter`       | `openrouter`      |
| Z.AI or BigModel Chat                   | `openai`           | `thinking`        |
| Unknown OpenAI-compatible Chat endpoint | `none`             | `none`            |
| Native Anthropic                        | `anthropic`        | `thinking`        |
| Native Gemini                           | `gemini`           | `gemini`          |

Subdomains of the listed Chat hosts are recognized. Missing or malformed base
URLs are treated as unknown. Unknown endpoints stay conservative because some
OpenAI-compatible servers reject reasoning fields they do not implement.
Choose a selector in a profile when you know the server's accepted shape.

## Maps

### Effort maps

`reasoning.effortMap` is a JSON object with zero or more of these keys:

- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`
- `max`

Each value must be one of:

- a non-empty string for a string-valued effort format;
- an integer of at least `1024` for `anthropic-budget`;
- `null` to omit that effort deliberately and log a warning.

For string-valued formats, a missing key passes the generic effort through
unchanged. This partial map changes `minimal` to `low`; `low`, `medium`, `high`,
`xhigh`, and `max` retain their original strings:

```json
{
  "version": 1,
  "provider": "openai",
  "model": "custom-reasoning-model",
  "modelParams": {},
  "ephemeralSettings": {
    "base-url": "https://gateway.example.com/v1",
    "responses-mode": "chat",
    "reasoning.enabled": true,
    "reasoning.effort": "minimal",
    "reasoning.effortWireFormat": "openai",
    "reasoning.effortMap": {
      "minimal": "low"
    }
  }
}
```

A higher-precedence map replaces the lower-precedence map as one value. Entries
are not merged. If an alias supplies six entries and a profile supplies only
`minimal`, the effective map contains only the profile's `minimal` entry.

### Enablement maps

`reasoning.enabledMap` is a JSON object with optional `true` and `false` keys.
Each value must be a non-empty string, a boolean, or `null`.

The selected format further restricts the mapped value:

| Format                          | Accepted mapped values                                      |
| ------------------------------- | ----------------------------------------------------------- |
| `openai`, `openai-responses`    | non-empty strings                                           |
| `thinking`                      | non-empty strings accepted by the active provider and model |
| `openrouter`, `template-kwargs` | booleans                                                    |
| `gemini`                        | booleans or `LOW`, `MEDIUM`, `HIGH`                         |
| `none`                          | values are not emitted                                      |

A missing enablement key uses the selected format's default behavior. A `null`
entry deliberately omits the control and logs a warning.

## Exact request shapes

The fragments in this section omit unrelated request fields such as `model` and
`messages`.

### OpenAI Chat

With `reasoning.effortWireFormat=openai`:

```json
{
  "reasoning_effort": "high"
}
```

The official OpenAI Chat host selects this effort shape under `auto`. Unknown
custom hosts do not.

### OpenAI Responses and Codex

With `reasoning.effortWireFormat=openai-responses`:

```json
{
  "reasoning": {
    "effort": "high"
  }
}
```

For GPT-5.6 Responses models that require the Responses API, LLxprt Code changes
the generic `minimal` value to the wire value `none`. Existing Responses summary
and encrypted-reasoning controls continue to use the same `reasoning` request
object.

### OpenRouter Chat

When reasoning is enabled and effort is present, effort represents enablement:

```json
{
  "reasoning": {
    "effort": "high"
  }
}
```

When reasoning is disabled, effort is omitted:

```json
{
  "reasoning": {
    "enabled": false
  }
}
```

### Z.AI and DeepSeek Chat

A Chat endpoint that accepts coordinated thinking and effort uses separate
selectors, `reasoning.enabledWireFormat=thinking` and
`reasoning.effortWireFormat=openai`:

```json
{
  "thinking": {
    "type": "enabled"
  },
  "reasoning_effort": "high"
}
```

With `reasoning.enabled=false`, a supported map can emit
`thinking.type=disabled`; the effort field is omitted.

### Native Anthropic adaptive thinking

Claude Opus 5 aliases select `thinking` enablement and `anthropic` effort:

```json
{
  "thinking": {
    "type": "adaptive",
    "display": "summarized"
  },
  "output_config": {
    "effort": "high"
  }
}
```

If `reasoning.includeInResponse` is `false`, adaptive thinking uses
`"display": "omitted"`. `reasoning.enabled=false` emits
`{ "thinking": { "type": "disabled" } }` only on models that support disabled
thinking, and effort is omitted.

### Explicit Anthropic budget

A legacy model with budgeted thinking needs a direct budget or a numeric
map. This example uses a direct `reasoning.budgetTokens` value:

```json
{
  "thinking": {
    "type": "enabled",
    "budget_tokens": 8192
  }
}
```

A numeric map can produce the same request:

```json
{
  "reasoning.effortMap": {
    "high": 8192
  }
}
```

The numeric map is valid only with
`reasoning.effortWireFormat=anthropic-budget`.
`reasoning.budgetTokens` is direct and takes precedence over a mapped budget.

### Gemini 3

Gemini 3 uses thinking levels. The default generic mapping is `minimal` and
`low` to `LOW`, `medium` to `MEDIUM`, and `high`, `xhigh`, and `max` to `HIGH`:

```json
{
  "thinkingConfig": {
    "includeThoughts": true,
    "thinkingLevel": "HIGH"
  }
}
```

An effort map can provide `LOW`, `MEDIUM`, or `HIGH` directly. Gemini 3 does not
use `reasoning.maxTokens`; LLxprt Code warns if it is configured.

### Gemini 2

Gemini 2 uses a token budget rather than a thinking level:

```json
{
  "thinkingConfig": {
    "includeThoughts": true,
    "thinkingBudget": -1
  }
}
```

`-1` asks Gemini to choose the budget. Set `reasoning.maxTokens` for a specific
budget. `reasoning.enabled=false` emits a zero budget on Gemini 2. Generic effort
does not convert to a Gemini 2 token budget and is omitted with a warning.

### Template kwargs

vLLM and other template-driven servers can receive both controls inside
`chat_template_kwargs`:

```json
{
  "chat_template_kwargs": {
    "enable_thinking": true,
    "reasoning_effort": "high"
  }
}
```

Unrelated template options are preserved during the merge.

## Profile examples

### vLLM `chat_template_kwargs`

Use this shape when the served chat template reads both kwargs:

```json
{
  "version": 1,
  "provider": "openai",
  "model": "served-reasoning-model",
  "modelParams": {
    "chat_template_kwargs": {
      "tokenize": false
    }
  },
  "ephemeralSettings": {
    "base-url": "http://127.0.0.1:8000/v1",
    "requires-auth": false,
    "responses-mode": "chat",
    "reasoning.enabled": true,
    "reasoning.effort": "high",
    "reasoning.enabledWireFormat": "template-kwargs",
    "reasoning.effortWireFormat": "template-kwargs"
  }
}
```

The unrelated `tokenize` sibling remains in `chat_template_kwargs`.

### OpenRouter

The built-in alias already supplies both `openrouter` selectors. This profile
makes the selected policy visible:

```json
{
  "version": 1,
  "provider": "openrouter",
  "model": "provider/reasoning-model",
  "modelParams": {},
  "ephemeralSettings": {
    "auth-key-name": "openrouter-prod",
    "reasoning.enabled": true,
    "reasoning.effort": "high",
    "reasoning.enabledWireFormat": "openrouter",
    "reasoning.effortWireFormat": "openrouter"
  }
}
```

### Anthropic and Claude Opus 5

```json
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-opus-5",
  "modelParams": {},
  "ephemeralSettings": {
    "auth-key-name": "anthropic-prod",
    "reasoning.enabled": true,
    "reasoning.effort": "high",
    "reasoning.enabledWireFormat": "thinking",
    "reasoning.effortWireFormat": "anthropic",
    "reasoning.effortMap": {
      "minimal": "low"
    },
    "reasoning.enabledMap": {
      "true": "adaptive",
      "false": "disabled"
    }
  }
}
```

### Codex GPT-5.6

The built-in `codex` alias ships these reasoning defaults for GPT-5.6 Sol,
Terra, and Luna. The explicit profile below makes the selected policy visible:

```json
{
  "version": 1,
  "provider": "codex",
  "model": "gpt-5.6-sol",
  "modelParams": {},
  "ephemeralSettings": {
    "reasoning.effort": "medium",
    "reasoning.effortWireFormat": "openai-responses",
    "reasoning.summary": "auto"
  }
}
```

The reasoning portion of the Responses request is:

```json
{
  "reasoning": {
    "effort": "medium",
    "summary": "auto"
  }
}
```

The generic `minimal` effort becomes the wire value `none` for these GPT-5.6
Responses models.

### Z.AI GLM-5.3

The `zai` alias uses its Anthropic-compatible endpoint, and `glm-5.3` is the
alias default model. The profile below mirrors the shipped GLM-5.3 defaults:

```json
{
  "version": 1,
  "provider": "zai",
  "model": "glm-5.3",
  "modelParams": {},
  "ephemeralSettings": {
    "auth-key-name": "zai-prod",
    "reasoning.enabled": true,
    "reasoning.effort": "high",
    "reasoning.enabledWireFormat": "thinking",
    "reasoning.effortWireFormat": "anthropic",
    "reasoning.effortMap": {
      "minimal": "low",
      "low": "low",
      "medium": "high",
      "high": "high",
      "xhigh": "max",
      "max": "max"
    },
    "reasoning.enabledMap": {
      "true": "enabled"
    }
  }
}
```

The reasoning portion of the Anthropic request is:

```json
{
  "thinking": {
    "type": "enabled"
  },
  "output_config": {
    "effort": "high"
  }
}
```

No `budget_tokens` value is fabricated for GLM models; the thinking type is
the only enablement field.

### Kimi K3 and Kimi for Coding K2.7

The built-in `kimi` alias selects different shapes per model. For `kimi-k3`:

```json
{
  "version": 1,
  "provider": "kimi",
  "model": "kimi-k3",
  "modelParams": {},
  "ephemeralSettings": {
    "auth-key-name": "kimi-prod",
    "reasoning.enabled": true,
    "reasoning.effort": "max",
    "reasoning.enabledWireFormat": "openai",
    "reasoning.effortWireFormat": "openai",
    "reasoning.effortMap": {
      "minimal": "low",
      "low": "low",
      "medium": "high",
      "high": "high",
      "xhigh": "max",
      "max": "max"
    }
  }
}
```

The reasoning portion of the Chat request carries only top-level effort:

```json
{
  "reasoning_effort": "max"
}
```

For `kimi-for-coding` (K2.7), the alias instead selects enablement-only
thinking:

```json
{
  "version": 1,
  "provider": "kimi",
  "model": "kimi-for-coding",
  "modelParams": {},
  "ephemeralSettings": {
    "auth-key-name": "kimi-prod",
    "reasoning.enabled": true,
    "reasoning.effortWireFormat": "none",
    "reasoning.enabledWireFormat": "thinking",
    "reasoning.enabledMap": {
      "true": "enabled"
    }
  }
}
```

The reasoning portion of the Chat request is:

```json
{
  "thinking": {
    "type": "enabled"
  }
}
```

K2.7 emits no effort field; an attempted disablement is suppressed with a
warning because the shipped map has no supported disable value.

### Deliberate suppression with `none`

Use `none` when you want the model or server to use its own reasoning defaults:

```json
{
  "version": 1,
  "provider": "openai",
  "model": "server-managed-reasoning-model",
  "modelParams": {},
  "ephemeralSettings": {
    "base-url": "http://127.0.0.1:8080/v1",
    "requires-auth": false,
    "responses-mode": "chat",
    "reasoning.enabled": true,
    "reasoning.effort": "high",
    "reasoning.enabledWireFormat": "none",
    "reasoning.effortWireFormat": "none"
  }
}
```

This is deliberate suppression, not silent fallback. LLxprt Code logs a warning
for each configured generic control that produces no wire value.

## Precedence and explicit native parameters

Each selector and map is resolved independently in this order, highest first:

1. An explicit profile or session value
2. The last matching model default from the active provider alias
3. The provider alias default
4. `auto` for selectors, or no map for maps

Later matching model rules win. Explicit profile values survive provider and
model switches. Maps replace as a whole rather than merging entries.

Explicit native reasoning fields in `modelParams` remain authoritative. If a
native reasoning field collides with automatic translation, LLxprt Code leaves
the explicit field unchanged and adds no competing representation. Collisions
include:

- `reasoning`
- `thinking`
- `reasoning_effort`
- `parse_reasoning` on OpenAI-compatible Chat
- `chat_template_kwargs.reasoning_effort`
- `chat_template_kwargs.enable_thinking`
- `output_config.effort`
- native Gemini `thinkingConfig`

Unrelated nested siblings are merged where the provider supports merging. For
example, `chat_template_kwargs.tokenize` and `output_config.service_hint` remain
when translated reasoning adds a sibling field.

LLxprt Code emits only the selected representation. It does not send OpenAI,
Anthropic, and OpenRouter reasoning shapes together.

## Disablement, suppression, and warnings

`reasoning.enabled=false` suppresses generic effort. If the selected format and
model support a disable form, LLxprt Code emits it. If no disable form exists,
LLxprt Code omits effort and logs a warning.

A warning is also logged when:

- `auto` cannot identify a safe format for an unknown Chat endpoint;
- a selector is explicitly `none`;
- a selected map entry is `null`;
- `anthropic-budget` has no direct or mapped numeric budget;
- a configured generic control cannot be represented by the selected format or
  model.

The warning identifies the provider, model, selected format, and omitted generic
setting without printing credentials. Invalid maps and transport-incompatible
selectors fail before network I/O.

## Alias policy and provider capabilities

A built-in alias records defaults for known models. It does not claim that every
model exposed by that provider accepts the same fields or values. Provider APIs
may support controls that LLxprt Code does not enable by default. You can use a
profile selector when the active transport supports the shape and the provider
documents the model behavior.

Model-agnostic local aliases, including LM Studio and llama.cpp, do not set an
effort selector. The model served at the endpoint determines whether `openai`,
`template-kwargs`, or `none` is appropriate.

### Shipped model restrictions

Each row separates the request shape the alias selects from the model value
restrictions the same rule encodes.

| Alias or model                          | Request shape                                                                                                                                                      | Accepted model values                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Opus 5, `anthropic`/`claudecode` | Native `thinking.type` plus `output_config.effort`                                                                                                                 | Enabled maps to `adaptive`, disabled maps to `disabled`; generic `minimal` maps to `low`                                                                        |
| Codex GPT-5.6 Sol, Terra, and Luna      | Responses `reasoning.effort`                                                                                                                                       | Alias default is `medium`; generic `minimal` becomes wire `none` for these GPT-5.6 Responses models                                                             |
| OpenAI GPT-5.6 family                   | Chosen transport owns the shape: Responses translation when routing selects Responses; a custom Chat endpoint needs a Chat-compatible selector chosen in a profile | Same GPT-5.6 Responses `minimal` to `none` policy when served over Responses                                                                                    |
| Kimi K3 and K3 256K                     | Top-level `reasoning_effort`; no `thinking` object                                                                                                                 | Accepted ladder is `low`, `high`, `max`; generic values map to that three-value ladder; alias default is `max` for K3 and `high` for K3 256K                    |
| Kimi for Coding K2.7                    | `thinking.type=enabled` only; no effort field                                                                                                                      | Disablement has no supported wire value in the shipped map, so it is omitted with a warning                                                                     |
| Z.AI GLM-5.3                            | The `zai` alias default model on its Anthropic-compatible endpoint: `thinking.type` plus `output_config.effort`                                                    | Generic `minimal`/`low` map to `low`, `medium`/`high` to `high`, `xhigh`/`max` to `max`; disablement is omitted with a warning                                  |
| Z.AI GLM-5.2                            | The `zai` alias uses `thinking.type` plus `output_config.effort`                                                                                                   | Explicit `minimal` map emits native `minimal` on the wire; `low`/`medium`/`high` map to `high`, `xhigh`/`max` to `max`; enabled and disabled are both supported |
| DeepSeek V4 family                      | `thinking.type` plus top-level `reasoning_effort`                                                                                                                  | Generic `minimal`/`low` map to `low`, `medium`/`high`/`xhigh` to `high`, and `max` stays `max`                                                                  |
| Fireworks MiniMax M3                    | Top-level `reasoning_effort`; no Anthropic-style thinking field is added                                                                                           | Disabled maps to effort `none`                                                                                                                                  |

For Z.AI's OpenAI-compatible Chat endpoint, select `openai` effort and `thinking`
enablement to get the coordinated Chat shape shown above. Endpoint protocol
choice changes the field location even when the model effort ladder is the same.

## Provider references

Provider documentation changes over time. These links describe the request
shapes and model restrictions used for the settings and defaults above:

- [OpenAI Chat API](https://platform.openai.com/docs/api-reference/chat)
- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses)
- [OpenRouter reasoning parameters](https://openrouter.ai/docs/api/reference/parameters)
- [Anthropic extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Z.AI GLM-5.3](https://docs.z.ai/guides/llm/glm-5.3)
- [Z.AI reasoning parameters](https://docs.z.ai/guides/overview/concept-param)
- [Z.AI Coding Plan models](https://docs.z.ai/devpack/latest-model)
- [Kimi K3 reasoning controls](https://platform.moonshot.ai/docs/guide/kimi-k3-quickstart)
- [vLLM reasoning outputs and template kwargs](https://docs.vllm.ai/en/latest/features/reasoning_outputs/)
- [Fireworks reasoning controls](https://docs.fireworks.ai/guides/reasoning)
- [Fireworks Chat Completions API](https://docs.fireworks.ai/api-reference/post-chatcompletions)
- [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)

## Related pages

- [Ephemeral Settings Reference](../reference/ephemerals.md)
- [Settings and Profiles](../settings-and-profiles.md)
- [Provider Setup Quick Reference](./quick-reference.md)
