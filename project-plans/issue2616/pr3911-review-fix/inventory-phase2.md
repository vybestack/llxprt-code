# Phase 2 transport inventory (T2.0)

Generated at base `3872f9deb` from `git grep -n -F` on `captureProviderInvocation(`, `prepareProviderInvocation(`, `createRuntimeInvocationContext(`, `ProviderInvocationData`, `fetchNetwork`, `bindNetworkFetch`, `new ProviderManager(`, `new OwnedFetch(` and `invocation ??=`, run over the whole tree except `project-plans/` and `tmp/`. Line numbers are at that head; find code by symbol.

Counts: 13 production invocation producers (table A), 8 production callers or readers (table B), 4 production `ProviderManager` constructions, 2 production `OwnedFetch` constructions plus the session network field, 1 production `bindNetworkFetch` caller, 6 production `fetchNetwork` reader files (C1 to C6), 132 test files and helpers that need a fetch (11 batches, T2.5a to T2.5k, table E), 124 files that construct a `ProviderManager` and are covered by the T2.6 suites (appendix 1; some of them are also in a batch).

## A. Production producers of invocation contexts and invocation data

"Fetch today" says where the request fetch comes from at the head: owner (an `OwnedFetch` the root or session owns), ambient (`globalThis.fetch` default), none (no fetch field is set, so the provider falls back to its own default), or carried (copied from an incoming invocation).

| # | File and symbol | Fetch today | Task |
| --- | --- | --- | --- |
| A1 | `packages/core/src/runtime/providerRequestContext.ts` `ProviderInvocationData` (no fetch field) and `captureProviderInvocation` (sixth positional `requestFetch?`, forwards it as `fetch`) | param, optional | T2.2 adds `ProviderInvocationData.fetch?` and reads it; T2.6 makes it required and deletes the sixth parameter |
| A2 | `packages/core/src/runtime/RuntimeInvocationContext.ts` `RuntimeInvocationContext.fetch?` (line 36), `RuntimeInvocationContextInit.fetch?` (line 76), `createRuntimeInvocationContext` (line 168, copies `init.fetch`) | optional field | T2.6 |
| A3 | `packages/core/src/session/session-settings-owner.ts` `prepareProviderInvocation` (line 404; optional `requestFetch`, forwards to A1 as the sixth argument) | caller supplied, optional | T2.6 (parameter deleted; see finding F7: the owner builds the data itself and has no fetch to put in it) |
| A4 | `packages/providers/src/ProviderManager.ts` `normalizeRuntimeInputs` → `admitRequest` (line 489, `captureProviderInvocation(..., this.requestFetch)`) | `this.requestFetch`: ambient until a root binds it | T2.2 (data carries it), T2.6 (default deleted) |
| A5 | `packages/providers/src/ProviderManager.ts` `snapshotInvocationData` (line 437; builds the `ProviderInvocationData` that `setInvocationDataReader` hands the wrapper, no fetch) | none | T2.2 ("the manager's builder fills it") |
| A6 | `packages/providers/src/logging/optionsNormalizer.ts` line 62 `normalizedOptions.invocation ??= captureProviderInvocation(injectedData, name, params)` | none | T2.2 (data carries the fetch from A5; the call itself does not change after T2.6 removes the sixth parameter) |
| A7 | `packages/agents/src/session/text-generation-request.ts` line 102 (`fetch: captured.fetch`, from B2) | carried | T2.6 (type only) |
| A8 | `packages/agents/src/core/CompressionProfileResolver.ts` line 385 (profile provider path) | none | T2.4 |
| A9 | `packages/agents/src/core/CompressionProfileResolver.ts` line 520 (load-balancer path) | none | T2.4 |
| A10 | `packages/providers/src/BaseProviderNormalization.ts` line 224 (`createNormalizedInvocation`, invocation already provided: `fetch: providedInvocation.fetch`) | carried | T2.6 (type only) |
| A11 | `packages/providers/src/BaseProviderNormalization.ts` line 252 (same function, no valid invocation provided) | none, and no source to take one from | T2.6 (see finding F2 below) |
| A12 | `packages/providers/src/loadBalancing/resolvedOptionsBuilder.ts` line 212 `createDelegateInvocation` (builds the sub-profile delegate's invocation from `options.invocation`, copies `runtimeId`, `sessionId` and `metadata` but not `fetch`) | none, although `options.invocation?.fetch` is available | T2.6 (see finding F1 below) |
| A13 | `packages/providers/src/runtimeNormalizer.ts` line 77 (`fetch: invocation.fetch`) | carried | T2.6 (type only) |

## B. Production callers and readers of `prepareProviderInvocation`

| # | File and site | Fetch today | Task |
| --- | --- | --- | --- |
| B1 | `packages/agents/src/session/session-client-binding.ts` line 135 (`bindClientSettings`, the closure passed to `client.bindProviderInvocation`; last argument `requestFetch`) | the session's private `OwnedFetch` (`session-client-acquisition-owner.ts` line 431 passes `this.network.fetch`) | T2.3d (the session borrows the root network) |
| B2 | `packages/agents/src/session/session-text-generation.ts` line 168 (`this.fetch`, from `session-client-acquisition-owner.ts` line 110 `this.network.fetch`) | the session's private `OwnedFetch` | T2.3d |
| B3 | `packages/agents/src/core/subagent-runtime-loader.ts` line 43 (closure for the child runtime; passes no fetch) | none | T2.3d |
| B4 | `packages/agents/src/core/TurnProcessor.ts` line 750 (`this.runtimeContext.prepareProviderInvocation`, reader of the closure bound by B1 or B3) | whatever the bound closure carries | follows B1 and B3; no edit |
| B5 | `packages/agents/src/core/DirectMessageProcessor.ts` line 555 (same reader) | same | follows B1 and B3; no edit |
| B6 | `packages/agents/src/compression/compressionContextBuilder.ts` line 77 (same reader, route path) | same | T2.4 lists this file in its scope (context type); no fetch edit expected unless the resolver context type changes |
| B7 | `packages/agents/src/core/CompressionProfileResolver.ts` line 564 (`ctx.prepareProviderInvocation(provider.name)`, default-provider path) | same | follows B1 and B3; T2.4 gives the context a required root fetch for A8 and A9 |
| B8 | `packages/agents/src/core/StreamProcessor.ts` lines 401 and 491 (hands the same function to `buildStreamChatOptions`; also plumbing in `ChatSessionFactory.ts`, `chatSession.ts`, `client.ts` line 815, `client-session-policy.ts` `bindProviderInvocation`, `AgentRuntimeLoader.ts`, `createAgentRuntimeContext.ts`) | same | no edit; listed so nobody assumes the list of readers is complete |

## C. Transport roots: manager constructions, networks, binding and readers

| # | File and site | Today | Task |
| --- | --- | --- | --- |
| C1 | `packages/agents/src/api/profile-preflight.ts` line 180 `new ProviderManager(...)`; line 207 `createOwnerOAuthManager(..., manager.fetchNetwork)`; line 211 `populateProviderManager` | manager unbound, so `fetchNetwork` is the ambient fetch; OAuth reads it | T2.3c |
| C2 | `packages/agents/src/api/fromConfig-session.ts` line 106 `new ProviderManager(...)` (inside `if (this.adoptProviderManager !== undefined)` else-branch; `adoptProviderManager` is never assigned in production, only by test fixtures); lines 129 and 131 `fetchNetwork === undefined` check and read for OAuth `requestFetch` | unbound, ambient | T2.3b (root network); T2.6 (the `=== undefined` check) |
| C3 | `packages/agents/src/api/preferred-provider-acquisition.ts` line 93 `new ProviderManager(...)`; line 143 OAuth `(input, init) => manager.fetchNetwork(input, init)` | unbound, ambient | T2.3b |
| C4 | `packages/agents/src/api/child-agent-assembly.ts` line 227 `new ProviderManager(...)`; line 260 OAuth `this.manager.fetchNetwork`; lines 194-201 child `new Config({...})` has no `proxy` input; line 218 `ProviderFileLifecycle` `proxy: this.config.getProxy()` | unbound, ambient; child proxy undefined | T2.3b (child proxy propagation and root network) |
| C5 | `packages/agents/src/api/provider-switch/provider-switch.ts` lines 128-130 (`manager.fetchNetwork === undefined` check, then read, for the claudecode OAuth registration) | reads the root's network | T2.6 (check deleted) |
| C6 | `packages/providers/src/composition/providerManagerInstance.ts` line 401 `registerStandardOAuthProviders(oauthManager, manager.fetchNetwork, ...)` inside `registerAllProviders`, reached from `populateProviderManager` (callers: C1, C2, `policyComposition.registerProvidersOntoManager` for C3 and C4) | reads the manager's `fetchNetwork` (a property arrow, so it follows later binding) | none; correct once each root binds before populate |
| C7 | `packages/core/src/runtime/contracts/RuntimeProviderManager.ts` lines 89 and 94 (`fetchNetwork?` and `bindNetworkFetch?` optional members) | optional | T2.6 (`fetchNetwork` required; `bindNetworkFetch?` stays optional in the plan, see F4) |
| C8 | `packages/providers/src/ProviderManager.ts` line 516 `private requestFetch = globalThis.fetch`; line 518 `fetchNetwork`; line 527 `bindNetworkFetch`; lines 342 and 535 `bindOwnerAuthentication(..., () => this.requestFetch, ...)`; line 501 (A4) | ambient default | T2.6 (default deleted; see F3 for the direct field reads) |
| C9 | `packages/agents/src/session/session-client-acquisition-owner.ts` line 101 `new OwnedFetch(this.config.getProxy())` (`initializeClientNetwork`); line 97 `fetch` getter; lines 110 and 431 read `this.network.fetch` directly; line 132 failure path `this.network.dispose()`; line 143 `disposeClientNetwork`; line 335 `network` field | one private network per session | T2.3d (see F5) |
| C10 | `packages/agents/src/session/session-client-owner.ts` line 280 `new ModelRegistry(this.fetch)`; line 282 `manager.bindNetworkFetch?.(this.fetch)` (the only production `bindNetworkFetch` caller); line 287 passes `this.fetch` to `SessionToolCatalogOwner`; line 238 `operations.fetch`; lines 540-552 dispose step `disposeClientNetwork` | session network | line 282 deleted in T2.3b; the rest in T2.3d |
| C11 | `packages/providers/src/provider-file-deletion.ts` line 21 `new OwnedFetch(proxy)` in `deleteRetainedProviderFile` (one short-lived network per remote deletion, disposed in the same function) | self-contained owner | none (not a manager root; not part of the ownership table) |
| C12 | `packages/cli/src/integration-tests/fake-provider-registration-fixture.ts` line 56 `new ProviderManager(...)` (CLI test fixture, not production) | unbound | T2.3b (bind it the same way, per the plan) |

Production `OwnedFetch` constructions: C9 and C11 only. Production `bindNetworkFetch` callers: C10 only. Test files that already call `bindNetworkFetch` or read `fetchNetwork` or build `OwnedFetch` (no batch needed; listed so T2.6 knows they are already bound):
`packages/agents/src/api/__tests__/session-client-owner-join.behavior.test.ts` (wraps `bindNetworkFetch`), `packages/cli/src/ui/contexts/runtime-owner-bridge.oauth.test.tsx`, `packages/core/src/utils/owned-fetch-http.test.ts`, `packages/core/src/utils/owned-fetch.test.ts`, `packages/providers/src/__tests__/admitted-fetch-normalization.test.ts`, `packages/providers/src/auth/auth-owner-identity.test.ts`, `packages/providers/src/auth/oauth-proxy-refresh.test.ts`.

## D. Ambient fetch defaults still present outside the sites above

Not named in the plan's "Known facts". They do not change the T2.x task list, but T2.6 deletes only `ProviderManager.requestFetch`'s default and `vercelModelClient.ts`'s `?? fetch`, so these stay:

| File and site | Note |
| --- | --- |
| `packages/providers/src/openai-vercel/vercelModelClient.ts` line 211 `customFetch ?? options.invocation.fetch ?? fetch` | the `?? fetch` T2.6 deletes (the next branch, line 213, already has no ambient fallback) |
| `packages/providers/src/BaseProvider.ts` line 154 `protected readonly requestFetch = globalThis.fetch` | shadowed by `bindOwnerAuthentication` when a manager registers the provider (line 176 reads the manager's fetch); ambient for any provider not registered through a manager |
| `packages/providers/src/openai-responses/openAIResponsesHttpStream.ts` line 328, `packages/providers/src/openai-vercel/vercelReasoningCapture.ts` line 197, `packages/providers/src/openai/openaiStreamFetchSafety.ts` line 12 (`innerFetch ?? globalThis.fetch`) | default parameters of helpers; callers pass the invocation fetch when they have one |
| `packages/agents/src/session/session-tool-catalog-owner.ts` line 146 `requestFetch = globalThis.fetch` default; the only production construction (`session-client-owner.ts` line 283) passes `this.fetch`; the other construction is `packages/agents/src/tools/__tests__/task-selection-fixture.ts` | ambient only in the test fixture |

## E. Test files and helpers, grouped into batches (T2.5a to T2.5k)

Selection rule: every file outside production code that contains `captureProviderInvocation(`, `prepareProviderInvocation(`, `createRuntimeInvocationContext(`, `ProviderInvocationData` or `invocation ??=` (132 files: core 8, test-utils 1, providers 59, agents 59, google-gemini plugin 5; cli has none). The plan estimated about 129. Two of them are not named `*.test.ts`: `packages/test-utils/src/core/providerCallOptions.ts` (111 files import it) and `plugins/google-gemini/src/test/testSupport.ts` (12 importers); both are in the plan's "Known facts" list of direct builders. `packages/agents/src/core/chatSession-runtime-helpers.ts` sits in the production directory but is only imported by tests (its `invocationData` builds a `ProviderInvocationData` literal), so it is in the agents batches (T2.5g to T2.5j) like the other test helpers.

Batch rule: at most 15 files from one package, files sorted by path. Columns: calls to `captureProviderInvocation(` / `prepareProviderInvocation(` / `createRuntimeInvocationContext(` in the file, then the number of lines mentioning `ProviderInvocationData` or `invocation ??=`. "helper" files are not test entry points; run the focused command for every test file in the batch (a helper is exercised by the in-batch tests that import it, and by the package suite at the phase gate).

Per-batch commands (W is the worktree path):

- Core batch: for each test file, `exec < /dev/null; cd W/packages/core && bun test <path>`; then `cd W/packages/core && npm run typecheck`.
- test-utils batch: the helper has no test of its own and 111 files import it; run `cd W/packages/test-utils && npm run typecheck`, and the typecheck of core, providers and agents; the importers' tests run in the package suites at the phase gate.
- Providers batches: `exec < /dev/null; cd W/packages/providers && bun test <path>` per test file; `cd W/packages/providers && npm run typecheck`.
- Agents batches: `exec < /dev/null; cd W/packages/agents && bun test --timeout 180000 <path>` per test file, one process each (the `test-bun` file with its explicit path); `cd W/packages/agents && npm run typecheck`.
- Plugin batch: `exec < /dev/null; cd W/plugins/google-gemini && bun test <path>` per test file; `cd W/plugins/google-gemini && npm run typecheck`.
- Every batch: `cd W && npx eslint --max-warnings 0 <batch files>` and `cd W && npx prettier --check <batch files>`.

Batch ids for the task index: T2.5a (core), T2.5b (test-utils), T2.5c, T2.5d, T2.5e, T2.5f (providers), T2.5g, T2.5h, T2.5i, T2.5j (agents), T2.5k (google-gemini plugin).
Paths in the tables are relative to the package directory shown in the heading.

### T2.5a (packages/core, 8 files)

| File | Kind | capture / prepare / createRuntime calls; ProviderInvocationData mentions |
| --- | --- | --- |
| `src/__tests__/settings-integration/adapter-integration.test.ts` | test | 1 / 0 / 0; 0 |
| `src/runtime/__tests__/RuntimeInvocationContext.separation.test.ts` | test | 0 / 0 / 23; 0 |
| `src/runtime/AgentRuntimeLoader.test.ts` | test | 0 / 9 / 0; 0 |
| `src/runtime/provider-invocation-data.test.ts` | test | 3 / 0 / 0; 0 |
| `src/runtime/provider-request-settings.test.ts` | test | 1 / 0 / 0; 0 |
| `src/runtime/RuntimeInvocationContext.failfast.test.ts` | test | 0 / 0 / 2; 0 |
| `src/runtime/RuntimeInvocationContext.owner-data.test.ts` | test | 0 / 0 / 8; 0 |
| `src/runtime/session-settings-policy-validation.test.ts` | test | 0 / 1 / 0; 0 |

### T2.5b (packages/test-utils, 1 files)

| File | Kind | capture / prepare / createRuntime calls; ProviderInvocationData mentions |
| --- | --- | --- |
| `src/core/providerCallOptions.ts` | helper | 0 / 0 / 1; 0 |

### T2.5c (packages/providers, 15 files)

| File | Kind | capture / prepare / createRuntime calls; ProviderInvocationData mentions |
| --- | --- | --- |
| `src/__tests__/admitted-fetch-normalization.test.ts` | test | 0 / 0 / 1; 0 |
| `src/__tests__/BaseProvider.proxyKeyStorage.test.ts` | test | 1 / 0 / 0; 0 |
| `src/__tests__/BaseProviderNormalization.ephemeralPropagation.test.ts` | test | 0 / 0 / 4; 0 |
| `src/__tests__/BaseProviderNormalization.invocation.test.ts` | test | 0 / 0 / 1; 0 |
| `src/__tests__/extracted-helpers.behavior.test.ts` | test | 0 / 0 / 3; 0 |
| `src/__tests__/helper-request-admission.ts` | helper | 1 / 0 / 0; 0 |
| `src/__tests__/LoadBalancingProvider.admitted-parameters.test.ts` | test | 1 / 0 / 0; 0 |
| `src/__tests__/LoadBalancingProvider.sessionPrecedence.test.ts` | test | 0 / 0 / 1; 0 |
| `src/__tests__/promptEnvelopeWrapperChain.test.ts` | test | 1 / 0 / 0; 0 |
| `src/__tests__/provider-media-recovery.entry.test.ts` | test | 0 / 0 / 1; 0 |
| `src/__tests__/provider-request-port-isolation.test.ts` | test | 0 / 0 / 2; 0 |
| `src/__tests__/ProviderManager.guard.test.ts` | test | 1 / 0 / 0; 0 |
| `src/__tests__/public-invocation-ownership.test.ts` | test | 0 / 0 / 2; 0 |
| `src/__tests__/safeDefaultModel.regression.test.ts` | test | 2 / 0 / 0; 0 |
| `src/anthropic/AnthropicProvider.dumpContext.test.ts` | test | 0 / 0 / 5; 0 |

### T2.5d (packages/providers, 15 files)

| File | Kind | capture / prepare / createRuntime calls; ProviderInvocationData mentions |
| --- | --- | --- |
| `src/anthropic/AnthropicProvider.stateless.test.ts` | test | 0 / 0 / 1; 0 |
| `src/BaseProvider.test.ts` | test | 2 / 0 / 0; 0 |
| `src/composition/codex-proxy.behavior.test.ts` | test | 0 / 0 / 1; 0 |
| `src/logging/optionsNormalizer.test.ts` | test | 1 / 0 / 0; 0 |
| `src/LoggingProviderWrapper.test.ts` | test | 2 / 0 / 0; 0 |
| `src/openai-responses/__tests__/codexStateful.test-helpers.ts` | helper | 0 / 0 / 1; 0 |
| `src/openai-responses/__tests__/openai-responses-media-resolution.stateful.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai-responses/__tests__/openaiResponses.stateless.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai-responses/__tests__/OpenAIResponsesProvider.codex.noSyntheticInjection.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai-responses/__tests__/OpenAIResponsesProvider.codex.stateful.remediation.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai-responses/__tests__/OpenAIResponsesProvider.codex.stateless.test.ts` | test | 0 / 0 / 2; 0 |
| `src/openai-responses/__tests__/OpenAIResponsesProvider.hooksConfigLeak.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts` | test | 0 / 0 / 8; 0 |
| `src/openai-responses/__tests__/OpenAIResponsesProvider.retryClassification.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai-responses/__tests__/OpenAIResponsesProvider.stateful.test.ts` | test | 0 / 0 / 1; 0 |

### T2.5e (packages/providers, 15 files)

| File | Kind | capture / prepare / createRuntime calls; ProviderInvocationData mentions |
| --- | --- | --- |
| `src/openai-responses/openAIResponsesExecutor.abort.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai-responses/openAIResponsesExecutor.errorDump.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai-responses/openAIResponsesExecutor.liveness.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai-responses/openAIResponsesExecutor.multiParentRecovery.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai-responses/openAIResponsesExecutor.pdfSetting.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai-responses/openAIResponsesExecutor.streamIntegrity.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai-responses/OpenAIResponsesProvider.emptyModelFallback.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai-responses/OpenAIResponsesProvider.websocketFallback.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai-responses/responses-request.test-helpers.ts` | helper | 0 / 0 / 1; 0 |
| `src/openai-responses/websocket-lifetime-provider.test.ts` | test | 1 / 0 / 0; 0 |
| `src/openai-vercel/OpenAIVercelProvider.reasoning.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai-vercel/vercelModelClient.localAuth.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai-vercel/vercelRequestParams.maxRetries.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai/__tests__/openai.stateless.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai/__tests__/OpenAIRequestPreparation.issue3255.test-helpers.ts` | helper | 0 / 0 / 1; 0 |

### T2.5f (packages/providers, 14 files)

| File | Kind | capture / prepare / createRuntime calls; ProviderInvocationData mentions |
| --- | --- | --- |
| `src/openai/OpenAIClientFactory.test.ts` | test | 0 / 0 / 7; 0 |
| `src/openai/OpenAIProvider.emptyResponseRetry.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai/OpenAIProvider.kimiMedia.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai/OpenAIProvider.mistralPayload.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai/OpenAIProvider.reasoning.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai/openaiReasoningPipeline.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai/OpenAIRequestBuilder.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai/OpenAIRequestPreparation.issue1943.test.ts` | test | 0 / 0 / 12; 0 |
| `src/openai/OpenAIRequestPreparation.issue2853.test.ts` | test | 0 / 0 / 1; 0 |
| `src/openai/OpenAIRequestPreparation.issue2896.test.ts` | test | 0 / 0 / 1; 0 |
| `src/providerInterface.contract.test.ts` | test | 1 / 0 / 0; 0 |
| `src/retryConfigHandlers.test.ts` | test | 1 / 0 / 0; 0 |
| `src/runtime/provider-alias-defaults.ownership.issue3255.test.ts` | test | 0 / 0 / 1; 0 |
| `src/runtime/providerAliases.codex.contextLimit.integration.test.ts` | test | 0 / 1 / 0; 0 |

### T2.5g (packages/agents, 15 files)

| File | Kind | capture / prepare / createRuntime calls; ProviderInvocationData mentions |
| --- | --- | --- |
| `src/api/__tests__/mcp-instruction-owner.test.ts` | test | 0 / 1 / 0; 0 |
| `src/api/__tests__/providerActivation.behavior.test.ts` | test | 0 / 1 / 0; 0 |
| `src/compression/__tests__/compression-retry-helpers.ts` | helper | 0 / 1 / 0; 0 |
| `src/compression/__tests__/compression-usage-sync.test.ts` | test | 1 / 0 / 0; 0 |
| `src/compression/__tests__/compressionAnchorE2E.test.ts` | test | 1 / 0 / 0; 0 |
| `src/compression/__tests__/high-density-settings.test.ts` | test | 0 / 1 / 0; 0 |
| `src/compression/__tests__/MiddleOutStrategy-test-helpers.ts` | helper | 1 / 0 / 0; 0 |
| `src/compression/__tests__/transcriptPathInjection.test.ts` | test | 1 / 0 / 0; 0 |
| `src/compression/compression-media-composition.test.ts` | test | 1 / 0 / 0; 0 |
| `src/compression/compressionMemoryExclusion.test.ts` | test | 1 / 0 / 0; 0 |
| `src/compression/compressionSystemPrompt.test.ts` | test | 1 / 0 / 0; 0 |
| `src/compression/MiddleOutStrategy-core.test.ts` | test | 4 / 0 / 0; 0 |
| `src/compression/MiddleOutStrategy-edge.test.ts` | test | 1 / 0 / 0; 0 |
| `src/compression/MiddleOutStrategy-error.test.ts` | test | 3 / 0 / 0; 0 |
| `src/compression/MiddleOutStrategy-media.test.ts` | test | 6 / 0 / 0; 0 |

### T2.5h (packages/agents, 15 files)

| File | Kind | capture / prepare / createRuntime calls; ProviderInvocationData mentions |
| --- | --- | --- |
| `src/compression/one-shot-finish-metadata.test.ts` | test | 1 / 0 / 0; 0 |
| `src/compression/OneShotStrategy.test.ts` | test | 1 / 0 / 0; 0 |
| `src/core/__tests__/chat-factory-fixture.ts` | helper | 0 / 1 / 0; 0 |
| `src/core/__tests__/chatSession-density-helpers.ts` | helper | 0 / 1 / 0; 0 |
| `src/core/__tests__/chatSession.resolvedBaseUrl.bun.test.ts` | test | 0 / 1 / 0; 0 |
| `src/core/__tests__/chatSession.runtimeState.test.ts` | test | 0 / 1 / 0; 0 |
| `src/core/__tests__/directMessage.characterization.test.ts` | test | 1 / 0 / 0; 0 |
| `src/core/__tests__/directMessageAfcSanitization.test.ts` | test | 1 / 0 / 0; 0 |
| `src/core/__tests__/history-runtime-fixture.ts` | helper | 0 / 1 / 0; 0 |
| `src/core/__tests__/responses-lifecycle-fixture.ts` | helper | 1 / 0 / 0; 0 |
| `src/core/__tests__/selected-chat-media-fixture.ts` | helper | 0 / 1 / 0; 0 |
| `src/core/__tests__/session-policy-fixture.ts` | helper | 0 / 1 / 0; 0 |
| `src/core/__tests__/streamPipeline-characterization-helpers.ts` | helper | 0 / 1 / 0; 0 |
| `src/core/__tests__/structural-history-fixture.ts` | helper | 0 / 1 / 0; 0 |
| `src/core/__tests__/subagentOrchestrator-sessionInheritance.test.ts` | test | 0 / 1 / 0; 0 |

### T2.5i (packages/agents, 15 files)

| File | Kind | capture / prepare / createRuntime calls; ProviderInvocationData mentions |
| --- | --- | --- |
| `src/core/chat-session-empty-tools.test.ts` | test | 1 / 0 / 0; 0 |
| `src/core/chatSession-runtime-helpers.ts` | helper | 0 / 0 / 0; 1 |
| `src/core/chatSession.directRefusal.issue2329.test.ts` | test | 1 / 0 / 0; 0 |
| `src/core/chatSession.issue1729.test.ts` | test | 1 / 0 / 0; 0 |
| `src/core/chatSession.issue1749.test.ts` | test | 0 / 1 / 0; 0 |
| `src/core/chatSession.issue2150.test.ts` | test | 1 / 0 / 0; 0 |
| `src/core/chatSession.issue3048.discardRestart.test.ts` | test | 1 / 0 / 0; 0 |
| `src/core/chatSession.media-history.test.ts` | test | 0 / 1 / 0; 0 |
| `src/core/chatSession.runtime.history.test.ts` | test | 7 / 0 / 0; 0 |
| `src/core/chatSession.runtime.streaming.test.ts` | test | 3 / 0 / 0; 0 |
| `src/core/chatSession.runtime.test.ts` | test | 3 / 0 / 0; 0 |
| `src/core/chatSession.runtime.timeout.test.ts` | test | 4 / 0 / 0; 0 |
| `src/core/chatSession.systemPromptAssembly.test.ts` | test | 2 / 0 / 0; 0 |
| `src/core/chatSession.thinking-toolcalls.repro.test.ts` | test | 2 / 0 / 0; 0 |
| `src/core/chatSession.thinking-toolcalls.test.ts` | test | 4 / 0 / 0; 0 |

### T2.5j (packages/agents, 14 files)

| File | Kind | capture / prepare / createRuntime calls; ProviderInvocationData mentions |
| --- | --- | --- |
| `src/core/CompressionProfileResolver.config.test.ts` | test | 0 / 1 / 0; 0 |
| `src/core/ConversationManager.historyView.test.ts` | test | 1 / 0 / 0; 0 |
| `src/core/ConversationManager.modelStamp.test.ts` | test | 1 / 0 / 0; 0 |
| `src/core/ConversationManager.responseId.test.ts` | test | 1 / 0 / 0; 0 |
| `src/core/promptEnvelopeSendSeam.test.ts` | test | 0 / 0 / 1; 0 |
| `src/core/subagent-runtime-loader.test.ts` | test | 0 / 2 / 0; 0 |
| `src/core/subagent.stream-idle.test.ts` | test | 0 / 1 / 0; 0 |
| `src/core/subagentRuntimeSetup.assembler.test.ts` | test | 1 / 0 / 0; 0 |
| `src/core/systemPromptProvider.nonForegroundProvider.test.ts` | test | 0 / 1 / 0; 0 |
| `src/core/tokenUsageAttempt.test.ts` | test | 0 / 1 / 0; 0 |
| `src/core/tokenUsageLifecycle.test.ts` | test | 0 / 1 / 0; 0 |
| `src/core/TokenUsageLogger.rawTiming.test.ts` | test | 0 / 1 / 0; 0 |
| `src/core/turnMediaAdmission.lifecycle.test.ts` | test | 0 / 1 / 0; 0 |
| `test-bun/generatingModelStamp.issue2511.bun.ts` | test (explicit path) | 0 / 2 / 0; 0 |

### T2.5k (plugins/google-gemini, 5 files)

| File | Kind | capture / prepare / createRuntime calls; ProviderInvocationData mentions |
| --- | --- | --- |
| `src/test/gemini-session-streaming.wire.test.ts` | test | 0 / 2 / 0; 0 |
| `src/test/gemini.issue3255.test.ts` | test | 0 / 0 / 1; 0 |
| `src/test/gemini.stateless.test.ts` | test | 0 / 0 / 1; 0 |
| `src/test/gemini.userMemory.test.ts` | test | 0 / 0 / 3; 0 |
| `src/test/testSupport.ts` | helper | 0 / 0 / 1; 0 |

## F. Findings that differ from the plan's text

- F1 (`resolvedOptionsBuilder.ts` line 212, row A12). The load-balancer delegate invocation is built without `fetch`, although the parent `options.invocation` carries one. Every load-balancer sub-profile request therefore loses the owner transport today and falls back to the provider's own default. No task before T2.6 has a red test for it, and T2.6's two tests do not exercise it. T2.6 must pass `options.invocation?.fetch` (and, once the field is required, take it from the parent invocation without a fallback).
- F2 (`BaseProviderNormalization.ts` line 252, row A11). The branch that builds an invocation when none was provided has no fetch source at all. With `createRuntimeInvocationContext`'s `fetch` required (T2.6), this branch cannot compile unless it takes a fetch from its caller or fails. The plan lists the file in T2.6's scope but does not say which. This needs a decision before T2.6.
- F3 (`ProviderManager.ts` lines 342, 501 and 535, row C8). Providers get `() => this.requestFetch` (the raw field) through `bindOwnerAuthentication`, and A4 passes the raw field. After T2.6 removes the default, the field is `undefined` on an unbound manager, so these three sites hand out `undefined` instead of throwing `Error('Provider request requires the owner transport')`; only `fetchNetwork` would throw. The plan's red test (unbound `fetchNetwork` throws) does not cover these reads. They need to go through `this.fetchNetwork` (or the field must be a throwing function) in the same commit.
- F4 (`RuntimeProviderManager.ts` line 94). T2.6 makes `fetchNetwork` required but the session constructor's call is `manager.bindNetworkFetch?.(...)` (optional call), and the plan keeps the optional member while requiring that every production manager is bound exactly once by its root. The contract still lets a manager without `bindNetworkFetch` exist. T2.6 should decide whether `bindNetworkFetch` becomes required too.
- F5 (`session-client-acquisition-owner.ts` lines 110 and 431). The plan's "Session cleanup sites" lists the `fetch` getter, `initializeClientNetwork`, the failure path, `disposeClientNetwork` and the `network` field. Two more direct reads of `this.network.fetch` exist (the text-generation construction at line 110 and `bindClientSettings` at line 431), plus `new ModelRegistry(this.fetch)` and the `SessionToolCatalogOwner` argument in `session-client-owner.ts` (lines 280 and 287). All must read the manager's `fetchNetwork` when the field is deleted.
- F7 (`session-settings-owner.ts` line 404, row A3). T2.6 says the optional `requestFetch` parameter of `prepareProviderInvocation` is deleted because "the data object carries it", but the owner builds the data object itself from its settings (`getAllGlobalSettings`, `getProviderSettings`) and has no fetch. B1, B2 and B3 are the only places that know the root fetch. T2.6 needs a decision: keep a required fetch parameter on `prepareProviderInvocation` (and on the `PrepareProviderInvocation` closure type's implementations), or bind the root fetch into `SessionSettingsOwner` once per root.
- F6 (`fromConfig-session.ts` line 102). The adoption path has a branch that uses a caller-supplied manager and builds no network. Production never takes it (`adoptProviderManager` is not assigned outside test fixtures), so the ownership table's "adopted session root" row matches production. The fixtures `adopted-provider-fixture.ts` and `adoption-fixture.ts` do take it; T2.3b/T2.6 tests that run through those fixtures see an unbound manager until phase 6 removes the branch.

The plan's ownership table otherwise matches the code: four production `ProviderManager` constructions, one root per construction, `bindNetworkFetch` called only by the session constructor, and the child `Config` built without `proxy`.

## Appendix 1: other files that construct a `ProviderManager` (not in a T2.5 batch)

These 124 files (some also appear in a T2.5 batch) build a manager (`git grep -l -F 'new ProviderManager('`, excluding the four production constructions). After T2.6 an unbound manager's `fetchNetwork` throws, so any of them that makes a real request through the manager breaks there. They are found by the T2.6 verification suites, not by a separate batch. Per package: agents 26, cli 17, providers 76, google-gemini plugin 3, root `integration-tests` 1, `scripts/tests` 1.

- `integration-tests/token-tracking.test.ts`
- `packages/agents/src/api/__tests__/AgentRuntimeState.configDispose.test.ts`
- `packages/agents/src/api/__tests__/activation-media-owner-lifetime.behavior.test.ts`
- `packages/agents/src/api/__tests__/activation-preflight-cleanup-failure.behavior.test.ts`
- `packages/agents/src/api/__tests__/adoption-publication-barrier.behavior.test.ts`
- `packages/agents/src/api/__tests__/agentUnconfigured.behavior.test.ts`
- `packages/agents/src/api/__tests__/fromConfig-bootstrap-failure.behavior.test.ts`
- `packages/agents/src/api/__tests__/helpers/generation-owner-fixture.ts`
- `packages/agents/src/api/__tests__/helpers/provider-auth-fixtures.ts`
- `packages/agents/src/api/__tests__/helpers/session-failure-fixture.ts`
- `packages/agents/src/api/__tests__/profile-workflow-owner.test.ts`
- `packages/agents/src/api/__tests__/provider-alias-errors.test.ts`
- `packages/agents/src/api/__tests__/provider-factory-authority.behavior.test.ts`
- `packages/agents/src/api/__tests__/provider-switch-assembly.test.ts`
- `packages/agents/src/api/__tests__/workspace-definition-preflight.behavior.test.ts`
- `packages/agents/src/api/__tests__/workspace-memory-lifetime-owner-10.behavior.test.ts`
- `packages/agents/src/api/__tests__/workspace-memory-lifetime-owner-3.behavior.test.ts`
- `packages/agents/src/api/__tests__/workspace-memory-lifetime-owner-4.behavior.test.ts`
- `packages/agents/src/api/__tests__/workspace-memory-lifetime-owner-7.behavior.test.ts`
- `packages/agents/src/api/__tests__/workspace-memory-lifetime-owner-8.behavior.test.ts`
- `packages/agents/src/api/__tests__/workspace-memory-lifetime-owner-9.behavior.test.ts`
- `packages/agents/src/api/admit-load-balancer-model-parameters.test.ts`
- `packages/agents/src/api/profile-application/loadBalancerProfile.memberAuth.test.ts`
- `packages/agents/src/compression/__tests__/lbGuardProjectionParity.integration.test.ts`
- `packages/agents/src/core/client.media-history-lifecycle.test.ts`
- `packages/agents/src/core/subagent-runtime-loader.test.ts`
- `packages/agents/src/core/turn.preRequestTimeout.test.ts`
- `packages/cli/src/__tests__/headless-policy-fixture.ts`
- `packages/cli/src/__tests__/interactive-config-fixture.ts`
- `packages/cli/src/__tests__/slash-command-provider-fixture.ts`
- `packages/cli/src/__tests__/stream-media-fixture.ts`
- `packages/cli/src/__tests__/uiSessionOwner.ts`
- `packages/cli/src/cli.provider-init.test.ts`
- `packages/cli/src/cliBootstrap.providerActivation.test.ts`
- `packages/cli/src/cliSessionBootstrap.unreadable.test.ts`
- `packages/cli/src/integration-tests/consumer-content-generation.integration.test.ts`
- `packages/cli/src/integration-tests/consumer-migration-p13.integration.test.ts`
- `packages/cli/src/integration-tests/ephemeral-settings.integration.test.ts`
- `packages/cli/src/integration-tests/fake-provider-registration-fixture.ts`
- `packages/cli/src/nonInteractiveUnconfiguredProvider.test.ts`
- `packages/cli/src/runtime/__tests__/authKeyName.test.ts`
- `packages/cli/src/ui/containers/AppContainer/hooks/interactive-auth-root-isolation.behavior.test.ts`
- `packages/cli/src/ui/hooks/agentStream/__tests__/useSubmitQuery.providerIgnoreCancel.bun.tsx`
- `packages/cli/src/ui/hooks/continuePackageResume.integration.test.ts`
- `packages/providers/src/ProviderManager.test.ts`
- `packages/providers/src/__tests__/BaseProviderNormalization.ephemeralPropagation.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.activeModel.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.admitted-parameters.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.attemptTelemetry.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.circuitbreaker.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.commitBoundary.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.compressionAccounting.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.compressionGuard.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.delegation.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.delegation2.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.failover.errors.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.failover.retryable.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.failover.selection.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.failover.settings.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.failover.stickyIndex.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.failover.streaming.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.getContextLimit.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.getCurrentModel.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.interface.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.issue2849.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.lifecycle.noPhantom.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.liveness.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.metrics.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.promptEnvelopeProjection.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.realpath.repro.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.retryBoundary.integration.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.roundrobin.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.selectionEvent.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.settings-merge.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.stats.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.stats2.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.systemPromptModel.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.systemPromptProvider.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.timeout.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.tokenAccounting.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.tpm.test.ts`
- `packages/providers/src/__tests__/LoadBalancingProvider.types.test.ts`
- `packages/providers/src/__tests__/ProviderManager.guard.test.ts`
- `packages/providers/src/__tests__/ProviderManager.sandboxBaseUrl.test.ts`
- `packages/providers/src/__tests__/ProviderManager.settingsSeparation.test.ts`
- `packages/providers/src/__tests__/admitted-fetch-normalization.test.ts`
- `packages/providers/src/__tests__/headless-provider.test.ts`
- `packages/providers/src/__tests__/rawTimingTransport.retryBoundary.test.ts`
- `packages/providers/src/auth/oauth-proxy-refresh.test.ts`
- `packages/providers/src/composition/aliasProviderFactory.contributions.test.ts`
- `packages/providers/src/composition/oauth-browser-owner.test.ts`
- `packages/providers/src/composition/oauth-session-policy.behavior.test.ts`
- `packages/providers/src/composition/populate-provider-manager.test.ts`
- `packages/providers/src/composition/provider-filesystem-owner.test.ts`
- `packages/providers/src/composition/provider-manager-activation-errors.test.ts`
- `packages/providers/src/composition/provider-manager-selection-precedence.test.ts`
- `packages/providers/src/composition/provider-switching.integration.test.ts`
- `packages/providers/src/composition/provider-token-ownership.test.ts`
- `packages/providers/src/composition/providerManagerInstance.filesystem.test.ts`
- `packages/providers/src/composition/providerManagerInstance.oauthRegistration.test.ts`
- `packages/providers/src/composition/providerManagerInstance.schemaDefaults.test.ts`
- `packages/providers/src/composition/providerManagerUnconfigured.test.ts`
- `packages/providers/src/integration/multi-provider.integration.test.ts`
- `packages/providers/src/loadBalancing/memberAuthentication.projection.test.ts`
- `packages/providers/src/openai-vercel/providerRegistry.test.ts`
- `packages/providers/src/provider-manager-behavior.test.ts`
- `packages/providers/src/provider-manager-media-composition.test.ts`
- `packages/providers/src/providerManager.context.test.ts`
- `packages/providers/src/retryConfigHandlers.test.ts`
- `packages/providers/src/runtime/__tests__/profile-workflow-owner-fixture.ts`
- `packages/providers/src/runtime/__tests__/profileApplication.workflow.test.ts`
- `packages/providers/src/runtime/__tests__/providerManagerAdoption.behavior.test.ts`
- `packages/providers/src/runtime/config-manager-lifecycle.behavior.test.ts`
- `packages/providers/src/runtime/profileApplication.spec.ts`
- `packages/providers/src/runtime/provider-owner-diagnostics.behavior.test.ts`
- `packages/providers/src/runtime/provider-switch-owner.test.ts`
- `packages/providers/src/runtime/providerConfigUtils.test.ts`
- `packages/providers/src/runtime/runtimeContextFactory.oauthRetirement.test.ts`
- `packages/providers/src/runtime/runtimeContextFactory.setRuntimeContext.test.ts`
- `packages/providers/src/runtime/runtimeLifecycle.spec.ts`
- `plugins/google-gemini/src/test/ProviderManager.gemini-switch.test.ts`
- `plugins/google-gemini/src/test/geminiTokenTracking.test.ts`
- `plugins/google-gemini/src/test/provider-gemini-switching.test.ts`
- `scripts/tests/issue-2603-plugin-install-layouts.test.ts`
