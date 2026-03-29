/**
 * ConfigBaseCore — field declarations and simple single-delegation accessors.
 * ConfigBase extends this and adds abstract methods + complex multi-line logic.
 */

import * as path from 'node:path';
import type { EventEmitter } from 'node:events';
import type { SubagentSchedulerFactory } from '../core/subagentScheduler.js';
import type { ContentGeneratorConfig } from '../core/contentGenerator.js';
import type { GeminiClient } from '../core/client.js';
import type { PromptRegistry } from '../prompts/prompt-registry.js';
import type { ResourceRegistry } from '../resources/resource-registry.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import type { McpClientManager } from '../tools/mcp-client-manager.js';
import { LLXPRT_CONFIG_DIR as LLXPRT_DIR } from '../tools/memoryTool.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import type { HookDefinition, HookEventName } from '../hooks/types.js';
import type { HookSystem } from '../hooks/hookSystem.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import type { GitService } from '../services/gitService.js';
import type { ContextManager } from '../services/contextManager.js';
import type { SessionRecordingService } from '../recording/SessionRecordingService.js';
import type { AsyncTaskManager } from '../services/asyncTaskManager.js';
import type { AsyncTaskReminderService } from '../services/asyncTaskReminderService.js';
import type { AsyncTaskAutoTrigger } from '../services/asyncTaskAutoTrigger.js';
import type { FileSystemService } from '../services/fileSystemService.js';
import type { EnvironmentSanitizationConfig } from '../services/environmentSanitization.js';
import type { OutputFormat } from '../utils/output-format.js';
import { shouldAttemptBrowserLaunch } from '../utils/browser.js';
import type { WorkspaceContext } from '../utils/workspaceContext.js';
import type { ExtensionLoader } from '../utils/extensionLoader.js';
import {
  type TelemetryTarget,
  DEFAULT_TELEMETRY_TARGET,
  DEFAULT_OTLP_ENDPOINT,
} from '../telemetry/index.js';
import type { IProviderManager as ProviderManager } from '../providers/IProviderManager.js';
import type { IdeClient } from '../ide/ide-client.js';
import type { SettingsService } from '../settings/SettingsService.js';
import type { ProfileManager } from './profileManager.js';
import type { SubagentManager } from './subagentManager.js';
import type { Storage } from './storage.js';
import type { FileExclusions } from '../utils/ignorePatterns.js';
import type { PolicyEngine } from '../policy/policy-engine.js';
import type { SkillManager } from '../skills/skillManager.js';
import type { ToolRecord } from './toolRegistryFactory.js';
import type { LspState } from './lspIntegration.js';
import type {
  ApprovalMode,
  AccessibilitySettings,
  BugCommandSettings,
  ChatCompressionSettings,
  SummarizeToolOutputSettings,
  ComplexityAnalyzerSettings,
  OutputSettings,
  CodebaseInvestigatorSettings,
  IntrospectionAgentSettings,
  TelemetrySettings,
  GeminiCLIExtension,
  MCPServerConfig,
  SandboxConfig,
  ActiveExtension,
  BucketFailoverHandler,
  FileFilteringOptions,
} from './configTypes.js';

export abstract class ConfigBaseCore {
  protected toolRegistry!: ToolRegistry;
  protected mcpClientManager?: McpClientManager;
  protected allowedMcpServers!: string[];
  protected blockedMcpServers!: Array<{ name: string; extensionName: string }>;
  protected promptRegistry!: PromptRegistry;
  protected resourceRegistry!: ResourceRegistry;
  protected readonly sessionId!: string;
  protected adoptedSessionId: string | undefined;
  protected readonly settingsService!: SettingsService;
  protected fileSystemService!: FileSystemService;
  protected contentGeneratorConfig!: ContentGeneratorConfig;
  protected readonly embeddingModel: string | undefined;
  protected readonly sandbox: SandboxConfig | undefined;
  protected readonly targetDir!: string;
  protected workspaceContext!: WorkspaceContext;
  protected readonly debugMode!: boolean;
  protected readonly outputFormat!: OutputFormat;
  protected readonly question: string | undefined;
  /**
   * @plan PLAN-20250212-LSP.P33
   * @requirement REQ-CFG-010, REQ-CFG-015, REQ-CFG-070
   */
  protected readonly _lspState: LspState = {};
  protected readonly coreTools: string[] | undefined;
  protected readonly allowedTools: string[] | undefined;
  protected readonly excludeTools: string[] | undefined;
  protected readonly toolDiscoveryCommand: string | undefined;
  protected readonly toolCallCommand: string | undefined;
  protected readonly mcpServerCommand: string | undefined;
  protected mcpServers: Record<string, MCPServerConfig> | undefined;
  protected userMemory!: string;
  protected llxprtMdFileCount!: number;
  protected llxprtMdFilePaths!: string[];
  protected approvalMode!: ApprovalMode;
  protected readonly jitContextEnabled?: boolean;
  protected contextManager?: ContextManager;
  protected terminalBackground: string | undefined = undefined;
  protected readonly showMemoryUsage!: boolean;
  protected readonly accessibility!: AccessibilitySettings;
  protected telemetrySettings!: TelemetrySettings;
  protected readonly usageStatisticsEnabled!: boolean;
  protected geminiClient!: GeminiClient;
  protected runtimeState!: AgentRuntimeState;
  protected readonly fileFiltering!: {
    respectGitIgnore: boolean;
    respectLlxprtIgnore: boolean;
    enableRecursiveFileSearch: boolean;
    disableFuzzySearch: boolean;
  };
  protected alwaysAllowedCommands: Set<string> = new Set();
  protected fileDiscoveryService: FileDiscoveryService | null = null;
  protected gitService: GitService | undefined = undefined;
  protected sessionRecordingService: SessionRecordingService | undefined =
    undefined;
  // @plan PLAN-20260130-ASYNCTASK.P09
  protected asyncTaskManager: AsyncTaskManager | undefined = undefined;
  // @plan PLAN-20260130-ASYNCTASK.P22
  protected asyncTaskReminderService?: AsyncTaskReminderService;
  protected asyncTaskAutoTrigger?: AsyncTaskAutoTrigger;
  protected readonly checkpointing!: boolean;
  protected readonly dumpOnError!: boolean;
  protected readonly proxy: string | undefined;
  protected readonly cwd!: string;
  protected readonly bugCommand: BugCommandSettings | undefined;
  protected model!: string;
  protected readonly originalModel!: string;
  protected readonly extensionContextFilePaths!: string[];
  protected readonly noBrowser!: boolean;
  protected readonly folderTrust!: boolean;
  protected ideMode!: boolean;
  protected ideClient!: IdeClient;
  protected inFallbackMode = false;
  protected _modelSwitchedDuringSession: boolean = false;
  protected readonly maxSessionTurns!: number;
  protected readonly _activeExtensions!: ActiveExtension[];
  protected readonly listExtensions!: boolean;
  protected readonly _extensionLoader!: ExtensionLoader;
  protected readonly enableExtensionReloading!: boolean;
  protected providerManager?: ProviderManager;
  protected profileManager?: ProfileManager;
  protected subagentManager?: SubagentManager;
  protected subagentSchedulerFactory?: SubagentSchedulerFactory;
  protected bucketFailoverHandler?: BucketFailoverHandler;
  // Track all potential tools for settings UI
  protected allPotentialTools: ToolRecord[] = [];
  protected provider?: string;
  protected readonly summarizeToolOutput:
    | Record<string, SummarizeToolOutputSettings>
    | undefined;
  protected readonly experimentalZedIntegration: boolean = false;
  protected readonly complexityAnalyzerSettings!: ComplexityAnalyzerSettings;
  protected readonly loadMemoryFromIncludeDirectories: boolean = false;
  protected readonly chatCompression: ChatCompressionSettings | undefined;
  protected readonly interactive!: boolean;
  protected readonly trustedFolder: boolean | undefined;
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
  readonly storage!: Storage;
  protected readonly fileExclusions!: FileExclusions;
  protected readonly eventEmitter?: EventEmitter;
  protected readonly policyEngine!: PolicyEngine;

  truncateToolOutputThreshold!: number;
  truncateToolOutputLines!: number;
  enableToolOutputTruncation!: boolean;

  protected readonly continueOnFailedApiCall!: boolean;
  protected readonly enableShellOutputEfficiency!: boolean;
  protected readonly continueSession!: boolean | string;
  protected readonly disableYoloMode!: boolean;
  protected readonly enableHooks!: boolean;
  protected readonly hooks:
    | { [K in HookEventName]?: HookDefinition[] }
    | undefined;
  protected disabledHooks: string[] = [];
  protected readonly projectHooks:
    | ({ [K in HookEventName]?: HookDefinition[] } & { disabled?: string[] })
    | undefined;
  protected skillManager!: SkillManager;
  protected readonly skillsSupport!: boolean;
  protected disabledSkills!: string[];
  protected readonly enableHooksUI!: boolean;
  protected adminSkillsEnabled: boolean = true;
  protected readonly sanitizationConfig?: EnvironmentSanitizationConfig;
  protected readonly _onReload:
    | (() => Promise<{
        disabledSkills?: string[];
        adminSkillsEnabled?: boolean;
      }>)
    | undefined;
  protected readonly outputSettings!: OutputSettings;
  protected readonly codebaseInvestigatorSettings!: CodebaseInvestigatorSettings;
  protected readonly introspectionAgentSettings!: IntrospectionAgentSettings;
  protected readonly useWriteTodos!: boolean;
  /**
   * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P03
   * @requirement:HOOK-001,HOOK-002
   * Lazily-created HookSystem instance, only when enableHooks=true
   */
  protected hookSystem: HookSystem | undefined;
  protected initialized = false;

  // ---- Simple field accessors ----

  setProviderManager(providerManager: ProviderManager) {
    this.providerManager = providerManager;
  }
  getProviderManager(): ProviderManager | undefined {
    return this.providerManager;
  }
  setProfileManager(manager: ProfileManager | undefined): void {
    this.profileManager = manager;
  }
  getProfileManager(): ProfileManager | undefined {
    return this.profileManager;
  }
  setSubagentManager(manager: SubagentManager | undefined): void {
    this.subagentManager = manager;
  }
  getSubagentManager(): SubagentManager | undefined {
    return this.subagentManager;
  }
  /**
   * Set the bucket failover handler for rate limit/quota error handling
   * @plan PLAN-20251213issue490
   */
  setBucketFailoverHandler(handler: BucketFailoverHandler | undefined): void {
    this.bucketFailoverHandler = handler;
  }
  /**
   * Get the bucket failover handler
   * @plan PLAN-20251213issue490
   */
  getBucketFailoverHandler(): BucketFailoverHandler | undefined {
    return this.bucketFailoverHandler;
  }
  /**
   * Set the session recording service for hooks to access transcript path
   * @plan PLAN-20250219-GMERGE022.B2
   * @requirement R1
   */
  setSessionRecordingService(
    service: SessionRecordingService | undefined,
  ): void {
    this.sessionRecordingService = service;
  }
  /**
   * Get the session recording service
   * @plan PLAN-20250219-GMERGE022.B2
   * @requirement R1
   */
  getSessionRecordingService(): SessionRecordingService | undefined {
    return this.sessionRecordingService;
  }
  setInteractiveSubagentSchedulerFactory(
    factory: SubagentSchedulerFactory | undefined,
  ): void {
    this.subagentSchedulerFactory = factory;
  }
  getInteractiveSubagentSchedulerFactory():
    | SubagentSchedulerFactory
    | undefined {
    return this.subagentSchedulerFactory;
  }

  isContinueSession(): boolean {
    return !!this.continueSession;
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
  getContentGeneratorConfig(): ContentGeneratorConfig | undefined {
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
  getWorkspaceContext(): WorkspaceContext {
    return this.workspaceContext;
  }
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }
  getPromptRegistry(): PromptRegistry {
    return this.promptRegistry;
  }
  getResourceRegistry(): ResourceRegistry {
    return this.resourceRegistry;
  }
  getSkillManager(): SkillManager {
    return this.skillManager;
  }
  getDebugMode(): boolean {
    return this.debugMode;
  }
  getOutputFormat(): OutputFormat {
    return this.outputFormat;
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
  getMcpClientManager(): McpClientManager | undefined {
    return this.mcpClientManager;
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
  setCoreMemory(_content: string): void {}
  setUserMemory(newUserMemory: string): void {
    this.userMemory = newUserMemory;
  }
  setLlxprtMdFileCount(count: number): void {
    this.llxprtMdFileCount = count;
  }
  setLlxprtMdFilePaths(paths: string[]): void {
    this.llxprtMdFilePaths = paths;
  }
  getApprovalMode(): ApprovalMode {
    return this.approvalMode;
  }
  isJitContextEnabled(): boolean {
    return !!this.jitContextEnabled;
  }
  getContextManager(): ContextManager | undefined {
    return this.contextManager;
  }
  getAccessibility(): AccessibilitySettings {
    return this.accessibility;
  }
  getPolicyEngine(): PolicyEngine {
    return this.policyEngine;
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
  getTelemetryLogPromptsEnabled(): boolean {
    return this.telemetrySettings.logPrompts ?? true;
  }
  getTelemetryOtlpEndpoint(): string {
    return this.telemetrySettings.otlpEndpoint ?? DEFAULT_OTLP_ENDPOINT;
  }
  getTelemetryTarget(): TelemetryTarget {
    return this.telemetrySettings.target ?? DEFAULT_TELEMETRY_TARGET;
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
  getGeminiClient(): GeminiClient {
    return this.geminiClient;
  }
  getGeminiDir(): string {
    return path.join(this.targetDir, LLXPRT_DIR);
  }
  getProjectTempDir(): string {
    return this.storage.getProjectTempDir();
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
    const customExcludes: string[] = [];
    return customExcludes;
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
  getFileService(): FileDiscoveryService {
    if (this.fileDiscoveryService == null) {
      this.fileDiscoveryService = new FileDiscoveryService(this.targetDir);
    }
    return this.fileDiscoveryService;
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
  getExtensionLoader(): ExtensionLoader {
    return this._extensionLoader;
  }
  getExtensions(): GeminiCLIExtension[] {
    return this._extensionLoader.getExtensions();
  }
  getActiveExtensions(): ActiveExtension[] {
    return this._activeExtensions;
  }
  isExtensionEnabled(extensionName: string): boolean {
    const extension = this._extensionLoader
      .getExtensions()
      .find((ext) => ext.name === extensionName);
    // If extension not found, default to true to avoid filtering
    return extension != null ? extension.isActive : true;
  }
  getEnableExtensionReloading(): boolean {
    return this.enableExtensionReloading;
  }
  getExtensionEvents(): EventEmitter | undefined {
    return this.eventEmitter;
  }
  getProvider(): string | undefined {
    return this.provider;
  }
  setProvider(provider: string): void {
    this.provider = provider;
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
  getIdeClient(): IdeClient | undefined {
    return this.ideClient;
  }
  getIdeMode(): boolean {
    return this.ideMode;
  }
  getFolderTrust(): boolean {
    return this.folderTrust;
  }
  setIdeMode(value: boolean): void {
    this.ideMode = value;
  }
  setIdeClientDisconnected(): void {
    void this.ideClient?.disconnect();
  }
  setIdeClientConnected(): void {
    void this.ideClient?.connect();
  }
  getComplexityAnalyzerSettings(): ComplexityAnalyzerSettings {
    return this.complexityAnalyzerSettings;
  }
  clearEphemeralSettings(): void {
    this.settingsService.clear();
  }
  isInteractive(): boolean {
    return this.interactive;
  }
  getNonInteractive(): boolean {
    return !this.interactive;
  }
  getFileSystemService(): FileSystemService {
    return this.fileSystemService;
  }
  setFileSystemService(fileSystemService: FileSystemService): void {
    this.fileSystemService = fileSystemService;
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
  getEnableShellOutputEfficiency(): boolean {
    return this.enableShellOutputEfficiency;
  }
  getScreenReader(): boolean {
    return this.accessibility.screenReader ?? false;
  }
  getEnablePromptCompletion(): boolean {
    return this.enablePromptCompletion;
  }
  getSettingsService(): SettingsService {
    return this.settingsService;
  }
  getFileExclusions(): FileExclusions {
    return this.fileExclusions;
  }
  getAllPotentialTools() {
    return this.allPotentialTools;
  }
  getToolRegistryInfo() {
    return {
      registered: this.allPotentialTools.filter((t) => t.isRegistered),
      unregistered: this.allPotentialTools.filter((t) => !t.isRegistered),
    };
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
  getProjectHooks():
    | ({ [K in HookEventName]?: HookDefinition[] } & { disabled?: string[] })
    | undefined {
    return this.projectHooks;
  }
  getOutputSettings(): OutputSettings {
    return this.outputSettings;
  }
  getCodebaseInvestigatorSettings(): CodebaseInvestigatorSettings {
    return this.codebaseInvestigatorSettings;
  }
  getIntrospectionAgentSettings(): IntrospectionAgentSettings {
    return this.introspectionAgentSettings;
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
