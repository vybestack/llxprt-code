# P05 Core Runtime Verification

@plan:PLAN-20250218-STATELESSPROVIDER.P05a  
@requirement:REQ-SP-001

## Regression Summary
- `npm run typecheck` and targeted Vitest suites pass; multi-provider integration emits expected OpenAI API key warning when credentials are absent.
- CLI help path and provider flag handling succeed; OpenAI prompt flow fails gracefully without a key and Gemini prompts trigger OAuth as expected.
- Prompt context assembly now consumes explicit provider/model inputs; no hidden singleton setting reads observed.

## Command Output

### `npm run typecheck`
```
> @vybestack/llxprt-code@0.4.2 typecheck
> npm run typecheck --workspaces --if-present


> @vybestack/llxprt-code-a2a-server@0.4.2 typecheck
> tsc --noEmit


> @vybestack/llxprt-code@0.4.2 typecheck
> tsc --noEmit


> @vybestack/llxprt-code-core@0.4.2 typecheck
> tsc --noEmit


> @vybestack/llxprt-code-test-utils@0.4.2 typecheck
> tsc --noEmit
```

### `npx vitest run packages/core/src/core/geminiChat.runtime.test.ts packages/core/src/providers/providerManager.context.test.ts packages/core/src/providers/BaseProvider.test.ts packages/core/src/providers/integration/multi-provider.integration.test.ts`
```
 RUN  v3.2.4 /Users/acoliver/projects/llxprt-code

 ✓ packages/core/src/providers/BaseProvider.test.ts (21 tests) 6ms
 ✓ packages/core/src/providers/providerManager.context.test.ts (2 tests) 2ms
stderr | packages/core/src/core/geminiChat.runtime.test.ts > GeminiChat runtime context > passes runtime context and tools to provider generateChatCompletion
[WARN] Skipping unreadable directory: /tmp/project (Directory does not exist: /tmp/project)

stdout | packages/core/src/providers/integration/multi-provider.integration.test.ts > Multi-Provider Integration Tests

WARNING:  Skipping Multi-Provider Integration Tests: No OpenAI API key found
   To run these tests, set the OPENAI_API_KEY environment variable


 ✓ packages/core/src/core/geminiChat.runtime.test.ts (1 test) 90ms
 ✓ packages/core/src/providers/integration/multi-provider.integration.test.ts (12 tests | 1 skipped) 328ms
   ✓ Multi-Provider Integration Tests > Error Handling > should handle missing API key  326ms

 Test Files  4 passed (4)
      Tests  35 passed | 1 skipped (36)
   Start at  19:10:14
   Duration  1.44s (transform 803ms, setup 0ms, collect 2.30s, tests 426ms, environment 0ms, prepare 163ms)
```

## Manual Verification
- **CLI provider switching** — `node packages/cli/dist/index.js --help` executes successfully; `--provider` accepts `gemini`, `openai`, `anthropic` (version output `0.4.2`). Invoking `--prompt "Hello"` with `--provider openai` surfaces the expected missing-key error file path, while the Gemini flow triggers OAuth login (timeout occurred awaiting external auth), confirming runtime switching engages the correct auth paths.
- **Prompt helper dependencies** — `packages/core/src/core/prompts.ts:77` explicitly builds prompt context from function parameters; no direct `getSettingsService()` imports remain, satisfying the singleton-removal requirement for prompt assembly.
- **Compatibility wrappers documented** — This report records the remaining shim surface slated for retirement in P09 (see “Compatibility wrappers to retire” below), addressing the documentation requirement for eventual removal.

## Remaining Singleton Touchpoints
- `packages/core/src/core/prompts.ts:18` maintains a module-level `PromptService` singleton; it now derives configuration from call sites but still caches the service instance.
- `packages/core/src/settings/settingsServiceInstance.ts:16` retains the legacy `getSettingsService()` singleton façade to satisfy consumers pending migration; the fallback wiring now routes through `ProviderRuntimeContext`.
- `packages/cli/src/providers/providerManagerInstance.ts:113` keeps a cached `providerManagerInstance`/`oauthManagerInstance` for CLI sessions; runtime handoff occurs via injected context but the global reference remains until CLI fully migrates.

## Compatibility Wrappers to Retire (P09)
- CLI helper `packages/cli/src/providers/providerManagerInstance.ts:243` re-exports `getProviderManager` for legacy imports; mark slated for deletion once CLI adopts per-runtime factories.
- Core `packages/core/src/settings/settingsServiceInstance.ts:44` exposes `registerSettingsService`/`resetSettingsService` convenience helpers; scheduled for deprecation once downstream callers construct scoped services directly.

## Modules queued for P06–P07 migration
- `packages/cli/src/ui/App.tsx` and `packages/cli/src/gemini.tsx` still reach for the cached provider manager; require refactor to accept injected runtime context.
- `packages/cli/src/validateNonInterActiveAuth.ts` and related tests continue to assume singleton access to provider/config instances.
- Zed integration path (`packages/cli/src/zed-integration/zedIntegration.ts`) reuses `config.getProviderManager()`; needs adaptation to instantiate per-session runtime contexts.
- OAuth manager registration (`packages/cli/src/auth/oauth-manager.ts`) still mutates providers via the shared instance; should transition to runtime-scoped managers in P07.

## Follow-ups
- Ensure CLI flows capture OAuth login prompts without hanging automated verification (consider headless bypass flag for future smoke tests).
- Coordinate with P06 owners to replace cached provider manager usage in UI/App bootstrap with explicit runtime context factories.
