# LLxprt Code: Quotas and Pricing

LLxprt Code supports multiple AI providers, each with their own pricing and quota structures. A summary of model usage is available through the `/stats` command and presented on exit at the end of a session.

**Important:** LLxprt Code displays a "Paid Mode" indicator in the lower right corner when it detects you're using a paid service. However, this is a heuristic to help you avoid unexpected costs - always verify with your provider's documentation.

## Provider-Specific Pricing

### Google Gemini

For detailed information about Google's quotas and pricing options, including:

- Free tier with Google account login (/auth)
- API key options (paid and unpaid)
- Vertex AI pricing
- Workspace and enterprise options

Please see [Google's original documentation](https://github.com/google-gemini/gemini-cli/blob/main/docs/quota-and-pricing.md) for comprehensive details.

### Other Providers

Each provider has their own pricing structure:

#### OpenAI

- **Pricing:** Pay-per-token model
- **Models:** o3, o1, GPT-4.1, GPT-4o, and others
- **Details:** [OpenAI Pricing](https://openai.com/pricing)
- **Note:** All OpenAI usage requires an API key and is paid

#### Anthropic

- **Pricing:** Pay-per-token model
- **Models:** Claude Opus 4, Claude Sonnet 4, and others
- **Details:** [Anthropic Pricing](https://www.anthropic.com/pricing)
- **Note:** All Anthropic usage requires an API key and is paid

#### Local Models

- **Cost:** Free (you provide the compute)
- **Requirements:** Local hardware capable of running the model
- **Options:** LM Studio, llama.cpp, or any OpenAI-compatible server

#### OpenRouter

- **Pricing:** Varies by model (aggregates multiple providers)
- **Details:** [OpenRouter Pricing](https://openrouter.ai/models)
- **Note:** Provides access to 100+ models with unified billing

#### Fireworks

- **Pricing:** Competitive rates for fast inference
- **Details:** [Fireworks Pricing](https://fireworks.ai/pricing)
- **Note:** Optimized for speed and cost-efficiency

## Free vs Paid Mode Detection

LLxprt Code attempts to detect when you're in "free" vs "paid" mode:

- **Free Mode:**
  - Google account login with Gemini (limited daily requests)
  - Local models
- **Paid Mode:**
  - Any API key usage (except Google's free tier)
  - All OpenAI and Anthropic usage
  - Most third-party providers

The mode indicator helps you track potential costs, but always verify actual charges with your provider.

## Managing Costs

1. **Monitor Usage:** Use `/stats` regularly to track token usage
2. **Choose Models Wisely:** Smaller models are often cheaper but less capable
3. **Use Local Models:** For development and testing when possible
4. **Set Budgets:** Most providers offer spending limits in their dashboards

## Privacy and Terms

See [privacy and terms](./tos-privacy.md) for details on privacy policies and terms of service for each provider.
