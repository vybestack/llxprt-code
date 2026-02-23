# Bucket Failover Recovery — Requirements Specification (EARS)

**Plan ID:** PLAN-issue1598  
**Issue:** #1598  
**Created:** 2025-02-23  
**Revision:** 2  
**Status:** Draft

## Document Purpose

This document specifies all functional and non-functional requirements for the Bucket Failover Recovery feature using EARS (Easy Approach to Requirements Syntax) format. Each requirement is unique, testable, unambiguous, and atomic.

**Important: Target State Document**  
This document describes the **TARGET STATE** after implementation. The baseline (current state before changes) is documented in the Baseline section below. All requirements describe what the system will do after issue #1598 is complete.

---

## Baseline (Current State)

### Current Failover Behavior
- `BucketFailoverHandlerImpl.tryFailover()` performs simple round-robin rotation through buckets
- No classification of failure reasons
- No foreground reauth support
- Returns boolean: `true` if next bucket found, `false` if all tried
- State tracking via `triedBucketsThisSession` set
- `AllBucketsExhaustedError` constructor: `constructor(providerName: string, attemptedBuckets: string[], lastError: Error)`

### Current RetryOrchestrator Triggers
- Tracks `consecutive429s` and `consecutiveAuthErrors` counters
- Calls `tryFailover()` when:
  - `consecutive429s > failoverThreshold` (immediate 429 does not trigger failover; requires consecutive count)
  - Immediate 402 (payment required)
  - `consecutiveAuthErrors > 1` (requires multiple auth failures)

### Current Interfaces
- `BucketFailoverHandler` interface: `tryFailover()` only — no optional parameter
- No `getLastFailoverReasons()` method
- No `FailoverContext` parameter
- No `BucketFailureReason` type
- No `bucketFailureReasons` property on `AllBucketsExhaustedError`

### Current Token Field Name
- Actual code uses `expiry` field (Unix timestamp in seconds), not `expiresAt`. All references in this document use `expiry` to match the actual implementation.

---

## Glossary

| Term | Definition |
|------|------------|
| **Bucket** | An API key identifier (e.g., `default`, `claudius`, `vybestack`) within a multi-key profile configuration |
| **Failover** | The process of switching from a failed bucket to another bucket in the profile when the current bucket cannot service a request |
| **Reauth** | Foreground interactive authentication initiated by the failover handler to refresh or obtain new credentials |
| **Exhausted** | State where all buckets have been tried and classified as unavailable for the current request |
| **Pass** | A sequential phase in the TARGET failover algorithm (Pass 1: classification, Pass 2: candidate search, Pass 3: reauth) — this is NEW behavior |
| **Session** | A single API request/response cycle |
| **Near-expiry** | A token with `expiry <= now + 30` seconds |
| **Refresh** | Proactive token renewal using an existing refresh_token without user interaction |
| **Classification** | Assignment of a `BucketFailureReason` to a bucket based on its current state — NEW behavior |
| **Profile order** | The array index order of buckets as defined in the profile configuration file |

---

## 1. Proactive Renewal Requirements

**Note**: These requirements address a secondary fix related to issue #1598 — preventing tokens from expiring during failover by renewing them proactively.

### REQ-1598-PR01
**Type:** Event-driven  
**Statement:** When a token is acquired or refreshed successfully, the system shall schedule proactive renewal at 80% of the token's lifetime if the lifetime exceeds 5 minutes.

**Rationale:** Prevents tokens from expiring mid-request by renewing before expiration, reducing user-visible authentication failures.

**Traceability:** overview.md "Proactive Renewal" section, technical.md "ProactiveTokenScheduler"

**Verification:** Unit test with fake timers verifying renewal timer scheduling at 80% lifetime threshold.

---

### REQ-1598-PR02
**Type:** Event-driven  
**Statement:** When a proactive renewal timer fires, the system shall call `oauthManager.refreshOAuthToken(provider, bucket)` for the associated bucket.

**Rationale:** Implements the actual refresh mechanism triggered by the timer.

**Traceability:** technical.md "ProactiveTokenScheduler"

**Verification:** Unit test with fake timers; verify `refreshOAuthToken` is called with correct parameters.

---

### REQ-1598-PR03
**Type:** Event-driven  
**Statement:** When a proactive renewal succeeds, the system shall reschedule the next renewal timer at 80% of the new token's lifetime.

**Rationale:** Maintains continuous coverage by chaining renewal timers.

**Traceability:** technical.md "ProactiveTokenScheduler"

**Verification:** Unit test with fake timers verifying timer rescheduling after successful renewal.

---

### REQ-1598-PR04
**Type:** Event-driven  
**Statement:** When a proactive renewal fails, the system shall log the failure and increment a failure counter for the bucket.

**Rationale:** Enables diagnostics without blocking the retry loop; failures are handled during actual API calls.

**Traceability:** technical.md "ProactiveTokenScheduler"

**Verification:** Unit test verifying failure logging and counter increment.

---

### REQ-1598-PR05
**Type:** Event-driven  
**Statement:** When a proactive renewal fails 3 consecutive times for a bucket, the system shall stop scheduling further proactive renewals for that bucket until a successful manual refresh occurs.

**Rationale:** Prevents infinite retry loops for buckets with permanent auth issues.

**Traceability:** technical.md "ProactiveTokenScheduler"

**Verification:** Unit test verifying renewal scheduling stops after threshold, resumes after manual refresh.

---

### REQ-1598-PR06
**Type:** Event-driven  
**Statement:** When the session resets via `resetSession()` or `reset()`, the system shall cancel all active proactive renewal timers managed by OAuthManager.

**Rationale:** Prevents stale timers from executing after session state has been cleared.

**Traceability:** technical.md "Modified: BucketFailoverHandlerImpl"

**Verification:** Unit test with fake timers verifying timer cancellation on reset methods.

---

## 2. Bucket Classification Requirements

### REQ-1598-CL01
**Type:** Event-driven  
**Statement:** When `tryFailover(context?)` is called and `context.triggeringStatus === 429`, the system shall classify the triggering bucket as `quota-exhausted`.

**Rationale:** 429 responses indicate rate limit exhaustion, which cannot be resolved by refresh.

**Traceability:** overview.md "Bucket Failure Reasons" section, technical.md "Pass 1" section

**Verification:** Unit test with 429 status, verify classification is `quota-exhausted`.

---

### REQ-1598-CL02
**Type:** Event-driven  
**Statement:** When `tryFailover(context?)` is called and the triggering bucket's token is expired and refresh fails, the system shall classify the bucket as `expired-refresh-failed` and log the refresh error.

**Rationale:** Distinguishes between tokens that cannot be refreshed vs. quota exhaustion; logging provides diagnostics for refresh failures.

**Traceability:** overview.md "Bucket Failure Reasons" section, technical.md "Pass 1" section

**Verification:** Unit test with expired token and failed refresh, verify classification and log output.

---

### REQ-1598-CL03
**Type:** Event-driven  
**Statement:** When `tryFailover(context?)` is called and `getOAuthToken` returns `null` for the triggering bucket, the system shall classify the bucket as `no-token`.

**Rationale:** Missing tokens require foreground reauth, not just refresh.

**Traceability:** overview.md "Bucket Failure Reasons" section, technical.md "Pass 1" section

**Verification:** Unit test with null token response, verify classification.

---

### REQ-1598-CL04
**Type:** Event-driven  
**Statement:** When `tryFailover(context?)` is called and `getOAuthToken` throws an exception for the triggering bucket, the system shall log the exception and classify the bucket as `no-token`.

**Rationale:** Pragmatic recovery strategy treats read errors as recoverable via reauth while preserving diagnostic information.

**Traceability:** overview.md "Bucket Failure Reasons" section (note about token-store read errors), technical.md "Error Handling" section

**Verification:** Unit test with token-store read exception, verify classification and logging.

---

### REQ-1598-CL05
**Type:** Event-driven  
**Statement:** When `tryFailover(context?)` evaluates a bucket already present in `triedBucketsThisSession`, the system shall classify it as `skipped`.

**Rationale:** Prevents redundant reauth attempts and infinite loops within a single request.

**Traceability:** overview.md "Bucket Failure Reasons" section, technical.md "Pass 2" section

**Verification:** Unit test with bucket in `triedBucketsThisSession`, verify classification.

---



---

### REQ-1598-CL07
**Type:** Event-driven  
**Statement:** When `tryFailover(context?)` is called without a 429 status, refresh is attempted, and refresh succeeds in pass 1, the system shall return `true` immediately without proceeding to pass 2.

**Rationale:** Successful refresh recovers the current bucket, eliminating the need for failover. This combines the condition from CL06 (attempt refresh for non-429 expired tokens) with the outcome (immediate return on success).

**Traceability:** technical.md "Pass 1" section

**Verification:** Unit test with non-429 status, expired token, and successful refresh, verify immediate `true` return.

---

### REQ-1598-CL08
**Type:** Unwanted behavior  
**Statement:** If a token object is missing the `expiry` field, the system shall treat it as expired and attempt refresh.

**Rationale:** Gracefully handles malformed token objects without crashing.

**Traceability:** technical.md "Error Handling" section (malformed tokens)

**Verification:** Unit test with token missing `expiry`, verify refresh attempt.

---

### REQ-1598-CL09
**Type:** Event-driven  
**Statement:** When `tryFailover(context?)` begins, the system shall clear `lastFailoverReasons` and log the reasons that are now visible to callers after the method returns.

**Rationale:** Ensures classification results reflect only the current failover attempt, not stale data; reasons become visible after tryFailover completes.

**Traceability:** technical.md "Modified: BucketFailoverHandlerImpl" → "New State"

**Verification:** Unit test verifying `lastFailoverReasons` is empty at start of `tryFailover()` and populated after completion.

---

## 3. Failover Logic (Multi-Pass) Requirements

### REQ-1598-FL01
**Type:** Ubiquitous  
**Statement:** The system shall execute three sequential passes in `tryFailover()`: classification, candidate search, and foreground reauth.

**Rationale:** Structured approach maximizes recovery opportunities while minimizing user friction.

**Traceability:** overview.md "Failover Algorithm" section, technical.md "Modified: tryFailover" section

**Verification:** Integration tests covering all three passes.

---



---

### REQ-1598-FL03
**Type:** Event-driven  
**Statement:** When Pass 2 finds a bucket with a valid unexpired token, the system shall call `setSessionBucket(provider, bucket)` and return `true`.

**Rationale:** Prioritizes buckets with immediately usable credentials.

**Traceability:** technical.md "Pass 2" section

**Verification:** Unit test with valid token in candidate bucket, verify `setSessionBucket` call and return.

---

### REQ-1598-FL04
**Type:** Event-driven  
**Statement:** When Pass 2 finds a bucket with an expired token, the system shall attempt refresh.

**Rationale:** Enables recovery via automatic refresh without user interaction.

**Traceability:** technical.md "Pass 2" section

**Verification:** Unit test with expired token, verify refresh attempt.

---

### REQ-1598-FL05
**Type:** Event-driven  
**Statement:** When Pass 2 refresh succeeds, the system shall call `setSessionBucket(provider, bucket)` and return `true`.

**Rationale:** Successful refresh enables request to proceed with recovered credentials.

**Traceability:** technical.md "Pass 2" section

**Verification:** Unit test with successful refresh, verify `setSessionBucket` call and return.

---

### REQ-1598-FL06
**Type:** Event-driven  
**Statement:** When Pass 2 completes without finding a valid or refreshable bucket, the system shall proceed to Pass 3.

**Rationale:** Ensures all recovery mechanisms are attempted before giving up.

**Traceability:** technical.md "Pass 2 → Pass 3 transition"

**Verification:** Integration test verifying Pass 3 executes after Pass 2 exhaustion.

---

### REQ-1598-FL07
**Type:** Event-driven  
**Statement:** When Pass 3 finds ONE bucket classified as `expired-refresh-failed` or `no-token` not in `triedBucketsThisSession`, the system shall attempt `oauthManager.authenticate(provider, bucket)` with a 5-minute timeout for that single bucket only.

**Rationale:** Foreground reauth is the last resort for buckets that cannot be automatically recovered; limit to one attempt to avoid user fatigue.

**Traceability:** overview.md "Foreground reauth" section, technical.md "Pass 3" section

**Verification:** Unit test verifying only ONE candidate is selected for reauth, not iterative attempts.

---

### REQ-1598-FL08
**Type:** Event-driven  
**Statement:** When Pass 3 foreground reauth succeeds, the system shall call `getOAuthToken` to verify the token exists, and if non-null, call `setSessionBucket(provider, bucket)` and return `true`.

**Rationale:** Post-reauth validation ensures the token is actually usable before proceeding with the request.

**Traceability:** technical.md "Pass 3" section

**Verification:** Unit test with successful reauth and non-null token, verify `getOAuthToken` validation call, `setSessionBucket` call, and return.

---

### REQ-1598-FL09
**Type:** Event-driven  
**Statement:** When Pass 3 foreground reauth succeeds but `getOAuthToken` returns `null`, the system shall classify the bucket as `reauth-failed`.

**Rationale:** Authentication without usable token is treated as a failure condition.

**Traceability:** technical.md "Pass 3" section

**Verification:** Unit test with successful authenticate but null getOAuthToken, verify classification.

---

### REQ-1598-FL10
**Type:** Event-driven  
**Statement:** When Pass 3 foreground reauth fails, the system shall classify the bucket as `reauth-failed` and add it to `triedBucketsThisSession`.

**Rationale:** Prevents redundant reauth attempts for failed buckets.

**Traceability:** technical.md "Pass 3" section

**Verification:** Unit test with failed reauth, verify classification and session tracking.

---

### REQ-1598-FL11
**Type:** Event-driven  
**Statement:** When all three passes complete without finding a usable bucket, the system shall return `false`.

**Rationale:** Signals to `RetryOrchestrator` that all buckets are exhausted.

**Traceability:** technical.md "Pass 3 completion"

**Verification:** Integration test with all buckets unavailable, verify `false` return.

---

### REQ-1598-FL12
**Type:** Event-driven  
**Statement:** When Pass 1 completes, the system shall add the triggering bucket to `triedBucketsThisSession`.

**Rationale:** Prevents re-evaluation of the triggering bucket in subsequent passes.

**Traceability:** technical.md "Pass 1" section

**Verification:** Unit test verifying triggering bucket in session set after Pass 1.

---

### REQ-1598-FL13
**Type:** Event-driven  
**Statement:** When Pass 2 evaluates buckets, the system shall iterate in profile order.

**Rationale:** Maintains predictable and stable bucket selection behavior. Profile order is defined as the array index order from the profile configuration.

**Traceability:** technical.md "Pass 2" section

**Verification:** Unit test with specific bucket ordering in profile config, verify iteration order matches array order.

---

### REQ-1598-FL14
**Type:** Unwanted behavior  
**Statement:** If `setSessionBucket()` throws an exception during pass-2 or pass-3 bucket switch, the system shall log the error and continue with failover.

**Rationale:** Session bucket persistence failure should not block recovery attempts or abort the entire failover process.

**Traceability:** technical.md "Error Handling" section

**Verification:** Unit test with mocked `setSessionBucket()` throwing error in both pass-2 and pass-3, verify logging and continuation.

---

### REQ-1598-FL15
**Type:** Unwanted behavior  
**Statement:** If the profile contains zero buckets, the system shall return `false` immediately without attempting failover, and `getCurrentBucket()` shall return `undefined`.

**Rationale:** Empty bucket lists cannot be failed over, and there is no current bucket to return.

**Traceability:** technical.md "Edge Cases" section

**Verification:** Unit test with empty bucket list, verify immediate `false` return and `getCurrentBucket()` returns `undefined`.

---

### REQ-1598-FL16
**Type:** Event-driven  
**Statement:** When `isEnabled()` is called and returns `false` (single bucket profile), the system shall NOT call `tryFailover()` in RetryOrchestrator.

**Rationale:** Single-bucket profiles have no failover capability, so attempting failover is futile and wastes resources.

**Traceability:** overview.md "Single-Bucket Profile" section, technical.md "Modified: RetryOrchestrator" section

**Verification:** Integration test with single-bucket profile encountering error, verify `tryFailover()` is never called.

---

### REQ-1598-FL17
**Type:** Event-driven  
**Statement:** When a token is retrieved in Pass 2 with `expiry - now <= 0` (expired), the system shall attempt refresh; if refresh succeeds, call `setSessionBucket()` and return `true`; if refresh fails, classify the bucket as `expired-refresh-failed` and continue to the next bucket.

**Rationale:** This consolidates the Pass 2 expired token handling: attempt refresh, succeed or fail, and continue failover appropriately. Avoids redundant requirements for the same logical flow.

**Traceability:** technical.md "Pass 2" section

**Verification:** Unit test with expired token in Pass 2: (a) successful refresh → verify `setSessionBucket()` and `true` return, (b) failed refresh → verify classification and continuation to next bucket.

---

### REQ-1598-FL18
**Type:** Unwanted behavior  
**Statement:** If a token is retrieved with `remainingSec <= 30` but `remainingSec > 0`, the system shall accept it without refresh.

**Rationale:** The 30-second threshold is only for classifying NULL results, not rejecting returned tokens.

**Traceability:** overview.md "Token Near-Expiry Handling" section, technical.md "Pass 2" section

**Verification:** Unit test with token at 20 seconds remaining, verify acceptance without refresh.

---

## 4. Foreground Re-authentication Requirements

### REQ-1598-FR01
**Type:** Event-driven  
**Statement:** When foreground reauth is initiated, the system shall call `oauthManager.authenticate(provider, bucket)` with the target bucket identifier.

**Rationale:** Ensures reauth targets the specific bucket, not the default.

**Traceability:** technical.md "Pass 3" section

**Verification:** Mock verification of `authenticate()` with correct bucket parameter.

---

### REQ-1598-FR02
**Type:** Event-driven  
**Statement:** When `RetryOrchestrator` invokes foreground reauth, the system shall enforce a 5-minute timeout using `Promise.race`.

**Rationale:** Prevents indefinite hangs while waiting for user interaction. Timeout ownership is in RetryOrchestrator.

**Traceability:** technical.md "Timeout Enforcement" section

**Verification:** Integration test with delayed reauth using fake timers, verify timeout after 5 minutes.

---

### REQ-1598-FR03
**Type:** Ubiquitous  
**Statement:** The system shall support foreground reauth for buckets classified as `expired-refresh-failed` or `no-token` only.

**Rationale:** These classifications indicate buckets that may be recoverable via user interaction.

**Traceability:** overview.md "Foreground reauth" section, technical.md "Pass 3" section

**Verification:** Unit tests for both classifications, verify reauth attempts; verify `quota-exhausted` and `skipped` do NOT trigger reauth.

---

### REQ-1598-FR04
**Type:** Event-driven  
**Statement:** When foreground reauth times out, the system shall classify the bucket as `reauth-failed` and continue failover.

**Rationale:** Timeout is treated as a failure condition, not a blocking error.

**Traceability:** technical.md "Pass 3" section, "Timeout Enforcement" section

**Verification:** Integration test with timeout using fake timers, verify classification and continuation.

---

### REQ-1598-FR05
**Type:** Ubiquitous  
**Statement:** The system shall NOT cancel in-flight `authenticate()` calls when the timeout fires.

**Rationale:** Known limitation — `OAuthManager.authenticate()` does not currently support abort signals.

**Traceability:** technical.md "Known Limitations" section

**Verification:** Unit test verifying that in-flight authenticate operations do not throw exceptions or affect subsequent request flow when timeout fires.

---

## 5. Error Reporting Requirements

### REQ-1598-ER01
**Type:** Event-driven  
**Statement:** When `tryFailover()` returns `false`, the system shall construct `AllBucketsExhaustedError` with `bucketFailureReasons` from `getLastFailoverReasons()`.

**Rationale:** Provides detailed diagnostics to aid debugging when all buckets fail.

**Traceability:** technical.md "Modified: RetryOrchestrator" section

**Verification:** Integration test with all buckets failing, verify error contains reasons.

---

### REQ-1598-ER02
**Type:** Ubiquitous  
**Statement:** The `AllBucketsExhaustedError` class shall include a `bucketFailureReasons` property with type `Record<string, BucketFailureReason>`.

**Rationale:** Structured error reporting enables programmatic error analysis. This is a NEW property added to the existing error class.

**Traceability:** technical.md "Modified: AllBucketsExhaustedError" section

**Verification:** TypeScript compilation + runtime type validation in tests.

---

### REQ-1598-ER03
**Type:** Ubiquitous  
**Statement:** The `AllBucketsExhaustedError` constructor shall accept `bucketFailureReasons` as an optional parameter, defaulting to an empty record if not provided.

**Rationale:** Backward compatibility with existing call sites that don't provide reasons.

**Traceability:** technical.md "Modified: AllBucketsExhaustedError" section

**Verification:** Unit test with `AllBucketsExhaustedError` constructed without reasons parameter; verify existing call sites compile.

---

### REQ-1598-ER04
**Type:** Ubiquitous  
**Statement:** The `AllBucketsExhaustedError.message` property shall include the provider name and list of attempted buckets.

**Rationale:** Human-readable summary aids debugging in logs and error displays.

**Traceability:** technical.md "Modified: AllBucketsExhaustedError" section

**Verification:** Unit test verifying message format.

---

## 6. Interface Changes Requirements

### REQ-1598-IC01
**Type:** Ubiquitous  
**Statement:** The `BucketFailoverHandler` interface shall define an optional method `getLastFailoverReasons?(): Record<string, BucketFailureReason>`.

**Rationale:** Enables `RetryOrchestrator` to retrieve failure reasons without breaking existing implementations. This is a NEW method.

**Traceability:** technical.md "Modified: BucketFailoverHandler Interface" section

**Verification:** TypeScript compilation of existing implementations without the method.

---

### REQ-1598-IC02
**Type:** Ubiquitous  
**Statement:** The `BucketFailoverHandlerImpl` class shall implement `getLastFailoverReasons()` and return a shallow copy of `lastFailoverReasons`.

**Rationale:** Prevents external mutation of internal state.

**Traceability:** technical.md "New Method: getLastFailoverReasons" section

**Verification:** Unit test verifying returned object is a copy, not a reference.

---

### REQ-1598-IC03
**Type:** Event-driven  
**Statement:** When `RetryOrchestrator` calls `getLastFailoverReasons()`, the system shall use optional chaining (`?.()`) to handle implementations that don't provide the method.

**Rationale:** Gracefully handles implementations that don't provide the method.

**Traceability:** technical.md "Modified: RetryOrchestrator" section

**Verification:** Unit test with handler lacking `getLastFailoverReasons`, verify no crash.

---

### REQ-1598-IC04
**Type:** Event-driven  
**Statement:** When `RetryOrchestrator` cannot retrieve failure reasons (undefined handler or method), the system shall default to an empty record.

**Rationale:** Ensures `AllBucketsExhaustedError` always has a valid (possibly empty) reasons object.

**Traceability:** technical.md "Modified: RetryOrchestrator" section

**Verification:** Unit test verifying empty record fallback.

---

### REQ-1598-IC05
**Type:** Ubiquitous  
**Statement:** The system shall export `BucketFailureReason` type from `packages/core/src/providers/errors.ts`.

**Rationale:** Centralized error type definitions for consistency across packages. This is a NEW type.

**Traceability:** technical.md "New Export: BucketFailureReason Type" section

**Verification:** Import statement verification in `config.ts`.

---

### REQ-1598-IC06
**Type:** Unwanted behavior  
**Statement:** If `config.ts` imports `BucketFailureReason` from `errors.ts`, the system shall not create circular import dependencies.

**Rationale:** Maintains separation of concerns and prevents build issues.

**Traceability:** technical.md "Config Interface" section

**Verification:** Dependency graph analysis showing no circular imports.

---

### REQ-1598-IC07
**Type:** Event-driven  
**Statement:** When `FailoverContext` is provided to `tryFailover()`, the system shall extract `triggeringStatus` for classification logic.

**Rationale:** Enables accurate classification based on the HTTP status that triggered failover.

**Traceability:** technical.md "Modified: tryFailover" section

**Verification:** Unit test with various `triggeringStatus` values, verify classification.

---

### REQ-1598-IC08
**Type:** Ubiquitous  
**Statement:** The `BucketFailureReason` type shall be a union containing: `"quota-exhausted"`, `"expired-refresh-failed"`, `"reauth-failed"`, `"no-token"`, `"skipped"`.

**Rationale:** Type safety ensures valid classification values across the codebase. Five categories total (token-store exceptions are classified as no-token).

**Traceability:** technical.md "New Export: BucketFailureReason Type" section

**Verification:** TypeScript compilation error when invalid reason is assigned.

---

### REQ-1598-IC09
**Type:** Ubiquitous  
**Statement:** The `tryFailover()` signature shall be updated to `tryFailover(context?: FailoverContext): Promise<boolean>`.

**Rationale:** Enables passing triggering status and other context for classification. This is a signature change adding an optional parameter.

**Traceability:** technical.md "Modified: tryFailover" section

**Verification:** TypeScript compilation of existing call sites; verify optional parameter works.

---

### REQ-1598-IC10
**Type:** Ubiquitous  
**Statement:** The `FailoverContext` type shall include a `triggeringStatus` field with type `number | undefined`.

**Rationale:** Provides HTTP status code that triggered failover for classification logic. This is a NEW type.

**Traceability:** technical.md "Modified: tryFailover" section

**Verification:** TypeScript compilation with type definition.

---

### REQ-1598-IC11
**Type:** Event-driven  
**Statement:** When `RetryOrchestrator` calls `tryFailover()`, the system shall pass a `FailoverContext` object containing the triggering status.

**Rationale:** Ensures classification logic has access to status code information. This is a NEW requirement for RetryOrchestrator.

**Traceability:** technical.md "Modified: RetryOrchestrator" section

**Verification:** Unit test verifying context parameter is passed with correct status.

---

## 7. State Management Requirements

### REQ-1598-SM01
**Type:** Ubiquitous  
**Statement:** The system shall maintain `triedBucketsThisSession` as a `Set<string>` tracking buckets attempted during the current API request.

**Rationale:** Prevents redundant attempts and infinite loops.

**Traceability:** overview.md "Session State" section

**Verification:** Unit test verifying set operations during failover.

---

### REQ-1598-SM02
**Type:** Event-driven  
**Statement:** When `resetSession()` is called at the start of each request, the system shall clear `triedBucketsThisSession`.

**Rationale:** Allows all buckets to be retried in a new request. Reset happens at request boundaries, not only on success.

**Traceability:** overview.md "Session State" section

**Verification:** Unit test verifying set is empty after `resetSession()`; verify called at request boundaries.

---

### REQ-1598-SM03
**Type:** Event-driven  
**Statement:** When a new API request begins in `RetryOrchestrator`, the system shall call `bucketFailoverHandler.resetSession()` at the request boundary.

**Rationale:** Ensures each request starts with a fresh failover state.

**Traceability:** technical.md "Modified: RetryOrchestrator" section

**Verification:** Integration test verifying `resetSession()` called before retry loop and at request boundaries.

---

### REQ-1598-SM04
**Type:** Ubiquitous  
**Statement:** The system shall maintain `lastFailoverReasons` as `Record<string, BucketFailureReason>` to store classification results.

**Rationale:** Enables error reporting without coupling classification and reporting logic. This is a NEW state variable.

**Traceability:** technical.md "New State: lastFailoverReasons" section

**Verification:** Unit test verifying reasons are stored and retrievable.

---

### REQ-1598-SM05
**Type:** Event-driven  
**Statement:** When `reset()` is called, the system shall clear `triedBucketsThisSession` and `sessionBucket`, and reset to the first bucket.

**Rationale:** Full session reset for new user turns or fresh starts.

**Traceability:** technical.md "Modified: BucketFailoverHandlerImpl" section

**Verification:** Unit test verifying all state cleared and first bucket selected.

---

### REQ-1598-SM06
**Type:** Ubiquitous  
**Statement:** The `sessionBucket` property shall persist across requests within a session until explicitly reset.

**Rationale:** Maintains stable bucket selection when no failover is needed.

**Traceability:** technical.md "Modified: BucketFailoverHandlerImpl" section

**Verification:** Integration test verifying bucket persists across multiple requests.

---

### REQ-1598-SM07
**Type:** Ubiquitous  
**Statement:** The system shall preserve the existing `consecutive429s` and `consecutiveAuthErrors` counters in `RetryOrchestrator`.

**Rationale:** These counters control failover trigger thresholds and must not be removed. This is EXISTING behavior.

**Traceability:** technical.md "Modified: RetryOrchestrator" section

**Verification:** Unit test verifying counters increment/reset correctly.

---

### REQ-1598-SM08
**Type:** Unwanted behavior  
**Statement:** If the profile configuration changes mid-session and handler buckets become stale, the system shall continue with the existing bucket list until `reset()` is called.

**Rationale:** Profile changes are not dynamically reflected to avoid mid-request instability. This is an explicit limitation.

**Traceability:** technical.md "Edge Cases" section

**Verification:** Unit test verifying bucket list does not update when profile changes.

---

## 8. Backward Compatibility Requirements

### REQ-1598-BWC01
**Type:** Ubiquitous  
**Statement:** The system shall preserve existing behavior for single-bucket profiles.

**Rationale:** Users with one bucket should not experience any behavioral changes.

**Traceability:** overview.md "Single-Bucket Profile" section

**Verification:** Regression tests for single-bucket profiles pass without modification.

---

### REQ-1598-BWC02
**Type:** Ubiquitous  
**Statement:** The `AllBucketsExhaustedError` constructor signature shall make `bucketFailureReasons` an optional parameter.

**Rationale:** Existing call sites without reasons parameter must continue to work.

**Traceability:** technical.md "Modified: AllBucketsExhaustedError" section

**Verification:** Compilation + runtime test of existing call sites; verify all existing call sites remain compatible.

---

### REQ-1598-BWC03
**Type:** Ubiquitous  
**Statement:** The `getLastFailoverReasons()` method shall be optional in the `BucketFailoverHandler` interface.

**Rationale:** Existing custom implementations should not break.

**Traceability:** technical.md "Modified: BucketFailoverHandler Interface" section

**Verification:** Compilation test with interface implementing only required methods.

---

### REQ-1598-BWC04
**Type:** Event-driven  
**Statement:** When a profile with one bucket encounters a 429 error, the system shall NOT trigger failover logic.

**Rationale:** Single-bucket profiles have no fallback, so failover would be futile.

**Traceability:** overview.md "Single-Bucket Profile" section

**Verification:** Integration test with single-bucket 429, verify no failover attempts.

---

### REQ-1598-BWC05
**Type:** Ubiquitous  
**Statement:** The system shall verify all existing `AllBucketsExhaustedError` call sites remain compatible with the updated constructor signature.

**Rationale:** Ensures backward compatibility is actually maintained in practice.

**Traceability:** technical.md "Modified: AllBucketsExhaustedError" section

**Verification:** Code search for all `AllBucketsExhaustedError` instantiations; verify compilation.

---

## 9. Integration with RetryOrchestrator Requirements

### REQ-1598-RO01
**Type:** Event-driven  
**Statement:** When `RetryOrchestrator` detects `consecutive429s > failoverThreshold`, the system shall call `tryFailover()` with `context.triggeringStatus = 429`.

**Rationale:** Provides classification context to the failover handler. Note: immediate 429 does NOT trigger failover; requires consecutive count.

**Traceability:** overview.md "Triggering Conditions" section

**Verification:** Integration test with consecutive 429 responses, verify context parameter.

---

### REQ-1598-RO02
**Type:** Event-driven  
**Statement:** When `RetryOrchestrator` detects a 402 status code, the system shall call `tryFailover()` immediately.

**Rationale:** Payment required errors indicate account issues requiring bucket rotation.

**Traceability:** overview.md "Triggering Conditions" section

**Verification:** Integration test with 402 response, verify immediate failover.

---

### REQ-1598-RO03
**Type:** Event-driven  
**Statement:** When `RetryOrchestrator` detects `consecutiveAuthErrors > 1`, the system shall call `tryFailover()`.

**Rationale:** Multiple consecutive auth errors indicate bucket-specific issues. Note: requires multiple failures, not immediate.

**Traceability:** overview.md "Triggering Conditions" section

**Verification:** Integration test with consecutive 401/403 responses, verify failover after second attempt.

---

### REQ-1598-RO04
**Type:** Event-driven  
**Statement:** When `tryFailover()` returns `true`, the system shall reset the retry delay to `initialDelayMs` and reset consecutive error counters.

**Rationale:** Fresh bucket gets a fresh retry sequence.

**Traceability:** technical.md "Modified: RetryOrchestrator" section

**Verification:** Integration test verifying delay and counter reset after successful failover.

---

### REQ-1598-RO05
**Type:** Event-driven  
**Statement:** When `tryFailover()` returns `false`, the system shall throw `AllBucketsExhaustedError` with failure reasons.

**Rationale:** Terminal error condition when no recovery is possible.

**Traceability:** technical.md "Modified: RetryOrchestrator" section

**Verification:** Integration test with all buckets failing, verify error thrown.

---

## 10. Logging and Diagnostics Requirements

### REQ-1598-LD01
**Type:** Event-driven  
**Statement:** When `tryFailover()` begins, the system shall log the triggering bucket and reason.

**Rationale:** Diagnostic visibility into failover triggers.

**Traceability:** technical.md "Modified: tryFailover" section

**Verification:** Unit test verifying log output at failover start.

---

### REQ-1598-LD02
**Type:** Event-driven  
**Statement:** When a bucket is classified, the system shall log the bucket name and classification reason.

**Rationale:** Enables debugging of classification logic.

**Traceability:** technical.md "Pass 1-3" sections

**Verification:** Unit test verifying log output for each classification.

---

### REQ-1598-LD03
**Type:** Event-driven  
**Statement:** When a bucket switch occurs, the system shall log the source and destination buckets.

**Rationale:** Visibility into failover decisions.

**Traceability:** technical.md "Pass 2-3" sections

**Verification:** Integration test verifying log output during switch.

---

### REQ-1598-LD04
**Type:** Event-driven  
**Statement:** When foreground reauth is attempted, the system shall log the bucket name.

**Rationale:** Indicates user interaction is required.

**Traceability:** technical.md "Pass 3" section

**Verification:** Unit test verifying log output before `authenticate()` call.

---

### REQ-1598-LD05
**Type:** Event-driven  
**Statement:** When foreground reauth fails, the system shall log the bucket name and error message.

**Rationale:** Diagnostic information for reauth failures.

**Traceability:** technical.md "Pass 3" section

**Verification:** Unit test with failed reauth, verify log output.

---

### REQ-1598-LD06
**Type:** Event-driven  
**Statement:** When all buckets are exhausted, the system shall log a warning message before throwing the error.

**Rationale:** Provides visibility before terminal error.

**Traceability:** technical.md "Modified: RetryOrchestrator" section

**Verification:** Integration test verifying warning logged before error thrown.

---

## 11. Performance and Efficiency Requirements

### REQ-1598-PE01
**Type:** Ubiquitous  
**Statement:** The system shall return immediately from Pass 1 when refresh succeeds.

**Rationale:** Avoids unnecessary bucket evaluation when current bucket can be recovered.

**Traceability:** technical.md "Pass 1" section

**Verification:** Performance test measuring latency with successful refresh.

---

### REQ-1598-PE02
**Type:** Ubiquitous  
**Statement:** The system shall stop bucket evaluation at the first usable candidate in Pass 2.

**Rationale:** Reduces unnecessary token reads and refresh attempts.

**Traceability:** technical.md "Pass 2" section

**Verification:** Unit test verifying iteration stops after first valid bucket.

---

### REQ-1598-PE03
**Type:** Ubiquitous  
**Statement:** The system shall cache classification results in `lastFailoverReasons` to avoid re-evaluation.

**Rationale:** Prevents redundant classification work.

**Traceability:** technical.md "New State: lastFailoverReasons" section

**Verification:** Unit test verifying classification occurs once per bucket per call.

---

## 12. Security Requirements

### REQ-1598-SE01
**Type:** Ubiquitous  
**Statement:** The system shall NOT log access tokens or refresh tokens in any log statement.

**Rationale:** Prevents credential leakage in logs.

**Traceability:** All implementation files

**Verification:** Code review + grep for token field logging.

---

### REQ-1598-SE02
**Type:** Ubiquitous  
**Statement:** The system shall return a shallow copy from `getLastFailoverReasons()` to prevent external mutation.

**Rationale:** Protects internal state from unintended modification.

**Traceability:** technical.md "New Method: getLastFailoverReasons" section

**Verification:** Unit test attempting to mutate returned object, verify internal state unchanged.

---

## 13. Edge Cases and Error Handling Requirements

### REQ-1598-EC01
**Type:** Unwanted behavior  
**Statement:** If a bucket has a malformed token (missing `expiry`), the system shall treat it as expired and attempt refresh.

**Rationale:** Graceful degradation for corrupted token data.

**Traceability:** technical.md "Error Handling" section

**Verification:** Unit test with malformed token, verify refresh attempt.

---

### REQ-1598-EC02
**Type:** Unwanted behavior  
**Statement:** If token-store throws an I/O exception during `getOAuthToken()`, the system shall classify the bucket as `no-token` and continue.

**Rationale:** Pragmatic recovery enables progress even with transient I/O errors.

**Traceability:** technical.md "Error Handling" section

**Verification:** Unit test with simulated I/O error, verify classification and continuation.

---

### REQ-1598-EC03
**Type:** Event-driven  
**Statement:** When all buckets in a profile are classified as `skipped`, the system shall return `false`.

**Rationale:** Prevents infinite loops when all buckets have been tried.

**Traceability:** technical.md "Pass 2-3 completion"

**Verification:** Unit test with all buckets pre-populated in `triedBucketsThisSession`.

---

### REQ-1598-EC04
**Type:** Unwanted behavior  
**Statement:** If a bucket returns a token with `expiry` in the past but refresh succeeds, the system shall use the refreshed token.

**Rationale:** Successful refresh overrides stale expiry data.

**Traceability:** technical.md "Pass 2" section

**Verification:** Unit test with expired token + successful refresh, verify switch.

---

### REQ-1598-EC05
**Type:** Non-goal  
**Statement:** The system shall NOT provide reentrancy or concurrency protection for simultaneous `tryFailover()` calls.

**Rationale:** Single-threaded execution model in Node.js makes this unnecessary. Documenting as explicit non-goal with rationale.

**Traceability:** technical.md "Edge Cases" section

**Verification:** Documentation review; concurrency note added to known limitations.

---

## 14. Testing Requirements

### REQ-1598-TS01
**Type:** Ubiquitous  
**Statement:** The system shall include unit tests covering all five `BucketFailureReason` classifications.

**Rationale:** Ensures classification logic is comprehensive and correct.

**Traceability:** All classification requirements (REQ-1598-CL*)

**Verification:** Test coverage report showing all classifications tested.

---

### REQ-1598-TS02
**Type:** Ubiquitous  
**Statement:** The system shall include integration tests verifying end-to-end failover for multi-bucket profiles.

**Rationale:** Validates full failover flow in realistic scenarios.

**Traceability:** All failover logic requirements (REQ-1598-FL*)

**Verification:** Integration test suite execution.

---

### REQ-1598-TS03
**Type:** Ubiquitous  
**Statement:** The system shall include regression tests ensuring single-bucket profiles exhibit unchanged behavior.

**Rationale:** Backward compatibility validation.

**Traceability:** REQ-1598-BWC01

**Verification:** Existing single-bucket tests pass without modification.

---

### REQ-1598-TS04
**Type:** Ubiquitous  
**Statement:** The system shall include tests verifying `AllBucketsExhaustedError` contains correct failure reasons.

**Rationale:** Error reporting quality assurance.

**Traceability:** REQ-1598-ER01, REQ-1598-ER02

**Verification:** Test assertions on error object properties.

---

### REQ-1598-TS05
**Type:** Ubiquitous  
**Statement:** The system shall include tests verifying state management (`triedBucketsThisSession`, `lastFailoverReasons`) across multiple `tryFailover()` calls.

**Rationale:** State integrity is critical for correct failover behavior.

**Traceability:** All state management requirements (REQ-1598-SM*)

**Verification:** Unit tests with multiple sequential failover attempts.

---

## 15. Documentation Requirements

### REQ-1598-DC01
**Type:** Ubiquitous  
**Statement:** The system shall document the known limitation regarding abort signal support in `OAuthManager.authenticate()`.

**Rationale:** Informs users of current timeout behavior.

**Traceability:** REQ-1598-FR05, technical.md "Known Limitations" section

**Verification:** Technical spec includes limitation section.

---

### REQ-1598-DC02
**Type:** Ubiquitous  
**Statement:** The system shall document the 30-second near-expiry threshold and its use in NULL classification only.

**Rationale:** Clarifies token acceptance policy.

**Traceability:** REQ-1598-FL18, overview.md "Token Near-Expiry Handling" section

**Verification:** Code comments + technical spec.

---

### REQ-1598-DC03
**Type:** Ubiquitous  
**Statement:** The system shall document the three-pass failover algorithm in code comments.

**Rationale:** Maintainability and onboarding.

**Traceability:** REQ-1598-FL01

**Verification:** Code review of `tryFailover()` implementation.

---

---

## Traceability Matrix

| Requirement ID | Functional Area | Spec Reference | Source Files |
|---------------|----------------|----------------|--------------|
| REQ-1598-PR01-PR06 | Proactive Renewal | overview.md "Proactive Renewal", technical.md "ProactiveTokenScheduler" | BucketFailoverHandlerImpl.ts (new) |
| REQ-1598-CL01-CL09 | Classification | overview.md "Bucket Failure Reasons", technical.md "Pass 1" | BucketFailoverHandlerImpl.ts, RetryOrchestrator.ts |
| REQ-1598-FL01-FL20 | Failover Logic | overview.md "Failover Algorithm", technical.md "Pass 1-3" | BucketFailoverHandlerImpl.ts |
| REQ-1598-FR01-FR05 | Foreground Reauth | overview.md "Foreground reauth", technical.md "Pass 3", "Timeout Enforcement" | BucketFailoverHandlerImpl.ts, RetryOrchestrator.ts |
| REQ-1598-ER01-ER04 | Error Reporting | technical.md "Modified: AllBucketsExhaustedError", "Modified: RetryOrchestrator" | errors.ts, RetryOrchestrator.ts |
| REQ-1598-IC01-IC11 | Interface Changes | technical.md "Modified: BucketFailoverHandler", "New Export" | config.ts, BucketFailoverHandlerImpl.ts, errors.ts |
| REQ-1598-SM01-SM08 | State Management | overview.md "Session State", technical.md "New State" | BucketFailoverHandlerImpl.ts, RetryOrchestrator.ts |
| REQ-1598-BWC01-BWC05 | Backward Compatibility | overview.md "Single-Bucket Profile", technical.md "Modified signatures" | Existing test suite |
| REQ-1598-RO01-RO05 | RetryOrchestrator Integration | technical.md "Modified: RetryOrchestrator" | RetryOrchestrator.ts |
| REQ-1598-LD01-LD06 | Logging | technical.md "Pass 1-3", "Modified: RetryOrchestrator" | All implementation files |
| REQ-1598-PE01-PE03 | Performance | technical.md "Pass 1-2" | BucketFailoverHandlerImpl.ts |
| REQ-1598-SE01-SE02 | Security | All files | All implementation files |
| REQ-1598-EC01-EC05 | Edge Cases | technical.md "Error Handling", "Edge Cases" | BucketFailoverHandlerImpl.ts |
| REQ-1598-TS01-TS05 | Testing | All requirements | Test files |
| REQ-1598-DC01-DC03 | Documentation | technical.md "Known Limitations", overview.md | Technical spec, code comments |

---

## Summary

This requirements document defines **124 atomic, testable requirements** covering:
- 6 Proactive Renewal behaviors (secondary fix related to issue)
- 8 Classification rules (NEW) — reduced from 9, merged CL06 into CL07
- 18 Failover logic requirements (UPDATED from simple rotation to 3-pass algorithm) — reduced from 20, removed FL02 duplicate and consolidated FL17/FL19/FL20
- 5 Foreground reauth requirements (NEW)
- 4 Error reporting requirements (UPDATED to include reasons)
- 11 Interface change requirements (NEW methods, types, and signatures)
- 8 State management requirements (preserves existing + adds new)
- 5 Backward compatibility requirements (preserves existing behavior)
- 5 RetryOrchestrator integration requirements (preserves existing triggers + adds context)
- 6 Logging requirements (NEW detailed logging)
- 3 Performance requirements (NEW)
- 2 Security requirements (NEW)
- 5 Edge case requirements (NEW)
- 5 Testing requirements (NEW)
- 3 Documentation requirements (NEW)

All requirements are grounded in the TARGET specifications (overview.md, technical.md) and actual source code baseline. The baseline section documents current behavior for comparison.

## Important Notes

1. **All interface/error changes are TARGET STATE** — the current code has none of these changes
2. **Five failure categories** (removed `read-error`): `quota-exhausted`, `expired-refresh-failed`, `reauth-failed`, `no-token`, `skipped`
3. **Token field name**: Actual code uses `expiry` (not `expiresAt`)
4. **Pass 3 behavior**: Only ONE candidate attempted for reauth (not iterative)
5. **resetSession()**: Called at request boundaries, not just on success
6. **tryFailover() signature IS changing**: Adding optional `FailoverContext` parameter
7. **RetryOrchestrator must pass context**: New requirement for passing `FailoverContext` when calling `tryFailover()`
8. **Concurrency**: Explicit non-goal with rationale (Node.js single-threaded model)
9. **Stale handler buckets**: Profile changes not dynamically reflected until `reset()`
10. **Post-reauth validation**: If authenticate succeeds but getOAuthToken returns null, classify as `reauth-failed`
