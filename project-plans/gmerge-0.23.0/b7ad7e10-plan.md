# Reimplement Plan: Quota retry improvements (upstream b7ad7e1035)

## Upstream Change
Makes `retryDelayMs` optional in quota error classes and adds better exponential backoff handling. Removes hardcoded 5-second fallback, allowing retry logic to use exponential backoff when specific delay is not provided.

## LLxprt Files to Modify
- packages/core/src/utils/googleQuotaErrors.ts — Make retryDelayMs optional, remove default fallback
- packages/core/src/utils/googleQuotaErrors.test.ts — Update test expectations
- packages/core/src/utils/retry.ts — Add error logging, handle undefined retryDelayMs

## Steps

1. **Update googleQuotaErrors.ts** (packages/core/src/utils/googleQuotaErrors.ts):

   **A. Remove default constant**:
   - Delete: `const DEFAULT_RETRYABLE_DELAY_SECOND = 5;`

   **B. Update TerminalQuotaError constructor**:
   ```typescript
   export class TerminalQuotaError extends Error {
     retryDelayMs?: number;

     constructor(
       message: string,
       override readonly cause: GoogleApiError,
       retryDelaySeconds?: number,  // Make optional
     ) {
       super(message);
       this.name = 'TerminalQuotaError';
       this.retryDelayMs = retryDelaySeconds
         ? retryDelaySeconds * 1000
         : undefined;
     }
   }
   ```

   **C. Update RetryableQuotaError**:
   ```typescript
   export class RetryableQuotaError extends Error {
     retryDelayMs?: number;  // Make optional

     constructor(
       message: string,
       override readonly cause: GoogleApiError,
       retryDelaySeconds?: number,  // Make optional
     ) {
       super(message);
       this.name = 'RetryableQuotaError';
       this.retryDelayMs = retryDelaySeconds
         ? retryDelaySeconds * 1000
         : undefined;
     }
   }
   ```

   **D. Remove fallback from 429 without retry info** (around line 127):
   ```typescript
   return new RetryableQuotaError(
     errorMessage,
     {
       code: 429,
       message: errorMessage,
       details: [],
     },
     // Remove: DEFAULT_RETRYABLE_DELAY_SECOND
   );
   ```

   **E. Remove fallback from generic 429** (around line 262):
   ```typescript
   return new RetryableQuotaError(
     errorMessage,
     {
       code: 429,
       message: errorMessage,
       details: [],
     },
     // Remove: DEFAULT_RETRYABLE_DELAY_SECOND
   );
   ```

2. **Update googleQuotaErrors.test.ts** (packages/core/src/utils/googleQuotaErrors.test.ts):

   **A. Update test for RetryableQuotaError without specific delay**:
   ```typescript
   it('should return RetryableQuotaError with 5s fallback for generic 429 without specific message', () => {
     // ... existing setup ...
     expect(result).toBeInstanceOf(RetryableQuotaError);
     if (result instanceof RetryableQuotaError) {
       expect(result.retryDelayMs).toBeUndefined();  // Changed from .toBe(5000)
     }
   });
   ```

   **B. Update all similar tests** (4 tests total based on upstream diff):
   - Test around line 345: "should return RetryableQuotaError..."
   - Test around line 396: "should return RetryableQuotaError without delay time for generic 429..."
   - Test around line 406: "should return RetryableQuotaError without delay time for 429 with empty details..."
   - Test around line 429: "should return RetryableQuotaError without delay time for 429 with some detail..."
   
   All should expect `toBeUndefined()` instead of `toBe(5000)`

   **C. Update test names**:
   - "...with 5s fallback..." → "...without delay time..."

3. **Update retry.ts** (packages/core/src/utils/retry.ts):

   **A. Add max attempts logging** (around line 222):
   ```typescript
   if (attempt >= maxAttempts) {
     const errorMessage =
       classifiedError instanceof Error ? classifiedError.message : '';
     debugLogger.warn(
       `Attempt ${attempt} failed${errorMessage ? `: ${errorMessage}` : ''}. Max attempts reached`,
     );
     if (onPersistent429) {
       // ... existing fallback logic
     }
     throw is500 ? error : classifiedError;
   }
   ```

   **B. Update retry delay handling** (around line 248):
   ```typescript
   if (
     classifiedError instanceof RetryableQuotaError &&
     classifiedError.retryDelayMs !== undefined
   ) {
     debugLogger.warn(
       `Attempt ${attempt} failed: ${classifiedError.message}. Retrying after ${classifiedError.retryDelayMs}ms...`,
     );
     await delay(classifiedError.retryDelayMs, signal);
   } else {
     // ... existing exponential backoff logic (unchanged)
   }
   ```
   
   The key change: only use `retryDelayMs` if it's defined. If undefined, fall through to exponential backoff.

   **C. Change console.warn to debugLogger.warn**:
   - Find: `console.warn(`
   - Replace with: `debugLogger.warn(`

## Verification
- `cd packages/core && npx vitest run src/utils/googleQuotaErrors.test.ts`
- `cd packages/core && npx vitest run src/utils/retry.test.ts` (if exists)
- `npm run typecheck`
- `npm run lint`
- Verify exponential backoff works when retryDelayMs is undefined
- Verify specific delay is used when retryDelayMs is provided

## Branding Adaptations
- None required (internal retry logic, no user-facing strings)

## Notes
- This change allows multi-provider retry logic to work better
- LLxprt may serve non-Google providers that don't provide specific retry delays
- Exponential backoff is now the default, specific delays are used when available
- Improves resilience for rate limit scenarios across different providers
