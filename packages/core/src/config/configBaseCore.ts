/**
 * ConfigBaseCore — field declarations and simple single-delegation accessors.
 * ConfigBase extends this and adds abstract methods + complex multi-line logic.
 */

import type { MemorySettings } from './configTypes.js';

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import * as path from 'node:path';
import { ConfigMediaDefaults } from './configMediaDefaults.js';
import type { ContentGeneratorConfig } from '../core/contentGenerator.js';

import { LLXPRT_CONFIG_DIR as LLXPRT_DIR } from '@vybestack/llxprt-code-tools';
import type { HookDefinition, HookEventName } from '../hooks/types.js';
import type { EnvironmentSanitizationConfig } from '../services/environmentSanitization.js';
import type { OutputFormat } from '../utils/output-format.js';
import { shouldAttemptBrowserLaunch } from '../utils/browser.js';
import type { PolicyEngineConfig } from '../policy/types.js';
import type { LspConfig } from '@vybestack/llxprt-code-ide-integration';
import type { ApprovalMode, MCPServerConfig } from './configTypes.js';
import { resolvePerfSettings } from './configConstructor.js';
import {
  type AccessibilitySettings,
  type BugCommandSettings,
  type ChatCompressionSettings,
  type SummarizeToolOutputSettings,
  type ComplexityAnalyzerSettings,
  type OutputSettings,
  type IntrospectionAgentSettings,
  type TelemetrySettings,
  type LlxprtExtension,
  type SandboxConfig,
  type ActiveExtension,
  type FileFilteringOptions,
} from './configTypes.js';

export abstract class ConfigBaseCore extends ConfigMediaDefaults {
  protected allowedMcpServers!: string[];
  protected blockedMcpServers!: Array<{ name: string; extensionName: string }>;
  protected readonly sessionId!: string;
  protected adoptedSessionId: string | undefined;
  protected readonly initialSettings!: Readonly<Record<string, unknown>>;
  protected readonly provider: string | undefined;
  protected contentGeneratorConfig:
    | Readonly<Omit<ContentGeneratorConfig, 'contentGeneratorFactory'>>
    | undefined;
  protected readonly embeddingModel: string | undefined;
  protected readonly sandbox: SandboxConfig | undefined;
  protected readonly targetDir!: string;
  protected readonly configuredIncludeDirectories!: readonly string[];
  protected readonly debugMode!: boolean;
  protected readonly outputFormat!: OutputFormat;
  protected readonly quiet!: boolean;
  protected readonly question: string | undefined;
  /**
   * @plan PLAN-20250212-LSP.P33
   * @requirement REQ-CFG-010, REQ-CFG-015, REQ-CFG-070
   */
  protected readonly lspConfig: LspConfig | undefined;
  protected readonly coreTools: string[] | undefined;
  protected readonly allowedTools: string[] | undefined;
  protected readonly excludeTools: string[] | undefined;
  protected readonly toolDiscoveryCommand: string | undefined;
  protected readonly toolCallCommand: string | undefined;
  protected readonly mcpServerCommand: string | undefined;
  protected mcpServers: Record<string, MCPServerConfig> | undefined;
  protected readonly memorySettings!: MemorySettings;
  protected readonly providedInstructions!: string;
  protected approvalMode!: ApprovalMode;
  protected readonly jitContextEnabled?: boolean;
  protected terminalBackground: string | undefined = undefined;
  protected readonly showMemoryUsage!: boolean;
  protected readonly accessibility!: AccessibilitySettings;
  protected telemetrySettings!: TelemetrySettings;
  protected readonly usageStatisticsEnabled!: boolean;
  protected readonly fileFiltering!: {
    respectGitIgnore: boolean;
    respectLlxprtIgnore: boolean;
    enableRecursiveFileSearch: boolean;
    disableFuzzySearch: boolean;
  };
  protected alwaysAllowedCommands: Set<string> = new Set();
  // #1995 slice 2 — session-owned background shell jobs
  protected readonly checkpointing!: boolean;
  protected readonly dumpOnError!: boolean;
  protected readonly proxy: string | undefined;
  protected readonly cwd!: string;
  protected readonly bugCommand: BugCommandSettings | undefined;
  protected readonly originalModel!: string;
  protected readonly extensionContextFilePaths!: string[];
  protected readonly noBrowser!: boolean;
  protected folderTrust!: boolean;
  protected ideMode!: boolean;
  protected inFallbackMode = false;
  protected _modelSwitchedDuringSession: boolean = false;
  protected readonly maxSessionTurns!: number;
  protected readonly _activeExtensions!: ActiveExtension[];
  protected readonly listExtensions!: boolean;
  protected extensions: LlxprtExtension[] = [];
  protected readonly enableExtensionReloading!: boolean;

  protected readonly summarizeToolOutput:
    | Record<string, SummarizeToolOutputSettings>
    | undefined;
  protected readonly experimentalZedIntegration: boolean = false;
  protected readonly complexityAnalyzerSettings!: ComplexityAnalyzerSettings;
  protected readonly loadMemoryFromIncludeDirectories: boolean = false;
  protected readonly chatCompression: ChatCompressionSettings | undefined;
  protected readonly interactive!: boolean;
  protected readonly useRipgrep!: boolean;
  protected readonly shouldUseNodePtyShell!: boolean;
  protected readonly allowPtyThemeOverride!: boolean;
  protected readonly ptyScrollbackLimit!: number;
  protected ptyTerminalWidth?: number;
  protected ptyTerminalHeight?: number;
  protected readonly skipNextSpeakerCheck!: boolean;
  protected readonly extensionManagement!: boolean;
  protected readonly enablePromptCompletion: boolean = false;
  protected readonly shellReplacement: 'allowlist' | 'all' | 'none' =
    'allowlist';
  readonly storageRoot!: string;
  readonly globalConfigRoot!: string;
  readonly globalDataRoot!: string;
  readonly globalLogRoot!: string;
  readonly globalAgentsRoot!: string;
  readonly projectTempDir!: string;
  readonly projectHistoryDir!: string;
  readonly projectChatsDir!: string;
  readonly projectCheckpointsDir!: string;
  readonly historyFilePath!: string;
  readonly projectCommandsDir!: string;
  readonly projectSkillsDir!: string;
  readonly projectAgentSkillsDir!: string;
  readonly userCommandsDir!: string;
  readonly userSkillsDir!: string;
  readonly userAgentSkillsDir!: string;
  readonly customExcludes!: readonly string[];
  protected readonly policyEngineConfig!: PolicyEngineConfig;

  truncateToolOutputThreshold!: number;
  truncateToolOutputLines!: number;
  enableToolOutputTruncation!: boolean;

  protected readonly continueOnFailedApiCall!: boolean;
  protected readonly imagePayloadBudgetBytes!: number;
  protected readonly enableShellOutputEfficiency!: boolean;
  protected readonly continueSession!: boolean | string;
  protected readonly disableYoloMode!: boolean;
  protected readonly enableHooks!: boolean;
  protected readonly hooks:
    | { [K in HookEventName]?: HookDefinition[] }
    | undefined;
  protected disabledHooks: string[] = [];
  protected readonly projectHooks:
    | { [K in HookEventName]?: HookDefinition[] }
    | undefined;
  protected readonly skillsSupport!: boolean;
  protected disabledSkills!: string[];
  protected readonly enableHooksUI!: boolean;
  protected adminSkillsEnabled: boolean = true;
  protected readonly sanitizationConfig?: EnvironmentSanitizationConfig;
  protected readonly outputSettings!: OutputSettings;
  protected readonly introspectionAgentSettings!: IntrospectionAgentSettings;
  protected readonly useWriteTodos!: boolean;
  protected initialized = false;
  isContinueSession(): boolean {
    return Boolean(this.continueSession);
  }
  shouldLoadMemoryFromIncludeDirectories(): boolean {
    return this.loadMemoryFromIncludeDirectories;
  }
  setTerminalBackground(terminalBackground: string | undefined): void {
    this.terminalBackground = terminalBackground;
  }
  getTerminalBackground(): string | undefined {
    return this.terminalBackground;
  }
  setContentGeneratorConfig(value: ContentGeneratorConfig): void {
    this.contentGeneratorConfig = Object.freeze({
      model: value.model,
      ...(value.apiKey === undefined ? {} : { apiKey: value.apiKey }),
      ...(value.vertexai === undefined ? {} : { vertexai: value.vertexai }),
      ...(value.proxy === undefined ? {} : { proxy: value.proxy }),
    });
  }
  getContentGeneratorConfig():
    | Readonly<Omit<ContentGeneratorConfig, 'contentGeneratorFactory'>>
    | undefined {
    return this.contentGeneratorConfig;
  }
  isInFallbackMode(): boolean {
    return this.inFallbackMode;
  }
  setFallbackMode(active: boolean): void {
    this.inFallbackMode = active;
  }
  getMaxSessionTurns(): number {
    return this.maxSessionTurns;
  }
  getEmbeddingModel(): string | undefined {
    return this.embeddingModel;
  }
  getSandbox(): SandboxConfig | undefined {
    return this.sandbox;
  }
  getTargetDir(): string {
    return this.targetDir;
  }
  getProjectRoot(): string {
    return this.targetDir;
  }
  getConfiguredIncludeDirectories(): readonly string[] {
    return [...this.configuredIncludeDirectories];
  }
  getDisabledSkills(): string[] {
    return [...this.disabledSkills];
  }
  setDisabledSkills(names: string[]): void {
    this.disabledSkills = [...names];
  }
  isAdminSkillsEnabled(): boolean {
    return this.adminSkillsEnabled;
  }
  setAdminSkillsEnabled(enabled: boolean): void {
    this.adminSkillsEnabled = enabled;
  }
  getDebugMode(): boolean {
    return this.debugMode;
  }
  getOutputFormat(): OutputFormat {
    return this.outputFormat;
  }
  getQuiet(): boolean {
    return this.quiet;
  }
  getQuestion(): string | undefined {
    return this.question;
  }
  getCoreTools(): string[] | undefined {
    return this.coreTools;
  }
  getAllowedTools(): string[] | undefined {
    return this.allowedTools;
  }
  getToolDiscoveryCommand(): string | undefined {
    return this.toolDiscoveryCommand;
  }
  getToolCallCommand(): string | undefined {
    return this.toolCallCommand;
  }
  getMcpServerCommand(): string | undefined {
    return this.mcpServerCommand;
  }
  getMcpServers(): Record<string, MCPServerConfig> | undefined {
    return this.mcpServers;
  }
  getAllowedMcpServers(): string[] | undefined {
    return this.allowedMcpServers;
  }
  getBlockedMcpServers():
    | Array<{ name: string; extensionName: string }>
    | undefined {
    return this.blockedMcpServers;
  }
  setMcpServers(mcpServers: Record<string, MCPServerConfig>): void {
    this.mcpServers = mcpServers;
  }
  getApprovalMode(): ApprovalMode {
    return this.approvalMode;
  }
  /**
   * The single JIT-context predicate. It resolves from the
   * constructor-assigned `jitContextEnabled` field and nothing else, so every
   * consumer (workspace discovery, session instruction reads, the prompt
   * builders and the CLI) observes one answer. A second predicate with a
   * different resolution order would let the workspace memory hierarchy be
   * sent twice or not at all (issue #3135).
   *
   * The user-facing setting is `experimental.jitContext`, resolved by the CLI
   * and threaded in as `ConfigParameters.jitContextEnabled`.
   */
  isJitContextEnabled(): boolean {
    return this.jitContextEnabled === true;
  }
  getAccessibility(): AccessibilitySettings {
    return this.accessibility;
  }
  getPolicyEngineConfig(): PolicyEngineConfig {
    return {
      ...this.policyEngineConfig,
      rules: this.policyEngineConfig.rules?.map((rule) => ({
        ...rule,
        modes: rule.modes?.slice(),
        argsPattern: rule.argsPattern
          ? new RegExp(rule.argsPattern.source, rule.argsPattern.flags)
          : undefined,
      })),
    };
  }
  getShowMemoryUsage(): boolean {
    return this.showMemoryUsage;
  }
  getDisableYoloMode(): boolean {
    return this.disableYoloMode;
  }
  getTelemetryEnabled(): boolean {
    return this.telemetrySettings.enabled ?? false;
  }
  /**
   * Effective perf telemetry master switch. Delegates to resolvePerfSettings
   * so gating policy lives in exactly one place.
   */
  getTelemetryPerfEnabled(): boolean {
    return resolvePerfSettings(this.telemetrySettings).enabled;
  }
  /**
   * Effective perf memory flag. Master-gated: returns false when the perf
   * master switch (getTelemetryPerfEnabled) is off, regardless of the stored
   * memory value. Delegates to resolvePerfSettings.
   */
  getTelemetryPerfMemory(): boolean {
    return resolvePerfSettings(this.telemetrySettings).memory;
  }
  getTelemetryLogPromptsEnabled(): boolean {
    return this.telemetrySettings.logPrompts ?? true;
  }
  getTelemetryOutfile(): string | undefined {
    return this.telemetrySettings.outfile;
  }
  getResponseLoggingEnabled(): boolean {
    return this.telemetrySettings.logResponses ?? false;
  }
  getMaxConversationHistory(): number {
    return this.telemetrySettings.maxConversationHistory ?? 50;
  }
  getConversationRetentionDays(): number {
    return this.telemetrySettings.retentionDays ?? 30;
  }
  getMaxLogFiles(): number {
    return this.telemetrySettings.maxLogFiles ?? 10;
  }
  getMaxLogSizeMB(): number {
    return this.telemetrySettings.maxLogSizeMB ?? 100;
  }
  getDataRetentionEnabled(): boolean {
    return this.telemetrySettings.enableDataRetention ?? true;
  }
  getConversationExpirationDays(): number {
    return this.telemetrySettings.conversationExpirationDays ?? 30;
  }
  getMaxConversationsStored(): number {
    return this.telemetrySettings.maxConversationsStored ?? 1000;
  }
  getLlxprtDir(): string {
    return path.join(this.targetDir, LLXPRT_DIR);
  }
  getProjectTempDir(): string {
    return this.projectTempDir;
  }
  getEnableRecursiveFileSearch(): boolean {
    return this.fileFiltering.enableRecursiveFileSearch;
  }
  getFileFilteringDisableFuzzySearch(): boolean {
    return this.fileFiltering.disableFuzzySearch;
  }
  getFileFilteringRespectGitIgnore(): boolean {
    return this.fileFiltering.respectGitIgnore;
  }
  getFileFilteringRespectLlxprtIgnore(): boolean {
    return this.fileFiltering.respectLlxprtIgnore;
  }
  getFileFilteringOptions(): FileFilteringOptions {
    return {
      respectGitIgnore: this.fileFiltering.respectGitIgnore,
      respectLlxprtIgnore: this.fileFiltering.respectLlxprtIgnore,
    };
  }
  getCustomExcludes(): string[] {
    return [...this.customExcludes];
  }
  getCheckpointingEnabled(): boolean {
    return this.checkpointing;
  }
  getDumpOnError(): boolean {
    return this.dumpOnError;
  }
  getProxy(): string | undefined {
    return this.proxy;
  }
  getWorkingDir(): string {
    return this.cwd;
  }
  getBugCommand(): BugCommandSettings | undefined {
    return this.bugCommand;
  }
  getUsageStatisticsEnabled(): boolean {
    return this.usageStatisticsEnabled;
  }
  getExtensionContextFilePaths(): string[] {
    return this.extensionContextFilePaths;
  }
  getExperimentalZedIntegration(): boolean {
    return this.experimentalZedIntegration;
  }
  getListExtensions(): boolean {
    return this.listExtensions;
  }
  getExtensionManagement(): boolean {
    return this.extensionManagement;
  }
  getExtensions(): LlxprtExtension[] {
    return [...this.extensions];
  }
  setExtensions(extensions: readonly LlxprtExtension[]): void {
    this.extensions = [...extensions];
  }
  getActiveExtensions(): ActiveExtension[] {
    return this._activeExtensions;
  }
  isExtensionEnabled(extensionName: string): boolean {
    const extension = this.getExtensions().find(
      (ext) => ext.name === extensionName,
    );
    // If extension not found, default to true to avoid filtering
    return extension ? extension.isActive : true;
  }
  getEnableExtensionReloading(): boolean {
    return this.enableExtensionReloading;
  }
  getProvider(): string | undefined {
    const value = this.provider;
    return typeof value === 'string' && value !== '' ? value : undefined;
  }
  getNoBrowser(): boolean {
    return this.noBrowser;
  }
  isBrowserLaunchSuppressed(): boolean {
    return this.getNoBrowser() || !shouldAttemptBrowserLaunch();
  }
  getSummarizeToolOutputConfig():
    | Record<string, SummarizeToolOutputSettings>
    | undefined {
    return this.summarizeToolOutput;
  }
  getIdeMode(): boolean {
    return this.ideMode;
  }
  getFolderTrust(): boolean {
    return this.folderTrust;
  }
  getComplexityAnalyzerSettings(): ComplexityAnalyzerSettings {
    return this.complexityAnalyzerSettings;
  }
  isInteractive(): boolean {
    return this.interactive;
  }
  getNonInteractive(): boolean {
    return !this.interactive;
  }
  getChatCompression(): ChatCompressionSettings | undefined {
    return this.chatCompression;
  }
  addAlwaysAllowedCommand(rootCommand: string): void {
    this.alwaysAllowedCommands.add(rootCommand);
  }
  isCommandAlwaysAllowed(rootCommand: string): boolean {
    return this.alwaysAllowedCommands.has(rootCommand);
  }
  getAlwaysAllowedCommands(): string[] {
    return Array.from(this.alwaysAllowedCommands);
  }
  getUseRipgrep(): boolean {
    return this.useRipgrep;
  }
  getShouldUseNodePtyShell(): boolean {
    return this.shouldUseNodePtyShell;
  }
  getAllowPtyThemeOverride(): boolean {
    return this.allowPtyThemeOverride;
  }
  getPtyScrollbackLimit(): number {
    return this.ptyScrollbackLimit;
  }
  getPtyTerminalWidth(): number | undefined {
    return this.ptyTerminalWidth;
  }
  getPtyTerminalHeight(): number | undefined {
    return this.ptyTerminalHeight;
  }
  getSkipNextSpeakerCheck(): boolean {
    return this.skipNextSpeakerCheck;
  }
  getContinueOnFailedApiCall(): boolean {
    return this.continueOnFailedApiCall;
  }
  getImagePayloadBudgetBytes(): number {
    return this.imagePayloadBudgetBytes;
  }
  getEnableShellOutputEfficiency(): boolean {
    return this.enableShellOutputEfficiency;
  }
  getScreenReader(): boolean {
    return this.accessibility.screenReader ?? false;
  }
  getEnablePromptCompletion(): boolean {
    return this.enablePromptCompletion;
  }
  getUtilityModel(): string | undefined {
    // Interim utilityModel source; real setting tracked in the companion feature issue (#2614 umbrella)
    const raw = this.initialSettings.utilityModel;
    if (typeof raw !== 'string') {
      return undefined;
    }
    const trimmed = raw.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  getInitialSettings(): Readonly<Record<string, unknown>> {
    return this.initialSettings;
  }
  getEnableHooks(): boolean {
    return this.enableHooks;
  }
  getEnableHooksUI(): boolean {
    return this.enableHooksUI;
  }
  getHooks(): { [K in HookEventName]?: HookDefinition[] } | undefined {
    return this.hooks;
  }
  getEnableInteractiveShell(): boolean {
    return this.shouldUseNodePtyShell;
  }
  getProjectHooks(): { [K in HookEventName]?: HookDefinition[] } | undefined {
    return this.projectHooks;
  }
  getOutputSettings(): OutputSettings {
    return this.outputSettings;
  }
  getUseWriteTodos(): boolean {
    return this.useWriteTodos;
  }
  isSkillsSupportEnabled(): boolean {
    return this.skillsSupport;
  }
  getSanitizationConfig(): EnvironmentSanitizationConfig | undefined {
    return this.sanitizationConfig;
  }
}
