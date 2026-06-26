# CodeQL — js/clear-text-logging (alerts 154, 155, 158)

**Rule:** `js/clear-text-logging` — "Clear-text logging of sensitive
information" (high).
**File:** `packages/auth/src/oauth-errors.ts`
**Alert lines (pre-fix):** 553, 618, 671.

## What CodeQL flagged

`OAuthError` carries free-form fields that can originate from **untrusted OAuth
provider responses**: `message`, `stack`, `technicalDetails` (an arbitrary
`Record<string, unknown>`), and a wrapped `originalError`. The class exposed a
`toLogEntry()` method whose result is passed straight to a logger in three
places:

- `RetryHandler.executeWithRetry` debug line (the backoff log),
- `GracefulErrorHandler.handleGracefully` (`this.logger.debug(..., toLogEntry())`),
- `GracefulErrorHandler.wrapMethod` (same pattern).

Because `toLogEntry()` previously emitted the raw `message` / `stack` /
`technicalDetails`, CodeQL traced a taint path from an untrusted source (token
endpoint error payloads, which can contain tokens, `client_secret`, auth codes,
etc.) to a clear-text log sink. That is a genuine secret-leakage risk, not a
false positive.

## Fix (applied)

Make `toLogEntry()` **redact by construction** so there is no longer any taint
path to the log sink, while preserving the structured, non-sensitive fields that
make the log useful.

1. A single redaction marker, consistent with the existing `maskToken`
   convention in `packages/auth/src/precedence.ts`:

       const REDACTED = '[redacted]' as const;

2. A helper that preserves object **shape** (keys) but replaces every **value**:

       function redactTechnicalDetails(
         details: Record<string, unknown>,
       ): Record<string, unknown> {
         const redacted: Record<string, unknown> = {};
         for (const key of Object.keys(details)) {
           redacted[key] = REDACTED;
         }
         return redacted;
       }

3. `toLogEntry()` now redacts every free-form/secret-bearing field and keeps
   only the safe classification fields:

   - **Redacted:** `message`, `stack`, all `technicalDetails` values,
     `originalError.message`, `originalError.stack`.
   - **Preserved (safe, non-sensitive):** `type`, `category`, `provider`,
     `isRetryable`, `retryAfterMs`, `userMessage`, `actionRequired`,
     `originalError.name`.

4. The retry-delay log (alert 154's sink) additionally coerces the
   attacker-influenced `retryAfterMs` through arithmetic to a sanitized finite
   number before logging, severing the taint flow:

       const delayMs = Number.isFinite(delay) ? Math.round(delay) : 0;

   The log then interpolates `delayMs` (a clean numeric), not the raw value.

## Why this fully resolves the alerts

After the change there is **no** data-flow from any untrusted field to a logging
call: every value that could carry a secret is replaced by the constant
`'[redacted]'` (or, for `delayMs`, a numeric derived purely by arithmetic).
`userMessage`/`actionRequired` are first-party, developer-authored strings (not
derived from provider payloads), so they are safe to retain.

## Tests

- Updated `packages/auth/src/__tests__/oauth-errors.spec.ts` (2 existing
  `toLogEntry` assertions updated to the redacted shape: `message`, `stack`, and
  `technicalDetails` values all `'[redacted]'`).
- Added `packages/auth/src/__tests__/oauth-errors.redaction.spec.ts` (11 tests)
  asserting that:
  - secrets embedded in `message`/`stack`/`technicalDetails`/`originalError`
    never appear in `JSON.stringify(toLogEntry())`,
  - the preserved classification fields keep their real values,
  - `handleGracefully` and `wrapMethod` do not leak secrets to the logger.
- Full `packages/auth` suite passes (439 tests).
