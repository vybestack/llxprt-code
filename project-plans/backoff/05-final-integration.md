# Phase 5 - Final Integration and Testing (backoff)

**⚠️ STOP after completing all tasks in this phase and wait for verification.**

## Goal

Complete the integration of all components and ensure the feature works end-to-end.

## Deliverables

- [ ] Remove old Flash fallback code completely
- [ ] Update documentation
- [ ] Integration tests for new behavior
- [ ] Migration guide for users

## Implementation Checklist

- [ ] Remove deprecated Flash fallback code:
  - Remove `flashFallbackHandler` from `packages/cli/src/ui/App.tsx`
  - Remove `handleFlashFallback` from `packages/core/src/core/client.ts`
  - Remove `onPersistent429` callback usage
  - Clean up related imports and types

- [ ] Update error messages in `packages/cli/src/ui/utils/errorParsing.ts`:
  - Remove Flash fallback suggestions
  - Add `/fallback-model` command suggestions
  - Update rate limit error messages

- [ ] Create integration tests in `packages/cli/src/integration-tests/rate-limit-backoff.test.ts`:
  - Test wait behavior with rate limit headers
  - Test fallback after 3 failures
  - Test billing warnings
  - Test /fallback-model command

- [ ] Update documentation:
  - Add `/fallback-model` to command reference
  - Document new rate limit behavior
  - Add billing information section
  - Remove Flash fallback references

- [ ] Create migration notice in `packages/cli/CHANGELOG.md`:

  ```markdown
  ## Breaking Changes

  - Removed automatic Flash fallback for rate-limited users
  - Rate limits now cause the CLI to wait for the model to become available
  - Use `/fallback-model <model>` to configure optional fallback behavior

  ## New Features

  - `/fallback-model` command for configuring fallback models
  - Intelligent rate limit backoff using API headers
  - Billing warnings for API key usage
  ```

## Self-Verify Commands

```bash
# Full test suite should pass
npm test

# Integration tests should pass
npm run test:integration

# Build should succeed
npm run build

# No references to old fallback
grep -r "flashFallback\|onPersistent429" packages/ --exclude-dir=node_modules
# Should return nothing or only in tests/comments
```

## Notes

- Ensure all old Flash fallback code is removed
- Documentation should clearly explain the new behavior
- Consider adding telemetry for fallback model usage

**STOP. Wait for Phase 5a verification before proceeding.**
