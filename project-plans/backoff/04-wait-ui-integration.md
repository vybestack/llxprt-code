# Phase 4 - Rate Limit Wait UI Integration (backoff)

**⚠️ STOP after completing all tasks in this phase and wait for verification.**

## Goal

Integrate rate limit information into the UI, showing wait progress and allowing cancellation.

## Deliverables

- [ ] Rate limit status display in UI
- [ ] Wait countdown/progress indicator
- [ ] Cancellable wait with Ctrl+C handling
- [ ] Integration with fallback model logic

## Implementation Checklist

- [ ] Update `packages/core/src/core/client.ts` to pass rate limit info to CLI:

  ```typescript
  // Add to response handling
  if (response.headers['x-ratelimit-remaining']) {
    this.lastRateLimitInfo = {
      limit: parseInt(response.headers['x-ratelimit-limit']),
      remaining: parseInt(response.headers['x-ratelimit-remaining']),
      resetTime: parseInt(response.headers['x-ratelimit-reset']),
    };
  }
  ```

- [ ] Create rate limit display component in `packages/cli/src/ui/components/RateLimitStatus.tsx`:
  - Show remaining requests when < 20% of limit
  - Display wait countdown when rate limited
  - Update every second during wait

- [ ] Update `packages/cli/src/ui/hooks/useGeminiStream.ts`:
  - Handle rate limit wait states
  - Show progress messages during wait
  - Implement cancellable wait with fallback option

- [ ] Add rate limit handler in retry logic:

  ```typescript
  // After 3 failures, check for fallback model
  if (attemptCount >= 3 && settings.fallbackModel) {
    addMessage({
      type: MessageType.INFO,
      content: `Switching to fallback model: ${settings.fallbackModel}`,
    });
    // Switch to fallback model
  }
  ```

- [ ] Handle Ctrl+C during wait:
  - Register signal handler during wait periods
  - Offer to use fallback model or exit

## Self-Verify Commands

```bash
# Type checking should pass
npm run typecheck

# Lint should pass
npm run lint

# Component tests
cd packages/cli && npm test -- RateLimitStatus

# Manual test - simulate rate limit
# This requires hitting actual rate limits or mocking
```

## Notes

- Wait UI should be non-blocking (user can still type commands)
- Show estimated wait time based on reset timestamp
- Clear indication when using fallback model

**STOP. Wait for Phase 4a verification before proceeding.**
