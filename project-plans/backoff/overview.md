# Intelligent Rate Limit Backoff and Billing Warnings

## Overview

This feature replaces the current automatic Flash fallback behavior with an intelligent backoff system that respects rate limits and user preferences. The new system will wait for Pro model availability by default, with an optional user-configured fallback model after repeated failures.

## Key Requirements

### 1. Rate Limit Handling

- **Default behavior**: Wait for Pro model when rate limited (no automatic Flash fallback)
- **Use rate limit headers**: Proactively monitor `X-RateLimit-*` headers to anticipate limits
- **Smart backoff**: Calculate exact wait times using `X-RateLimit-Reset` timestamp
- **Respect Retry-After**: Honor the `Retry-After` header when present
- **User feedback**: Show clear countdown/progress during waits

### 2. Fallback Model Configuration

- **New command**: `/fallback-model [model-name]` to set optional fallback
- **Trigger threshold**: Only use fallback after 3+ consecutive failures
- **Disable option**: `/fallback-model none` to disable fallback entirely
- **Show current**: `/fallback-model` without args displays current setting
- **Persistence**: Save fallback model preference in user settings

### 3. Billing Warnings

- **API key warning**: When users set `/key` or have GEMINI_API_KEY env var:
  ```
  ⚠️ Warning: Using a Gemini API key will result in charges to your Google Cloud account.
  To use Gemini CLI for free, use `/auth` with OAuth and remove any API keys.
  ```
- **Keyfile warning**: Similar warning when `.gemini_key` or `.openai_key` files are detected
- **Provider switch warning**: When switching from free OAuth to paid API key mode
- **Show on `/auth` command**: Display current auth method and billing implications

### 4. UI/UX Improvements

- **Rate limit status**: Display remaining requests in footer or status area
- **Wait progress**: Show countdown timer when waiting for rate limit reset
- **Cancel option**: Allow Ctrl+C to cancel wait and proceed with fallback
- **Clear messaging**: Explain why waiting and estimated time remaining

## Technical Changes

### Core Library Changes

1. Modify `retryWithBackoff` to use rate limit headers instead of counting 429s
2. Remove automatic Flash fallback logic for OAuth users
3. Add support for user-configured fallback models
4. Expose rate limit information to CLI layer

### CLI Changes

1. Add `/fallback-model` command implementation
2. Add billing warnings to `/key`, `/auth`, and provider switching
3. Update UI to show rate limit status and wait progress
4. Add fallback model to user settings

### Settings Schema

```typescript
interface Settings {
  // ... existing settings ...
  fallbackModel?: string; // User-configured fallback model
  preferWaitOverFallback?: boolean; // Future: explicit wait preference
}
```

## Migration Path

1. Existing users will experience the new "wait for Pro" behavior
2. Flash fallback messages will be updated to suggest `/fallback-model` command
3. OAuth users will see no billing warnings (free tier)
4. API key users will see billing warnings on first use

## Success Criteria

- [ ] No automatic Flash fallback for rate-limited users
- [ ] Rate limit headers used for intelligent backoff
- [ ] `/fallback-model` command fully functional
- [ ] Billing warnings displayed for all API key scenarios
- [ ] Clear user feedback during rate limit waits
- [ ] Settings properly persist fallback model choice
