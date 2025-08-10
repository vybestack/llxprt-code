# Phase 01: Fix Tests

## Objective

Update all existing tests to match the correct OAuth behavior where `/auth` toggles enablement rather than triggering OAuth, and providers lazily trigger OAuth when needed.

## Context

The current tests likely expect `/auth` to trigger OAuth flows. These need to be updated to test the new toggle behavior and lazy triggering patterns.

## Tasks

### 1. Update Auth Command Tests

**Files to modify:**
- `packages/cli/src/commands/__tests__/auth.spec.ts` (if exists)
- Any other auth command test files

**Changes needed:**
- Remove tests expecting OAuth flow on `/auth` execution
- Add tests for toggle behavior (enabled → disabled → enabled)
- Add tests for enablement state persistence
- Add tests for warning messages when higher priority auth exists
- Add tests for status display after toggle

### 2. Update Provider Tests

**Files to modify:**
- `packages/core/src/providers/__tests__/gemini.spec.ts`
- `packages/core/src/providers/__tests__/openai.spec.ts`
- Any OAuth-related provider tests

**Changes needed:**
- Remove tests expecting immediate OAuth triggering
- Add tests for lazy OAuth triggering during API calls
- Add tests for auth precedence checking
- Add tests for OAuth skipping when higher priority auth available

### 3. Update OpenAI Provider Tests

**Files to modify:**
- OpenAI provider test files

**Changes needed:**
- Add tests for baseURL validation before OAuth usage
- Add tests for Qwen endpoint detection
- Add tests for error handling on endpoint mismatch
- Test that default OpenAI endpoints don't trigger Qwen OAuth

### 4. Add Integration Tests

**New test files to create:**
- Tests for complete auth precedence flow
- Tests for OAuth enablement persistence
- Tests for provider coordination with auth system

## Test Categories to Update

1. **Command Tests**: Toggle behavior, not execution
2. **Provider Tests**: Lazy triggering, not immediate
3. **Integration Tests**: Full precedence chain
4. **Warning Tests**: Proper user feedback

## Verification Criteria

- [ ] All existing tests pass with new behavior
- [ ] No tests expect immediate OAuth triggering on `/auth`
- [ ] Tests cover toggle functionality thoroughly
- [ ] Tests verify lazy OAuth triggering
- [ ] Tests validate auth precedence chain
- [ ] Tests check baseURL validation for OpenAI
- [ ] Integration tests cover end-to-end scenarios

## Expected Behavioral Changes in Tests

**Before (incorrect):**
```typescript
it('should trigger OAuth flow on auth command', async () => {
  await authCommand.execute('qwen');
  expect(oauthManager.startFlow).toHaveBeenCalled();
});
```

**After (correct):**
```typescript
it('should toggle OAuth enablement on auth command', async () => {
  await authCommand.execute('qwen');
  expect(config.getOAuthEnabled('qwen')).toBe(true);
  expect(oauthManager.startFlow).not.toHaveBeenCalled();
});
```