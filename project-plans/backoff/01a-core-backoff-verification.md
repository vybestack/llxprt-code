# Phase 1a - Verification of Core Backoff Refactor (backoff)

## Verification Steps

1. **Check RateLimitInfo interface exists**:

   ```bash
   grep -n "interface RateLimitInfo" packages/core/src/types/rateLimits.ts
   # Should show the interface definition
   ```

2. **Verify retry.ts uses rate limit headers**:

   ```bash
   grep -n "x-ratelimit-" packages/core/src/utils/retry.ts
   # Should show header extraction code

   grep -n "consecutive429Count" packages/core/src/utils/retry.ts
   # Should return nothing (removed)
   ```

3. **Confirm Flash fallback removal**:

   ```bash
   grep -n "onPersistent429" packages/core/src/utils/retry.ts
   # Should return nothing (removed)

   grep -n "handleFlashFallback" packages/core/src/core/client.ts
   # Should return nothing or be commented out
   ```

4. **Check new callback exists**:

   ```bash
   grep -n "onRateLimitApproaching" packages/core/src/utils/retry.ts
   # Should show the new callback parameter
   ```

5. **Run type checking**:

   ```bash
   npm run typecheck
   # Must pass with no errors
   ```

6. **Run linting**:

   ```bash
   npm run lint
   # Must pass with no errors
   ```

7. **Run retry tests**:

   ```bash
   cd packages/core && npm test -- --testPathPattern=retry
   # All tests must pass
   ```

8. **Check for cheating**:

   ```bash
   # Ensure no hidden Flash fallback logic
   grep -r "flash" packages/core/src/utils/retry.ts
   # Should return nothing or only in comments

   # Ensure old fallback handler setup is removed
   grep -r "setFlashFallbackHandler" packages/cli/src/ui/App.tsx
   # Should be removed or commented out
   ```

## Outcome

If all checks pass: ✅ Phase 1 complete
If any check fails: ❌ List the specific failures
