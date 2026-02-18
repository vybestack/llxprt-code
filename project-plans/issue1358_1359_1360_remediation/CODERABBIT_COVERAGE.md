# CodeRabbit Issues vs Remediation Plan Coverage

**PR**: #1441  
**Date**: 2026-02-17

This document tracks CodeRabbit review comments and whether they're addressed in the remediation plan.

---

## MAJOR Issues

### 1. Socket path nonce has only 32 bits of entropy
**CodeRabbit**: `crypto.randomBytes(4)` produces only 32 bits. Should be 16 bytes (128 bits).
**Remediation Coverage**: NOT COVERED
**Action Needed**: Add to Plan 08 (stale socket cleanup) or create new plan

### 2. handleSaveToken bypasses provider/bucket allowlist checks
**CodeRabbit**: `handleGetToken` enforces allowlists, but `handleSaveToken`, `handleRemoveToken`, `handleListBuckets`, `handleGetApiKey`, `handleListApiKeys`, `handleHasApiKey` do not.
**Remediation Coverage**: NOT COVERED
**Action Needed**: Add to Plan 09 (request validation) - add allowlist checks to all handlers

### 3. handleRefreshToken fabricates token when none exists
**CodeRabbit**: Creates synthetic token with guessable values instead of returning NOT_FOUND.
**Remediation Coverage**: COVERED in Plan 05 (handleRefreshToken)
**Status**: OK

### 4. Abort expired sessions before deletion
**CodeRabbit**: Line 97 deletes expired sessions without aborting AbortController.
**Remediation Coverage**: NOT COVERED
**Action Needed**: Add to Plan 03 or Plan 04 (OAuth session handling)

### 5. Unhandled promise rejection if refreshFn throws
**CodeRabbit**: `void this.refreshFn(...)` discards the promise, causing unhandled rejection.
**Remediation Coverage**: NOT COVERED  
**Action Needed**: Add to proactive renewal work (currently not in any plan)

### 6. Handle sessionId/mode variants in ProxyOAuthAdapter
**CodeRabbit**: Line 52 only checks `session_id`, not `sessionId`. Line 55-74 only checks `flow_type`, not `mode`.
**Remediation Coverage**: NOT COVERED
**Action Needed**: Add normalization to ProxyOAuthAdapter (client-side fix)

### 7. JSON.parse is unguarded - throws raw SyntaxError
**CodeRabbit**: Malformed JSON in frame throws SyntaxError instead of FrameError.
**Remediation Coverage**: NOT COVERED
**Action Needed**: Add to framing layer fixes (new plan needed)

### 8. Partial-frame timeout fires but takes no action
**CodeRabbit**: Timer fires at line 80-82 but only nulls itself - no buffer reset or error.
**Remediation Coverage**: PARTIALLY COVERED - Plan 09 mentions validation but not partial frame handling
**Action Needed**: Add buffer reset and error surfacing to framing fixes

### 9. OAuth sessions lack timeout, GC, and single-use enforcement
**CodeRabbit**: Sessions persist indefinitely, no GC, TOCTOU on consumption allows double-exchange.
**Remediation Coverage**: PARTIALLY COVERED
- Timeout: Mentioned in Plan 03
- GC/Sweep: NOT in plan (should add session sweep per R20.7)
- Single-use TOCTOU: NOT explicitly addressed
**Action Needed**: Add TOCTOU fix (delete-then-check pattern) and session sweep

### 10. handleOAuthExchange uses simulated tokens
**CodeRabbit**: Creates `test_access_${sessionId}` instead of real exchange.
**Remediation Coverage**: COVERED in Plan 04 (handleOAuthExchange)
**Status**: OK

### 11. handleRefreshToken simulates refresh
**CodeRabbit**: Returns `refreshed_${Date.now()}` instead of calling provider.
**Remediation Coverage**: COVERED in Plan 05 (handleRefreshToken)
**Status**: OK

---

## MINOR Issues

### 12. Biome: implicit return from forEach callback
**CodeRabbit**: Lines 91, 116, 140, 158 - arrow functions without braces.
**Remediation Coverage**: NOT COVERED (lint fix)
**Action Needed**: Simple lint fix

### 13. Missing license header
**CodeRabbit**: New file missing Vybestack copyright header.
**Remediation Coverage**: NOT COVERED (lint fix)
**Action Needed**: Simple lint fix

### 14. Test title promises 0o600 verification but doesn't check it
**CodeRabbit**: Test says "creates socket with correct permissions (0o600)" but doesn't verify mode.
**Remediation Coverage**: COVERED - test-strategy.md requires behavioral tests
**Action Needed**: Fix test to actually verify permissions

### 15. Temp directory leaked after each test
**CodeRabbit**: `createTempSocketPath` creates temp dir but `afterEach` only removes socket, not dir.
**Remediation Coverage**: NOT COVERED (test infrastructure)
**Action Needed**: Fix test cleanup

### 16. Unclosed JSDoc block
**CodeRabbit**: JSDoc at line 33 never closed with `*/`.
**Remediation Coverage**: NOT COVERED (syntax fix)
**Action Needed**: Simple syntax fix

### 17. gracefulClose() doesn't reject pending requests
**CodeRabbit**: Promises hang until 30s timeout instead of being rejected.
**Remediation Coverage**: NOT COVERED
**Action Needed**: Add cleanup logic to gracefulClose

### 18. onClose during handshake doesn't trigger cleanup
**CodeRabbit**: If server closes during handshake, handshake promise hangs 30s.
**Remediation Coverage**: NOT COVERED
**Action Needed**: Fix onClose to call destroy() when handshakeResolver exists

### 19. getBucketStats discards response.data
**CodeRabbit**: Returns hardcoded placeholder values instead of actual data.
**Remediation Coverage**: NOT COVERED
**Action Needed**: Fix ProxyTokenStore.getBucketStats to use response data

### 20. \s in grep pattern not portable to macOS
**CodeRabbit**: `\s` is GNU grep extension, fails on macOS BSD grep.
**Remediation Coverage**: NOT COVERED (test infrastructure)
**Action Needed**: Use POSIX character class `[[:space:]]`

### 21. Token expiry uses milliseconds instead of seconds
**CodeRabbit**: Lines 510, 519, 573 use `Date.now() + 3600000` (ms) instead of epoch seconds.
**Remediation Coverage**: NOT COVERED (test fix)
**Action Needed**: Fix to use `Math.floor(Date.now() / 1000) + 3600`

### 22. stop() ordering - server close failure leaks socket file
**CodeRabbit**: If `server.close()` rejects, `unlinkSync` never runs.
**Remediation Coverage**: PARTIALLY COVERED in Plan 08 (stale socket cleanup)
**Action Needed**: Ensure cleanup happens in finally block

### 23. Missing validation of id and op before dispatch
**CodeRabbit**: If frame missing `id` or `op`, sendError writes with `id: undefined`.
**Remediation Coverage**: COVERED in Plan 09 (request schema validation)
**Status**: OK

---

## Summary

| Category | Count |
|----------|-------|
| MAJOR Issues | 11 |
| MINOR Issues | 12 |
| COVERED by remediation | 5 |
| PARTIALLY COVERED | 3 |
| NOT COVERED | 15 |

---

## Recommended Additions to Remediation Plan

### Add to Existing Plans

**Plan 03 (handleOAuthInitiate)**:
- Add session TOCTOU fix (delete-then-check pattern)
- Add abort controller cleanup on session expiry

**Plan 05 (handleRefreshToken)**:
- (already covers the stub fix)

**Plan 08 (Stale Socket Cleanup)**:
- Increase nonce from 4 bytes to 16 bytes
- Fix stop() to cleanup socket in finally block

**Plan 09 (Request Schema Validation)**:
- Add provider/bucket allowlist checks to ALL handlers (not just get_token)
- Add id/op validation before dispatch (already there)

### New Work Items Needed

**Plan 10: Framing Layer Fixes**
- Wrap JSON.parse in try-catch, throw FrameError
- Partial-frame timeout should reset buffer and surface error
- gracefulClose() should reject pending requests
- onClose during handshake should trigger destroy

**Plan 11: Client-Side Fixes**
- ProxyOAuthAdapter: normalize sessionId/session_id and flowType/mode/flow_type
- ProxyTokenStore.getBucketStats: use response.data instead of placeholders

**Plan 12: Proactive Renewal Fixes**
- Add .catch() to void refreshFn(...) calls to handle rejections

**Test Infrastructure Fixes** (not a plan, just fixes):
- Fix forEach arrow functions (lint)
- Add missing license headers
- Fix test that claims to verify 0o600 but doesn't
- Fix temp directory cleanup in tests
- Fix unclosed JSDoc
- Fix grep \s to [[:space:]] for macOS
- Fix token expiry ms vs seconds in tests

---

## Priority Order

1. **HIGH**: Plan 09 additions (allowlist checks) - security issue
2. **HIGH**: Plan 08 additions (nonce entropy) - security issue  
3. **HIGH**: Plan 10 (framing fixes) - stability
4. **MEDIUM**: Plan 03 additions (session TOCTOU) - correctness
5. **MEDIUM**: Plan 11 (client fixes) - correctness
6. **MEDIUM**: Plan 12 (proactive renewal) - stability
7. **LOW**: Test infrastructure fixes - quality
