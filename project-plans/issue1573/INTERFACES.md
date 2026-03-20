# Consumer Interfaces Design

## Status: Transitional

These interfaces are **transitional anti-corruption interfaces over the god object**, not
final domain abstractions. They are derived from the current getter shape of Config and
preserve existing coupling patterns. Their purpose is to:

1. **Document actual dependencies** — what does each subsystem need from config?
2. **Enable future DI** — callers can accept narrow interfaces instead of the god object
3. **Make testing easier** — tests create minimal stubs instead of full `makeFakeConfig()`
4. **Enforce boundaries** — a tool shouldn't be able to access provider infrastructure

Future work will refine these into tighter domain-driven interfaces as the package
modularization progresses (see #1568).

## Methodology

Each interface below was derived by reviewing the imports and method calls from representative
consumer files in each category. The member lists are plausible approximations based on that
review, not mechanically generated exhaustive inventories. They will be **validated by compiler
conformance** when `Config implements ...` is added — any missing methods will surface as
type errors and be addressed.

**Pre-step (Phase 2):** Before writing these interfaces, mechanically compare every proposed
method name against the actual `Config` class method surface. Where names differ (e.g., plan
says `getSkillsSupport()` but actual method is `isSkillsSupportEnabled()`), use the actual
method name.

## Three Categories of Interfaces

### 1. Composable Trait Interfaces (defined in Phase 2)

Small, focused interfaces representing a single capability slice. These are the primary
deliverable of Phase 2. Config implements all of them. Consumers can depend on exactly
the traits they need.

### 2. Consumer-Migration Composites (deferred — introduced only when validated)

Broader interfaces that compose traits to cover what each consumer category uses.
**Not defined in Phase 2.** These are introduced only when:
- An extraction phase needs a typed dependency beyond composable traits, or
- A real consumer migration validates the composite boundary.

This avoids creating "god interfaces over the god object" — broad speculative
composites that are never adopted or that need immediate revision.

The composites documented below (ToolHostConfig, RuntimeSessionConfig, ProviderHostConfig,
etc.) are **design sketches**, not committed Phase 2 deliverables.

### 3. Extraction-Facing Dependency Interfaces (defined at extraction time)

Purpose-built narrow interfaces for the specific modules extracted in Phases 3-6b.
These represent the **exact dependency needs** of each extracted module. They are
introduced in their respective extraction phases when the actual code reveals the
exact dependency shape.

See PLAN.md Phases 3, 4, and 6b for details on `ToolRegistryFactoryDeps`,
`LspIntegrationDeps`, and `ConfigInitializationDeps`.

---

## Composable Trait Interfaces

Small composable traits that larger interfaces extend. Individual consumers can depend on
exactly the subset they need.

```typescript
/** Workspace and file path context */
export interface WorkspacePathsConfig {
  getTargetDir(): string;
  getProjectRoot(): string;
  getWorkingDir(): string;
  getWorkspaceContext(): WorkspaceContext;
}

/** File filtering behavior */
export interface FileFilteringConfig {
  getFileFilteringRespectGitIgnore(): boolean;
  getFileFilteringRespectLlxprtIgnore(): boolean;
  getFileFilteringOptions(): FileFilteringOptions;
  getEnableRecursiveFileSearch(): boolean;
  getFileFilteringDisableFuzzySearch(): boolean;
  getCustomExcludes(): string[];
  getFileExclusions(): FileExclusions;
}

/** Shell and PTY execution configuration */
export interface ShellExecutionHostConfig {
  getUseRipgrep(): boolean;
  getShouldUseNodePtyShell(): boolean;
  getAllowPtyThemeOverride(): boolean;
  getPtyScrollbackLimit(): number;
  getPtyTerminalWidth(): number | undefined;
  getPtyTerminalHeight(): number | undefined;
  getShellReplacement(): ShellReplacementMode;
  getShellExecutionConfig(): ShellExecutionConfig;
}

/** Sandbox awareness */
export interface SandboxAwarenessConfig {
  getSandbox(): SandboxConfig | undefined;
  isRestrictiveSandbox(): boolean;
}

/** Debug and output formatting */
export interface DebugOutputConfig {
  getDebugMode(): boolean;
  getOutputFormat(): OutputFormat;
}

/** Read-only settings access (for most consumers) */
export interface SettingsReadConfig {
  getEphemeralSetting(key: string): unknown;
  getSettingsService(): SettingsService;
}

/** Mutable settings access (for runtime/admin code only) */
export interface SettingsMutationConfig extends SettingsReadConfig {
  setEphemeralSetting(key: string, value: unknown): void;
}

/** Memory and context file access */
export interface MemoryContextConfig {
  getUserMemory(): string;
  getLlxprtMdFilePaths(): string[];
  getJitMemoryForPath(targetPath: string): Promise<string>;
}

/** Tool output truncation settings */
export interface ToolOutputConfig {
  getTruncateToolOutputThreshold(): number;
  getTruncateToolOutputLines(): number;
  isToolOutputTruncationEnabled(): boolean;
}
```

---

## Extraction-Facing Dependency Interfaces (Deferred)

These interfaces are NOT defined speculatively. They are introduced in their respective
extraction phases when the actual code reveals exact dependency shapes:

- **`ToolRegistryFactoryDeps`** — defined in Phase 3 alongside `toolRegistryFactory.ts`
- **`LspIntegrationDeps`** — defined in Phase 4 alongside `lspIntegration.ts`
- **`ConfigInitializationDeps`** — defined in Phase 6b alongside `configInitializer.ts`

Each composes the relevant traits from below plus any purpose-specific methods discovered
during extraction. See PLAN.md for phase-specific details.

**Rationale:** Speculative interface definitions inevitably need immediate correction when
the actual code is extracted. Deferring avoids churn and ensures interfaces match reality.

---

## Consumer-Migration Interfaces (Design Sketches — Not Phase 2 Deliverables)

> **Status:** These composites are **design sketches**, not committed Phase 2 deliverables.
> They will be introduced only when extraction phases or real consumer migrations validate
> them. They are documented here to show the intended direction, not as specifications.
>
> Some of these are too broad for stable interfaces and may need splitting. Others may
> need methods not yet listed. The actual boundaries will be determined by the code.

These compose traits and are broader. They exist for callers to narrow their dependency
on Config over time.

### ToolHostConfig

What tools need from their host at **runtime** (not for registry creation).

```typescript
/**
 * Configuration interface for tool implementations.
 * Tools should depend on this interface, not the full Config class.
 */
export interface ToolHostConfig extends
  WorkspacePathsConfig,
  FileFilteringConfig,
  ShellExecutionHostConfig,
  SandboxAwarenessConfig,
  DebugOutputConfig,
  SettingsReadConfig,
  MemoryContextConfig,
  ToolOutputConfig
{
  // File services
  getFileService(): FileDiscoveryService;
  getFileSystemService(): FileSystemService;

  // Tool configuration
  getToolRegistry(): ToolRegistry;

  // Approval (needed by edit/write/shell tools)
  getApprovalMode(): ApprovalMode;

  // Trust
  isTrustedFolder(): boolean;

  // Storage
  getStorage(): Storage;
}
```

**Note:** Individual tools may depend on just the traits they need. For example, a
read-only file tool might only need `WorkspacePathsConfig & FileFilteringConfig & DebugOutputConfig`.

### RuntimeSessionConfig

> **Naming:** Named `RuntimeSessionConfig` to avoid collision with the UI package's
> existing `SessionConfig` interface (a data shape in `packages/ui/src/features/config/llxprtAdapter.ts`).
> The core interface is a runtime capability interface, not a data shape.

What the session/conversation loop needs. This is an **extraction-only / temporary
convenience interface** that combines several distinct concerns. It should not become
a permanent contract.

```typescript
/**
 * Temporary convenience interface for session management.
 * Combines what the chat loop currently touches. NOT a stable domain boundary.
 *
 * Future work should split this into:
 * - ConversationSessionConfig (session control, approval, interactivity) — future split
 * - ModelRuntimeConfig (model state, fallback, switching)
 * - ClientLifecycleConfig (GeminiClient, ContentGeneratorConfig, auth)
 * - MemoryRefreshConfig (memory refresh, session adoption)
 *
 * Includes `getGeminiClient()` and `initializeContentGeneratorConfig()`
 * which are bound to the current client architecture.
 */
export interface RuntimeSessionConfig {
  // Session control
  getSessionId(): string;
  isContinueSession(): boolean;
  getContinueSessionRef(): string | null;
  isInteractive(): boolean;
  getNonInteractive(): boolean;
  getMaxSessionTurns(): number;
  getQuestion(): string | undefined;
  getApprovalMode(): ApprovalMode;
  setApprovalMode(mode: ApprovalMode): void;
  getDisableYoloMode(): boolean;
  getSkipNextSpeakerCheck(): boolean;
  getContinueOnFailedApiCall(): boolean;
  getEnableShellOutputEfficiency(): boolean;

  // Model runtime state
  getModel(): string;
  setModel(newModel: string): void;
  resetModelToDefault(): void;
  isInFallbackMode(): boolean;
  setFallbackMode(active: boolean): void;

  // Client lifecycle (transitional — Gemini-specific naming)
  getGeminiClient(): GeminiClient;
  getContentGeneratorConfig(): ContentGeneratorConfig | undefined;
  initializeContentGeneratorConfig(): Promise<void>;
  refreshAuth(authMethod?: string): Promise<void>;

  // Provider context
  getProvider(): string | undefined;
  getSettingsService(): SettingsService;
  getIdeMode(): boolean;
  getSessionRecordingService(): SessionRecordingService | undefined;

  // Compression
  getChatCompression(): ChatCompressionSettings | undefined;

  // Memory refresh
  refreshMemory(): Promise<{ memoryContent: string; fileCount: number; filePaths: string[] }>;

  // Session adoption
  adoptSessionId(sessionId: string): void;
}
```

### TelemetryConfig

What the telemetry subsystem needs.

```typescript
export interface TelemetryConfig {
  getSessionId(): string;
  getModel(): string;
  getProvider(): string | undefined;
  getTargetDir(): string;
  getDebugMode(): boolean;
  getSandbox(): SandboxConfig | undefined;

  // Telemetry settings
  getTelemetryEnabled(): boolean;
  getTelemetryLogPromptsEnabled(): boolean;
  getTelemetryOtlpEndpoint(): string;
  getTelemetryTarget(): TelemetryTarget;
  getTelemetryOutfile(): string | undefined;
  getTelemetrySettings(): TelemetrySettings & { [key: string]: unknown };
  updateTelemetrySettings(settings: Partial<TelemetrySettings>): void;

  // Conversation logging
  getConversationLoggingEnabled(): boolean;
  getResponseLoggingEnabled(): boolean;
  getConversationLogPath(): string;
  getMaxConversationHistory(): number;
  getConversationRetentionDays(): number;
  getMaxLogFiles(): number;
  getMaxLogSizeMB(): number;

  // Privacy
  getRedactionConfig(): RedactionConfig;
  getDataRetentionEnabled(): boolean;
  getConversationExpirationDays(): number;
  getMaxConversationsStored(): number;

  // Usage statistics
  getUsageStatisticsEnabled(): boolean;

  // Active extensions (for telemetry context)
  getActiveExtensions(): ActiveExtension[];
}
```

### ProviderHostConfig

What provider implementations need. Distinguishes provider runtime consumers from
provider infrastructure wiring.

```typescript
/**
 * Configuration for provider implementations (runtime behavior).
 * Includes settings mutation because providers need to read/update ephemeral settings.
 * Does NOT include provider manager mutation — that's infrastructure wiring in CLI/bootstrap.
 */
export interface ProviderHostConfig extends SettingsMutationConfig {
  getModel(): string;
  setModel(newModel: string): void;
  getProvider(): string | undefined;
  getProxy(): string | undefined;
  getDebugMode(): boolean;
  getSandbox(): SandboxConfig | undefined;

  // Provider access (read-only for providers)
  getProviderManager(): IProviderManager | undefined;
  getBucketFailoverHandler(): BucketFailoverHandler | undefined;

  // Browser (for OAuth)
  getNoBrowser(): boolean;
  isBrowserLaunchSuppressed(): boolean;
}
```

**Note:** Provider infrastructure mutation (setProviderManager, setBucketFailoverHandler,
setProvider) is used by CLI bootstrap and runtime orchestration, not by provider
implementations themselves. Those methods remain on Config but are not in this interface.

### ExtensionHostConfig

What the extension system needs.

```typescript
export interface ExtensionHostConfig {
  getExtensionLoader(): ExtensionLoader;
  getExtensions(): GeminiCLIExtension[];
  getActiveExtensions(): ActiveExtension[];
  isExtensionEnabled(extensionName: string): boolean;
  getListExtensions(): boolean;
  getExtensionManagement(): boolean;
  getEnableExtensionReloading(): boolean;
  getExtensionEvents(): EventEmitter | undefined;
  getExtensionContextFilePaths(): string[];
}
```

### HookHostConfig

What the hook system needs.

```typescript
export interface HookHostConfig {
  getEnableHooks(): boolean;
  getHooks(): { [K in HookEventName]?: HookDefinition[] } | undefined;
  getProjectHooks(): { [K in HookEventName]?: HookDefinition[] } & { disabled?: string[] } | undefined;
  getDisabledHooks(): string[];
  setDisabledHooks(hooks: string[]): void;
  getHookSystem(): HookSystem | undefined;
  getTargetDir(): string;
  getDebugMode(): boolean;
  getSettingsService(): SettingsService;
  getSessionRecordingService(): SessionRecordingService | undefined;
}
```

### SubagentHostConfig

What the subagent orchestration system needs (not async tasks).

```typescript
export interface SubagentHostConfig {
  getProfileManager(): ProfileManager | undefined;
  setProfileManager(manager: ProfileManager | undefined): void;
  getSubagentManager(): SubagentManager | undefined;
  setSubagentManager(manager: SubagentManager | undefined): void;
  getInteractiveSubagentSchedulerFactory(): SubagentSchedulerFactory | undefined;
  setInteractiveSubagentSchedulerFactory(factory: SubagentSchedulerFactory | undefined): void;
}
```

### AsyncTaskHostConfig

What the async task infrastructure needs (separate from subagent orchestration).

```typescript
export interface AsyncTaskHostConfig {
  getAsyncTaskManager(): AsyncTaskManager | undefined;
  getAsyncTaskReminderService(): AsyncTaskReminderService | undefined;
}
```

---

## Config Class Declaration

After defining these interfaces, the Config class declaration becomes:

```typescript
export class Config implements
  ToolHostConfig,
  RuntimeSessionConfig,
  TelemetryConfig,
  ProviderHostConfig,
  ExtensionHostConfig,
  HookHostConfig,
  SubagentHostConfig,
  AsyncTaskHostConfig
  // Extraction-facing interfaces (ToolRegistryFactoryDeps, LspIntegrationDeps,
  // ConfigInitializationDeps) are added in their respective extraction phases.
{
  // ... existing implementation

  // Added getter wrappers for public fields (fields remain for compatibility):
  getStorage(): Storage { return this.storage; }
  getTruncateToolOutputThreshold(): number { return this.truncateToolOutputThreshold; }
  getTruncateToolOutputLines(): number { return this.truncateToolOutputLines; }
  isToolOutputTruncationEnabled(): boolean { return this.enableToolOutputTruncation; }
}
```

This is purely additive — no callers need to change. Existing public field access
(`config.storage`, `config.truncateToolOutputThreshold`) continues to work alongside
the new getter methods.

---

## Migration Path

The interfaces enable **gradual migration**:

1. **Phase 2 (this plan):** Define interfaces, Config implements them. No callers change.
2. **Follow-up work:** Individual callers/modules opt in to narrower types:
   ```typescript
   // Before
   constructor(config: Config) { ... }

   // After (extraction-facing interface)
   constructor(deps: ToolRegistryFactoryDeps) { ... }

   // Or consumer interface
   constructor(config: ToolHostConfig) { ... }

   // Or even narrower (composable traits)
   constructor(config: WorkspacePathsConfig & FileFilteringConfig) { ... }
   ```
3. **Testing benefits immediate:** Use typed helper factories:
   ```typescript
   function createTestToolConfig(overrides: Partial<ToolHostConfig> = {}): ToolHostConfig {
     return {
       getTargetDir: () => '/tmp/test',
       getProjectRoot: () => '/tmp/test',
       getWorkingDir: () => '/tmp/test',
       getDebugMode: () => false,
       getOutputFormat: () => OutputFormat.TEXT,
       getFileService: () => new FileDiscoveryService('/tmp/test'),
       ...overrides,
     } as ToolHostConfig;
   }
   ```
4. **New code rule (aspirational, not enforced yet):** New/modified consumers in extracted
   modules should use narrow interfaces where feasible.

## Interface Size Analysis

| Interface | Category | Own Methods | Primary Consumers |
|-----------|----------|-------------|------------------|
| `ToolHostConfig` | Consumer | ~5 (composed from traits) | All core tools (~30 files) |
| `RuntimeSessionConfig` | Consumer (temporary) | ~28 | App.tsx, useGeminiStream, chat |
| `TelemetryConfig` | Consumer | ~20 | Telemetry subsystem (~5 files) |
| `ProviderHostConfig` | Consumer | ~10 (extends SettingsMutationConfig) | Provider impls (~10 files) |
| `ExtensionHostConfig` | Consumer | ~9 | Extension system (~5 files) |
| `HookHostConfig` | Consumer | ~11 | Hook system (~3 files) |
| `SubagentHostConfig` | Consumer | ~6 | Subagent orchestration (~3 files) |
| `AsyncTaskHostConfig` | Consumer | ~2 | Async task infrastructure (~2 files) |

Extraction-facing interfaces (defined in their respective phases, not here):
| `ToolRegistryFactoryDeps` | Extraction | TBD at Phase 3 | toolRegistryFactory.ts |
| `LspIntegrationDeps` | Extraction | TBD at Phase 4 | lspIntegration.ts |
| `ConfigInitializationDeps` | Extraction | TBD at Phase 6b | configInitializer.ts |

Composable traits range from 2-8 methods each.

Note: Some overlap exists (e.g., `getDebugMode()` appears in multiple interfaces).
This is intentional — each interface is self-contained for its use case.
TypeScript's structural typing means Config satisfies all of them simultaneously.

## Not Yet Covered / Future Interfaces

The following consumer categories are not yet covered by explicit interfaces and may
need them in future work:

- **PolicyEngine / PolicyUpdater** — currently receives full Config
- **ContextManager** — needs workspace, file service, session context
- **Logging/provider wrappers** — telemetry and debug context
- **a2a-server consumers** — server bootstrap config subset (constructs `new Config()` directly)
- **UI package consumers** — config data passed via props (may not need interfaces)
- **Integration scripts** — construct Config directly
- **Provider infrastructure wiring** — setProviderManager, setBucketFailoverHandler, setProvider
  (used by CLI bootstrap, not by providers themselves)

These will be defined as the respective subsystems are modularized per #1568.
