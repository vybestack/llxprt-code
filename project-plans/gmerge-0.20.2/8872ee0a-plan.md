# Reimplement Plan: Shell Environment Sanitization

**Upstream SHA:** `8872ee0ace406f105476764be54c1e029684093c`
**Batch:** 14

## What upstream does

Sanitizes shell execution environment in CI to prevent secret/credential leaks through environment variables.

## LLxprt approach

Same sanitization but preserve LLXPRT_TEST* environment variables and local development behavior.

## Files to modify

1. `packages/core/src/services/shellExecutionService.ts` — env sanitization logic
2. `packages/core/src/services/shellExecutionService.test.ts` — tests for sanitization
3. Tests

## Key design

- Sanitize sensitive env vars (tokens, keys, secrets) before passing to child processes
- Preserve LLXPRT_CODE, LLXPRT_TEST*, TERM, PAGER, PATH and other safe vars
- Allow-list approach (safer than deny-list)

## Verification

- Unit tests for env sanitization
- Verify LLXPRT_TEST variables preserved in test contexts
- Verify secrets not leaked to child shells
