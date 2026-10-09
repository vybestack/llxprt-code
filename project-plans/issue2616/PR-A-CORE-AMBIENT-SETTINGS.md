# Issue #2616 — PR A: Delete the core ambient runtime-context pointer and the process-wide settings singleton

Parent issue: #2616 (Eliminate ambient runtime global state). Epic #2619.
Branch: `issue2616`. Slicing rationale recorded below; this is the first PR of the
#2616 series.

## Why this slice first

#2616 reconciles a large inventory of ambient mechanisms to zero across multiple
PRs ("counts drive PR slicing only"; each PR leaves the build green and deletes
the accessors it obsoletes). The inventory splits into interlocking clusters:

- **Core ambient pointer + settings singleton** (this PR): the module-level
  `activeContext` in `core/src/runtime/providerRuntimeContext.ts`, the ambient
  helpers in `core/src/runtime/settingsRuntimeAdapter.ts`, the
  `defaultRuntimeStateFactory`, and `settings/src/settings/settingsServiceInstance.ts`.
- Providers runtime internals (runtimeRegistry Map, runtimeContextFactory
  side-channels, providerManagerInstance singletons, oauth-provider-registration
  WeakMap, runtimeAccessors/runtimeSettings barrels) — later PR.
- Agents side-channels + CLI `latestBridge` — later PR.
- `AgentRuntimeState.ts` global registries — later PR (candidate PR B).
- Negative-control/CI-scan machinery for the full prohibited-shapes list — later
  PR (this PR adds the first scan covering its own banned symbols).

This cluster is the bottom of the dependency chain: `providers/runtimeRegistry.ts`
(dispose path), `runtimeAccessors.ts`, `runtimeContextFactory.ts`, and
`runtimeLifecycle.ts` all consume the core ambient helpers being deleted here.
Migrating them first means the later registry-deletion PR touches no core files.
It is also the issue's Phase 3 + Phase 4 fused with their consumers, migrated
bottom-up with each consumer receiving explicit ports.

## Goal

Production code no longer obtains a `SettingsService` or a
`ProviderRuntimeContext` by asking "what is active right now". Every consumer
receives collaborators explicitly (constructor/function parameters or an
already-owned object). No new bundle type, no keyed registry, no ambient
delegation wrapper, no backward-compatibility shim is introduced.

## Exact deletions (production)

1. `packages/settings/src/settings/settingsServiceInstance.ts` — delete the
   file: `getSettingsService`, `registerSettingsService`,
   `resetSettingsService`, and the module singleton. Remove the three re-exports
   from `packages/settings/src/index.ts`.
2. `packages/core/src/runtime/providerRuntimeContext.ts` — delete:
   - `activeContext` module pointer,
   - `setActiveProviderRuntimeContext`, `clearActiveProviderRuntimeContext`,
     `peekActiveProviderRuntimeContext`, `getActiveProviderRuntimeContext`,
   - `defaultRuntimeStateFactory` and `setProviderRuntimeStateFactory`.
   `createProviderRuntimeContext` stays and becomes explicit-only: it throws
   `MissingRuntimeProviderError` when `init.settingsService` is absent (no
   factory fallback). Remove the import-time side effect previously caused by
   importing the settings adapter.
3. `packages/core/src/runtime/settingsRuntimeAdapter.ts` — delete:
   `resolveRuntimeSettingsService`, `getRuntimeSettingsService`,
   `maybeGetRuntimeSettingsService`, `createSettingsProviderRuntimeContext`,
   `setSettingsProviderRuntimeContext`, `clearSettingsProviderRuntimeContext`,
   `activateSettingsRuntimeContext`, `deactivateSettingsRuntimeContext`, and the
   `setProviderRuntimeStateFactory(...)` module side effect. What remains:
   `createRuntimeSettingsService` (the pure single-owner construction seam used
   by agents) plus any still-needed types. If a type becomes unused, delete it.
4. `packages/core/src/index.ts` — remove the re-exports of every deleted symbol
   (lines around 594-597 and 648-649 today). Keep
   `createProviderRuntimeContext`, `ProviderRuntimeContext`,
   `ProviderRuntimeContextInit` exports.

## Consumer migrations (behavior-preserving)

Each site stops resolving ambiently and receives/constructs explicitly. Where
today's chain ends in "fabricate a fresh `new SettingsService()`", the
composition site constructs one explicitly (same observable behavior, no
ambient read). No site may keep a fallback that probes ambient state.

| File | Today | After |
|---|---|---|
| `providers/src/BaseProvider.ts` (constructor) | `resolveRuntimeSettingsService(settingsService)` (ambient peek → singleton → fresh) | `settingsService ?? new SettingsService()` local construction default, stored on the instance. No ambient read. |
| `providers/src/BaseProvider.ts` (`invokeWithNormalizedOptions`) | saves/peeks the module context, swaps it around each provider call, restores in `finally` | Module-context swap deleted entirely. The call-scoped context object is already carried by `NormalizedGenerateChatOptions` and by `activeCallContext` (instance-owned ALS); the ambient swap exists only for outside readers, which this PR migrates. `createSettingsProviderRuntimeContext` call replaced by direct `createProviderRuntimeContext({..., settingsService: normalized.settings, ...})`. |
| `providers/src/BaseProvider.ts` (`normalizeGenerateChatOptions` runtimeId fallback) | `providedOptions.runtime?.runtimeId ?? providedOptions.invocation?.runtimeId ?? peekActiveProviderRuntimeContext()?.runtimeId` | Ambient peek removed; runtimeId comes only from the explicit options. Verify with the OAuth runtime-scope tests that CLI/agent flows pass runtime info explicitly (they do via `runtime`/`invocation`); if a flow regresses, thread the runtimeId explicitly at that caller — never restore the peek. |
| `core/src/core/prompts.ts` (4 sites: `resolvePromptSettings`, `resolveProvider`, `resolveAsyncSubagentSettings`, memory-merge in `getCoreSystemPromptAsync`) | `getRuntimeSettingsService()` in try/catch with defaults | Add an optional explicit settings reader parameter (narrow structural port, e.g. `{ get(key): unknown; getAllGlobalSettings(): Record<string, unknown> }`) to `CoreSystemPromptOptions`; thread from callers that own Config: `agents/src/core/ChatSessionFactory.ts`, `agents/src/core/clientLlmUtilities.ts`, `agents/src/compression/compressionSystemPrompt.ts` pass `config.getSettingsService()`. When absent, the same defaults as today's catch branch apply. |
| `providers/src/auth/provider-usage-info.ts` (`getHigherPriorityAuth`) | ambient `getRuntimeSettingsService()` for the `authOnly` global | Explicit optional parameter (settings reader) sourced from `OAuthManager` (its own settings/service state), passed at `oauth-manager.ts:367-368`. Absent → same behavior as today's catch (skip authOnly check). |
| `providers/src/runtime/runtimeLifecycle.ts` (`setCliRuntimeContext`) | builds a settings runtime context and `setSettingsProviderRuntimeContext(nextContext)` | Context build + set deleted. Registry upsert (`upsertRuntimeEntry`), `enterRuntimeScope`, `setDefaultCliRuntimeId`, `registerOAuthRuntimeAccessors` remain (they are the later PR's scope). |
| `providers/src/runtime/runtimeContextFactory.ts` (`createIsolatedRuntimeContext`) | `options.config?.getSettingsService() ?? resolveRuntimeSettingsService(options.settingsService)` | `options.config?.getSettingsService() ?? options.settingsService ?? new SettingsService()` (explicit composition default). `createSettingsProviderRuntimeContext` calls replaced by direct `createProviderRuntimeContext` (settings always non-null there). |
| `providers/src/runtime/runtimeContextFactory.ts` (`buildCleanupClosure`) | peeks ambient context; clears it if it matches the runtime | Ambient peek/clear block deleted. |
| `providers/src/runtime/runtimeRegistry.ts` (`disposeCliRuntimeRegistration`) | peeks ambient context; `clearSettingsProviderRuntimeContext()` when it matches | Peek/clear deleted. `resetCliRuntimeRegistryForTesting` drops its `clearSettingsProviderRuntimeContext()` call. `requireRuntimeEntry` debug log drops the `peekActiveProviderRuntimeContext` read. |
| `providers/src/runtime/runtimeAccessors.ts` (`getCliRuntimeContext`) | `createSettingsProviderRuntimeContext({settingsService: entry.settingsService, ...})` (chain fabricates fresh service when entry lacks one) | Direct `createProviderRuntimeContext`; when `entry.settingsService` is null and stateless hardening is off, construct a fresh `SettingsService` explicitly at this site (same observable behavior). Stateless-hardening throw behavior unchanged. |
| `agents/src/api/fromConfig.ts` | `activateSettingsRuntimeContext(sharedSettingsService, runtimeId, {...})` after handle activation | Call deleted. The handle/Config already carry the service explicitly; downstream ambient readers are gone in this PR. |
| `cli/src/config/profileBootstrap.ts` (`prepareRuntimeForProfile`) | `resolveRuntimeSettingsService(providedService)` | `providedService ?? createRuntimeSettingsService()` using the core adapter's surviving construction seam (the file already imports from core; keep the construction at this composition site, no ambient read). |
| `scripts/benchmark/responses_vs_chat.ts` | `peekActiveProviderRuntimeContext()` save/restore | Drop the ambient save/restore; pass explicit context where the script needs one. |
| `packages/core/src/test-utils/runtime.ts` | peeks/saves/restores ambient context in helpers | Update to the explicit-only API (test utility; no ambient). |
| `scripts/check-settings-boundary.ts` | asserts core re-exports `./runtime/settingsRuntimeAdapter.js` and the single-owner bridge | Update the checks to the new contract (adapter file still exists with `createRuntimeSettingsService`; if any check specifically enumerates deleted helpers, update it; the single-owner rule itself stays). |

`runtimeAccessors.ts` and `runtimeSettings.ts` themselves are NOT deleted in
this PR (later PR deletes them with their last caller); only their imports of
the deleted core helpers are migrated.

## Explicitly out of scope for this PR (later PRs in the lane)

- `runtimeRegistry` Map, `defaultCliRuntimeId` write-once pointer,
  `resolveActiveRuntimeIdentity`, the `runtimeScope` ALS identity mechanism,
  `runtimeAccessors.ts`/`runtimeSettings.ts` barrels, `registerCliProviderInfrastructure`.
- `providerManagerInstance.ts` singletons, `oauth-provider-registration.ts` WeakMap.
- `agentRuntimeFactoryBindings` registration seam (owned by #3222), `sharedTokenStore`,
  `activationBindings`, `runtimeCounter`.
- `AgentRuntimeState.ts` global registries (candidate PR B).
- Agents `internalConfigAccess`/`activationPreflightState` WeakMaps, CLI
  `RuntimeContext.tsx` `latestBridge`, MCP `hostServices` callbacks.
- The full AST/lint negative-control suite for all prohibited shapes (this PR
  ships only the banned-symbol scan for the helpers it deletes).
- No Config decomposition (#2615), no agents-owned assembly changes (#3222).

## Prohibited in this PR

- Any new module-level mutable state.
- Any new ALS scope (the existing instance-owned `BaseProvider.activeCallContext`
  ALS stays as documented call scoping).
- Any bundle type (RuntimeServices/RuntimeHandle/CliRuntimeServices-style), any
  keyed services bag, any ambient delegation wrapper, any re-export shim for a
  deleted symbol, any backward-compatibility alias.

## Tests (Bun, behavioral, per dev-docs/RULES.md)

Characterization first (committed before the migration, staying green across
it where the behavior is preserved):

1. Rewrite `packages/core/src/runtime/providerRuntimeContext.test.ts`:
   explicit `createProviderRuntimeContext` works with an injected settings
   state; throws `MissingRuntimeProviderError` without one; importing the
   module registers no factory and mutates nothing.
2. Rewrite `packages/core/src/runtime/settingsRuntimeAdapter.test.ts` (and
   `packages/core/src/__tests__/settings-integration/adapter-integration.test.ts`
   as needed): `createRuntimeSettingsService` constructs isolated services;
   none of the deleted helper names exist on the module (compile-time proof).
3. Delete `packages/settings/src/__tests__/settingsServiceInstance.test.ts`
   with the singleton (its "throws when unregistered" cases are the deletion
   proof — replaced by the import-absence scan in item 8).
4. Migrate `packages/providers/src/openai/openai-oauth.spec.ts` off
   `setActiveProviderRuntimeContext`/`clearActiveProviderRuntimeContext`:
   construct the context explicitly and pass it where the flow needs it.
5. `packages/providers/src/runtime/runtimeRegistry.spec.ts` and
   `runtimeLifecycle.spec.ts`: keep passing (reset helpers lose the ambient
   clear; no behavior assertions should depend on the module pointer — if any
   do, rewrite them against the registry entry, which is the surviving owner).
6. New: concurrent call-scoping test — two overlapping
   `generateChatCompletion` calls on one BaseProvider instance with different
   explicit settings each observe their own settings throughout (instance ALS
   provides the isolation; the deleted module pointer made this racy).
7. New: formerly-ambient consumer runs outside any ALS scope with explicit
   inputs and succeeds with no fallback (e.g. the prompts settings resolution
   via `getCoreSystemPromptAsync({..., settings})` and
   `getHigherPriorityAuth` with an explicit settings reader).
8. New: banned-symbol scan test (runs in CI via `bun test`): assert none of
   the deleted symbols appear in `packages/*/src` production files
   (excluding `*.test.*`/`*.spec.*`), mirroring the issue's rg patterns for
   this cluster: `peekActiveProviderRuntimeContext|setActiveProviderRuntimeContext|clearActiveProviderRuntimeContext|getActiveProviderRuntimeContext|createSettingsProviderRuntimeContext|setSettingsProviderRuntimeContext|clearSettingsProviderRuntimeContext|resolveRuntimeSettingsService|getRuntimeSettingsService|maybeGetRuntimeSettingsService|activateSettingsRuntimeContext|deactivateSettingsRuntimeContext|registerSettingsService|resetSettingsService|setProviderRuntimeStateFactory`.
   The checker function is exported and unit-tested against a synthetic
   violation so the control proves it can fail. Place it near the existing
   guard/test scripts conventions (e.g. `packages/core/src/runtime/` or
   `scripts/tests/` — follow where similar source-shape tests live today).
9. Existing suites that must stay green: providers runtime specs
   (runtimeRegistry, runtimeLifecycle, runtimeAccessors, statelessHardening,
   isolatedRuntimeDefaultPointer.behavior), BaseProvider suites, ProviderManager
   suites, agents fromConfig/createAgent/providerActivation behavior tests, cli
   config parity tests, zed-acp cleanup tests, auth authRuntimeScope test. The
   #2300 invariant (background runtime never becomes foreground default) must
   stay green — `isolatedRuntimeDefaultPointer.behavior.test.ts` is the anchor.

## Verification

Full cycle per the issue-workflow skill (run before commit, before push, and
after every remediation):

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"
```

(Note: the issue text says "StepFun smoke"; StepFun was cancelled 2026-09-13 —
the current recorded smoke profile is zai-glm-flash per .llxprt/LLXPRT.md.)

## Landing discipline reminders (binding)

- The superseded path is removed in this same PR; no shim, alias, delegation
  wrapper, or re-export of deleted symbols.
- Every migrated consumer is in this PR; the PR diff shows the count
  arithmetic (call sites enumerated before = migrated + deleted).
- No test is deleted except the singleton's own spec, which is replaced by the
  import-absence scan; rewritten tests keep their behavioral assertions.
