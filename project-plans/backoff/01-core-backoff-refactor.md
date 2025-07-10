# Phase 1 - Core Backoff Refactor (backoff)

**⚠️ STOP after completing all tasks in this phase and wait for verification.**

## Goal

Refactor the core retry logic to use rate limit headers instead of counting 429 errors, and remove automatic Flash fallback.

## Deliverables

- [ ] Updated `packages/core/src/utils/retry.ts` with header-based backoff
- [ ] Removed automatic Flash fallback logic
- [ ] New rate limit info interface exported from core
- [ ] Updated retry configuration options

## Implementation Checklist

- [ ] Create `RateLimitInfo` interface in `packages/core/src/types/rateLimits.ts`:

  ```typescript
  export interface RateLimitInfo {
    limit: number;
    remaining: number;
    resetTime: number; // Unix timestamp in seconds
    retryAfter?: number; // Seconds to wait (from Retry-After header)
  }
  ```

- [ ] Extract rate limit headers in `retryWithBackoff` function
- [ ] Replace `consecutive429Count` logic with header-based decisions
- [ ] Remove `onPersistent429` callback and Flash fallback logic
- [ ] Add `onRateLimitApproaching` callback for proactive warnings
- [ ] Update retry delay calculation to use `resetTime` when available
- [ ] Export rate limit info from successful responses

## Self-Verify Commands

```bash
# Type checking should pass
npm run typecheck

# Lint should pass
npm run lint

# Core tests should pass (update tests that expect Flash fallback)
cd packages/core && npm test -- --testPathPattern=retry
```

## Notes

- Preserve existing exponential backoff for non-rate-limit errors
- Keep OAuth/API key auth type checks but remove fallback behavior
- Ensure backward compatibility for existing retry options

**STOP. Wait for Phase 1a verification before proceeding.**
