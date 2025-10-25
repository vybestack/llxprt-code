# Retry Settings Configuration

LLxprt Code implements configurable exponential backoff retry logic for API calls to LLM providers. These settings help manage rate limits and transient errors effectively.

## Ephemeral Settings

Retry configuration can be set as ephemeral settings, which means they can be changed during a session without modifying your saved profiles or configuration files.

### Available Retry Settings

- **`retries`** (number):
  - **Description:** Maximum number of retry attempts for API calls. LLxprt now uses a unified default across providers.
  - **Default:** `6`
  - **Example:** `/set retries 3`

- **`retrywait`** (number):
  - **Description:** Initial delay in milliseconds between retry attempts. The delay increases exponentially for subsequent retries.
  - **Default:** `4000` ms
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

The retry logic now uses the same baseline everywhere (6 attempts, 4-second initial delay) and includes:

- Special handling for 429 (rate limit) errors (respecting `Retry-After` headers)
- Automatic detection of transient network issues (socket resets, stream interruptions)
- Integration with streaming pipelines so SSE disconnects are retried without user intervention

### Technical Implementation

The retry mechanism is implemented in `packages/core/src/utils/retry.ts` and uses exponential backoff with jitter. Provider implementations in `packages/core/src/providers/` have been updated to use these global settings.
