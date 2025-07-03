# Phase 2 - Fallback Model Command (backoff)

**⚠️ STOP after completing all tasks in this phase and wait for verification.**

## Goal

Implement the `/fallback-model` command to allow users to configure an optional fallback model.

## Deliverables

- [ ] `/fallback-model` command in slash command processor
- [ ] Settings integration for fallback model persistence
- [ ] Command help text and usage examples
- [ ] Validation of model names

## Implementation Checklist

- [ ] Add `fallbackModel` to settings schema in `packages/cli/src/config/settings.ts`:

  ```typescript
  fallbackModel?: string; // User-configured fallback model
  ```

- [ ] Implement `/fallback-model` command in `packages/cli/src/ui/hooks/slashCommandProcessor.ts`:
  - No args: Show current fallback model setting
  - With model name: Set fallback model
  - `none`: Clear fallback model setting
  - Validate model exists in available models list

- [ ] Add command to help text with description:

  ```
  /fallback-model [model] - Set fallback model for rate limit scenarios (use 'none' to disable)
  ```

- [ ] Store fallback model in user settings when changed

- [ ] Add fallback model info to `/settings` command output

## Self-Verify Commands

```bash
# Type checking should pass
npm run typecheck

# Lint should pass
npm run lint

# Manual test (start CLI and test command)
npm start
# Try: /fallback-model
# Try: /fallback-model gemini-2.5-flash
# Try: /fallback-model none
# Try: /fallback-model invalid-model-name
```

## Notes

- Command should work regardless of active provider
- Model validation should check against all available models
- Settings should persist across sessions

**STOP. Wait for Phase 2a verification before proceeding.**
