# Retry Settings Configuration

LLxprt Code implements configurable exponential backoff retry logic for API
calls to LLM providers. These settings help manage rate limits and transient
errors effectively.

## Ephemeral settings

Retry configuration uses ephemeral settings, which means they can be changed
during a session without modifying your saved profiles or configuration files.

### Available retry settings

- **`retries`** (number):
  - **Description:** Maximum number of retry attempts for API calls.
  - **Default:** `6` for most providers (OpenAI Responses API, Anthropic).
    Some providers apply their own default — for example, the OpenAI Vercel
    provider defaults to `2`.
  - **Example:** `/set retries 3`

- **`retrywait`** (number):
  - **Description:** Initial delay in milliseconds between retry attempts. The
    delay increases exponentially for subsequent retries.
  - **Default:** `4000` ms
  - **Example:** `/set retrywait 10000`

### How to configure retry settings

Use the `/set` command within the LLxprt Code CLI to configure retry settings
for your session:

```bash
# Set maximum retry attempts to 3
/set retries 3

# Set initial retry wait time to 10 seconds (10000 ms)
/set retrywait 10000
```

These settings apply to all subsequent API calls during your session and can be
overridden at any time. To persist them, use `/profile save`.

### Provider-specific retry behavior

When you do not set these explicitly, each provider applies its own default.
The retry logic includes:

- Special handling for 429 (rate limit) errors, respecting `Retry-After`
  headers.
- Automatic detection of transient network issues (socket resets, stream
  interruptions).
- Integration with streaming pipelines so SSE disconnects are retried without
  user intervention.
