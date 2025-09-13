# Token Tracking

## Overview

LLxprt Code provides real-time token tracking capabilities to help you monitor your API usage across multiple providers. The token tracking feature displays:

- **TPM (Tokens Per Minute)**: The rate of output token generation
- **Session Tokens**: Cumulative token usage for your current session
- **Throttle Wait Time**: Total time spent waiting for rate limit retries

## Features

### Real-Time Metrics in Footer

The footer displays live token metrics that update as you use the CLI:

```
TPM: 2450.75 | Tokens: 125k | Throttle: 6.2s
```

- **TPM**: Shows output tokens per minute (only output tokens, not input)
- **Tokens**: Total session tokens (input + output + cache + tool + thought)
- **Throttle**: Accumulated wait time from 429 rate limit retries

### Provider Support

Token tracking works with all supported providers:

- OpenAI (requires `stream_options: { include_usage: true }`)
- Anthropic (built-in usage tracking)
- Gemini (built-in usage tracking)
- Other providers as they add usage metadata

### No Logging Required

Token tracking works independently of conversation logging. You don't need to enable logging to see token metrics.

## Configuration

Token tracking is enabled by default. No configuration is required.

### Ephemeral Settings

You can control retry behavior (which affects throttle tracking) using ephemeral settings:

```bash
# Set max retries
/ephemeral retries 6

# Set initial retry wait time (ms)
/ephemeral retrywait 1000
```

## Commands

### View Detailed Stats

Use the `/stats` command to see detailed token usage breakdown:

```bash
/stats
```

This shows:

- Token usage by type (input, output, cache, tool, thought)
- Provider-specific metrics
- Historical usage patterns

### Diagnostics

The `/diagnostics` command includes token tracking metrics:

```bash
/diagnostics
```

## Understanding the Metrics

### TPM (Tokens Per Minute)

- Calculated using a sliding 60-second window
- Shows only output tokens (the tokens the model generates)
- Updates in real-time as responses stream in
- Helps you understand generation speed and identify throttling

### Session Tokens

- Accumulates all token types across the session
- Resets when you start a new session
- Includes:
  - **Input**: Tokens from your prompts
  - **Output**: Tokens from model responses
  - **Cache**: Cached context tokens (provider-specific)
  - **Tool**: Tokens used for tool calls
  - **Thought**: Internal reasoning tokens (provider-specific)

### Throttle Wait Time

- Tracks cumulative time spent waiting due to rate limits (429 errors)
- Helps identify when you're hitting provider limits
- Accumulates across all retries in the session

## Provider-Specific Notes

### OpenAI

- Requires streaming responses for real-time tracking
- Token counts available via `usage` field in responses
- Automatically disables OpenAI SDK's built-in retries to track throttles

### Anthropic

- Native usage tracking in all responses
- Includes cache tokens for context caching
- Thought tokens for Claude's thinking process

### Gemini

- Built-in token counting
- May show different token counts due to tokenizer differences

## Troubleshooting

### TPM Shows 0

- Ensure you're using a provider that returns usage data
- Check that streaming is enabled
- Verify the provider is configured correctly

### Throttle Time Not Updating

- Only tracks 429 rate limit errors
- Some providers handle retries internally
- Check ephemeral settings for retry configuration

### Session Tokens Not Accumulating

- Verify provider is returning usage metadata
- Check that token tracking isn't disabled
- Ensure provider wrapper is properly configured

## Technical Details

Token tracking is implemented through:

- `ProviderPerformanceTracker`: Calculates TPM and tracks metrics
- `LoggingProviderWrapper`: Extracts token counts from responses
- `ProviderManager`: Accumulates session-wide token usage
- UI components poll metrics every second for live updates

The feature has minimal performance impact and doesn't affect response times.
