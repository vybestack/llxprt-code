# Phase 2a - Verification of Fallback Model Command (backoff)

## Verification Steps

1. **Check settings schema update**:

   ```bash
   grep -n "fallbackModel" packages/cli/src/config/settings.ts
   # Should show the new optional field
   ```

2. **Verify command implementation**:

   ```bash
   grep -n "name: 'fallback-model'" packages/cli/src/ui/hooks/slashCommandProcessor.ts
   # Should show the command definition

   # Check for command logic
   grep -A 20 "name: 'fallback-model'" packages/cli/src/ui/hooks/slashCommandProcessor.ts
   # Should show validation and settings update logic
   ```

3. **Check help text**:

   ```bash
   grep -n "fallback-model" packages/cli/src/ui/hooks/slashCommandProcessor.ts
   # Should appear in help command output
   ```

4. **Verify settings integration**:

   ```bash
   # Check that fallback model is saved to settings
   grep -n "setValue.*fallbackModel" packages/cli/src/ui/hooks/slashCommandProcessor.ts
   # Should show settings.setValue call
   ```

5. **Run type checking**:

   ```bash
   npm run typecheck
   # Must pass with no errors
   ```

6. **Run linting**:

   ```bash
   npm run lint
   # Must pass with no errors
   ```

7. **Manual command test**:

   ```bash
   # Start the CLI
   npm start

   # Test each variant and verify output:
   # /fallback-model (should show current setting or "none")
   # /fallback-model gemini-2.5-flash (should confirm setting)
   # /fallback-model none (should clear setting)
   # /fallback-model bad-model (should show error)
   ```

8. **Check settings persistence**:
   ```bash
   # After setting a fallback model, check the settings file
   cat ~/.gemini/settings.json | grep fallbackModel
   # Should show the saved value
   ```

## Outcome

If all checks pass: ✅ Phase 2 complete
If any check fails: ❌ List the specific failures
