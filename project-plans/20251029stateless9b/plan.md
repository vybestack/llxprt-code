# PlanExec: Provider Fail-Fast Retrofit (STATELESS9B)

Plan ID: PLAN-20251029-STATELESS9B  
Generated: 2025-10-29  
Scope: Finish the fail-fast runtime refactor by wiring explicit configs/runtimes into all provider paths, cleaning up tests, and delivering a green suite.

## Starting Point

- `RuntimeInvocationContext` now throws when runtime IDs or provider ephemerals are missing. `BaseProvider` and `ProviderManager` call it, but many providers/tests still rely on legacy `generateChatCompletion(contents)` overloads that never pass a config/runtime.
- Subagent wiring was partially updated to create isolated settings/config, but requires follow-up to ensure new helpers are exercised everywhere.
- Provider test suites (Anthropic, OpenAI, OpenAI responses, compatibility, stateless base tests) currently fail because they haven’t been retrofitted to supply runtime/config context.
- Some helper utilities (e.g., compatibility adapters, logging wrapper tests) still assume config fallbacks and need explicit runtime fixtures.

## Objectives

1. Provide a reliable helper for constructing `GenerateChatOptions` with settings + config + runtime, and apply it everywhere tests/fixtures call `generateChatCompletion`.
2. Update provider test suites (OpenAI, Anthropic, Gemini, OpenAI Responses, base provider stateless) to use the helper and assert the new fail-fast behaviour.
3. Ensure SubAgentScope uses the isolated settings/config path throughout and that its stateless tests pass without patching foreground config.
4. Confirm runtime hardening works end-to-end by running `vitest` provider suites and main npm pipelines.

## Deliverables

- Shared test helper (e.g., `createProviderCallOptions`) available under `packages/core/src/test-utils/` for injecting per-call settings/config/runtime.
- Updated provider unit/integration tests using the helper instead of relying on fallback behaviour.
- SubAgentScope fully isolated, with updated tests verifying separate runtime IDs and ephemerals.
- Green runs for:
  - `npx vitest run packages/core/src/providers`
  - `npm run ci:test`
  - From `main`: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build`, and `node scripts/start.js --profile-load cerebrasqwen3 --prompt "just say hi"`.

## Work Breakdown (Test-First)

### Phase P01 – Retrofit Helpers
- [ ] Introduce `createProviderCallOptions` (or similar) returning `{ contents, settings, config, runtime }`.
- [ ] Add failing tests that depend on this helper to guarantee it populates provider-specific ephemerals.

### Phase P02 – Provider Suites
- [ ] Update BaseProvider, ProviderManager, stateless provider tests to call `generateChatCompletion` with the new helper.
- [ ] Inject provider-specific overrides (temperature, max tokens, etc.) into the settings snapshots so regression expectations stay the same.
- [ ] Fix compatibility tests to inspect the returned options rather than relying on reference equality.

### Phase P03 – Provider Implementations
- [ ] Adjust Anthropic, Gemini, OpenAI, and OpenAI responses tests/fixtures to use the helper; ensure request expectations see the right overrides.
- [ ] Review production call sites (e.g., logging wrapper, integration tests) for missing configs; update as needed.

### Phase P04 – Subagent Isolation
- [ ] Finish SubAgentScope wiring to use isolated settings/provider manager; verify tests no longer stub foreground config methods.
- [ ] Ensure stateless tests assert runtime IDs, provider names, and ephemerals are subagent-specific.

### Phase P05 – Verification
- [ ] Run `npx vitest run packages/core/src/providers` until green.
- [ ] Execute `npm run ci:test`.
- [ ] From `main`, run `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build`, and `node scripts/start.js --profile-load cerebrasqwen3 --prompt "just say hi"`.
- [ ] Archive logs under `.completed/PLAN-20251029-STATELESS9B/`.

## Risks & Notes

- Provider suites are numerous; use the helper to avoid repetitive boilerplate.
- Integration tests may need additional mock configs once fail-fast behaviour is enforced.
- Keep an eye on backwards compatibility for external consumers; note any breaking changes separately.
