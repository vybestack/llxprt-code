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

If the endpoint needs a model-specific reasoning request shape, see
[Reasoning Wire Formats](./reasoning-wire-formats.md).

## Built-in provider aliases

LLxprt Code ships with these aliases. Use `/provider <alias>` to switch. The
alias name is what you type after `/provider`. Default model names change over
time and are kept in the dated
[Provider Models and Limits](./models-and-limits.md#default-models-by-alias)
page; the table below lists only the stable alias and authentication details.

| Provider                   | Alias           | Auth method                    |
| -------------------------- | --------------- | ------------------------------ |
| Anthropic (API key)        | `anthropic`     | API key (`ANTHROPIC_API_KEY`)  |
| Claude Code (subscription) | `claudecode`    | OAuth                          |
| Google Gemini              | `gemini`        | API key (`GEMINI_API_KEY`)     |
| OpenAI (API)               | `openai`        | API key (`OPENAI_API_KEY`)     |
| OpenAI Codex (ChatGPT sub) | `codex`         | OAuth                          |
| Qwen (DashScope)           | `qwen`          | API key (`DASHSCOPE_API_KEY`)  |
| Kimi                       | `kimi`          | API key                        |
| xAI (Grok)                 | `xai`           | API key (`XAI_API_KEY`)        |
| DeepSeek                   | `deepseek`      | API key (`DEEPSEEK_API_KEY`)   |
| Z.AI                       | `zai`           | API key (`ZAI_API_KEY`)        |
| Synthetic                  | `synthetic`     | API key                        |
| Chutes AI                  | `chutes-ai`     | API key (`CHUTES_API_KEY`)     |
| Makora                     | `makora`        | API key (`MAKORA_API_KEY`)     |
| Fireworks                  | `fireworks`     | API key (`FIREWORKS_API_KEY`)  |
| OpenRouter                 | `openrouter`    | API key (`OPENROUTER_API_KEY`) |
| Cerebras Code              | `cerebras-code` | API key (`CEREBRAS_API_KEY`)   |
| Mistral                    | `mistral`       | API key (`MISTRAL_API_KEY`)    |
| LiteLLM (gateway)          | `litellm`       | API key (`LITELLM_API_KEY`)    |
| Ollama Cloud (hosted)      | `ollama-cloud`  | API key (`OLLAMA_API_KEY`)     |
| LM Studio (local)          | `lm-studio`     | None required                  |
| llama.cpp (local)          | `llama-cpp`     | None required                  |

For the current default model name each alias uses, see
[Default models by alias](./models-and-limits.md#default-models-by-alias). For
context windows and pricing, see
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

#### OpenAI transport selection (Responses vs. Chat Completions)

OpenAI models can use the newer **Responses API** or the classic **Chat
Completions API**. LLxprt Code picks one automatically:

- **GPT-5.6 and later** (bare model IDs like `gpt-5.6` and durable-tier IDs
  like `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`) use the **Responses
  transport** when pointed at the official `api.openai.com` endpoint. Chat
  Completions is not available for these on that endpoint.
- **Custom OpenAI-compatible endpoints** (proxies, gateways, self-hosted
  servers, or any non-`api.openai.com` base URL) **default to Chat
  Completions**, even for GPT-5.6+.

This matters when you point the `openai` alias at a custom endpoint: a
Responses-only model may fail if the endpoint does not implement the Responses
API. To force a specific transport, set one of these:

```bash
# Force Responses (useful on a custom endpoint that supports it)
/set responses-mode responses

# Force Chat Completions
/set responses-mode chat
```

You can also set it permanently in a profile via the `apiMode` or
`responsesMode` provider setting, or globally via the `responses-mode`
ephemeral setting. When forced to `responses`, a custom endpoint uses Responses
for models that support it; when forced to `chat`, Chat Completions is used
unless the model requires Responses on the official OpenAI endpoint (GPT-5.6+),
where Chat is unavailable and the override is ignored.

### OpenAI Codex (ChatGPT Plus/Pro)

```bash
/auth codex enable
/provider codex
/model gpt-5.6-sol
```

#### WebSocket transport

The Codex provider sends `Authorization`, `ChatGPT-Account-ID`,
`originator: codex_cli_rs`, and any configured custom headers during the
WebSocket handshake. It also sends `session-id`, `thread-id`, and
`x-client-request-id`, each set to the session's runtime ID, plus
`OpenAI-Beta: responses_websockets=2026-02-06`. The identity headers use the
hyphenated forms used by the current Codex client.

The WebSocket handshake times out after 15 seconds. After the connection is
established, the stream has a five-minute idle timeout that resets on each
valid text frame. If it expires, LLxprt closes the socket. When no output has been
streamed, LLxprt serves that request over HTTP/SSE instead; after repeated
consecutive pre-output WebSocket failures it stays on HTTP for the session.
When output has already been streamed, LLxprt reports a stream interruption
without replaying partial output.

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

#### Kimi provider Files policy

Kimi PDF uploads are disabled by default. Choose an explicit session or
workspace scope before enabling them:

```bash
/set provider-files session
/set provider-files-retention-ms 86400000
/set provider-files-delete delete
```

Use `workspace` instead of `session` when the same credential and base URL may
reuse file IDs across sessions in the current workspace. IDs are isolated by
provider, base URL, credential identity, and scope. The persisted workspace
scope is a credential-keyed identifier, not the local directory path. Moving or
renaming the directory produces a different scope and does not reuse its prior
file IDs. Valid IDs are written to the media reference in session history so
replay can reuse them without uploading the same bytes again. LLxprt keeps
dynamic IDs in message content and does not change the system instruction.

The retention duration controls how long LLxprt may reuse an ID. With `delete`,
expiry, cache eviction, and session cleanup request best-effort remote deletion.
A failed deletion remains tracked for retry. With `retain`, LLxprt drops its
local entry without calling the delete endpoint, and Moonshot's account
retention rules continue to apply. Setting `provider-files` back to `off`
prevents new uploads but does not by itself delete existing remote files.

Kimi Files storage is incompatible with zero-data-retention semantics while a
remote file remains stored. Set `provider-files-zdr require` to reject this
mode, or leave `allow-retention` only when provider storage is acceptable.
Memory pressure never enables Files mode.

Experimental Kimi video requires both `kimi.experimental-video=true` and an
explicit `provider-files` scope. It follows the same retention, deletion, and
ZDR settings. Anthropic Files references are currently unsupported in this
adapter, so Anthropic remains inline even when `provider-files` is enabled.

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
