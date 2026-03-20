/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TelemetryTarget } from '../telemetry/index.js';
import type { OutputFormat } from '../utils/output-format.js';
import type { HookDefinition, HookEventName } from '../hooks/types.js';
import type { SkillDefinition } from '../skills/skillManager.js';
import type { BucketFailureReason } from '../providers/errors.js';
import type { MCPOAuthConfig } from '../mcp/oauth-provider.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import type { IProviderManager as ProviderManager } from '../providers/IProviderManager.js';
import type { ExtensionLoader } from '../utils/extensionLoader.js';
import { IdeClient } from '../ide/ide-client.js';
import { SettingsService } from '../settings/SettingsService.js';
import type { PolicyEngineConfig } from '../policy/types.js';
import type { EnvironmentSanitizationConfig } from '../services/environmentSanitization.js';
import type { EventEmitter } from 'node:events';

// Import privacy-related types
export interface RedactionConfig {
  redactApiKeys: boolean;
  redactCredentials: boolean;
  redactFilePaths: boolean;
  redactUrls: boolean;
  redactEmails: boolean;
  redactPersonalInfo: boolean;
  customPatterns?: Array<{
    name: string;
    pattern: RegExp;
    replacement: string;
    enabled: boolean;
  }>;
}

export enum ApprovalMode {
  DEFAULT = 'default',
  AUTO_EDIT = 'autoEdit',
  YOLO = 'yolo',
}

export interface AccessibilitySettings {
  disableLoadingPhrases?: boolean;
  screenReader?: boolean;
}

export interface BugCommandSettings {
  urlTemplate: string;
}

export interface ChatCompressionSettings {
  contextPercentageThreshold?: number;
  /** @plan PLAN-20260211-COMPRESSION.P12 */
  strategy?: string;
  /** @plan PLAN-20260211-COMPRESSION.P12 */
  profile?: string;
}

export interface SummarizeToolOutputSettings {
  tokenBudget?: number;
}

export interface ComplexityAnalyzerSettings {
  complexityThreshold?: number;
  minTasksForSuggestion?: number;
  suggestionCooldownMs?: number;
}

export interface OutputSettings {
  format?: OutputFormat;
}

export interface CodebaseInvestigatorSettings {
  enabled?: boolean;
  maxNumTurns?: number;
  maxTimeMinutes?: number;
  thinkingBudget?: number;
  model?: string;
}

export interface IntrospectionAgentSettings {
  enabled?: boolean;
}

export interface TelemetrySettings {
  enabled?: boolean;
  target?: TelemetryTarget;
  otlpEndpoint?: string;
  logPrompts?: boolean;
  outfile?: string;
  logConversations?: boolean;
  logResponses?: boolean;
  redactSensitiveData?: boolean;
  maxConversationHistory?: number;
  conversationLogPath?: string;
  maxLogFiles?: number;
  maxLogSizeMB?: number;
  retentionDays?: number;
  // Privacy-related settings
  redactFilePaths?: boolean;
  redactUrls?: boolean;
  redactEmails?: boolean;
  redactPersonalInfo?: boolean;
  customRedactionPatterns?: Array<{
    name: string;
    pattern: RegExp;
    replacement: string;
    enabled: boolean;
  }>;
  enableDataRetention?: boolean;
  conversationExpirationDays?: number;
  maxConversationsStored?: number;
  remoteConsentGiven?: boolean;
}

/**
 * All information required in CLI to handle an extension. Defined in Core so
 * that the collection of loaded, active, and inactive extensions can be passed
 * around on the config object though Core does not use this information
 * directly.
 */
export interface GeminiCLIExtension {
  name: string;
  version: string;
  isActive: boolean;
  path: string;
  installMetadata?: ExtensionInstallMetadata;
  mcpServers?: Record<string, MCPServerConfig>;
  contextFiles: string[];
  excludeTools?: string[];
  hooks?: { [K in HookEventName]?: HookDefinition[] };
  skills?: SkillDefinition[];
  settings?: Array<Record<string, unknown>>;
  resolvedSettings?: Array<Record<string, unknown>>;
}

export interface ExtensionInstallMetadata {
  source: string;
  type: 'git' | 'local' | 'link' | 'github-release';
  releaseTag?: string; // Only present for github-release installs.
  ref?: string;
  autoUpdate?: boolean;
}

/** Shell replacement mode type */
export type ShellReplacementMode = 'allowlist' | 'all' | 'none';

export class MCPServerConfig {
  constructor(
    // For stdio transport
    readonly command?: string,
    readonly args?: string[],
    readonly env?: Record<string, string>,
    readonly cwd?: string,
    // For sse transport
    readonly url?: string,
    // For streamable http transport
    readonly httpUrl?: string,
    readonly headers?: Record<string, string>,
    // For websocket transport
    readonly tcp?: string,
    /**
     * Transport type for URL-based servers.
     * When set, disables automatic HTTP→SSE fallback.
     * - 'http' → StreamableHTTPClientTransport
     * - 'sse'  → SSEClientTransport
     * - omitted → defaults to HTTP with SSE fallback (deprecated; add type explicitly)
     *
     * Note: 'httpUrl' is deprecated; use 'url' + 'type: "http"' instead.
     * @plan PLAN-20250219-GMERGE021.R3.P03
     * @requirement REQ-GMERGE021-R3-001
     */
    readonly type?: 'sse' | 'http',
    // Common
    readonly timeout?: number,
    readonly trust?: boolean,
    // Metadata
    readonly description?: string,
    readonly includeTools?: string[],
    readonly excludeTools?: string[],
    readonly extensionName?: string,
    readonly extension?: GeminiCLIExtension,
    // OAuth configuration
    readonly oauth?: MCPOAuthConfig,
    readonly authProviderType?: AuthProviderType,
    // Service Account Configuration
    /* targetAudience format: CLIENT_ID.apps.googleusercontent.com */
    readonly targetAudience?: string,
    /* targetServiceAccount format: <service-account-name>@<project-num>.iam.gserviceaccount.com */
    readonly targetServiceAccount?: string,
  ) {}
}

export enum AuthProviderType {
  DYNAMIC_DISCOVERY = 'dynamic_discovery',
  GOOGLE_CREDENTIALS = 'google_credentials',
  SERVICE_ACCOUNT_IMPERSONATION = 'service_account_impersonation',
}

export interface SandboxConfig {
  command: 'docker' | 'podman' | 'sandbox-exec';
  image: string;
}

export interface ActiveExtension {
  name: string;
  version: string;
}

/**
 * @plan PLAN-20260223-ISSUE1598.P03
 * @requirement REQ-1598-IC10
 */
export interface FailoverContext {
  triggeringStatus?: number;
}

/**
 * Handler for bucket failover on rate limit/quota errors
 * @plan PLAN-20251213issue490
 */
export interface BucketFailoverHandler {
  /**
   * Get the list of available buckets
   */
  getBuckets(): string[];

  /**
   * Get the currently active bucket
   */
  getCurrentBucket(): string | undefined;

  /**
   * Try to failover to the next bucket
   * @plan PLAN-20260223-ISSUE1598.P03
   * @param context Optional context about the triggering failure
   * @returns true if failover succeeded (may switch bucket or refresh/reauth current), false if no recovery possible
   */
  tryFailover(context?: FailoverContext): Promise<boolean>;

  /**
   * Check if bucket failover is enabled
   */
  isEnabled(): boolean;

  /**
   * Reset the session tracking so failover can try buckets again in a new request.
   * Call this at the start of each new request to prevent infinite cycling.
   */
  resetSession?(): void;

  /**
   * Full reset for new user turns: clears tried set, resets to first bucket, and
   * resets session bucket to the primary (first) bucket so the next request starts fresh.
   */
  reset?(): void;

  /**
   * @plan PLAN-20260223-ISSUE1598.P03
   * @requirement REQ-1598-IC09
   * Get the failure reasons for buckets that were skipped during last failover
   */
  getLastFailoverReasons?(): Record<string, BucketFailureReason>;

  /**
   * @fix issue1616
   * Eagerly authenticate all unauthenticated buckets.
   * Called at user-turn boundaries so all buckets have tokens before API calls begin.
   * Respects auth-bucket-prompt and auth-bucket-delay ephemerals.
   * No-op for single-bucket profiles.
   */
  ensureBucketsAuthenticated?(): Promise<void>;
}

export interface ConfigParameters {
  sessionId: string;
  embeddingModel?: string;
  sandbox?: SandboxConfig;
  targetDir: string;
  debugMode: boolean;
  outputFormat?: OutputFormat;
  question?: string;

  coreTools?: string[];
  allowedTools?: string[];
  excludeTools?: string[];
  toolDiscoveryCommand?: string;
  toolCallCommand?: string;
  mcpServerCommand?: string;
  mcpServers?: Record<string, MCPServerConfig>;
  lsp?: import('../lsp/types.js').LspConfig | boolean;
  userMemory?: string;
  llxprtMdFileCount?: number;
  llxprtMdFilePaths?: string[];
  approvalMode?: ApprovalMode;
  showMemoryUsage?: boolean;
  contextLimit?: number;
  compressionThreshold?: number;
  contextFileName?: string | string[];
  accessibility?: AccessibilitySettings;
  telemetry?: TelemetrySettings;
  usageStatisticsEnabled?: boolean;
  fileFiltering?: {
    respectGitIgnore?: boolean;
    respectLlxprtIgnore?: boolean;
    enableRecursiveFileSearch?: boolean;
    disableFuzzySearch?: boolean;
  };
  checkpointing?: boolean;
  dumpOnError?: boolean;
  proxy?: string;
  cwd: string;
  fileDiscoveryService?: FileDiscoveryService;
  includeDirectories?: string[];
  bugCommand?: BugCommandSettings;
  model: string;
  extensionContextFilePaths?: string[];
  maxSessionTurns?: number;
  experimentalZedIntegration?: boolean;
  listExtensions?: boolean;
  activeExtensions?: ActiveExtension[];
  providerManager?: ProviderManager;
  provider?: string;
  extensions?: GeminiCLIExtension[];
  extensionLoader?: ExtensionLoader;
  enabledExtensions?: string[];
  enableExtensionReloading?: boolean;
  allowedMcpServers?: string[];
  blockedMcpServers?: Array<{ name: string; extensionName: string }>;
  noBrowser?: boolean;
  summarizeToolOutput?: Record<string, SummarizeToolOutputSettings>;
  folderTrust?: boolean;
  ideMode?: boolean;
  ideClient?: IdeClient;
  complexityAnalyzer?: ComplexityAnalyzerSettings;
  loadMemoryFromIncludeDirectories?: boolean;
  chatCompression?: ChatCompressionSettings;
  interactive?: boolean;
  shellReplacement?: 'allowlist' | 'all' | 'none' | boolean;
  trustedFolder?: boolean;
  useRipgrep?: boolean;
  shouldUseNodePtyShell?: boolean;
  allowPtyThemeOverride?: boolean;
  ptyScrollbackLimit?: number;
  ptyTerminalWidth?: number;
  ptyTerminalHeight?: number;
  skipNextSpeakerCheck?: boolean;
  extensionManagement?: boolean;
  enablePromptCompletion?: boolean;
  eventEmitter?: EventEmitter;
  settingsService?: SettingsService;
  policyEngineConfig?: PolicyEngineConfig;
  truncateToolOutputThreshold?: number;
  truncateToolOutputLines?: number;
  enableToolOutputTruncation?: boolean;
  continueOnFailedApiCall?: boolean;
  enableShellOutputEfficiency?: boolean;
  continueSession?: boolean | string;
  disableYoloMode?: boolean;
  enableHooks?: boolean;
  hooks?: {
    [K in HookEventName]?: HookDefinition[];
  };
  projectHooks?: {
    [K in HookEventName]?: HookDefinition[];
  };
  disabledHooks?: string[];
  skills?: SkillDefinition[];
  skillsSupport?: boolean;
  disabledSkills?: string[];
  sanitizationConfig?: EnvironmentSanitizationConfig;
  onReload?: () => Promise<{ disabledSkills?: string[] }>;
  outputSettings?: OutputSettings;
  codebaseInvestigatorSettings?: CodebaseInvestigatorSettings;
  introspectionAgentSettings?: IntrospectionAgentSettings;
  useWriteTodos?: boolean;

  jitContextEnabled?: boolean;
}
