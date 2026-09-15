# Plan: Collapse duplicate tool, activation, settings, and provider-state runtime paths

Plan ID: PLAN-20260914-ISSUE2534
Issue: #2534 (Code Quality / Modularization, milestone 0.12.0)
Generated: 2026-09-14
Branch: issue2534

## Objective

Each domain below gets exactly one authoritative implementation and owner. Whole
duplicate paths are deleted, not renamed. External provider/protocol adapters
and intentional package boundaries survive unchanged. No `as unknown as`, no
dynamic probes, no new adapters.

## Shaped acceptance criteria (behavior to deliver)

### Domain A — Tool API: one declarative invocation API

- **A1** TodoRead, TodoWrite, TodoPause become `BaseDeclarativeTool` subclasses
  with dedicated `BaseToolInvocation` subclasses (pattern: ReadFileTool/
  ReadFileToolInvocation in `packages/tools/src/tools/read-file.ts`).
  - Context threading: each converted tool keeps `context?: ToolContext` and
    `implements ContextAwareTool` (existing contract in
    `packages/tools/src/types/tool-context.ts`, already injected by
    `ToolRegistry.getTool(name, context)` at `tool-registry.ts:926-928`) and
    passes `this.context` into its invocation constructor in
    `createInvocation()`. No registry contract change, no new abstraction.
  - GIVEN a session with todos, WHEN todo_write executes via the scheduler,
    THEN behavior is byte-equivalent: emoji filtering, todoEvents emission,
    reminder text, tracker updates, pause semantics, 500-char reason cap
    (#2287), build-boundary params validation (#3655).
- **A2** `DiscoveredTool` (tool-registry.ts:80) extends `BaseDeclarativeTool`.
  It already overrides `build()` with its own `DiscoveredToolInvocation`; the
  base swap must not introduce schema validation regressions for discovered
  tools whose extracted schema defaults to `{}` (an empty schema validates any
  params; verify with the existing discovered-tool tests).
- **A3** `BaseTool`, `BaseToolLegacyInvocation`, and the dead
  `validateToolParamsLegacy` member are DELETED from
  `packages/tools/src/tools/tools.ts`, along with their exports in
  `packages/tools/src/index.ts` and the `packages/core/src/index.ts` re-export.
  All internal consumers are converted first, so the export is deleted outright
  (no deprecated stub — acceptance: "otherwise delete it").
- **A4** Test-only `BaseTool` subclasses migrate to `BaseDeclarativeTool`:
  `packages/agents/src/core/subagentNonInteractive.issue3535.test.ts`,
  `packages/agents/src/core/subagent-tool-processing-test-helpers.ts`,
  `packages/cli/src/coreToolToggle.test.ts` (fake DiscoveredTool),
  `packages/agents/src/api/__tests__/toolProjection.behavior.test.ts` (type ref).
- **A5** TodoPause's `new String(...) as string & {message}` hack and
  TodoWrite's manual `validateToolParams` are removed; declarative schema
  validation covers them. Boundary-guard tests
  (export-surface, package-boundary, forbidden-imports, public-surface) are
  updated in the same change set.
- **Prove with**: `packages/tools/src/__tests__/todo-tools.test.ts`,
  `todo-emoji-filter.test.ts`, `todo-write-params-validation.test.ts`,
  `todo-write-tracker.behavior.test.ts`, `neutral-types.test.ts`,
  `wire-types.test-d.ts`, `registry-contract.test.ts`,
  `tool-registry-mcp-lazy.test.ts`,
  `discovered-tool-bounded-acquisition.test.ts`, agents pause/continuation
  tests, `cli/coreToolToggle.test.ts`.

### Domain B — Agent/provider activation: one transition

- **B1** `applyActivationOrLegacy` (createAgent.ts:521) loses the legacy
  branch; `applyInitialProviderModelAuth` (createAgent.ts:587) is deleted.
  When `AgentConfig.activation` is absent, createAgent SYNTHESIZES a
  `ProviderActivationIntent` from the legacy fields and executes it via
  `executeProviderActivation`:
  - `provider` → `intent.provider` (preserving UNCONFIGURED_PROVIDER handling —
    trace what createAgent/config does with it today and keep the unconfigured
    case non-fatal)
  - `model` → `intent.model` (PLACEHOLDER_MODEL must remain filtered: the
    executor already skips placeholder/empty models in applyModelAndParams;
    verify parity with the legacy `parsed.model !== activeModel` guard)
  - `auth.apiKey` → `intent.cliOverrides.key` (persistence-equivalent:
    `applyCliArgumentOverrides` → `resolveFromKeyArg` →
    `updateActiveProviderApiKey`, same provider-scoped write as legacy)
  - `auth.baseUrl` → `intent.cliOverrides.baseurl` (same
    `updateActiveProviderBaseUrl` path as legacy)
  - `auth.authMethod` → carried through so the executor's `refreshAuth` call
    uses it (legacy called `config.refreshAuth(resolvedAuth.authMethod)`; the
    executor calls `refreshAuth()`/`refreshAuth('provider'|'oauth')`. Add the
    minimal passthrough needed on the intent/executor to preserve behavior.)
- **B2** GIVEN a2a-server constructs an agent with `LLXPRT_DEFAULT_PROVIDER`
  set (or unset → UNCONFIGURED_PROVIDER) and no auth fields, WHEN the agent is
  created, THEN activation outcome is equivalent to today: provider switched
  when different, model applied, auth client created, no fatal error in the
  unconfigured case. Proven by new/updated behavior tests covering the
  synthesized-intent path in `packages/agents/src/api/__tests__/`
  (providerActivation.behavior.test.ts pattern) plus the a2a-server tests.
- **B3** fromConfig keeps exactly one activation path: intent (or preflight
  token) → executor. The remaining no-activation `else if
  (!hasPostAuthClient(config)) refreshAuth(undefined)` branch in
  `resolveActivation` (fromConfig.ts:237) is auth-CLIENT CONSTRUCTION, not
  provider activation (no provider/model/auth mutation) — it stays and is
  documented as such, or is folded into the executor if behavior-equivalent;
  implementer's choice must be justified in the PR body and docs.
- **B4** Subagent path already routes through `executeProviderActivation` /
  `applyProfileWithGuards` (subagentOrchestrator.ts:805-895) — verify no
  regression, no change required unless the state-owner work (Domain C) moves
  its seams.
- **Prove with**: `providerActivation.behavior.test.ts`,
  `preflightAgentActivation.behavior.test.ts`,
  `activationPreflightState.behavior.test.ts`, `fromConfig.behavior.test.ts`,
  `mutationCoverage.*`, `cliBootstrap.providerActivation.test.ts`,
  `cli.provider-init.test.ts`, a2a-server tests, noninteractive tests.

### Domain C — Provider/model/auth state: one owner, one projection

Authoritative owner: **SettingsService** (already the de-facto owner; ProviderManager
and Config become readers/caches, never independent persistence).

- **C1 activeProvider — one store**: `settingsService` global key
  `'activeProvider'`. Delete the redundant stores:
  - `Config.provider` field (configBaseCore.ts:780-785) becomes a delegated
    projection (getProvider() reads settings, setProvider() writes settings) —
    no independent field.
  - Legacy root `settings.activeProvider` write in
    `SettingsService.importFromProfile` (SettingsService.ts:531) is removed.
  - `providerSwitch.activateProviderContext` (providerSwitch.ts:326-337) four
    redundant writes collapse to ONE settings write + ProviderManager runtime
    cache set (cache is not persistence).
- **C2 active model — one store + derived projection**: `providers[P].model`.
  - `Config.setModel` (config.ts:380-398) becomes a single transition: one
    provider-scoped write; `contentGeneratorConfig.model` is maintained as a
    derived projection inside the same transition; the duplicate re-write in
    `providerMutations.setActiveModel` (5 writes → 1 logical write) and
    `providerSwitch.applyModelSettings` double-write are removed.
  - `Config.getModel` reads the store via the unified resolution (below); the
    legacy `contentGeneratorConfig.model` → `this.model` fallback chain is
    removed once the transition maintains the projection. Constructor paths
    that seed a model must land in the store (same transition).
  - REMEDIATION NOTE (post full-suite run): the constructor store-seeding
    covers Configs constructed with a provider; providerless/bootstrap Configs
    (no activeProvider) keep `protected model` as a TERMINAL read fallback
    (store → contentGeneratorConfig.model projection → constructor fallback),
    with exactly main's four write points (constructor/setModel/
    resetModelToDefault). This is not a second store: reads prefer the store
    and projection; the field exists because flashFallback and session-isolation
    behavior depend on a providerless Config returning its constructed model.
- **C3 ONE provider/model read resolution**: unify
  `runtimeAccessors._internal.resolveActiveProviderName` (config-first chain)
  vs `getActiveProviderName` (manager-first chain) into one exported
  resolution used by all callers; `getActiveModelName`'s effective 5-hop chain
  collapses to the unified read of the store with provider default fallback
  only. `buildRuntimeProfileSnapshot` and `getActiveProviderStatus` reuse the
  same resolution.
- **C4 auth key / base URL / toolFormat**: the provider-scoped setting +
  global ephemeral override are TWO SCOPES OF ONE STORE (SettingsService) and
  implement override precedence — that design is functionality (CLI --key,
  profiles), NOT duplication; keep it. Remove only duplicated inline cascade
  copies: `providerSwitch.applyProviderBaseUrlSettings` duplication vs
  `updateActiveProviderBaseUrl`, and profileApplication's redundant second
  base-url write when the preserve-across-switch semantics don't require it.
- **C5 Profile application is atomic**: `applyProfileWithGuards`
  (profileApplication.ts:806) wraps its cascade in snapshot→apply→rollback-on-
  error using a full SettingsService state snapshot (e.g. exportForProfile or
  an internal equivalent) so a mid-cascade failure restores pre-application
  state. Existing fail-fast guards (named-key preflight #2916, unknown-provider
  #2479) and preserved invariants (never-empty emission #1770, preserve-lists
  #1049, previous-provider wipe #2626) are retained and proven by the existing
  providerSwitch/profileApplication/profileSnapshot specs.
- **C6 No multi-owner probing**: `runtimeAccessors.ts:135`
  (`entry.settingsService ?? config.getSettingsService()`) legacy fallback and
  `runtimeContextFactory.ts:528-532` double-resolution collapse to the single
  runtime-registry resolution path.
- **Prove with**: `providerMutations.spec.ts`, `providerSwitch.spec.ts`,
  `runtimeAccessors.spec.ts`, `profileApplication.spec.ts`,
  `profileSnapshot.test.ts`, `profile-persistence.issue3255.test.ts`,
  `assembleCliProviderRuntime*.test.ts`, runtime lifecycle/registry specs,
  model switching/history tests, OAuth + load-balancer + bucket tests,
  `fromConfig.behavior.test.ts` tokenizer/readiness section.

### Domain D — Settings bridge: one contract shape

- **D1** DELETE `CoreSettingsServiceAdapter` (core/src/tools-adapters/
  CoreSettingsServiceAdapter.ts) and tools `ISettingsService`
  (packages/tools/src/interfaces/ISettingsService.ts, Shape B — an expired
  placeholder: the settings package it was waiting for exists).
  `toolRegistryFactory.ts:368/415/433` injects `config.getSettingsService()`
  (or a `Pick<SettingsService, 'get' | 'set'>`) directly into MemoryTool and
  CodeSearchTool; their dependency types change to that shape;
  `codesearch.ts:352-361` nested `getSettingsService().get?.()` chain is
  removed. Update `interface-contracts.test.ts` ISettingsService block and
  the codesearch/memoryTool test doubles.
- **D2** DELETE `IToolRegistryHost.getSettingsService?()` (Shape D) +
  `CoreToolRegistryHostAdapter.getSettingsService()`/`SettingsServiceBoundary`;
  `tool-registry.ts:767` receives the narrow settings read it needs for
  schema transforms through a required injected dependency instead of an
  optional nested probe.
- **D3** RETAIN (intentional boundaries, documented): the
  `@vybestack/llxprt-code-settings` package barrel (Shape A), auth
  `ISettingsService` (Shape C — strict structural subset, zero-dep DI
  boundary), `core/src/runtime/settingsRuntimeAdapter.ts` single-owner bridge,
  and the CLI UI read-model facade (narrowed to value getters where trivial).
- **D4** Collapse ad-hoc structural variants onto the real type:
  `turnCitations.ts:20` ConfigWithSettings, `taskAsyncExecution.ts:92`
  typeof-probes, `nonInteractiveCli.ts:101` Omit-cast, `postConfigRuntime.ts:195`
  ??-probe+cast. No behavior change; type-level only.
- **D5** `toolsCommand.ts` `read()` fallback chain and `persistToolLists()`
  dual write (settings.set + config.setEphemeralSetting for the same keys —
  config ephemerals ARE settings global keys, so it writes global twice)
  collapse to single reads/writes.
- **D6** `config.ts setModel` multi-store write — resolved by C2.
- **Boundary enforcement**: `scripts/check-settings-boundary.ts` must stay
  green (it is green on baseline; headlessFactory/discovery construction sites
  are currently tolerated — leave their status unchanged unless trivially
  routable, and say which in the PR).
- **Prove with**: settings package tests, `settingsRuntimeAdapter.test.ts`,
  `adapter-integration.test.ts`, auth interface-compat tests, updated
  interface-contracts/codesearch/memoryTool tests, tool-registry tests,
  toolsCommand tests.

### Domain E — Tool canonicalization shared everywhere

- **E1** Collapse the true algorithmic duplicate:
  `providers/src/openai/ToolCallNormalizer.ts:99-115` private Kimi-prefix
  normalizer → delegate to `providers/src/utils/toolNameNormalization.ts`
  (the Kimi family owner).
- **E2** Remove name-shadowing wrappers: `cli/src/ui/commands/toolsCommand.ts:35`
  local `normalizeToolName` (call `canonicalizeToolName` directly);
  `providers/src/openai/ToolNameValidator.ts:108-110` private shadow wrapper.
- **E3** `agents/src/core/turn.ts` dual import (deep-path `normalizeToolName`
  + boundary `canonicalizeToolName`) consolidates on the package boundary
  (`agents/src/core/toolGovernance.ts` re-export or the public tools barrel —
  no new deep imports).
- **E4** RETAIN (classified, documented): `policy/src/config.ts` zero-dep
  duplicate (drift-tested boundary copy, removal condition documented),
  Kimi family itself (different algorithm, one owner), toolIdNormalization
  (documented zero-dep ID copy), `generate-image/index.ts` facade (public
  entrypoint), agents `toolGovernance.ts` re-export (package boundary).
- **Prove with**: `toolNameNormalization.test.ts`, `toolGovernance.test.ts`,
  `toolEntryDecoderDrift.test.ts`, `coreSubagentServiceHelpers.test.ts`, new
  ToolCallNormalizer tests.

### Cross-cutting

- **X1** Architecture docs name each owner/mutation path. Add a section to
  `dev-docs/architecture/` (new `runtime-ownership.md`) naming: tool invocation
  API owner (BaseDeclarativeTool/BaseToolInvocation), activation transition
  owner (ProviderActivationIntent → executeProviderActivation), provider/model/
  auth state owner (SettingsService + transitions) and its persistence
  projection, settings contract owner (settings package Shape A + auth subset),
  canonicalization owner (tools/formatters/toolNameUtils.ts + Kimi owner).
- **X2** PR body reports removed files/symbols and before/after call/
  dependency flow per domain.
- **X3** External adapters (provider, MCP, IDE, A2A, headless, package
  adapters) and capabilities (profiles, model switching/history, OAuth,
  buckets, load balancing, tools, policy, subagents, noninteractive) retain
  functionality — proven by the focused suites listed per domain.

## Out of scope (explicitly)

- The naming issue's deeper canonicalization work beyond E1-E4 (coordinate,
  don't preempt).
- `policy/src/config.ts` duplicate removal (documented boundary with removal
  condition; drift test enforces).
- Kimi-vs-snake algorithm unification (different algorithms by design).
- `toolIdNormalization` zero-dep copy.
- Any new adapter, `as unknown as`, dynamic probe, or new public abstraction.
- Zed-on-Agent-API migration (separate issue, per executor header).

## Required method (per issue)

For each bridge: identify callers/exports/tests/exposure; classify as external
adapter / package boundary / persisted migration / internal residue / duplicate;
retain the first three unless replacement is proven; collapse/delete the latter
two.

## Verification

Full cycle (repo standard): `npm run test`, `npm run lint`, `npm run typecheck`,
`npm run format`, `npm run build`, smoke
`bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"`.
Focused suites per domain as listed. Long test runs: launch with `nohup ... &`
inside the command, poll with short sleeps, log under `tmp/verify2534/`
(gitignored; unique paths because sibling sessions share /tmp).

## Execution order

1. Phase 1: Domains A + E (tools package is self-contained; normalization
   collapse is small and independent).
2. Phase 2: Domain B (activation single path).
3. Phase 3: Domains C + D (state owner + settings shape; C2/D6 overlap).
4. Phase 4: X1 docs + X2 PR report, full verification cycle, review.
Each phase lands as commits on issue2534; each phase runs its focused suites;
the full cycle runs before push.

## Review policy

At most 2 review rounds (initial + one remediation). Findings classified
Blocker-Fix / In-scope-Fix / Reject / Defer. OCR only if re-enabled by Andrew
(currently disabled). Do not merge — Andrew merges.
