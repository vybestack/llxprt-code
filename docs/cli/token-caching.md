# Token Caching and Cost Optimization

LLxprt Code automatically optimizes API costs through token caching when using Google's Gemini provider with API key authentication. This feature reuses previous system instructions and context to reduce the number of tokens processed in subsequent requests.

**Note:** Token caching is currently only available for Google's Gemini and Vertex AI providers. Other providers (OpenAI, Anthropic, etc.) do not support this feature at this time.

**Token caching is available for:**

- Gemini API key users
- Vertex AI users (with project and location setup)

**Token caching is not available for:**

- OAuth users (Google Personal/Enterprise accounts) - the Code Assist API does not support cached content creation at this time
- Other providers (OpenAI, Anthropic, etc.)

You can view your token usage and cached token savings using the `/stats` command. When cached tokens are available, they will be displayed in the stats output.
