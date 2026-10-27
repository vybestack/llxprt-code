# Runtime ownership

This document describes the ownership boundaries after the #2616 and #3841
runtime migration. The application host supplies credentials and host
capabilities. Agent composition creates or adopts the session resources, and
consumers receive the operations they need through explicit inputs.

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

## Creation and adoption

`createAgent` in `packages/agents/src/api/createAgent.ts` delegates construction
to `PreferredAgentAssembly`. That assembly creates a `SettingsService`, optionally
restores a captured settings snapshot, and binds it to a `SessionSettingsOwner`.
The settings owner manages selected provider and model state and telemetry
bindings. `Config` contains configuration data; it does not locate settings,
provider, credential, policy or tool services for consumers.

The host creates and supplies a `CredentialAuthority`. Agent assembly acquires
provider-key and token-store leases from that authority. It constructs the
`ProviderManager` and OAuth manager using those leases and explicit settings,
network, profile and authentication inputs. Providers come from the configured
contribution registry. They are not selected through a process-wide runtime
registry or singleton manager.

CLI startup uses `AgentProfilePreflight` in
`packages/agents/src/api/profile-preflight.ts`. Preflight accepts host inputs and
credentials, creates settings when none are supplied, and acquires the provider
and authentication resources needed before the final agent exists. Successful
activation transfers its owned resources to foreground assembly. A failed or
abandoned preflight releases its resources instead of publishing them.

`fromConfig` in `packages/agents/src/api/fromConfig.ts` is the adoption entrypoint.
Its caller supplies a `Config`, `SettingsService`, adoption intent and
`CredentialAuthority` explicitly. `AdoptedAgentAssembly` creates its own settings
selection owner and provider/authentication resources around those inputs. A
borrowed configuration or settings store does not become a process-global
service locator.

## Consumer ports

Composition sites retain concrete owners so they can release resources. They
project narrower, typed ports for other components. A tool that reads settings
receives the needed settings reads; an authentication resolver receives its
settings and credential operations; a scheduler receives policy, confirmation
and execution operations. None of these consumers receives a whole-runtime bag
as a shortcut to unrelated services.

The public `Agent` facade exposes conversation, profile, model and session
operations. CLI consumers use those operations or individually injected ports.
`InteractiveContextHost` supplies operation-specific React providers from
`ui/contexts/RuntimeContext.tsx`; the UI stores contain display projections,
not ownership of providers or credentials. Headless consumers use the same agent
assembly without mounting interactive stores.

A component outside composition must not construct another settings store to
replace a missing dependency. Its construction input should require the specific
settings port. The pure `createRuntimeSettingsService` helper in
`packages/core/src/runtime/settingsRuntimeAdapter.ts` remains available to
composition sites that need to create a store. It does not resolve an ambient
store or discover one through `Config`.

## Provider, model and profile changes

CLI `activateConfiguredProvider` in `packages/cli/src/cliProviderInit.ts` builds
an activation intent and submits it to the supplied preflight operation. The
intent includes explicit CLI model selection, merged profile/CLI model parameters
and credential overrides. Agent activation owns admission and provider changes.
The placeholder config model is not an instruction to install a real model.

After publication, consumers call the supplied agent's model and profile
operations. Internal provider switching, parameter admission and profile
application are implemented under `packages/agents/src/api/`. The removed
providers `runtime/*` orchestration exports are not an alternate public entrypoint.
Provider implementations and shared provider data remain in the providers package.

## Settings state and reads

`SettingsService` is the low-level settings store. `SessionSettingsOwner` owns
session selection and binds that state to the configuration read model. Narrow
settings contracts such as `SettingsServiceBoundary` in tools and
`ISettingsService` in auth describe only what those consumers use.

Streaming enablement and context-limit values are admitted at mutation
boundaries. Reads must not normalize values by writing them back into the store.
Equivalent writes should not emit another settings-change event. The owner that
performs a change is responsible for publishing the corresponding state update.

## Policy and lifecycle

Workspace and session policy owners construct the policy engine, confirmation
bus and trust bindings. Callers receive policy inspection, decision or
confirmation operations according to their responsibility. Configuration carries
policy inputs rather than returning live policy services.

Every acquisition has an owning release path. Foreground transfer, adopted
resources and child scopes must preserve which resources are owned and which are
borrowed. Published facade closures are created outside assembly class scopes so
the facade does not retain construction-only state.

## Enforcement

`npm run check:runtime-boundary` checks production compiler programs for service
bags, configuration service locators, assembly closures, retired ambient exports,
and mutable runtime state. State roots are derived from runtime, api and settings
directories plus explicit UI context files. ALS scanning covers the package source
roots derived from those state roots. It does not currently cover A2A's HTTP
request transport storage; see `packages/a2a-server/src/http/requestStorage.ts`.

Scanner tests use small fixtures to verify these rules. CI runs the production
analysis command independently of those fixtures. Compiler errors or scanner
findings fail the command; no tolerated-finding baseline applies.

## Tool-name canonicalization

Owner: `packages/tools/src/formatters/toolNameUtils.ts`
(`normalizeToolName`, `canonicalizeToolName`, `canonicalizePolicyToolEntry`,
`isValidToolName`, `findMatchingTool`). Registry, policy wiring, subagents,
commands, and the CLI UI import from the tools package boundary (e.g. the
`toolGovernance` re-export in agents).

Retained by classification, each with one owner and a stated reason:

- `packages/providers/src/utils/toolNameNormalization.ts`: the Kimi family
  normalizer (different algorithm: trims the `functions` prefix and strips
  trailing digits). Consumers: OpenAI response parsing/streaming handlers.
- `ToolCallNormalizer`'s private variant (`packages/providers/src/openai/ToolCallNormalizer.ts`)
  : classified a distinct algorithm, not a duplicate: tested behavior differs
  from the Kimi owner on suffixless `functionslist_directory` and
  underscore-delimited numeric suffixes (evidence on issue #2534).
  Unification requires a behavior decision, not a refactor.
- `packages/policy/src/config.ts`: documented zero-dependency copy with a
  drift test (`packages/core/src/policy/toolEntryDecoderDrift.test.ts`).
- `packages/tools/src/formatters/toolIdNormalization.ts`: documented
  zero-dependency ID copy.
