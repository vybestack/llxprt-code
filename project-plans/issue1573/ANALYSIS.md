# Current State Analysis

## The Problem

`packages/core/src/config/config.ts` is ~3,061 lines. The ticket proposes ConfigParser,
ConfigValidator, ConfigMerger, etc. But the dominant problem is not config parsing/validation —
it's the **concentration of unrelated runtime responsibilities in one class**. Config acts as
a runtime service container, mutable state holder, and lifecycle orchestrator alongside
its configuration value storage role.

## What Config Actually Is

The `Config` class holds three fundamentally different categories of state:

### 1. Immutable Configuration Values (~100 fields)

These are set in the constructor from `ConfigParameters` and never mutated:

```
sessionId, embeddingModel, sandbox, targetDir, debugMode, outputFormat,
question, coreTools, allowedTools, excludeTools, toolDiscoveryCommand,
toolCallCommand, mcpServerCommand, checkpointing, dumpOnError, proxy, cwd,
bugCommand, originalModel, extensionContextFilePaths, noBrowser, folderTrust,
maxSessionTurns, experimentalZedIntegration, listExtensions, useRipgrep,
shouldUseNodePtyShell, allowPtyThemeOverride, ptyScrollbackLimit,
skipNextSpeakerCheck, extensionManagement, enablePromptCompletion,
truncateToolOutputThreshold, truncateToolOutputLines, enableToolOutputTruncation,
continueOnFailedApiCall, enableShellOutputEfficiency, continueSession,
disableYoloMode, enableHooks, skillsSupport, sanitizationConfig, outputSettings,
codebaseInvestigatorSettings, introspectionAgentSettings, useWriteTodos,
complexityAnalyzerSettings, chatCompression, interactive, trustedFolder,
shellReplacement, accessibility, usageStatisticsEnabled, loadMemoryFromIncludeDirectories,
summarizeToolOutput, jitContextEnabled, ...
```

### Getter Categories

Not all getters are trivially `return this.X`. They fall into four categories:

1. **Pure field accessors** (~60 methods) — `getDebugMode()`, `getSessionId()`, etc.
   No logic, just `return this.field`.

2. **Derived getters** (~10 methods) — contain computation or merging logic:
   - `getExcludeTools()` merges active extension excludes dynamically
   - `getShellExecutionConfig()` computes a derived object from multiple fields + env/ephemeral
   - `isTrustedFolder()` consults IDE context and fallback semantics
   - `getFileFilteringOptions()` constructs an options object

3. **Env-precedence getters** (~5 methods) — consult environment at call time:
   - `getConversationLoggingEnabled()` reads `LLXPRT_LOG_CONVERSATIONS`
   - `getConversationLogPath()` reads `LLXPRT_CONVERSATION_LOG_PATH`
   - `isRestrictiveSandbox()` reads `SEATBELT_PROFILE`

4. **Lazy-service accessors** (~8 methods) — create services on first call:
   - `getFileService()`, `getGitService()`, `getHookSystem()`,
   - `getAsyncTaskManager()`, `getAsyncTaskReminderService()`
   - These embed lazy creation semantics that must be preserved during extraction.

### 2. Service Registry (lazily created services)

These are created in `initialize()`, the constructor, or lazily on first access:

| Service | Created In | Lines |
|---------|-----------|-------|
| `ToolRegistry` | `initialize()` via `createToolRegistry()` | ~190 lines |
| `McpClientManager` | `initialize()` | ~5 lines |
| `GeminiClient` | `initialize()` + `initializeContentGeneratorConfig()` | ~130 lines |
| `ContextManager` | `initialize()` | ~5 lines |
| `SkillManager` | constructor + `initialize()` | ~15 lines |
| `HookSystem` | lazy via `getHookSystem()` | ~15 lines |
| `FileDiscoveryService` | lazy via `getFileService()` | ~5 lines |
| `GitService` | lazy via `getGitService()` | ~5 lines |
| `AsyncTaskManager` | lazy via `getAsyncTaskManager()` | ~10 lines |
| `AsyncTaskReminderService` | lazy via `getAsyncTaskReminderService()` | ~10 lines |
| `AsyncTaskAutoTrigger` | lazy via `setupAsyncTaskAutoTrigger()` | ~20 lines |
| `LspServiceClient` | `initialize()` | ~60 lines |
| MCP Navigation (LspMcpClient) | `initialize()` via `registerMcpNavigationTools()` | ~210 lines |
| `PromptRegistry` | `initialize()` | ~1 line |
| `ResourceRegistry` | `initialize()` | ~1 line |
| `IdeClient` | `initialize()` (or injected) | ~5 lines |
| `PolicyEngine` | constructor | ~1 line |
| `Storage` | constructor | ~1 line |
| `FileExclusions` | constructor | ~1 line |
| `SettingsService` | constructor (injected or created) | ~15 lines |
| `WorkspaceContext` | constructor | ~3 lines |
| `FileSystemService` | constructor | ~1 line |
| `ExtensionLoader` | constructor (injected or default) | ~3 lines |
| `ContentGeneratorConfig` | `initializeContentGeneratorConfig()` | ~130 lines |
| `AgentRuntimeState` | `initializeContentGeneratorConfig()` | ~5 lines |

### Constructor Side Effects

The constructor is not just field assignment. It also performs:
- Telemetry initialization (`initializeTelemetry()`) with conditional VERBOSE logging
- Proxy setup (`setGlobalProxy()`) with error handling and feedback
- `Storage` construction (file I/O setup)
- `FileExclusions` construction (reads `.gitignore`/`.llxprtignore`)
- `PolicyEngine` construction (policy config evaluation)
- `SkillManager` construction (skill registry setup)
- Context filename handling (`setLlxprtMdFilename`)
- Runtime state creation (`createAgentRuntimeStateFromConfig`)
- `SettingsService` registration/resolution (global singleton)

These side effects complicate testing and extraction — moving them to a separate setup
phase is desirable but must be done carefully to avoid initialization order changes.

### 3. Runtime Mutable State (changes during session)

| Field | Mutated By |
|-------|-----------|
| `model` | `setModel()`, `resetModelToDefault()` |
| `inFallbackMode` | `setFallbackMode()`, `initializeContentGeneratorConfig()` |
| `_modelSwitchedDuringSession` | implicit |
| `approvalMode` | `setApprovalMode()` |
| `userMemory` | `setUserMemory()`, `refreshMemory()` |
| `llxprtMdFileCount` | `setLlxprtMdFileCount()` |
| `llxprtMdFilePaths` | `setLlxprtMdFilePaths()` |
| `terminalBackground` | `setTerminalBackground()` |
| `ideMode` | `setIdeMode()` |
| `mcpServers` | `setMcpServers()` |
| `alwaysAllowedCommands` | `addAlwaysAllowedCommand()` |
| `provider` | `setProvider()` |
| `providerManager` | `setProviderManager()` |
| `profileManager` | `setProfileManager()` |
| `subagentManager` | `setSubagentManager()` |
| `bucketFailoverHandler` | `setBucketFailoverHandler()` |
| `adoptedSessionId` | `adoptSessionId()` |
| `disabledHooks` | `setDisabledHooks()` |
| `disabledSkills` | via `reloadSkills()` |
| `telemetrySettings` | `updateTelemetrySettings()` |
| `runtimeState` | `initializeContentGeneratorConfig()` |
| `geminiClient` | `initializeContentGeneratorConfig()` |
| `contentGeneratorConfig` | `initializeContentGeneratorConfig()` |

## CLI config.ts (~2,015 lines)

The CLI's `config.ts` contains:

1. **`parseArguments()`** (~525 lines) — Pure yargs definition, maps CLI flags to `CliArgs`
2. **`loadCliConfig()`** (~1,100 lines) — Bootstrap orchestration:
   - Reads settings files (via `Settings`)
   - Resolves env vars for provider, model, proxy, debug, telemetry
   - Handles profile loading (file-based + inline JSON)
   - Computes derived values (approval mode, tool exclusions, interactivity)
   - Merges MCP servers from settings + extensions
   - Constructs `ConfigParameters` bag
   - Creates `new Config(params)`
   - Then does ~350 lines of post-construction mutation:
     - Provider switching via `switchActiveProvider()`
     - Profile application via `applyProfileSnapshot()`
     - CLI argument overrides
     - Tool governance policy application
     - Ephemeral settings seeding
3. **Helper functions** (~400 lines):
   - `loadHierarchicalLlxprtMemory()` — thin wrapper over core function
   - `createToolExclusionFilter()` — tool governance logic
   - `allowedMcpServers()` — MCP filtering
   - `mergeMcpServers()` — MCP merging from settings + extensions
   - `mergeExcludeTools()` — tool exclusion merging
   - `findEnvFile()` — .env file discovery
   - `loadEnvironment()` — dotenv loading
   - `buildNormalizedToolSet()` — tool name normalization
   - `READ_ONLY_TOOL_NAMES` — constant

## Overlap and Boundary Violations

### Bootstrap-originated runtime mode flags in core

Several fields on `Config` originate from CLI/bootstrap but influence core runtime behavior.
These are not pure CLI UI concerns — they're **bootstrap-originated session/runtime mode flags**
that affect core behavior:

- `interactive` — influences core tool/scheduler/session behavior (not just TTY presentation)
- `noBrowser` — affects OAuth/browser-launch behavior in core code paths
- `ideMode` — has both CLI and runtime/UI implications
- `continueSession` — session restoration behavior spans core runtime

These are correctly part of `ConfigParameters` since core needs them, but they blur the
origin boundary. The key principle: **CLI determines these values, core consumes them.**

The following are more clearly CLI-only concerns leaked into core:
- `listExtensions` — `--list-extensions` flag (CLI feature, checked once at startup)
- `experimentalZedIntegration` — `--experimental-acp` flag (CLI feature)

### CLI duplicates core logic:
- `createToolExclusionFilter()` in CLI does tool governance that should be in core
- `mergeMcpServers()` / `mergeExcludeTools()` handle shared concerns
- `buildNormalizedToolSet()` duplicates normalization logic
- `READ_ONLY_TOOL_NAMES` defines which tools are read-only (a core concept)

Note: `createToolExclusionFilter()` contains some CLI-specific interactivity/approval
logic alongside pure normalization. During extraction, the pure primitives
(`normalizeToolNameForPolicy`, `buildNormalizedToolSet`, `READ_ONLY_TOOL_NAMES`)
clearly belong in core. The CLI-specific composition logic that combines these with
approval mode and interactivity semantics may remain in CLI.

### Environment Variable Scatter

16+ env vars read in CLI `loadCliConfig`, 9 in core `Config`. No central registry.

Env vars fall into two categories:
- **Application env vars** — `LLXPRT_PROFILE`, `LLXPRT_DEFAULT_PROVIDER`,
  `LLXPRT_DEFAULT_MODEL`, `GEMINI_MODEL` (deprecated), `LLXPRT_LOG_CONVERSATIONS`,
  `LLXPRT_CONVERSATION_LOG_PATH`, `NO_BROWSER`, OTLP endpoints, `SEATBELT_PROFILE`,
  `DEBUG_MODE`, `VERBOSE`. These are candidates for centralization in an env resolver.
- **Platform env vars** — `HTTPS_PROXY`, `HTTP_PROXY`, `HOME`, `CI`, `NODE_ENV`, `VITEST`.
  These follow OS conventions and may be read inline where needed, though application
  logic that observes them (like `isRestrictiveSandbox`) should still be documented.

The gemini-cli heritage is visible — env vars were the primary config mechanism, but
we've moved toward settings files and profiles. Env vars remain for backward compat
and standard conventions (proxy, CI) but shouldn't be the primary documented path.

## SettingsService Architecture (Primary Extraction Constraint)

`SettingsService` (394 lines) is a pure in-memory key-value store:
- No file I/O (ephemeral only)
- Holds `providers: Record<string, Record<string, unknown>>` + `global: Record<string, unknown>`
- `Config` accesses it for ephemeral settings and delegates model lookup to it
- CLI seeds it during bootstrap from profiles, CLI args, and settings files

**This is a primary extraction constraint.** Many Config "getters" are not pure field
accessors — they resolve values through SettingsService ephemerals first, then fall back to
constructed values, then to defaults. Examples:
- `getModel()` checks ephemeral override → provider context → constructed field
- Provider-related getters check ephemeral provider settings → Config field → defaults
- Any getter that calls `getEphemeralSetting()` internally has live precedence semantics

### SettingsService Resolution Path

The constructor resolves SettingsService through a three-way precedence:
1. Provided via `params.settingsService` (explicit injection)
2. From `peekActiveProviderRuntimeContext()?.settingsService` (shared context)
3. Fresh `new SettingsService()` (fallback)

This resolution path must be preserved exactly — extracting builder/setup logic cannot
change which path is taken or when `registerSettingsService(...)` is called.

### Global Mutable State: Context Filename

`setLlxprtMdFilename(...)` in the constructor mutates global module state in
`memoryTool.ts`. CLI may also call `setLlxprtMdFilename(...)` before Config construction.
This is a global-state coordination risk: builder extraction (Phase 6a) must not change
the timing of this call relative to CLI's pre-configuration.

This means extracting code that calls these getters must preserve the exact same runtime
precedence chain. The extracted modules cannot cache getter results at extraction time;
they must call through to Config (or its interface) at use time, since ephemerals can
change during a session.

The `Settings` type (from `settings.ts` in CLI) is the static config from `settings.json` files.
`SettingsService` holds runtime/ephemeral overrides. Config holds the resolved values.
This three-way split creates confusion about which is the source of truth for any given value.

## Ad Hoc Bootstrap Metadata

CLI bootstrap currently attaches extra properties to `Config` instances via casts:
- `_bootstrapArgs` — stored for reference during provider switching
- `_cliModelOverride` — tracks whether the model was set by CLI flag (not profile/env)
- `_profileModelParams` — tracks model-related parameters from profile application
- `_cliModelParams` — tracks model-related parameters from CLI `--set` arguments;
  consumed by `gemini.tsx` and `zedIntegration.ts` during model param merging

These are not part of `ConfigParameters` or the formal `Config` class — they are runtime
bootstrap metadata hung off the object as ad hoc fields. This is a coupling hotspot that
should be addressed by either:
- moving the metadata to a dedicated bootstrap result object,
- storing it in `SettingsService` or runtime context,
- or formalizing it as explicit `Config` fields.

Even if full cleanup is out of scope for this issue, the decomposition must preserve and
test these ad hoc fields since CLI behavior depends on them.

## Public Field Compatibility

`Config` exposes several **public fields** (not just getters):
- `storage: Storage`
- `truncateToolOutputThreshold: number`
- `truncateToolOutputLines: number`
- `enableToolOutputTruncation: boolean`

These are accessed via `config.fieldName` by callers across the monorepo. Any decomposition
must preserve these fields and not accidentally break direct field access. The interface
design adds getter wrappers alongside the fields for DI purposes, but the fields themselves
must remain stable until intentionally deprecated.

## Direct `Config` Import Sprawl

`Config` is not just passed around — it is **directly imported** by ~130+ files in core
and ~40+ files in CLI via `import { Config } from '../../config/config.js'` or similar
deep imports. This pervasive direct coupling is a migration constraint: re-exports from
`config.ts` must remain stable, and any future interface adoption must be gradual
because so many files reference the concrete class.

## ConfigParameters — a God Object Enabler

The `ConfigParameters` interface (~107 lines) is itself an enabler of the god object pattern.
Its flat structure with 70+ optional fields makes it easy to add new concerns to Config
without any architectural friction. A follow-up decomposition should group parameters into
focused sub-objects:

- `ConfigValueParams` — core immutable values
- `TelemetryParams` — telemetry-specific values
- `RuntimeModeParams` — interactive, sandbox, continueSession, etc.
- `ExtensionParams` — extension-related config
- `ProviderRuntimeParams` — provider, model, auth-related config

This is out of scope for the immediate decomposition but should be tracked.

## Consumer Packages

Config is consumed across the monorepo:
- **core** (~130 files) — tools, services, providers, runtime, hooks, MCP
- **cli** (~40 files) — bootstrap, UI, commands, runtime settings
- **ui** — React components that receive config indirectly via props
- **a2a-server** — server bootstrap
- **lsp** — LSP service integration

The interface design must consider consumers beyond just core and CLI.

## Dependency Graph

```
CLI config.ts
  ├── reads Settings (from settings.json files)
  ├── reads env vars
  ├── parses CLI args (yargs)
  ├── loads profiles (ProfileManager)
  ├── constructs ConfigParameters
  ├── creates Config (core)
  ├── mutates Config post-construction
  │   ├── switchActiveProvider()
  │   ├── applyProfileSnapshot()
  │   ├── setEphemeralSetting() x N
  │   └── setModel(), setDisabledHooks(), etc.
  └── returns Config

Core Config
  ├── stores ~100 immutable values from ConfigParameters
  ├── creates/holds ~24 services (see table above)
  ├── holds mutable runtime state
  ├── exposes ~60 pure field accessors
  ├── exposes ~10 derived getters (compute, merge, or derive values)
  ├── exposes ~5 env-precedence getters (read env at call time)
  ├── exposes ~8 lazy-service accessors (create on first call)
  └── exposes ~30 mutators + complex methods
```
