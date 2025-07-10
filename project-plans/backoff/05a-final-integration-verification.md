# Phase 5a - Verification of Final Integration (backoff)

## Verification Steps

1. **Verify old code removal**:

   ```bash
   # Check Flash fallback is removed
   grep -r "flashFallback" packages/ --exclude-dir=node_modules --exclude-dir=dist
   # Should return nothing or only historical references

   grep -r "onPersistent429" packages/ --exclude-dir=node_modules --exclude-dir=dist
   # Should return nothing

   grep -r "handleFlashFallback" packages/ --exclude-dir=node_modules --exclude-dir=dist
   # Should return nothing
   ```

2. **Check updated error messages**:

   ```bash
   grep -n "fallback-model" packages/cli/src/ui/utils/errorParsing.ts
   # Should show new command suggestion

   grep -n "flash" packages/cli/src/ui/utils/errorParsing.ts
   # Should NOT show automatic flash fallback messages
   ```

3. **Verify integration tests exist**:

   ```bash
   ls packages/cli/src/integration-tests/rate-limit-backoff.test.ts
   # File should exist

   grep -n "describe\|test\|it" packages/cli/src/integration-tests/rate-limit-backoff.test.ts
   # Should show test cases
   ```

4. **Check documentation updates**:

   ```bash
   grep -n "fallback-model" packages/cli/README.md
   # Should document the command

   grep -n "billing\|charges" packages/cli/README.md
   # Should have billing section
   ```

5. **Verify CHANGELOG**:

   ```bash
   grep -n "Breaking Changes" packages/cli/CHANGELOG.md
   # Should mention removal of automatic fallback

   grep -n "fallback-model" packages/cli/CHANGELOG.md
   # Should document new command
   ```

6. **Run full test suite**:

   ```bash
   npm test
   # All tests must pass
   ```

7. **Run integration tests**:

   ```bash
   npm run test:integration
   # Must include rate limit tests
   ```

8. **Build verification**:

   ```bash
   npm run build
   # Must succeed without errors
   ```

9. **Final manual test**:

   ```bash
   npm start

   # Test sequence:
   # 1. /help - should list /fallback-model
   # 2. /fallback-model - should show "none" or current setting
   # 3. /provider gemini
   # 4. /key test-key - should show billing warning
   # 5. Make requests until rate limited (if possible)
   # 6. Should see wait behavior, not automatic Flash switch
   ```

## Outcome

If all checks pass: ✅ Phase 5 complete - Feature ready for release
If any check fails: ❌ List the specific failures
