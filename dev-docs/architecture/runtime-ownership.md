# Runtime ownership: tools, activation, provider state, settings

Status: durable reference for contributors. Introduced by the issue #2534
collapse, which removed the legacy tool base family, the dual
agent-activation path, redundant settings shapes, and multi-owner
provider/model/auth state.

Each section names the single authoritative owner of one runtime domain, the
mutation paths that may write it, and the boundaries that intentionally
remain. If you are adding a read or write in one of these domains, route it
through the named owner. Adding a second owner, a fallback read chain, or a
coordinated multi-store write reintroduces the duplication this document
exists to prevent.

## Tool invocation API

Owner: `BaseDeclarativeTool` + `BaseToolInvocation` in
`packages/tools/src/tools/tools.ts`. Every production tool subclasses
`BaseDeclarativeTool` and implements `createInvocation(params, messageBus)`;
execution logic lives in a `BaseToolInvocation` subclass whose constructor
receives `(host, params, messageBus)` (reference: `ReadFileTool` /
`ReadFileToolInvocation` in `packages/tools/src/tools/read-file.ts`).

- `BaseTool`, `BaseToolLegacyInvocation`, and `validateToolParamsLegacy` are
  deleted. There is no tool-level `execute` API.
- Session context (sessionId, agentId, interactiveMode) reaches invocations
  through the `ContextAwareTool` contract (`packages/tools/src/types/tool-context.ts`):
  `ToolRegistry.getTool(name, context)` assigns `tool.context`, and the tool
  passes it into its invocation constructor in `createInvocation()`.
- `DiscoveredTool` (MCP) extends `BaseDeclarativeTool` and keeps its own
  `build()` override that skips schema validation for discovered tools whose
  extracted schema defaults to `{}`.
- Build-boundary parameter validation: JSON schema via the declarative base
  plus the `validateToolParamValues` / `validateToolParams` hooks. TodoWrite
  keeps its normalization/Zod re-validation inside the invocation (raw
  arguments may legitimately contain IDs/statuses that normalization repairs).

## Agent/provider activation

Owner: `ProviderActivationIntent` → `executeProviderActivation`
(`packages/agents/src/api/providerActivationExecutor.ts`). This is the only
activation transition. Interactive, headless, subagent, and test construction
all route through it.

- `createAgent` (`packages/agents/src/api/createAgent.ts`): when
  `AgentConfig.activation` is absent it synthesizes an intent from the legacy
  fields (`provider`, `model` with placeholder filtering, `auth.apiKey` →
  `cliOverrides.key`, `auth.baseUrl` → `cliOverrides.baseurl`, derived
  authMethod, `providerSwitchPolicy: 'best-effort'` to keep unregistered
  providers non-fatal) and executes it through the same call as explicit
  intents. `applyActivationOrLegacy` / `applyInitialProviderModelAuth` are
  deleted.
- `fromConfig` keeps one branch that is auth-client CONSTRUCTION, not
  activation: when no intent exists and no post-auth client is configured it
  calls `config.refreshAuth(undefined)`. It mutates no provider/model/auth
  state.
- Subagents activate through the same executor
  (`packages/agents/src/core/subagentOrchestrator.ts`) plus
  `applyProfileWithGuards`.

## Provider/model/auth session state

Owner: `SettingsService` (`@vybestack/llxprt-code-settings`). ProviderManager
is a runtime cache; Config is a projection. Neither persists independent
copies.

- Active provider: the settings global key `activeProvider` is the only
  store. `Config.getProvider()`/`setProvider()` delegate to it. The switch
  cascade (`switchActiveProvider` in
  `packages/providers/src/runtime/providerSwitch.ts`) performs one store
  write plus one ProviderManager cache set; the legacy root
  `settings.activeProvider` field and the duplicate writes are deleted.
- Active model: `providers[<provider>].model` in settings is the only store.
  `Config.setModel()` (`packages/core/src/config/config.ts`) is the single
  transition: one provider-scoped store write, `contentGeneratorConfig.model`
  maintained as a derived projection in the same transition, and an
  unconditional `ModelChanged` event. `setActiveModel`
  (`packages/providers/src/runtime/providerMutations.ts`) is one call to it;
  leaving-model alias-default restoration (#3255) happens inside the same
  transition via `recomputeAndApplyModelDefaultsDiff`, which reads the
  previous model from the store.
- Reads: `resolveActiveProviderName()`
  (`packages/providers/src/runtime/runtimeAccessors.ts`) is the single
  provider resolution (settings store first, ProviderManager cache as a
  best-effort fallback for degraded-manager status paths). All model reads
  and profile/diagnostics snapshot builders reuse it.
- Auth overrides: two scopes of one store by design — the provider-scoped
  setting (persisted) and the global ephemeral override (CLI `--key` /
  `--baseurl` session override). Mutations go through
  `applyCliArgumentOverrides` → `resolveFromKeyArg` /
  `updateActiveProviderBaseUrl`; inline cascade copies are removed.
- Profile application: `applyProfileWithGuards`
  (`packages/providers/src/runtime/profileApplication.ts`) is atomic. It
  snapshots full settings state (`SettingsService.exportForStateSnapshot()`)
  before the cascade and restores it (`restoreFromStateSnapshot()`) on
  mid-cascade failure before rethrowing the original error. ProviderManager
  runtime caches are not snapshotted; they refresh on next access.

## Settings contract shape

Owner: the `@vybestack/llxprt-code-settings` package's `SettingsService`
type (the concrete class is the contract; no parallel interface).

- `CoreSettingsServiceAdapter`, the tools-owned `ISettingsService`, and
  `IToolRegistryHost.getSettingsService?()` are deleted. Consumers inject
  `config.getSettingsService()` or a `Pick<SettingsService, ...>` of it.
- The tools package (which does not depend on the settings package) keeps
  one structural mirror, `SettingsServiceBoundary`
  (`packages/tools/src/interfaces/SettingsServiceBoundary.ts`), whose comment
  names the settings package as owner. It is the only mirror.
- The auth package's `ISettingsService`
  (`packages/auth/src/interfaces/settings-service.ts`) is an intentional
  zero-dependency structural subset used for DI; it is not a second owner.
- `packages/core/src/runtime/settingsRuntimeAdapter.ts`
  (`resolveRuntimeSettingsService`) is the sanctioned single-owner bridge for
  runtime context assembly.

## Tool-name canonicalization

Owner: `packages/tools/src/formatters/toolNameUtils.ts`
(`normalizeToolName`, `canonicalizeToolName`, `canonicalizePolicyToolEntry`,
`isValidToolName`, `findMatchingTool`). Registry, policy wiring, subagents,
commands, and the CLI UI import from the tools package boundary (e.g. the
`toolGovernance` re-export in agents).

Retained by classification, each with one owner and a stated reason:

- `packages/providers/src/utils/toolNameNormalization.ts` — the Kimi family
  normalizer (different algorithm: trims the `functions` prefix and strips
  trailing digits). Consumers: OpenAI response parsing/streaming handlers.
- `ToolCallNormalizer`'s private variant (`packages/providers/src/openai/ToolCallNormalizer.ts`)
  — classified a distinct algorithm, not a duplicate: tested behavior differs
  from the Kimi owner on suffixless `functionslist_directory` and
  underscore-delimited numeric suffixes (evidence on issue #2534).
  Unification requires a behavior decision, not a refactor.
- `packages/policy/src/config.ts` — documented zero-dependency copy with a
  drift test (`packages/core/src/policy/toolEntryDecoderDrift.test.ts`).
- `packages/tools/src/formatters/toolIdNormalization.ts` — documented
  zero-dependency ID copy.
