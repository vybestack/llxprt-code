# Retry Settings Configuration

LLxprt Code implements configurable exponential backoff retry logic for API calls to LLM providers. These settings help manage rate limits and transient errors effectively.

## Ephemeral Settings

Retry configuration can be set as ephemeral settings, which means they can be changed during a session without modifying your saved profiles or configuration files.

### Available Retry Settings

- **`retries`** (number):
  - **Description:** Maximum number of retry attempts for API calls. This setting controls how many times the CLI will retry a failed API request.
  - **Default:** `5` (Anthropic and Google providers) or `6` (OpenAI provider)
  - **Example:** `/set retries 3`

- **`retrywait`** (number):
  - **Description:** Initial delay in milliseconds between retry attempts. The delay increases exponentially for subsequent retries.
  - **Default:** `5000` ms (Anthropic and Google providers) or `4000` ms (OpenAI provider)
  - **Example:** `/set retrywait 10000`

### How to Configure Retry Settings

Use the `/set` command within the LLxprt Code CLI to configure retry settings for your session:

```bash
# Set maximum retry attempts to 3
/set retries 3

# Set initial retry wait time to 10 seconds (10000 ms)
/set retrywait 10000
```

These settings will apply to all subsequent API calls during your session and can be overridden at any time.

### Provider-Specific Retry Behavior

Different providers have different default retry configurations:

- **Google/Gemini:** 5 retries with 5000ms initial delay
- **Anthropic:** 5 retries with 5000ms initial delay
- **OpenAI:** 6 retries with 4000ms initial delay

The retry logic includes special handling for 429 (rate limit) errors and will automatically adjust behavior based on `Retry-After` headers when present.

### Technical Implementation

The retry mechanism is implemented in `packages/core/src/utils/retry.ts` and uses exponential backoff with jitter. Provider implementations in `packages/core/src/providers/` have been updated to use these global settings.
