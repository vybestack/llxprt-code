# Providers

LLxprt Code works with multiple AI providers. You can switch between them mid-session, set up failover across accounts, or create your own provider aliases.

## Built-in Providers

LLxprt Code ships with aliases for these providers — just use `/provider <name>` to switch:

| Provider                      | Alias           | Default Model              | Auth             |
| ----------------------------- | --------------- | -------------------------- | ---------------- |
| Anthropic                     | `anthropic`     | claude-opus-4-6            | OAuth or API key |
| Google Gemini                 | `gemini`        | gemini-2.5-pro             | OAuth or API key |
| OpenAI (API)                  | `openai`        | gpt-5.2                    | API key          |
| OpenAI (ChatGPT subscription) | `codex`         | gpt-5.3-codex              | OAuth            |
| Qwen                          | `qwen`          | qwen3-coder-plus           | OAuth or API key |
| xAI                           | `xai`           | grok-4                     | API key          |
| Kimi                          | `kimi`          | kimi-for-coding            | API key          |
| Synthetic                     | `Synthetic`     | hf:zai-org/GLM-4.7         | API key          |
| Chutes.ai                     | `chutes-ai`     | zai-org/GLM-5-TEE          | API key          |
| Mistral                       | `mistral`       | mistral-large-latest       | API key          |
| Cerebras Code                 | `cerebras-code` | qwen-3-coder-480b          | API key          |
| OpenRouter                    | `openrouter`    | nvidia/nemotron-nano-9b-v2 | API key          |
| Fireworks                     | `fireworks`     | fireworks/minimax-m2p5     | API key          |
| LM Studio                     | `lm-studio`     | —                          | None (local)     |
| llama.cpp                     | `llama-cpp`     | —                          | None (local)     |

## Switching Providers

```text
/provider anthropic
/provider gemini
/provider Synthetic
```

From the command line:

```bash
llxprt --provider anthropic
llxprt --provider Synthetic
```

## Authentication

### OAuth (Recommended for Subscriptions)

If you have an existing subscription with Anthropic, OpenAI (via Codex), Google, or Qwen, use OAuth — no API key needed:

```text
/auth anthropic enable
/auth codex enable
/auth gemini enable
/auth qwen enable
```

From the command line:

```bash
llxprt --provider codex
```

Each command opens a browser for authentication with your existing account. See [OAuth Setup](../oauth-setup.md) for details.

### API Keys (Keyring)

Use `/key save` to store an API key in your system keyring. You only need to do this once — the key is stored securely and never exposed to the LLM. Keys are automatically masked when you paste them.

```text
/key save anthropic sk-ant-***your-key***
/key save openai sk-***your-key***
/key save synthetic syn-***your-key***
/key save xai xai-***your-key***
```

Then load a saved key:

```text
/key load anthropic
/key load synthetic
```

From the command line, use `--key-name` to load a saved key:

```bash
llxprt --provider anthropic --key-name anthropic
llxprt --provider Synthetic --key-name synthetic
```

After saving a key once, you only need `/key load <name>` (or `--key-name <name>`) in future sessions.

> **Note:** Avoid environment variables for API keys when possible. The keyring is more secure — keys aren't visible in your shell environment, process list, or shell history, and the LLM never has access to them. See [Authentication](./authentication.md) for details on all key methods and why the keyring is preferred.

## Model Selection

Select a model with `/model`:

```text
/model claude-opus-4-6
/model gemini-2.5-pro
/model grok-3
```

From the command line:

```bash
llxprt --provider anthropic --model claude-opus-4-6
```

Use `/model` with no arguments to see available models for the current provider.

## Custom Base URL

Some providers or self-hosted endpoints need a custom base URL. Use `/baseurl`:

```text
/provider openai
/baseurl https://my-company-proxy.example.com/v1/
/model my-custom-model
```

From the command line:

```bash
llxprt --provider openai --base-url https://my-company-proxy.example.com/v1/ --model my-custom-model
```

This is useful for corporate proxies, self-hosted inference servers, or any OpenAI-compatible endpoint.

## Creating Your Own Provider Alias

If you frequently use a provider that isn't built in, or a custom endpoint, save it as an alias so you don't have to reconfigure each time.

### Using the CLI

Configure your provider, then save:

```text
/provider openai
/baseurl https://api.myprovider.com/v1/
/key save myprovider mp-***your-key***
/key load myprovider
/model my-model
/provider save myprovider
```

The new alias appears immediately in `/provider` and persists across sessions.

### Manual Alias Files

Create `~/.llxprt/providers/<alias>.config`:

```json
{
  "baseProvider": "openai",
  "base-url": "https://api.myprovider.com/v1/",
  "defaultModel": "my-model",
  "description": "My custom provider",
  "apiKeyEnv": "MYPROVIDER_API_KEY"
}
```

Fields:

- `baseProvider` (required) — Base implementation to use (`openai`, `anthropic`, `gemini`).
- `base-url` — Endpoint URL. Defaults to the base provider's URL when omitted.
- `defaultModel` — Pre-selects the model shown in the UI.
- `description` — Optional helper text shown in `/provider`.
- `apiKeyEnv` — Environment variable to read the API key from (fallback if no keyring key is loaded).

## Troubleshooting

### Authentication Errors

- Verify your API key is correct with `/key load <name>`
- For OAuth, try `/auth <provider> logout` then `/auth <provider> enable`
- Check `/auth <provider> status`

### Model Not Found

- Use `/model` with no arguments to list available models
- Check the provider's documentation for current model names

### Rate Limiting and Quotas

- Use `/stats quota` to check your current usage
- Consider switching providers or setting up [multi-account failover](./profiles.md) if you hit limits frequently

## Related

- [Authentication](./authentication.md) — Detailed auth configuration
- [Profiles](./profiles.md) — Save and manage provider/model configurations
- [Local Models](../local-models.md) — Running models locally with LM Studio, Ollama, and llama.cpp
- [Configuration](./configuration.md) — Full configuration reference
