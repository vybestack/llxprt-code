# Phase 3 – Command Updates (gemini)

**STOP**: After completing all tasks in this phase, do not proceed. Wait for Phase 3a verification.

## Goal

Update slash commands to work correctly with the unified Gemini provider architecture, removing the requirement to manually activate the provider.

## Deliverables

- [ ] Update `/key` command in `packages/cli/src/ui/hooks/slashCommandProcessor.ts` to work when Gemini is default
- [ ] Update `/keyfile` command to work when Gemini is default
- [ ] Update `/model` command to always use provider model dialog (remove dual behavior)
- [ ] Add `/auth` command support for switching between OAuth/API key/Vertex modes within provider
- [ ] Remove checks that prevent commands when no provider is "active" (since Gemini is now always active)

## Checklist (implementer)

- [ ] Modified `/key` handler to work with default provider
- [ ] Modified `/keyfile` handler to work with default provider
- [ ] Removed `hasActiveProvider()` checks that block commands
- [ ] Updated `/model` to always use `openProviderModelDialog`
- [ ] Added or updated `/auth` to manage Gemini authentication modes
- [ ] Removed legacy `openModelDialog` calls for Gemini
- [ ] Commands work immediately without `/provider gemini` first
- [ ] Type checking passes
- [ ] Linting passes

## Implementation Notes

- The provider manager should now always have an active provider (Gemini by default)
- Remove any branching logic that checks for empty `activeProviderName`
- `/auth` should allow switching between OAuth, API key, and Vertex modes

## Self-verify

Run these commands to verify your implementation:

```bash
npm run typecheck
npm run lint
npm test -- --testPathPattern=slash
```

## End note

STOP. Wait for Phase 3a verification before proceeding to Phase 4.
