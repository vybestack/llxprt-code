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