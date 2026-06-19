/**
 * @plan:PLAN-20260617-COREAPI.P03
 * @requirement:REQ-002, REQ-006, REQ-017
 */

import type { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type {
  ApprovalMode,
  ConfigParameters,
  MCPServerConfig,
  SandboxConfig,
  SkillDefinition,
} from '@vybestack/llxprt-code-core/config/config.js';
import type { PolicyEngineConfig } from '@vybestack/llxprt-code-core/policy/types.js';
import type {
  HookDefinition,
  HookEventName,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core/config/configTypes.js';

export type {
  ApprovalMode,
  ConfigParameters,
  MCPServerConfig,
  SandboxConfig,
  SkillDefinition,
} from '@vybestack/llxprt-code-core/config/config.js';
export type { PolicyEngineConfig } from '@vybestack/llxprt-code-core/policy/types.js';
export type {
  HookDefinition,
  HookEventName,
} from '@vybestack/llxprt-code-core/hooks/types.js';
export type { GeminiCLIExtension } from '@vybestack/llxprt-code-core/config/configTypes.js';

export interface ProviderAuth {
  readonly apiKey?: string;
  readonly apiKeyFile?: string;
  readonly keyName?: string;
  readonly baseUrl?: string;
  readonly oauth?: boolean;
}

export interface AgentAuth extends ProviderAuth {
  readonly profile?: string;
  readonly perProvider?: Readonly<Record<string, ProviderAuth>>;
}

export type AgentHooks = Readonly<{
  [K in HookEventName]?: readonly HookDefinition[];
}>;

export type AgentModelParams = Readonly<Record<string, unknown>>;

export interface AgentFileFiltering {
  readonly respectGitIgnore?: boolean;
  readonly respectLlxprtIgnore?: boolean;
  readonly enableRecursiveFileSearch?: boolean;
  readonly disableFuzzySearch?: boolean;
}

export interface AgentTelemetry {
  readonly enabled?: boolean;
  readonly target?: ConfigParameters['telemetry'] extends
    | { target?: infer T }
    | undefined
    ? T
    : never;
  readonly otlpEndpoint?: string;
  readonly logPrompts?: boolean;
  readonly outfile?: string;
  readonly redactSensitiveData?: boolean;
}

export interface AgentCompression {
  readonly contextPercentageThreshold?: number;
  readonly strategy?: string;
  readonly profile?: string;
}

export interface AgentRecording {
  readonly enabled?: boolean;
  readonly path?: string;
  readonly format?: string;
}

export interface AgentIde {
  readonly mode?: boolean;
  readonly experimentalZed?: boolean;
}

export type AgentShell = 'allowlist' | 'all' | 'none';

export interface AgentToolOutputLimits {
  readonly truncateThreshold?: number;
  readonly truncateLines?: number;
  readonly enableTruncation?: boolean;
}

export interface AgentExtensions {
  readonly enabled?: readonly string[];
  readonly active?: ReadonlyArray<{
    readonly name: string;
    readonly version: string;
  }>;
}

export type ApprovalHandler = (confirmation: {
  readonly confirmationId: string;
  readonly toolCallId: string;
  readonly name: string;
  readonly details: unknown;
}) => Promise<ToolConfirmationOutcome> | ToolConfirmationOutcome;

export type OAuthPromptHandler = (prompt: {
  readonly url: string;
  readonly provider: string;
  readonly message?: string;
}) => Promise<boolean> | boolean;

export interface EditorCallbacks {
  readonly getPreferredEditor?: () => string | undefined;
  readonly onEditorClose?: () => void;
  readonly onEditorOpen?: () => void;
}

export interface AgentSchedulerHandle {
  dispose(): Promise<void> | void;
}

export interface AgentSchedulerFactoryOptions {
  readonly sessionId: string;
  readonly interactiveMode?: boolean;
}

export type AgentSchedulerFactory = (
  options: AgentSchedulerFactoryOptions,
) => AgentSchedulerHandle;

export interface AgentConfig {
  readonly provider: string;
  readonly model: string;
  readonly modelParams?: AgentModelParams;
  readonly auth?: AgentAuth;
  readonly tools?: readonly string[];
  readonly excludeTools?: readonly string[];
  readonly mcpServers?: Readonly<Record<string, MCPServerConfig>>;
  readonly approvalMode?: ApprovalMode;
  readonly systemPrompt?: string;
  readonly workingDir?: string;
  readonly sessionId?: string;
  readonly includeDirectories?: readonly string[];
  readonly fileFiltering?: AgentFileFiltering;
  readonly telemetry?: AgentTelemetry;
  readonly proxy?: string;
  readonly maxSessionTurns?: number;
  readonly compression?: AgentCompression;
  readonly checkpointing?: boolean;
  readonly recording?: AgentRecording;
  readonly policy?: PolicyEngineConfig;
  readonly extensions?: readonly GeminiCLIExtension[];
  readonly ide?: AgentIde;
  readonly hooks?: AgentHooks;
  readonly memory?: string;
  readonly streamIdleTimeoutMs?: number;
  readonly toolOutputLimits?: AgentToolOutputLimits;
  readonly outputFormat?: ConfigParameters['outputFormat'];
  readonly shell?: AgentShell;
  readonly contextLimit?: number;
  readonly compressionThreshold?: number;
  readonly skills?: readonly SkillDefinition[];
  readonly useWriteTodos?: boolean;
  readonly sandbox?: SandboxConfig;
  readonly folderTrust?: boolean;
  readonly embeddingModel?: string;
  readonly debugMode?: boolean;
  readonly continueOnFailedApiCall?: boolean;
  readonly allowedTools?: readonly string[];
  readonly coreTools?: readonly string[];
  readonly toolDiscoveryCommand?: string;
  readonly toolCallCommand?: string;
  readonly mcpServerCommand?: string;
  readonly allowedMcpServers?: readonly string[];
  readonly blockedMcpServers?: ReadonlyArray<{
    readonly name: string;
    readonly extensionName: string;
  }>;
  readonly mcpEnabled?: boolean;
  readonly extensionsEnabled?: boolean;
  readonly projectHooks?: AgentHooks;
  readonly disabledHooks?: readonly string[];
  readonly interactive?: boolean;
  readonly onApproval?: ApprovalHandler;
  readonly onOAuthPrompt?: OAuthPromptHandler;
  readonly editorCallbacks?: EditorCallbacks;
  /**
   * Caller-owned factory. Scheduler instances the Agent creates through this
   * factory are Agent-owned resources and are disposed by Agent.dispose().
   * The factory function itself is never disposed.
   */
  readonly toolSchedulerFactory?: AgentSchedulerFactory;
  /**
   * UNSTABLE escape hatch. Long-tail settings merged into ConfigParameters by
   * the adapter. Throws if it shadows a typed AgentConfig field. Subject to
   * change without notice.
   */
  readonly settings?: Readonly<Record<string, unknown>>;
}
