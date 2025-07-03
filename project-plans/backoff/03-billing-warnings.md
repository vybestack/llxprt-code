# Phase 3 - Billing Warnings Implementation (backoff)

**⚠️ STOP after completing all tasks in this phase and wait for verification.**

## Goal

Add billing warnings when users configure API keys that will result in charges.

## Deliverables

- [ ] Warning on `/key` command for Gemini provider
- [ ] Warning on keyfile detection during startup
- [ ] Warning on `/auth` command showing billing status
- [ ] Updated provider switching warnings

## Implementation Checklist

- [ ] Add billing warning to `/key` command in `packages/cli/src/ui/hooks/slashCommandProcessor.ts`:

  ```typescript
  // When setting key for gemini provider
  if (providerName === 'gemini') {
    addMessage({
      type: MessageType.WARNING,
      content:
        '⚠️ Warning: Using a Gemini API key will result in charges to your Google Cloud account.\n' +
        'To use Gemini CLI for free, use /auth with OAuth and remove any API keys.',
      timestamp: new Date(),
    });
  }
  ```

- [ ] Add keyfile detection warning in `packages/cli/src/providers/providerManagerInstance.ts`:
  - Check for `.gemini_key` file in home directory
  - Show warning if found during initialization

- [ ] Update `/auth` command to show billing implications:
  - Show current auth method (OAuth = free, API key = paid)
  - Add billing info to auth status display

- [ ] Add warning when switching from OAuth to API key mode:
  - In provider switching logic
  - In auth type changes

- [ ] Create billing warning constants in `packages/cli/src/constants/billing.ts`:
  ```typescript
  export const BILLING_WARNINGS = {
    API_KEY:
      '⚠️ Warning: Using a Gemini API key will result in charges to your Google Cloud account.\n' +
      'To use Gemini CLI for free, use /auth with OAuth and remove any API keys.',
    KEYFILE:
      '⚠️ A Gemini API key file was detected. This will result in charges to your Google Cloud account.\n' +
      'To use Gemini CLI for free, remove the key file and use /auth with OAuth.',
  };
  ```

## Self-Verify Commands

```bash
# Type checking should pass
npm run typecheck

# Lint should pass
npm run lint

# Manual test - set API key and verify warning
npm start
# /provider gemini
# /key test-key-123
# Should see billing warning

# Test with keyfile
echo "test-key" > ~/.gemini_key
npm start
# Should see keyfile warning on startup
rm ~/.gemini_key
```

## Notes

- Only show warnings for Gemini provider (OpenAI/Anthropic users expect billing)
- Don't show warnings repeatedly in same session
- OAuth users should never see billing warnings

**STOP. Wait for Phase 3a verification before proceeding.**
