# Implementation Plan

## Overview

This plan decomposes `packages/core/src/config/config.ts` (~3,061 lines) into focused modules
while addressing the root cause: Config is a runtime state/service-locator god object, not
just an oversized file. The decomposition separates **what the config values are** from
**what services the config creates** from **what state mutates at runtime**.

Each phase is independently shippable and maintains backward compatibility via re-exports.

## Target File Structure

After all phases:

```
packages/core/src/config/
  config.ts              (~900 lines) Config class: constructor, getters, mutators, lazy accessors,
                                      refreshMemory, scheduler wiring, settings-backed getters
  configTypes.ts         (~350 lines) All interfaces, type aliases, enums
  configInterfaces.ts    (~300 lines) Consumer-facing DI interfaces (transitional)
  toolRegistryFactory.ts (~250 lines) createToolRegistry() and tool registration logic
  lspIntegration.ts      (~280 lines) LSP service lifecycle and MCP navigation tools
  configInitializer.ts   (~250 lines) initialize() orchestration (transitional hub, effectful)
  configBuilders.ts      (~120 lines) Pure builder functions (telemetry, file filtering, LSP)
  toolGovernance.ts      (~80 lines)  Shared tool policy primitives (normalization, constants)
  envResolver.ts         (~80 lines)  Centralized application env var documentation + reading
  constants.ts           (existing)   FileFilteringOptions defaults
  endpoints.ts           (existing)   Endpoint configuration
  index.ts               (existing)   Barrel exports (updated)
  models.ts              (existing)   Model constants
  profileManager.ts      (existing)   Profile management
  schedulerSingleton.ts  (existing)   Scheduler lifecycle
  storage.ts             (existing)   Storage abstraction
  subagentManager.ts     (existing)   Subagent management
  types.ts               (existing)   SubagentConfig type
```

**Note:** `config.ts` at ~900 lines is realistic — it retains the constructor (with
simplified builder calls), ~60 pure field accessors, ~10 derived getters, lazy-service
accessors, `initializeContentGeneratorConfig()` (~130 lines), `refreshMemory()`,
scheduler wiring, settings-backed getters with SettingsService precedence logic, and
mutators. Estimates throughout are approximate, not hard planning constraints. Quality
of separation is the primary goal, not line count.

**Out of scope for this plan:**
- `initializeContentGeneratorConfig()` extraction — this ~130 line method deeply couples
  GeminiClient lifecycle, auth refresh, model fallback, and history preservation. It warrants
  its own focused extraction (client configuration lifecycle) in a follow-up issue.
- `ConfigParameters` decomposition into grouped sub-objects — tracked as future work.
- Full constructor side-effect separation — Phase 6a extracts builder functions, but fully
  separating "state construction" from "effectful startup" is deferred.
- Ad hoc bootstrap metadata (`_bootstrapArgs`, `_cliModelOverride`, `_profileModelParams`,
  `_cliModelParams`)
  formalization — preserved and tested but not redesigned.
- One-shot CLI command flags (`listExtensions`, `experimentalZedIntegration`) removal from
  core ConfigParameters — these remain in core for compatibility; future work should
  move them to CLI-only bootstrap state.
- `refreshMemory()` extraction — this method branches on JIT context, talks to ContextManager,
  calls `loadServerHierarchicalMemory()`, emits events, and mutates memory state. It remains
  in `config.ts` as acknowledged mixed-responsibility code.
- Scheduler wiring (`getOrCreateScheduler`/`disposeScheduler`) extraction — remains in
  `config.ts` as runtime/session orchestration.

---

## Phase 1: Extract Type Definitions

**Goal:** Move all interfaces, type aliases, and enums out of config.ts into configTypes.ts.
Zero behavioral change. Pure mechanical extraction.

**Scope: ~350 lines moved.**

### Files Created

**`configTypes.ts`** containing:
- `RedactionConfig` interface
- `AccessibilitySettings`, `BugCommandSettings`, `ChatCompressionSettings`,
  `SummarizeToolOutputSettings`, `ComplexityAnalyzerSettings` interfaces
- `OutputSettings`, `CodebaseInvestigatorSettings`, `IntrospectionAgentSettings` interfaces
- `TelemetrySettings` interface (~30 lines)
- `GeminiCLIExtension`, `ExtensionInstallMetadata`, `ActiveExtension` interfaces
- `SandboxConfig` interface
- `FailoverContext`, `BucketFailoverHandler` interfaces (~52 lines)
- `ConfigParameters` interface (~107 lines)
- `ShellReplacementMode` type alias
- `ApprovalMode` enum
- `AuthProviderType` enum

### What Stays in config.ts

- `MCPServerConfig` class — this is a class with a constructor (readonly fields, no methods).
  It could be moved to `configTypes.ts` or a dedicated `mcpServerConfig.ts`, but since it
  uses `AuthProviderType` and `GeminiCLIExtension` from the same file and is widely imported,
  it moves alongside the types. **Decision: move `MCPServerConfig` to `configTypes.ts`** since
  its constructor is trivial (readonly field assignment only, no behavior).
- `normalizeShellReplacement()` function (moves to `configBuilders.ts` in Phase 6a)
- `DEFAULT_TRUNCATE_TOOL_OUTPUT_*` constants (coupled to class)
- The `Config` class itself

### Files Modified

**`config.ts`**:
- Add `import { ... } from './configTypes.js'` for all extracted types
- Remove inline type definitions
- Add re-exports: `export { ApprovalMode, AuthProviderType, MCPServerConfig } from './configTypes.js'`
- Add re-exports: `export type { RedactionConfig, ConfigParameters, ... } from './configTypes.js'`

**`index.ts`**:
- Add `export * from './configTypes.js'` (or selective re-exports matching current surface)
- Verify all existing import paths continue to work

### Pre-Step: Export Inventory

Before modifying any files, capture the current export surface:
```bash
grep '^export' packages/core/src/config/config.ts > /tmp/config-exports-before.txt
grep '^export' packages/core/src/config/index.ts >> /tmp/config-exports-before.txt
```
After the phase, verify exact parity.

### Verification

- `npm run typecheck` passes
- `npm run test` passes
- Export surface diff shows no removals
- All deep imports from `config.ts` continue to compile

---

## Phase 2: Define Composable Trait Interfaces (DI Foundation)

**Goal:** Define small, focused trait interfaces that describe narrow capability slices.
Config implements them. No callers change yet — this is the type-level foundation for
future narrowing. Traits only; broader composite interfaces are deferred until extraction
phases prove which composites are actually useful.

**Scope: New file, ~200 lines. Config class declaration change only.**

### Pre-Step: API Surface Alignment

Before defining interfaces, mechanically verify every proposed interface method against the
current `Config` class method surface. Where names differ (e.g., plan says `getSkillsSupport()`
but actual method is `isSkillsSupportEnabled()`), use the actual method name.

### Files Created

**`packages/core/src/config/configInterfaces.ts`** containing:
- **Composable trait interfaces only:**
  - WorkspacePathsConfig, FileFilteringConfig, ShellExecutionHostConfig,
    SandboxAwarenessConfig, DebugOutputConfig, SettingsReadConfig,
    SettingsMutationConfig, MemoryContextConfig, ToolOutputConfig
- See [INTERFACES.md](./INTERFACES.md) for the full design.

**Not defined in Phase 2:**
- Broad consumer-migration composites (e.g., `ToolHostConfig`, `RuntimeSessionConfig`,
  `ProviderHostConfig`) — these are deferred until real consumers or extraction phases
  prove them useful. Speculative broad interfaces risk creating a "god interface" layer.
- Extraction-facing interfaces (`ToolRegistryFactoryDeps`, `LspIntegrationDeps`,
  `ConfigInitializationDeps`) — introduced in their respective extraction phases (3, 4, 6b).

### Files Modified

**`config.ts`**:
- Add `implements WorkspacePathsConfig, FileFilteringConfig, ...` to class declaration
- Add getter wrappers for currently-public fields:
  - `getStorage(): Storage { return this.storage; }`
  - `getTruncateToolOutputThreshold(): number { return this.truncateToolOutputThreshold; }`
  - `getTruncateToolOutputLines(): number { return this.truncateToolOutputLines; }`
  - `isToolOutputTruncationEnabled(): boolean { return this.enableToolOutputTruncation; }`
- Existing public fields remain (backward compatibility)

### Consumer Composites — Deferred

Broad consumer composites like `ToolHostConfig`, `RuntimeSessionConfig`, and
`ProviderHostConfig` will be introduced only when:
1. An extraction phase needs a typed dependency beyond composable traits, or
2. A real consumer migration validates the composite boundary.

This avoids creating interfaces that are never adopted or that need immediate revision.

### Verification

- `npm run typecheck` passes (compiler validates trait conformance)
- Config satisfies all declared trait interfaces
- Existing public field access still works
- No runtime behavior change

---

## Phase 3: Extract Tool Registry Factory

**Goal:** Move `createToolRegistry()` (~190 lines) and all tool imports to a standalone factory.

**Scope: ~250 lines moved (190 method + 60 lines of tool imports).**

### Files Created

**`toolRegistryFactory.ts`** containing:
- All tool class imports currently at top of config.ts
- `ToolRegistryFactoryDeps` interface — purpose-built narrow interface derived from the
  actual method calls in the extracted code. Composes only the traits the factory actually
  needs. Defined here (not in Phase 2) because the exact dependency shape is known only
  at extraction time.
- `createToolRegistryFromConfig(deps: ToolRegistryFactoryDeps, messageBus: MessageBus): Promise<ToolRegistryResult>`
- `matchesToolIdentifier()`, `ensureCoreToolIncluded()`, `registerCoreTool()` helpers
- `ToolRegistryResult` type: `{ registry: ToolRegistry; potentialTools: PotentialToolRecord[] }`
  where `PotentialToolRecord` preserves registered/unregistered classification, reasons, ordering,
  and argument capture shape (settings UI depends on this shape)

### Files Modified

**`config.ts`**:
- Remove ~30 tool import lines from top of file
- Import `{ createToolRegistryFromConfig }` from `./toolRegistryFactory.js`
- Replace `createToolRegistry()` method body with delegation:
  ```typescript
  async createToolRegistry(messageBus: MessageBus): Promise<ToolRegistry> {
    const { registry, potentialTools } = await createToolRegistryFromConfig(this, messageBus);
    // IMPORTANT: push, not assign — current code accumulates across repeated calls.
    // This preserves existing behavior. Clearing is a separate intentional fix.
    this.allPotentialTools.push(...potentialTools);
    return registry;
  }
  ```

### Design Decisions

- `ToolRegistryFactoryDeps` composes only the traits it actually needs, not the full
  `ToolHostConfig`. The factory needs tool policy, workspace paths, and subagent/async
  infrastructure — a different slice than tools need at runtime.
- Closure capture: the factory must not snapshot lazy dependencies too early. Tool
  constructors that receive `config` continue to receive the full Config instance
  (narrowing tool constructor params is future work). The factory itself depends on
  the narrow `ToolRegistryFactoryDeps`.

### Verification

- `npm run typecheck` passes
- `npm run test` passes (especially `config.test.ts`, `config.scheduler.test.ts`)
- Tool registration behavior identical
- Tool registration order unchanged
- `allPotentialTools` content, reasons, and ordering unchanged
- Consumers of `getAllPotentialTools()` and `getToolRegistryInfo()` get identical results

---

## Phase 4: Extract LSP Integration

**Goal:** Move LSP service lifecycle and MCP navigation tool registration (~280 lines)
into a dedicated module.

**Scope: ~280 lines moved.**

### Files Created

**`lspIntegration.ts`** containing:
- `LspIntegrationDeps` interface — narrow purpose-built interface derived from the actual
  inline LSP code path. Defined here (not in Phase 2) because the exact dependency shape
  is known only at extraction time.
- `initializeLsp(deps: LspIntegrationDeps, lspConfig: LspConfig): Promise<LspState>`
- `registerMcpNavigationTools(toolRegistry: ToolRegistry, streams, deps: LspIntegrationDeps): Promise<LspMcpState>`
- `shutdownLsp(state: LspState): Promise<void>`
- `LspNavigationCallableTool` class (currently inline)
- `LspState` interface — holds `lspServiceClient`, `lspMcpClient`, `lspMcpTransport` refs

### Design Decisions

- Dynamic imports for `LspServiceClient` and MCP SDK must be preserved as dynamic (lazy/optional).
  This ensures LSP dependencies remain optional and non-fatal when unavailable.
- `LspIntegrationDeps` is validated by extracting the actual method calls from the current
  inline code, not from aspirational narrowing.
- Teardown order preserved exactly: remove navigation tools -> close MCP client -> close
  transport -> stop LSP service.
- **Cleanup unification:** Registration failure cleanup and explicit shutdown cleanup should
  use the same cleanup helper to prevent behavioral divergence.

### Verification

- `npm run typecheck` passes
- `npm run test` passes (especially `config-lsp-integration.test.ts`)
- Dynamic imports preserved (LSP/MCP SDK loaded lazily, not eagerly)
- Startup failure remains non-fatal
- Navigation tool registration timeout remains non-fatal
- Teardown order preserved
- No resource leaks on shutdown

---

## Phase 5: Extract Tool Governance (Core/CLI Boundary)

**Goal:** Move **shared tool policy primitives** from CLI config.ts into core. These are
pure normalization helpers and constants used by CLI to compose tool exclusion policies.

Core exposes shared tool identity/policy helpers and a default policy constant; CLI owns
the composition/bootstrap logic that uses them.

**Scope: ~80 lines moved from CLI to core.**

### Files Created (in core)

**`toolGovernance.ts`** containing shared policy primitives:
- `READ_ONLY_TOOL_NAMES` constant (moved from CLI) — a default policy set currently
  used by CLI's tool exclusion logic. Not a universal core invariant; a future non-CLI
  host could define different policy defaults.
- `normalizeToolNameForPolicy(name: string): string`
- `buildNormalizedToolSet(value: unknown): Set<string>`

### What Stays in CLI

- **`createToolExclusionFilter()`** — CLI session UX policy composition
- **`allowedMcpServers()`** — MCP filtering with blocked-server accumulation (bootstrap
  composition logic including diagnostic side-channel for blocked server reasons)
- **`mergeMcpServers()`** — MCP server composition from settings + extensions (bootstrap
  assembly logic, not core runtime infrastructure)
- **`mergeExcludeTools()`** — tool exclusion composition from settings + extensions

These remain in CLI because they are **bootstrap composition logic** that assembles
effective config from settings, extensions, and CLI flags. Core runtime consumes
already-resolved `mcpServers` and exclude lists; it does not need to own the assembly.

### Files Modified

**CLI `config.ts`**:
- Remove `normalizeToolNameForPolicy()`, `buildNormalizedToolSet()`
- Remove `READ_ONLY_TOOL_NAMES` constant
- Import these from `@vybestack/llxprt-code-core`

**Core `config/index.ts`**:
- Add re-exports from `./toolGovernance.js`

### Verification

- `npm run typecheck` passes in both core and cli
- `npm run test` passes
- CLI tool exclusion behavior unchanged
- `loadCliConfig()` produces identical Config objects

---

## Phase 6a: Extract Pure Builder Functions

**Goal:** Extract pure (no side effect) builder functions from the constructor.

**Scope: ~120 lines moved.**

### Files Created

**`configBuilders.ts`** containing:
- `buildTelemetrySettings(params: Partial<TelemetrySettings>): TelemetrySettings`
- `normalizeFileFilteringSettings(params): FileFilteringState` (returns the internal data
  shape used by the constructor, not the DI interface)
- `parseLspConfig(lsp: LspConfig | boolean | undefined): LspConfig | undefined`
- `normalizeShellReplacement()` (moved from config.ts)

### Files Modified

**`config.ts`**:
- Import builders from `./configBuilders.js`
- Replace inline builder logic in constructor with calls to builder functions
- Constructor side effects remain in-place and in same order
- Add re-export: `export { normalizeShellReplacement } from './configBuilders.js'`

### Verification

- `npm run typecheck` passes
- `npm run test` passes
- Constructor behavior identical (same side effects in same order)
- `normalizeShellReplacement` still importable from all previous paths

---

## Phase 6b: Extract Config Initializer

**Goal:** Extract `Config.initialize()` orchestration into a dedicated module. This is a
**transitional extraction** — the resulting module is still an orchestration hub (knowing
about tool registry, MCP, extensions, LSP, skills, client, context). Future work may
split it further into infrastructure vs integration vs optional-services initialization.

**Scope: ~200 lines moved.**

### Files Created

**`configInitializer.ts`** containing:
- `ConfigInitializationDeps` interface — purpose-built interface derived from actual
  `initialize()` method calls. Defined here (not in Phase 2) because this is the broadest
  extraction with the most dependencies, and speculative definition would be inaccurate.
- `initializeConfig(deps: ConfigInitializationDeps, messageBus: MessageBus): Promise<InitializedState>`
  — **thin sequencing shell** that calls dedicated subsystem functions in order. Must not
  contain business logic — only orchestration calls. Internal structure should be:
  ```
  initializeBaseRegistries(...)
  createToolRegistryFromConfig(...)
  startMcpAndExtensions(...)
  initializeLsp(...)
  initializeSkills(...)
  initializeClientAndContext(...)
  ```
  Even if some remain in the same file initially, they must be distinct internal functions
  so the structure doesn't reconcentrate into a second god-method.

  ```typescript
  interface InitializedState {
    toolRegistry: ToolRegistry;
    mcpClientManager: McpClientManager;
    promptRegistry: PromptRegistry;
    resourceRegistry: ResourceRegistry;
    geminiClient: GeminiClient;
    contextManager?: ContextManager;
    lspState?: LspState;
    ideClient: IdeClient;
    allPotentialTools: PotentialToolRecord[];
  }
  ```

  The initialization sequence (order preserved exactly):
  1. IdeClient setup
  2. FileDiscoveryService setup
  3. Git service init (if checkpointing)
  4. PromptRegistry + ResourceRegistry creation
  5. Tool registry creation (delegates to `toolRegistryFactory`)
  6. McpClientManager creation
  7. **Concurrent startup**: `Promise.all([mcpClientManager.startConfiguredMcpServers(), extensionLoader.start(deps)])`
  8. LSP initialization (delegates to `lspIntegration`)
  9. Skills discovery + ActivateSkillTool re-registration (exactly once)
  10. GeminiClient creation
  11. ContextManager setup

- `Config.initialize()` remains the entry point and assigns returned state

### Concurrency Preservation

Step 7 currently uses `Promise.all` to start MCP servers and extension loader concurrently.
This **must be preserved** — serializing these would change startup latency and potentially
alter error/race behavior.

### SettingsService Constraint

Many Config getters have **SettingsService-backed precedence semantics**: the getter
checks SettingsService ephemerals, then the constructed value, then falls back to defaults.
This means some "getters" are actually stateful resolution logic, not raw field accessors.
The initializer must not change when or how SettingsService is consulted — settings-backed
getters on Config must behave identically before and after extraction.

### Partial-Failure Semantics

Current behavior on failure: `this.initialized = true` is set early. If a later step fails,
the object is left partially initialized and non-retryable. The extraction **preserves this
exact behavior** — it does not attempt to improve cleanup. Specifically:
- If step 7 fails after step 5 succeeded, the tool registry is created but MCP servers may
  not be started. This is the current behavior.
- No rollback of already-started subsystems on failure (current behavior).
- `initialized` flag prevents retry (current behavior).

Improving partial-failure cleanup is explicitly deferred to follow-up work.

### Verification

- `npm run typecheck` passes
- `npm run test` passes
- `Config.initialize()` behavior identical
- Initialization order preserved (numbered invariants above)
- Concurrency preserved: MCP startup and extension-loader startup remain concurrent
- `ActivateSkillTool` re-registration occurs exactly once
- Partial-failure behavior unchanged (no new cleanup, no new rollback)
- Optional LSP/MCP SDK dependencies remain lazily loaded via dynamic imports
- Closure capture: lazy dependencies not snapshot too early

---

## Phase 7: Extract Env Var Resolution

**Goal:** Document and centralize application-specific environment variable reading where safe.

**Scope: ~80 lines new, ~30 lines modified.**

This phase is **not purely mechanical**. Some env vars are read at call time (env-precedence
getters), and centralizing those would change semantics. This phase is split:
- **7a: Documentation** — create `envResolver.ts` with `EnvConfig` interface documenting all
  known application env vars, their purpose, and where they're read.
- **7b: Centralization** — move reads that happen at construction/init time into a resolver.
  Env-precedence getters that read env at call time are documented but left inline.

### Files Created

**`envResolver.ts`** containing:
- `EnvConfig` interface with all known application env vars documented
- `resolveConstructionTimeEnvConfig(): EnvConfig` — reads env vars consumed during
  construction/initialization only
- Documentation of call-time env reads that remain inline

### Verification

- `npm run typecheck` passes
- `npm run test` passes (especially `settings.env.test.ts`)
- Env var behavior identical
- Existing precedence preserved

---

## Phase 8: Separate CLI parseArguments

**Goal:** Move `parseArguments()` (~525 lines) to its own file in CLI.

**Scope: ~530 lines moved.**

### Files Created

**`packages/cli/src/config/parseArguments.ts`** containing:
- `CliArgs` interface
- `parseArguments(settings: Settings): Promise<CliArgs>`
- All yargs option definitions
- `isDebugMode(argv: CliArgs): boolean` helper

### Files Modified

**CLI `config.ts`**:
- Remove `CliArgs` interface, `parseArguments()`, and `isDebugMode()`
- Add re-exports for backward compatibility

### Verification

- `npm run typecheck` passes
- `npm run test` passes
- CLI argument parsing behavior identical

---

## Dependency Rules

To prevent circular dependencies, the following import direction rules apply:

### Allowed Import Directions

```
configTypes.ts       <- no runtime deps (types/enums only)
configInterfaces.ts  <- type-only imports from configTypes.ts
configBuilders.ts    <- imports from configTypes.ts (type-only), external pure utilities
envResolver.ts       <- no config imports (reads process.env only)
toolGovernance.ts    <- imports from configTypes.ts (type-only), core tool constants

toolRegistryFactory.ts <- imports tool classes, configInterfaces.ts (type-only)
lspIntegration.ts      <- imports MCP/LSP classes, configInterfaces.ts (type-only)
configInitializer.ts   <- imports toolRegistryFactory.ts, lspIntegration.ts, configBuilders.ts

config.ts              <- imports all of the above
index.ts               <- re-exports from config.ts, configTypes.ts, configInterfaces.ts, etc.
```

### Rules

1. **`configTypes.ts` and `configInterfaces.ts` must not import `config.ts`** at runtime.
2. **Extracted modules must use direct file imports**, never `config/index.ts` internally.
3. **`config.ts` may import factories** but factories must never import `config.ts` at
   runtime (type-only imports for parameter typing are acceptable).
4. **Barrel files (`index.ts`) are for external consumption only** — no internal module
   should import from a barrel where a direct import would work.
5. **New/modified code in extracted modules** should use narrow interfaces where feasible.

---

## Acceptance Criteria

After all phases:

### Structural Criteria
- [ ] All existing import paths work (via re-exports)
- [ ] Core config.ts under ~1,000 lines (target ~900, quality of separation over line count)
- [ ] CLI config.ts under 1,400 lines (target ~1,100)
- [ ] Consumer interfaces defined and Config implements them (compiler-validated)
- [ ] Shared policy primitives in core, not duplicated in CLI
- [ ] Application env var reads documented in envResolver.ts

**Note:** File-size targets are metrics, not architectural criteria. A file under 1,000 lines
can still be poorly structured. Quality of separation is the primary goal.

### Public API Parity Criteria
- [ ] Export surface from `config.ts` and `config/index.ts` exactly matches pre-refactor
      (verified by export inventory diff)
- [ ] Public fields (`storage`, `truncateToolOutputThreshold`, `truncateToolOutputLines`,
      `enableToolOutputTruncation`) remain present and semantically stable
- [ ] Direct deep imports from `config.ts` continue to compile
- [ ] `normalizeShellReplacement` still importable from previous paths
- [ ] Ad hoc bootstrap metadata (`_bootstrapArgs`, `_cliModelOverride`, `_profileModelParams`,
      `_cliModelParams`)
      preserved on Config instances (tested)
- [ ] `MCPServerConfig` importable from previous paths

### Bootstrap Mutation Ordering Parity
- [ ] Runtime context registration happens before provider/profile work
- [ ] Provider switch ordering preserved (after runtime context exists)
- [ ] CLI override replay ordering preserved (after provider switch)
- [ ] Profile ephemerals and tool governance seeded after relevant ephemerals exist
- [ ] Ad hoc metadata attached before downstream consumers read it
- [ ] Model override re-applied after provider switch

### Build/Test Criteria
- [ ] All existing tests pass (`npm run test`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] Linting passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Smoke test passes (`node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`)
- [ ] `makeFakeConfig()` and existing test factories compile unchanged
- [ ] `packages/ui/src/features/config/configSession.ts` still compiles
- [ ] `packages/a2a-server/src/config/config.ts` still compiles
- [ ] No widespread test rewrites required

### Behavioral Parity Criteria
- [ ] `Config.initialize()` preserves service creation order (all 11 steps in documented order)
- [ ] MCP server startup and extension-loader startup remain concurrent (`Promise.all`)
- [ ] LSP startup/shutdown behavior identical, including non-fatal failure handling
- [ ] LSP navigation tool registration timeout remains non-fatal
- [ ] LSP teardown order preserved: remove tools -> close MCP client -> close transport -> stop LSP
- [ ] Optional LSP/MCP SDK dependencies remain lazily loaded via dynamic imports
- [ ] Tool registration order and discoverability unchanged
- [ ] `allPotentialTools` content, reasons, and ordering unchanged
- [ ] `ActivateSkillTool` re-registration after skill discovery occurs exactly once
- [ ] Lazy initialization preserved and idempotent for: `getFileService`, `getGitService`,
      `getHookSystem`, `getAsyncTaskManager`, `getAsyncTaskReminderService`
- [ ] Partial-failure behavior in `initialize()` unchanged (no new cleanup, no new rollback)
- [ ] Existing env var precedence preserved: CLI flags > profile values > settings > env > defaults
- [ ] Model precedence preserved: CLI > profile > settings > env > legacy env > provider default
- [ ] Provider/model/base-url/auth switching semantics unchanged
- [ ] Telemetry initialization in constructor functionally identical
- [ ] Proxy setup in constructor functionally identical
- [ ] Context filename handling unchanged
- [ ] `FileExclusions` construction during constructor still works
- [ ] Non-interactive tool exclusion behavior unchanged
- [ ] `blockedMcpServers` diagnostic accumulation behavior unchanged (if applicable after Phase 5)
- [ ] `config.storage` consumers in CLI/UI/A2A work unchanged
- [ ] `allPotentialTools` behavior unchanged (note: current code does NOT clear before pushing,
      so repeated `createToolRegistry()` calls accumulate. Preserve this existing behavior;
      fixing the accumulation bug is a separate concern)
- [ ] Lazy accessors return same object identity on repeated calls
- [ ] No lazy services instantiated during constructor or interface/helper setup
- [ ] Settings-backed getters preserve current runtime precedence (SettingsService ephemerals
      vs constructed values vs defaults)
- [ ] SettingsService resolution path unchanged: provided service > runtime-context service >
      fresh service (constructor's three-way resolution)
- [ ] `registerSettingsService(...)` invocation preserved during construction
- [ ] `peekActiveProviderRuntimeContext()` usage preserved during construction
- [ ] `createAgentRuntimeStateFromConfig(this)` behavior unchanged
- [ ] Telemetry/proxy/logging side effects happen once per Config construction, not duplicated
- [ ] `refreshMemory()` behavior unchanged (branches, events, mutations)
- [ ] Scheduler wiring (`getOrCreateScheduler`/`disposeScheduler`) behavior unchanged
- [ ] `MCPServerConfig` construction/import behavior unchanged from all prior import locations
- [ ] `setLlxprtMdFilename()` global state coordination unchanged (CLI pre-sets, constructor
      may override — ordering preserved)
- [ ] `FileExclusions` constructed during Config constructor with fully-usable `this`

### Direct Constructor Compatibility
- [ ] All `new Config(...)` call sites across packages compile unchanged
- [ ] No new required constructor params added
- [ ] Constructor defaulting behavior unchanged
- [ ] `packages/ui/src/features/config/configSession.ts` compiles with `new Config(...)`
- [ ] `packages/a2a-server/src/config/config.ts` compiles with `new Config(...)`

### Package-Root Export Parity
- [ ] `packages/core/src/index.ts` export surface unchanged (verified by export inventory diff)
- [ ] `@vybestack/llxprt-code-core` package root imports continue to resolve unchanged
- [ ] No new exported interface names collide with existing UI/CLI type names

### Dependency Criteria
- [ ] No new runtime circular dependencies in config modules
- [ ] Extracted modules do not import `config/index.ts`
- [ ] Internal imports use direct module paths, not barrels
- [ ] `toolRegistryFactory.ts` does not participate in runtime import cycles through
      tool classes that import back into config modules
- [ ] Source-level cycle checks (e.g., `madge --circular`) run, not just dist output
- [ ] Dependency rules (see section above) verified
- [ ] Optionally verified with `madge --circular` or equivalent

### Targeted Regression Tests
Rather than relying on generic coverage metrics, add targeted tests for:
- [ ] Init order: assert service creation sequence
- [ ] LSP non-fatal startup: verify graceful degradation
- [ ] Tool registry parity: assert registered tools match expected set
- [ ] Bootstrap metadata preservation: verify `_bootstrapArgs` etc. survive construction
- [ ] Public-field compatibility: verify direct field access works alongside getter access
- [ ] Startup concurrency: verify MCP and extension startup happen concurrently
- [ ] Lazy identity: verify repeated accessor calls return same instance
- [ ] Settings precedence: verify ephemeral overrides work for settings-backed getters
- [ ] Runtime state: verify `createAgentRuntimeStateFromConfig` works after construction
- [ ] Constructor consumers: verify `new Config(...)` with minimal param subsets works
- [ ] No duplicate side effects: verify telemetry/proxy init happens exactly once
- [ ] `refreshAuth()` / client recreation: verify client lifecycle after provider switch
- [ ] Shared `SettingsService` across multiple Config instances: verify no fresh instantiation
- [ ] LSP dynamic-import mocking: verify `config-lsp-integration.test.ts` still works
- [ ] CLI bootstrap mutation sequencing: verify `config.integration.test.ts` ordering
- [ ] Extraction binding: verify extracted functions call config methods at use time, not
      via snapshotted closures (critical for settings-backed getters)
- [ ] `_cliModelParams` preservation: verify CLI model param merging in `gemini.tsx`

---

## Line Count Estimates (approximate)

| File | Estimated Lines | Contents |
|------|----------------|----------|
| `config.ts` | ~900 | Config class: constructor, getters, mutators, lazy accessors, `initializeContentGeneratorConfig`, `refreshMemory`, scheduler wiring, settings-backed getters |
| `configTypes.ts` | ~350 | All interfaces, types, enums, MCPServerConfig |
| `configInterfaces.ts` | ~300 | Consumer interfaces + extraction-facing dependency interfaces |
| `toolRegistryFactory.ts` | ~250 | Tool registration logic + imports |
| `lspIntegration.ts` | ~280 | LSP lifecycle + MCP navigation |
| `configInitializer.ts` | ~200 | initialize() orchestration (transitional hub) |
| `configBuilders.ts` | ~120 | Pure builder functions |
| `toolGovernance.ts` | ~80 | Shared policy primitives (from CLI) |
| `envResolver.ts` | ~80 | Env var documentation + construction-time reading |
| CLI `parseArguments.ts` | ~530 | CLI argument parsing |
| CLI `config.ts` | ~1,100 | loadCliConfig() + MCP/tool composition + helpers |

## Sequencing and Dependencies

```
Phase 1 (Types)
    |
    +-- Phase 2 (Interfaces) -- depends on Phase 1
          |
          +-- Phase 8 (CLI parseArgs) -- independent, low-risk, reduces CLI noise
          +-- Phase 6a (Builders) -- independent pure extraction
          +-- Phase 3 (Tool Registry) -- uses ToolRegistryFactoryDeps
          +-- Phase 4 (LSP) -- uses LspIntegrationDeps
          +-- Phase 5 (Governance) -- independent
          |
          +-- Phase 6b (Initializer) -- depends on Phases 3, 4
                |
                Phase 7 (Env Resolver) -- independent but subtle
```

Phases 3, 4, 5, 6a, 7, and 8 can proceed in parallel after Phase 2.
Phase 6b requires Phases 3 and 4 to be complete.
Phase 8 is fully independent and can be done at any time.

**Recommended execution order** (risk-minimizing):
1 -> 2 -> 8 -> 6a -> 5 -> 3 -> 4 -> 6b -> 7

Phase 5 (tool governance primitives) is low-risk and improves the core/CLI boundary,
making it a confidence-building step before the larger tool registry and LSP extractions.
Pure/mechanical extractions happen first, riskier orchestration extraction late,
and env centralization last (since it has subtle call-time semantics).

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Import path breakage | Medium | Re-exports from original locations. Export inventory diff before/after each phase. |
| Public field access breakage | Medium | Fields remain as public properties. Getter wrappers are additive. |
| Test failures from mocking | Medium | `makeFakeConfig()` unchanged. Compile test fixtures in each phase. |
| Tests spying on delegated methods | Medium | Config-level methods still exist. Only internal helper spies need updating. Explicitly flag affected test categories. |
| Circular dependencies (barrel-induced) | High | Dependency rules enforced. No internal barrel imports. Verify with `madge`. |
| Initialization order regression | High | 11-step sequence documented. Targeted regression tests. |
| Startup concurrency drift | High | `Promise.all` for MCP/extension startup explicitly preserved and tested. |
| Lazy-service semantic drift | Medium | Acceptance criterion: lazy init preserved. Test each accessor for idempotency. |
| Env precedence drift | High | Explicit precedence table. Regression tests for each env-backed setting. |
| Provider/runtime state desync | High | Model/provider/auth switching parity tested. |
| LSP/MCP resource leaks | Medium | Teardown order documented. Test cleanup ordering. |
| Dynamic import eagerness | Medium | Optional LSP/MCP SDK imports must remain dynamic. Verified in each phase. |
| Bootstrap metadata loss | Medium | Ad hoc `_bootstrapArgs` etc. preserved and tested explicitly. |
| Constructor side-effect timing | Medium | Side effects only modified by builder function calls (6a). No effects move between constructor and initialize. |
| `allPotentialTools` shape drift | Low | `PotentialToolRecord` type preserves shape. Content parity tested. |
| SettingsService source-of-truth drift | Medium | Model/provider fields and SettingsService kept synchronized in all integration tests. |
| Closure capture in tool factory | Medium | Factory receives interface, not snapshot values. Tool constructors still receive Config. |
| Partial-failure half-initialized state | Low | Current behavior preserved exactly. No new cleanup logic. |
| Diagnostic side-channel loss (blockedMcpServers) | Low | MCP filtering stays in CLI. Behavior preserved. |
| `configInitializer.ts` becoming a second god module | High | Must be thin sequencing shell only — no business logic. Composed of distinct internal functions. Lint/review guard against reconcentration. |
| `this`-binding / closure-capture bugs | Medium | Extracted functions must receive dep object and call methods at use time. No destructuring of dynamic getters into local snapshots. Review criterion enforced. |
| Dynamic import mocking breakage (LSP) | Medium | `config-lsp-integration.test.ts` verified after Phase 4. Module boundary changes require mock path updates. |
| SettingsService shared-instance behavior | Medium | Extractions must not accidentally instantiate fresh services. `peekActiveProviderRuntimeContext()` logic preserved. |
