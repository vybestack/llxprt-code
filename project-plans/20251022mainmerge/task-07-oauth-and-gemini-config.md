## Task 07 – Cherry-pick OAuth & Gemini Config Fixes

### Scope
Cherry-pick the final upstream commits:

1. `0332bbec8` – `fix: Remove premature OAuth initialization during MCP operations`
2. `5dcebb0f6` – `fix: add super.setConfig call to GeminiProvider.setConfig method`

### Key Files to Watch
- `packages/cli/src/auth/oauth-manager.ts`
- `packages/cli/src/providers/providerManagerInstance.ts`
- `packages/cli/src/providers/oauth-provider-registration.ts` (new upstream helper)
- `packages/core/src/providers/gemini/GeminiProvider.ts` (or equivalent path)

### Acceptance Notes
- Ensure lazy OAuth registration integrates with our provider bootstrap and stateless-provider runtime contexts.
- Verify the added `super.setConfig` call coexists with our Gemini provider adjustments (avoid duplicate logic).
- Run provider/OAuth test suites after applying these commits.
