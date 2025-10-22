**Summary**
- Cherry-picked upstream OAuth lazy-initialization and Gemini config commits without sacrificing our stateless provider runtime wiring.
- Adopted the new OAuth registration helper in `createProviderManager` while preserving agentic bootstrapping semantics.
- Ensured Gemini provider retains runtime-scoped caching by pairing `super.setConfig?.(config)` with our `refreshCachedSettings()` calls.

**Conflicts & Resolutions**
- `packages/cli/src/auth/oauth-manager.ts`: merged comment expectations and gated `getAuthStatus()` token reads behind `isOAuthEnabled` to prevent premature filesystem access.
- `packages/cli/src/providers/providerManagerInstance.ts`: removed eager OAuth registration, wired `ensureOAuthProviderRegistered` for on-demand setup, and retained config/runtime hooks plus addItem callbacks.
- `packages/core/src/providers/gemini/GeminiProvider.ts`: invoked `super.setConfig?.(config)` while keeping our stateless cache refresh to avoid regression in runtime overrides.

**Verification**
- `npx eslint packages/cli/src/auth/oauth-manager.ts packages/cli/src/providers/providerManagerInstance.ts packages/core/src/providers/gemini/GeminiProvider.ts` → exited 0.
- `npx vitest run packages/cli/src/auth/oauth-manager-initialization.spec.ts packages/cli/src/providers/providerManagerInstance.test.ts` → exited 0 (12 tests passed; console warnings expected from API key sanitization fixtures).

**Follow-up**
- Coordinate with runtime owners to run the broader provider-switching integration suite once related tasks land, ensuring no hidden regressions in agentic bootstrap flows.
