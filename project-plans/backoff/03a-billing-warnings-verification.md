# Phase 3a - Verification of Billing Warnings (backoff)

## Verification Steps

1. **Check billing constants file**:

   ```bash
   grep -n "BILLING_WARNINGS" packages/cli/src/constants/billing.ts
   # Should show the constants definition
   ```

2. **Verify /key command warning**:

   ```bash
   # Find warning in /key command
   grep -A 10 "providerName === 'gemini'" packages/cli/src/ui/hooks/slashCommandProcessor.ts | grep -i "warning"
   # Should show billing warning message
   ```

3. **Check keyfile detection**:

   ```bash
   grep -n "gemini_key" packages/cli/src/providers/providerManagerInstance.ts
   # Should show keyfile checking logic
   ```

4. **Verify /auth command update**:

   ```bash
   grep -n "billing\|charges\|paid\|free" packages/cli/src/ui/hooks/slashCommandProcessor.ts
   # Should show billing info in auth command
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

7. **Manual /key command test**:

   ```bash
   npm start
   # /provider gemini
   # /key test-api-key
   # Should see: "⚠️ Warning: Using a Gemini API key will result in charges..."

   # /provider openai
   # /key test-api-key
   # Should NOT see billing warning (OpenAI users expect charges)
   ```

8. **Keyfile detection test**:

   ```bash
   # Create test keyfile
   echo "test-key" > ~/.gemini_key

   # Start CLI and check for warning
   npm start 2>&1 | grep -i "warning"
   # Should see keyfile warning

   # Cleanup
   rm ~/.gemini_key
   ```

9. **Auth status test**:
   ```bash
   npm start
   # /auth
   # Should show current auth method and billing status
   ```

## Outcome

If all checks pass: ✅ Phase 3 complete
If any check fails: ❌ List the specific failures
