# Terms of Service and Privacy

LLxprt Code is open-source software that does not collect telemetry, usage data, or any user information. However, the AI providers you connect through LLxprt Code have their own terms and privacy policies.

**Your data is governed by whichever provider you're using.** Review the relevant terms below.

## Provider Terms and Privacy Policies

### Direct Providers

| Provider            | Terms                                                                       | Privacy                                                                     | Notes                                              |
| ------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------- |
| **Google Gemini**   | [Terms](https://ai.google.dev/gemini-api/terms)                             | [Privacy](https://ai.google.dev/gemini-api/terms#data-use-unpaid)           | Free tier may use data for training; paid does not |
| **Anthropic**       | [Terms](https://www.anthropic.com/legal/terms)                              | [Privacy](https://www.anthropic.com/legal/privacy)                          | API data not used for training                     |
| **OpenAI**          | [Terms](https://openai.com/policies/terms-of-use)                           | [Privacy](https://openai.com/policies/privacy-policy)                       | API data not used for training by default          |
| **Codex (OpenAI)**  | [Terms](https://openai.com/policies/terms-of-use)                           | [Privacy](https://openai.com/policies/privacy-policy)                       | Same as OpenAI                                     |
| **Qwen (Alibaba)**  | [Terms](https://www.alibabacloud.com/help/en/model-studio/terms-of-service) | [Privacy](https://www.alibabacloud.com/help/en/model-studio/privacy-policy) |                                                    |
| **Kimi (Moonshot)** | [Terms](https://platform.moonshot.cn/docs/policies/terms-of-service)        | [Privacy](https://platform.moonshot.cn/docs/policies/privacy-policy)        |                                                    |
| **xAI (Grok)**      | [Terms](https://x.ai/legal/terms-of-service)                                | [Privacy](https://x.ai/legal/privacy-policy)                                |                                                    |
| **Mistral**         | [Terms](https://mistral.ai/terms/)                                          | [Privacy](https://mistral.ai/terms/#privacy-policy)                         |                                                    |

### Routing Providers

These route requests to other providers. Both the routing provider's terms AND the underlying model provider's terms apply.

| Provider       | Terms                                          | Privacy                                        | Notes                    |
| -------------- | ---------------------------------------------- | ---------------------------------------------- | ------------------------ |
| **OpenRouter** | [Terms](https://openrouter.ai/terms)           | [Privacy](https://openrouter.ai/privacy)       | Routes to many providers |
| **Fireworks**  | [Terms](https://fireworks.ai/terms-of-service) | [Privacy](https://fireworks.ai/privacy-policy) | Hosted inference         |
| **Cerebras**   | [Terms](https://cerebras.ai/terms-of-service)  | [Privacy](https://cerebras.ai/privacy-policy)  | Fast inference           |
| **Chutes AI**  | [Terms](https://chutes.ai/terms)               | [Privacy](https://chutes.ai/privacy)           |                          |

### Local Models

When using local providers (LM Studio, llama.cpp, Ollama), no data leaves your machine. No external terms apply.

## Google Gemini: Free vs Paid

Google's terms differ significantly by tier:

- **Free tier (OAuth or unpaid API key):** Your prompts, responses, and code **may be collected** and used for model training. See [unpaid data use](https://ai.google.dev/gemini-api/terms#data-use-unpaid).
- **Paid API key:** Your data is treated as confidential and is **not used for training**. See [paid terms](https://ai.google.dev/gemini-api/terms#paid-services).
- **Vertex AI:** Your data is governed by [Google Cloud Privacy Notice](https://cloud.google.com/terms/cloud-privacy-notice) — not collected for training.

If you're sending proprietary code through Gemini, use a paid API key or Vertex AI.

## Recommendations

- **LLxprt Code collects nothing.** All data concerns are about the providers.
- For maximum privacy, use local models.
- For cloud providers, paid tiers generally have stronger privacy protections than free tiers.
- Review terms before sending proprietary or sensitive code to any provider.

## Related

- [Providers](./cli/providers.md) — supported providers and setup
- [Authentication](./cli/authentication.md) — key and OAuth management
