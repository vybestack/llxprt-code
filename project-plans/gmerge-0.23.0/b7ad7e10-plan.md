# Reimplement Plan: Quota retry improvements (upstream b7ad7e1035)

## Upstream Change
Makes `retryDelayMs` optional in quota error classes and adds better exponential backoff handling. Removes hardcoded 5-second fallback (`DEFAULT_RETRYABLE_DELAY_SECOND`), allowing retry logic to use exponential backoff when specific delay is not provided.

**Source**: `git show b7ad7e1035` in `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/tmp/gemini-cli-upstream`

## Exponential Backoff Parameters
From existing LLxprt `retry.ts` (DEFAULT_RETRY_OPTIONS), confirmed identical to upstream:
- **Base delay (initialDelayMs)**: 5000ms
- **Multiplier**: 2 (doubles each retry)
- **Max cap (maxDelayMs)**: 30000ms (30 seconds)
- **Jitter**: ±30% of current delay (applied in retry.ts line ~408: `currentDelay * 0.3 * (Math.random() * 2 - 1)`)

## LLxprt Files to Modify
- packages/core/src/utils/googleQuotaErrors.ts — Make retryDelayMs optional, remove default fallback
- packages/core/src/utils/googleQuotaErrors.test.ts — Update test expectations
- packages/core/src/utils/retry.ts — Add error logging, handle undefined retryDelayMs
- packages/core/src/utils/retry.test.ts — Add behavioral tests for exponential backoff with undefined retryDelayMs

## TDD: Test-First Development (MANDATORY)

**CRITICAL**: Follow RED-GREEN-REFACTOR cycle per dev-docs/RULES.md. Every line of production code must be written in response to a failing test.

**Step 1: Write behavioral tests in `packages/core/src/utils/retry.test.ts`**

Add these tests for new undefined retryDelayMs behavior:

1. **Test: RetryableQuotaError with undefined retryDelayMs uses exponential backoff**
   - Create RetryableQuotaError with retryDelayMs=undefined
   - Mock delay function to capture actual delay values
   - Verify first retry delay is between 3500ms-6500ms (5000ms ±30% jitter)
   - Verify second retry delay is between 7000ms-13000ms (10000ms ±30% jitter)
   - Verify third retry delay is between 14000ms-26000ms (20000ms ±30% jitter)
   - Verify delays never exceed 30000ms (max cap)

2. **Test: RetryableQuotaError with defined retryDelayMs=10000 bypasses exponential backoff**
   - Create RetryableQuotaError with retryDelayMs=10000
   - Mock delay function to capture actual delay values
   - Verify delay is exactly 10000ms (no jitter, no exponential growth)
   - Verify delay does NOT fall through to exponential backoff logic

3. **Test: debugLogger.warn called when max attempts reached with undefined retryDelayMs**
   - Create RetryableQuotaError with retryDelayMs=undefined
   - Set maxAttempts to 2
   - Mock debugLogger.warn
   - Verify debugLogger.warn called with message matching: "Attempt 2 failed: [error message]. Max attempts reached"

4. **Test: console.warn replaced with debugLogger.warn for explicit retryDelayMs**
   - Create RetryableQuotaError with retryDelayMs=10000
   - Mock debugLogger.warn
   - Verify debugLogger.warn called (not console.warn)
   - Verify message format: "Attempt N failed: [message]. Retrying after 10000ms..."

**Step 2: Run tests → Confirm RED (failures)**

```bash
cd packages/core && npx vitest run src/utils/retry.test.ts
```

Expected: All 4 new tests FAIL (retry.ts doesn't handle undefined retryDelayMs yet)

**Step 3: Implement minimal changes to retry.ts to make tests GREEN**

Only implement after tests are RED. See implementation steps below.

**Step 4: Run tests → Confirm GREEN (all pass)**

```bash
cd packages/core && npx vitest run src/utils/retry.test.ts
```

Expected: All tests PASS (including new tests)

**Step 5: Run full verification sequence (see Verification section below)**

This ensures no regressions and all integration points work.

## Steps

1. **Update googleQuotaErrors.ts** (packages/core/src/utils/googleQuotaErrors.ts):

   **A. Remove default constant** (line 16):
   Delete:
   ```typescript
   const DEFAULT_RETRYABLE_DELAY_SECOND = 5;
   ```

   **B. Update TerminalQuotaError constructor** (lines 18-29):
   
   Current LLxprt code:
   ```typescript
   export class TerminalQuotaError extends Error {
     readonly cause: GoogleApiError;

     constructor(message: string, cause: GoogleApiError) {
       super(message);
       this.name = 'TerminalQuotaError';
       this.cause = cause;
     }
   }
   ```
   
   Replace with (matching upstream pattern):
   ```typescript
   export class TerminalQuotaError extends Error {
     retryDelayMs?: number;
     readonly cause: GoogleApiError;

     constructor(
       message: string,
       override readonly cause: GoogleApiError,
       retryDelaySeconds?: number,
     ) {
       super(message);
       this.name = 'TerminalQuotaError';
       this.retryDelayMs = retryDelaySeconds
         ? retryDelaySeconds * 1000
         : undefined;
     }
   }
   ```

   **C. Update RetryableQuotaError constructor** (lines 34-49):
   
   Current LLxprt code:
   ```typescript
   export class RetryableQuotaError extends Error {
     retryDelayMs: number;
     readonly cause: GoogleApiError;

     constructor(
       message: string,
       cause: GoogleApiError,
       retryDelaySeconds: number,
     ) {
       super(message);
       this.name = 'RetryableQuotaError';
       this.cause = cause;
       this.retryDelayMs = retryDelaySeconds * 1000;
     }
   }
   ```
   
   Replace with:
   ```typescript
   export class RetryableQuotaError extends Error {
     retryDelayMs?: number;  // Changed: Make optional
     readonly cause: GoogleApiError;

     constructor(
       message: string,
       override readonly cause: GoogleApiError,
       retryDelaySeconds?: number,  // Changed: Make optional
     ) {
       super(message);
       this.name = 'RetryableQuotaError';
       this.retryDelayMs = retryDelaySeconds
         ? retryDelaySeconds * 1000
         : undefined;
     }
   }
   ```

   **D. Remove DEFAULT_RETRYABLE_DELAY_SECOND from 429 fallback** (search for first occurrence in classifyGoogleError):
   
   Find (around line 127):
   ```typescript
   return new RetryableQuotaError(
     errorMessage,
     googleApiError ?? {
       code: 429,
       message: errorMessage,
       details: [],
     },
     DEFAULT_RETRYABLE_DELAY_SECOND,  // Remove this line
   );
   ```
   
   Replace with (remove third argument):
   ```typescript
   return new RetryableQuotaError(
     errorMessage,
     googleApiError ?? {
       code: 429,
       message: errorMessage,
       details: [],
     },
   );
   ```

   **E. Remove DEFAULT_RETRYABLE_DELAY_SECOND from final 429 fallback** (search for second occurrence):
   
   Find (around line 268):
   ```typescript
   if (status === 429) {
     const errorMessage =
       googleApiError?.message ||
       (error instanceof Error ? error.message : String(error));
     return new RetryableQuotaError(
       errorMessage,
       googleApiError ?? {
         code: 429,
         message: errorMessage,
         details: [],
       },
       DEFAULT_RETRYABLE_DELAY_SECOND,  // Remove this line
     );
   }
   ```
   
   Replace with (remove third argument):
   ```typescript
   if (status === 429) {
     const errorMessage =
       googleApiError?.message ||
       (error instanceof Error ? error.message : String(error));
     return new RetryableQuotaError(
       errorMessage,
       googleApiError ?? {
         code: 429,
         message: errorMessage,
         details: [],
       },
     );
   }
   ```

2. **Update googleQuotaErrors.test.ts** (packages/core/src/utils/googleQuotaErrors.test.ts):

   Based on upstream diff, update 4 tests that currently expect `retryDelayMs: 5000` to expect `undefined`:

   **A. Test around line 342** (first test in upstream diff):
   
   Find test:
   ```typescript
   it('should return RetryableQuotaError with 5s fallback for ...', () => {
     // ... setup ...
     expect(result).toBeInstanceOf(RetryableQuotaError);
     if (result instanceof RetryableQuotaError) {
       expect(result.retryDelayMs).toBe(5000);  // Change this
     }
   });
   ```
   
   Change to:
   ```typescript
   expect(result.retryDelayMs).toBeUndefined();
   ```

   **B. Test around line 396** (second test):
   
   Same pattern - find `expect(result.retryDelayMs).toBe(5000);` and change to `toBeUndefined()`

   **C. Test around line 403** (third test):
   
   Title: "should return RetryableQuotaError with 5s fallback for generic 429 without specific message"
   
   Change title to: "should return RetryableQuotaError without delay time for generic 429 without specific message"
   
   Change assertion: `expect(result.retryDelayMs).toBe(5000);` → `expect(result.retryDelayMs).toBeUndefined();`

   **D. Test around line 410** (fourth test):
   
   Title: "should return RetryableQuotaError with 5s fallback for 429 with empty details and no regex match"
   
   Change title to: "should return RetryableQuotaError without delay time for 429 with empty details and no regex match"
   
   Change assertion: `expect(result.retryDelayMs).toBe(5000);` → `expect(result.retryDelayMs).toBeUndefined();`

   **E. Test around line 426** (fifth test):
   
   Title: "should return RetryableQuotaError with 5s fallback for 429 with some detail"
   
   Change title to: "should return RetryableQuotaError without delay time for 429 with some detail"
   
   Change assertion: `expect(result.retryDelayMs).toBe(5000);` → `expect(result.retryDelayMs).toBeUndefined();`

   **Summary**: Update 4-5 tests where generic 429 errors (without explicit retry delay) now return `retryDelayMs: undefined` instead of `5000`.

3. **Update retry.ts** (packages/core/src/utils/retry.ts):

   **PREREQUISITE**: Complete TDD RED phase before implementing these changes.

   **A. Import RetryableQuotaError** (at top of file, after existing imports):
   ```typescript
   import { RetryableQuotaError } from './googleQuotaErrors.js';
   ```

   **B. Add max attempts logging** (find existing `if (attempt >= maxAttempts)` block inside `if (classifiedError instanceof RetryableQuotaError || is500)`):
   
   Current code around line 220:
   ```typescript
   if (classifiedError instanceof RetryableQuotaError || is500) {
     if (attempt >= maxAttempts) {
       if (onPersistent429) {
   ```
   
   Add logging BEFORE the `if (onPersistent429)` block:
   ```typescript
   if (classifiedError instanceof RetryableQuotaError || is500) {
     if (attempt >= maxAttempts) {
       const errorMessage =
         classifiedError instanceof Error ? classifiedError.message : '';
       debugLogger.warn(
         `Attempt ${attempt} failed${errorMessage ? `: ${errorMessage}` : ''}. Max attempts reached`,
       );
       if (onPersistent429) {
         // ... existing fallback logic (keep unchanged)
       }
       throw is500 ? error : classifiedError;
     }
   ```

   **C. Update retry delay handling** (find existing RetryableQuotaError block that calls delay):
   
   Current code (search for `if (classifiedError instanceof RetryableQuotaError)`):
   ```typescript
   if (classifiedError instanceof RetryableQuotaError) {
     console.warn(
       `Attempt ${attempt} failed: ${classifiedError.message}. Retrying after ${classifiedError.retryDelayMs}ms...`,
     );
     await delay(classifiedError.retryDelayMs, signal);
   ```
   
   Replace with:
   ```typescript
   if (
     classifiedError instanceof RetryableQuotaError &&
     classifiedError.retryDelayMs !== undefined
   ) {
     debugLogger.warn(
       `Attempt ${attempt} failed: ${classifiedError.message}. Retrying after ${classifiedError.retryDelayMs}ms...`,
     );
     await delay(classifiedError.retryDelayMs, signal);
   ```
   
   **Critical changes**:
   - Add `&& classifiedError.retryDelayMs !== undefined` condition (narrows type, prevents undefined delay)
   - Change `console.warn` to `debugLogger.warn` (consistent logging)
   - If retryDelayMs is undefined, code falls through to exponential backoff logic below (no else clause needed)
   
   This makes tests GREEN because:
   - Test 1: undefined retryDelayMs skips this block → falls through to exponential backoff
   - Test 2: defined retryDelayMs=10000 enters this block → uses exact delay
   - Test 3: max attempts logging now exists
   - Test 4: debugLogger.warn used instead of console.warn

## Verification (FULL SEQUENCE - RUN ALL BEFORE COMMIT)

Run from project root (`/Users/acoliver/projects/llxprt/branch-1/llxprt-code`). **ALL steps must pass.**

### Phase 1: Unit Tests (Run from package directory)
```bash
cd packages/core
npx vitest run src/utils/googleQuotaErrors.test.ts
npx vitest run src/utils/retry.test.ts
cd ../..
```

**Expected**: All tests pass, including 4 new retry.test.ts tests for undefined retryDelayMs behavior.

### Phase 2: Full Test Suite
```bash
npm run test
```

**Expected**: All tests pass across all packages. No regressions.

### Phase 3: Type Safety
```bash
npm run typecheck
```

**Expected**: No TypeScript errors. Strict mode compliance verified.

### Phase 4: Code Quality
```bash
npm run lint
npm run format
```

**Expected**: 
- `npm run lint`: No linting errors
- `npm run format`: Code formatted (no changes if already formatted)

### Phase 5: Build Verification
```bash
npm run build
```

**Expected**: Clean build with no errors. All packages compile successfully.

### Phase 6: Integration Smoke Test
```bash
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

**Expected**: CLI starts successfully, generates haiku, no errors related to retry logic.

### Verification Checklist

Before committing, confirm:
- [ ] All unit tests pass (Phase 1)
- [ ] Full test suite passes (Phase 2)
- [ ] No TypeScript errors (Phase 3)
- [ ] No linting errors (Phase 4)
- [ ] Code is formatted (Phase 4)
- [ ] Build succeeds (Phase 5)
- [ ] Integration test passes (Phase 6)
- [ ] No regressions in existing functionality
- [ ] New behavior tests cover undefined retryDelayMs cases

**STOP**: Do not commit if ANY verification step fails. Fix issues and re-run full verification sequence.

## Branding Adaptations
- None required (internal retry logic, no user-facing strings)

## Implementation Summary

This plan reimplements upstream commit b7ad7e1035 with strict TDD compliance:

1. **Test-First (RED)**: Write 4 behavioral tests for undefined retryDelayMs handling
2. **Implementation (GREEN)**: Make minimal changes to pass tests
3. **Verification (FULL)**: Run complete 6-phase verification sequence

Key behavioral change: RetryableQuotaError without explicit retryDelayMs now falls through to exponential backoff (5000ms base, 2x multiplier, 30000ms cap, ±30% jitter) instead of using hardcoded 5-second delay.

## Notes
- This change allows multi-provider retry logic to work better
- LLxprt may serve non-Google providers that don't provide specific retry delays
- Exponential backoff is now the default, specific delays are used when available
- Improves resilience for rate limit scenarios across different providers
- Follows dev-docs/RULES.md TDD mandate: every production line written after failing test
