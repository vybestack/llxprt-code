/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  WorkspacePathOperations,
  WorkspaceTextOperations,
  WorkspaceScanOperations,
  WorkspaceIgnoreOperations,
} from '../services/workspace-filesystem-owner.js';

/**
 * Shared configuration types extracted from config.ts.
 * Pure type definitions — no runtime behavior.
 */

import type { HookEventName, HookDefinition } from '../hooks/types.js';
import type { SkillDefinition } from '../skills/skillManager.js';
/**
 * @plan:PLAN-20260603-ISSUE1584.P05
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-05, lines 50-54
 *
 * BucketFailureReason now imported from core-owned contract
 * instead of providers package.
 */
import type { BucketFailureReason } from '../runtime/contracts/BucketFailureReason.js';
import type {
  McpApprovalPolicy,
  MCPOAuthConfig,
} from '@vybestack/llxprt-code-mcp';
import type { MCPServerConfig } from '@vybestack/llxprt-code-mcp/config/mcpServerConfig.js';
import type { OutputFormat } from '../utils/output-format.js';
import type { FileFilteringOptions } from './constants.js';
import type { EnvironmentSanitizationConfig } from '../services/environmentSanitization.js';
import type { PolicyEngineConfig } from '../policy/types.js';
import type {
  AnyToolInvocation,
  ISkillService,
  ToolPublication,
  ILspService,
} from '@vybestack/llxprt-code-tools';
import type { LspConfig } from '@vybestack/llxprt-code-ide-integration';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

export type {
  MCPOAuthConfig,
  MCPServerConfig,
  AnyToolInvocation,
  SkillDefinition,
};

/**
 * Registration hook for post-skill-discovery tool registration.
 *
 * The workspace skill owner calls this after discovery and reload, passing
 * core-owned dependencies. The composition root
 * (CLI) supplies a callback that constructs and registers the concrete
 * ActivateSkillTool from the tools package, eliminating the inverted
 * core->tools dependency.
 *
 * The callback owns both halves of the decision: it must replace any existing
 * registration so the tool's captured skill names stay current, and it must
 * unregister the tool when the skill service reports no available skills
 * (issue #3379).
 */
export type PostSkillDiscoveryToolRegistrar = (
  toolRegistry: ToolPublication,
  skillService: ISkillService,
  messageBus: MessageBus,
) => void;

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

export interface IntrospectionAgentSettings {
  enabled?: boolean;
}

/**
 * Client-side performance telemetry settings (D2).
 *
 * The persisted shape is nested: `telemetry.perf.enabled` (master) and
 * `telemetry.perf.memory`, both default false. `telemetry.perf` itself is
 * an object, never a boolean. Memory is effective only when enabled is true.
 */
export interface PerfTelemetrySettings {
  enabled?: boolean;
  memory?: boolean;
}

export interface TelemetrySettings {
  enabled?: boolean;
  logPrompts?: boolean;
  outfile?: string;
  logApiBodies?: boolean;
  logApiBodyMaxChars?: number;
  outfileMaxBytes?: number;
  outfileMaxFiles?: number;
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
  perf?: PerfTelemetrySettings;
}

/**
 * All information required in CLI to handle an extension. Defined in Core so
 * that the collection of loaded, active, and inactive extensions can be passed
 * around on the config object though Core does not use this information
 * directly.
 */
export interface LlxprtExtension {
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
  subagents?: Array<{
    name: string;
    profile: string;
    systemPrompt: string;
  }>;
}

export interface ExtensionInstallMetadata {
  source: string;
  type: 'git' | 'local' | 'link' | 'github-release';
  releaseTag?: string; // Only present for github-release installs.
  ref?: string;
  autoUpdate?: boolean;
  allowPreRelease?: boolean;
}

export type { FileFilteringOptions };

/** Shell replacement mode type */
export type ShellReplacementMode = 'allowlist' | 'all' | 'none';

/**
 * Normalize shell-replacement setting to canonical mode.
 * Handles legacy boolean values for backward compatibility.
 */
export function normalizeShellReplacement(
  value: ShellReplacementMode | boolean | undefined,
): ShellReplacementMode {
  if (value === undefined) {
    return 'allowlist'; // Default to upstream behavior
  }
  if (value === true || value === 'all') {
    return 'all';
  }
  if (value === false || value === 'none') {
    return 'none';
  }
  // Fallback for allowlist and any unexpected value
  return 'allowlist';
}

export const DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD = 4_000_000;
export const DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES = 1000;

export const DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES = 15 * 1024 * 1024;

// Owned by @vybestack/llxprt-code-auth (a dependency-graph leaf) so that
// @vybestack/llxprt-code-mcp can use it without depending on core, which
// value-imports mcp (#3305). Re-exported here to keep core's public surface
// unchanged for existing consumers.
import { AuthProviderType } from '@vybestack/llxprt-code-auth/mcp-auth-provider-type.js';
export { AuthProviderType };

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
  authRetryTimeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Handler for authentication errors (401/403) that allows cache invalidation
 * and force-refresh before retrying with the same revoked token.
 * @fix issue1861
 */
export interface OnAuthErrorHandler {
  /**
   * Handle an authentication error by invalidating caches and/or forcing token refresh.
   * Called by RetryOrchestrator and retryWithBackoff on 401/403 errors before retry.
   *
   * @param context - Information about the failed authentication attempt
   */
  handleAuthError(context: {
    failedAccessToken: string;
    providerId: string;
    profileId?: string;
    errorStatus: number;
    signal?: AbortSignal;
  }): Promise<void>;
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

export interface MemorySettings {
  readonly importFormat: 'tree' | 'flat';
  readonly filenames: readonly string[];
  readonly maxDirectories: number;
  readonly maxDepth?: number;
  readonly filtering: FileFilteringOptions;
}

export interface ConfigParameters {
  readonly profileDirectory?: string;
  readonly subagentDirectory?: string;
  memorySettings?: Omit<MemorySettings, 'filenames'> & {
    readonly filenames?: readonly string[];
  };
  sessionId: string;
  embeddingModel?: string;
  sandbox?: SandboxConfig;
  targetDir: string;
  storageRoot?: string;
  debugMode: boolean;
  outputFormat?: OutputFormat;
  question?: string;
  quiet?: boolean;

  coreTools?: string[];
  allowedTools?: string[];
  excludeTools?: string[];
  toolDiscoveryCommand?: string;
  toolCallCommand?: string;
  mcpServerCommand?: string;
  mcpServers?: Record<string, MCPServerConfig>;
  lsp?: LspConfig | boolean;
  userMemory?: string;
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
  includeDirectories?: string[];
  bugCommand?: BugCommandSettings;
  model: string;
  extensionContextFilePaths?: string[];
  maxSessionTurns?: number;
  experimentalZedIntegration?: boolean;
  listExtensions?: boolean;
  activeExtensions?: ActiveExtension[];
  provider?: string;
  extensions?: LlxprtExtension[];
  enabledExtensions?: string[];
  enableExtensionReloading?: boolean;
  allowedMcpServers?: string[];
  blockedMcpServers?: Array<{ name: string; extensionName: string }>;
  noBrowser?: boolean;
  summarizeToolOutput?: Record<string, SummarizeToolOutputSettings>;
  folderTrust?: boolean;
  ideMode?: boolean;
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
  initialSettings?: Readonly<Record<string, unknown>>;
  policyEngineConfig?: PolicyEngineConfig;
  truncateToolOutputThreshold?: number;
  truncateToolOutputLines?: number;
  enableToolOutputTruncation?: boolean;
  continueOnFailedApiCall?: boolean;
  imagePayloadBudgetBytes?: number;
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
  outputSettings?: OutputSettings;
  introspectionAgentSettings?: IntrospectionAgentSettings;
  useWriteTodos?: boolean;

  jitContextEnabled?: boolean;
  adminSkillsEnabled?: boolean;
  enableHooksUI?: boolean;
  experimentalJitContext?: boolean;
  disableLLMCorrection?: boolean;
  onModelChange?: (model: string) => void;
  mcpEnabled?: boolean;
  extensionsEnabled?: boolean;
}

export interface ConfigInitializationDependencies {
  readonly initializeMemory?: () => Promise<void>;
  workspacePaths: WorkspacePathOperations;
  workspaceFiles: WorkspaceTextOperations;
  workspaceIgnore: WorkspaceIgnoreOperations;
  workspaceScans: WorkspaceScanOperations;
  lspDiagnostics?: ILspService;
  initializeIde?: () => Promise<void>;
  initializeTools: () => Promise<void>;
  startLsp?: () => Promise<void>;
  startExtensions?: () => Promise<void>;
  publishTools?: () => Promise<void>;
  summarizeOutput?: (
    content: string,
    signal: AbortSignal,
    tokenBudget?: number,
  ) => Promise<string>;
  mcpApprovalPolicy: McpApprovalPolicy;
  startMcpDiscovery: () => void;
  startMcpExtension: (extension: LlxprtExtension) => Promise<void>;
  stopMcpExtension: (extension: LlxprtExtension) => Promise<void>;
  readMcpInstructions: () => string | undefined;
  messageBus?: MessageBus;
  startMcp?: () => Promise<void>;
}
