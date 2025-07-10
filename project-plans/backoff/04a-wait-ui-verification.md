# Phase 4a - Verification of Rate Limit Wait UI (backoff)

## Verification Steps

1. **Check rate limit info storage**:

   ```bash
   grep -n "lastRateLimitInfo" packages/core/src/core/client.ts
   # Should show rate limit info being stored
   ```

2. **Verify RateLimitStatus component**:

   ```bash
   # Check component exists
   ls packages/cli/src/ui/components/RateLimitStatus.tsx

   # Check component structure
   grep -n "remaining\|resetTime\|countdown" packages/cli/src/ui/components/RateLimitStatus.tsx
   # Should show rate limit display logic
   ```

3. **Check useGeminiStream integration**:

   ```bash
   grep -n "rate.*limit\|wait" packages/cli/src/ui/hooks/useGeminiStream.ts
   # Should show rate limit handling

   grep -n "fallbackModel" packages/cli/src/ui/hooks/useGeminiStream.ts
   # Should show fallback model usage after 3 failures
   ```

4. **Verify Ctrl+C handling**:

   ```bash
   grep -n "SIGINT\|process.on" packages/cli/src/ui/hooks/useGeminiStream.ts
   # Should show signal handler for cancellation
   ```

5. **Run type checking**:

   ```bash
   npm run typecheck
   # Must pass with no errors
   ```

6. **Run component tests**:

   ```bash
   cd packages/cli && npm test -- RateLimitStatus
   # Tests must pass
   ```

7. **Check for proper countdown**:

   ```bash
   # Look for interval/timeout for countdown updates
   grep -n "setInterval\|setTimeout" packages/cli/src/ui/components/RateLimitStatus.tsx
   # Should show timer for countdown updates
   ```

8. **Verify fallback threshold**:
   ```bash
   # Check for 3-failure threshold
   grep -n "attemptCount >= 3\|failures >= 3" packages/cli/src/ui/hooks/useGeminiStream.ts
   # Should show fallback logic after 3 attempts
   ```

## Manual Testing (if possible)

1. Set a very low rate limit (would require API cooperation)
2. Make requests until rate limited
3. Observe:
   - Wait countdown appears
   - Time counts down correctly
   - Ctrl+C offers fallback option
   - After 3 failures, fallback model is used (if configured)

## Outcome

If all checks pass: ✅ Phase 4 complete
If any check fails: ❌ List the specific failures
