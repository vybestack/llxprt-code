# LLxprt Code: Terms of Service and Privacy Notice

LLxprt Code is an open-source tool that connects you with multiple AI providers. The Terms of Service and Privacy Notices that apply to your usage depend on which provider you use.

**Important:** LLxprt Code itself does not collect any telemetry or usage data. Each AI provider has their own data policies that apply when you use their services through LLxprt Code.

## Provider Terms and Privacy Policies

### Google Gemini

For detailed information about Google's terms, privacy policies, and data usage, see [Google's documentation](https://github.com/google-gemini/gemini-cli/blob/main/docs/tos-privacy.md).

Key points:

- Different terms apply for OAuth login vs API key usage
- Free tier (OAuth) may use data for training
- Paid API keys have stricter privacy protections

### OpenAI

- **Terms of Service:** [OpenAI Terms of Use](https://openai.com/policies/terms-of-use)
- **Privacy Policy:** [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)
- **API Data Usage:** [OpenAI API Data Usage Policies](https://openai.com/policies/api-data-usage-policies)

Key points:

- API data is not used for training by default
- 30-day data retention for abuse monitoring
- Enterprise agreements available for zero retention

### Anthropic

- **Terms of Service:** [Anthropic Terms of Service](https://www.anthropic.com/legal/terms)
- **Privacy Policy:** [Anthropic Privacy Policy](https://www.anthropic.com/legal/privacy)
- **API Terms:** [Anthropic API Terms](https://www.anthropic.com/legal/api-terms)

Key points:

- API data is not used for training
- Data retention for safety and legal compliance only
- Strong privacy commitments

### Fireworks

- **Terms of Service:** [Fireworks Terms of Service](https://fireworks.ai/terms-of-service)
- **Privacy Policy:** [Fireworks Privacy Policy](https://fireworks.ai/privacy-policy)

Key points:

- Focus on fast, efficient inference
- Data used only for service provision
- No model training on customer data

### OpenRouter

- **Terms of Service:** [OpenRouter Terms](https://openrouter.ai/terms)
- **Privacy Policy:** [OpenRouter Privacy Policy](https://openrouter.ai/privacy)

Key points:

- Acts as a proxy to multiple model providers
- Each underlying model may have additional terms
- Transparent about data routing

## Local Models

When using local models (via LM Studio, llama.cpp, etc.):

- No data leaves your machine
- No external terms of service apply
- You control all data and privacy

## Gemini Provider Data Collection

By default (if you have not opted out):

- **Google account with Gemini Code Assist for Individuals**: Yes. When you use your personal Google account, the [Gemini Code Assist Privacy Notice for Individuals](https://developers.google.com/gemini-code-assist/resources/privacy-notice-gemini-code-assist-individuals) applies. Under this notice,
  your **prompts, answers, and related code are collected** and may be used to improve Google's products, including for model training.
- **Google account with Gemini Code Assist for Workspace, Standard, or Enterprise**: No. For these accounts, your data is governed by the [Gemini Code Assist Privacy Notices](https://cloud.google.com/gemini/docs/codeassist/security-privacy-compliance#standard_and_enterprise_data_protection_and_privacy) terms, which treat your inputs as confidential. Your **prompts, answers, and related code are not collected** and are not used to train models.
- **Gemini API key via the Gemini Developer API**: Whether your code is collected or used depends on whether you are using an unpaid or paid service.
  - **Unpaid services**: Yes. When you use the Gemini API key via the Gemini Developer API with an unpaid service, the [Gemini API Terms of Service - Unpaid Services](https://ai.google.dev/gemini-api/terms#unpaid-services) terms apply. Under this notice, your **prompts, answers, and related code are collected** and may be used to improve Google's products, including for model training.
  - **Paid services**: No. When you use the Gemini API key via the Gemini Developer API with a paid service, the [Gemini API Terms of Service - Paid Services](https://ai.google.dev/gemini-api/terms#paid-services) terms apply, which treats your inputs as confidential. Your **prompts, answers, and related code are not collected** and are not used to train models.
- **Gemini API key via the Vertex AI GenAI API**: No. For these accounts, your data is governed by the [Google Cloud Privacy Notice](https://cloud.google.com/terms/cloud-privacy-notice) terms, which treat your inputs as confidential. Your **prompts, answers, and related code are not collected** and are not used to train models.

For more information about opting out, refer to the Usage Statistics Configuration section below.

### Usage Statistics and Opt-Out Control

The **Usage Statistics** setting is the single control for all optional data collection when using the Gemini provider.

The data it collects depends on your account and authentication type:

- **Google account with Gemini Code Assist for Individuals**: When enabled, this setting allows Google to collect both anonymous telemetry (for example, commands run and performance metrics) and **your prompts and answers, including code,** for model improvement.
- **Google account with Gemini Code Assist for Workspace, Standard, or Enterprise**: This setting only controls the collection of anonymous telemetry. Your prompts and answers, including code, are never collected, regardless of this setting.
- **Gemini API key via the Gemini Developer API**:
  - **Unpaid services**: When enabled, this setting allows Google to collect both anonymous telemetry (like commands run and performance metrics) and **your prompts and answers, including code,** for model improvement. When disabled we will use your data as described in [How Google Uses Your Data](https://ai.google.dev/gemini-api/terms#data-use-unpaid).
  - **Paid services**: This setting only controls the collection of anonymous telemetry. Google logs prompts and responses for a limited period of time, solely for the purpose of detecting violations of the Prohibited Use Policy and any required legal or regulatory disclosures.
- **Gemini API key via the Vertex AI GenAI API:** This setting only controls the collection of anonymous telemetry. Your prompts and answers, including code, are never collected, regardless of this setting.

Please refer to the Privacy Notice that applies to your authentication method for more information about what data is collected and how this data is used.

## Data Collection Summary

1. **LLxprt Code**: Does not collect any telemetry, usage statistics, or user data
2. **AI Providers**: Each provider has their own data policies as linked above
3. **Your Data**: Always check the specific terms for your chosen provider and authentication method

## Recommendations

- For maximum privacy, use local models
- For cloud providers, use API keys rather than OAuth when possible
- Review each provider's terms before sending sensitive data
- Consider enterprise agreements for business use

## See Also

- [Quotas and Pricing](./quota-and-pricing.md) - Cost information for each provider
- [Providers Documentation](./cli/providers.md) - Technical setup for each provider
