/**
 * @plan:PLAN-20260617-COREAPI.P03
 * @requirement:REQ-002, REQ-006, REQ-017
 * @plan:PLAN-20260621-COREAPIREMED.P06
 * @requirement:REQ-001
 */

import { z } from 'zod';
import type { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type { ApprovalMode } from '@vybestack/llxprt-code-core/config/config.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { PolicyEngineConfig } from '@vybestack/llxprt-code-core/policy/types.js';
import type {
  HookDefinition,
  HookEventName,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { OutputFormat } from '@vybestack/llxprt-code-core/utils/output-format.js';

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
  readonly target?: 'local' | 'gcp';
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

/**
 * Production-safety gate for createAgent harness seams.
 *
 * createAgent historically forces three behaviors that are unsafe for
 * production callers: forced interactive mode (overwrites caller intent),
 * confirmation-forcing policy injection, and unconditional process.cwd()
 * workspace mutation. Each field defaults to `true` (preserving backward
 * compatibility) so existing callers are unaffected unless they explicitly
 * disable a seam.
 *
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P01
 */
export interface AgentHarnessOptions {
  readonly forceInteractive?: boolean;
  readonly forceConfirmations?: boolean;
  readonly includeProcessCwd?: boolean;
}

export interface AgentToolOutputLimits {
  readonly truncateThreshold?: number;
  readonly truncateLines?: number;
  readonly enableTruncation?: boolean;
}

export interface AgentMcpServerConfig {
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly url?: string;
  readonly httpUrl?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly tcp?: string;
  readonly type?: 'sse' | 'http';
  readonly timeout?: number;
  readonly trust?: boolean;
  readonly description?: string;
  readonly includeTools?: readonly string[];
  readonly excludeTools?: readonly string[];
  readonly extensionName?: string;
  readonly extension?: Readonly<Record<string, unknown>>;
  readonly oauth?: Readonly<Record<string, unknown>>;
  readonly authProviderType?: string;
  readonly targetAudience?: string;
  readonly targetServiceAccount?: string;
}

export interface AgentSkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly location: string;
  readonly body: string;
  readonly disabled?: boolean;
  readonly source?: 'builtin' | 'extension' | 'user' | 'project';
}

export interface AgentSandboxConfig {
  readonly command: 'docker' | 'podman' | 'sandbox-exec';
  readonly image: string;
}

export interface AgentLspServerConfig {
  readonly id: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly rootUri?: string;
}

export interface AgentLspConfig {
  readonly servers: readonly AgentLspServerConfig[];
  readonly includeSeverities?: ReadonlyArray<
    'error' | 'warning' | 'info' | 'hint'
  >;
  readonly maxDiagnosticsPerFile?: number;
  readonly maxProjectDiagnosticsFiles?: number;
  readonly diagnosticTimeout?: number;
  readonly firstTouchTimeout?: number;
  readonly navigationTimeout?: number;
  readonly navigationTools?: boolean;
  readonly requestTimeout?: number;
}

export interface AgentExtension {
  readonly name: string;
  readonly version: string;
  readonly isActive: boolean;
  readonly path: string;
  readonly mcpServers?: Readonly<Record<string, AgentMcpServerConfig>>;
  readonly contextFiles: readonly string[];
  readonly excludeTools?: readonly string[];
  readonly hooks?: AgentHooks;
  readonly skills?: readonly AgentSkillDefinition[];
  readonly settings?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly resolvedSettings?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly subagents?: ReadonlyArray<{
    readonly name: string;
    readonly profile: string;
    readonly systemPrompt: string;
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
  readonly mcpServers?: Readonly<Record<string, AgentMcpServerConfig>>;
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
  readonly extensions?: readonly AgentExtension[];
  readonly ide?: AgentIde;
  readonly hooks?: AgentHooks;
  readonly memory?: string;
  readonly skillsSupport?: boolean;
  readonly disabledSkills?: readonly string[];
  readonly adminSkillsEnabled?: boolean;
  readonly streamIdleTimeoutMs?: number;
  readonly toolOutputLimits?: AgentToolOutputLimits;
  readonly outputFormat?: OutputFormat;
  readonly shell?: AgentShell;
  readonly contextLimit?: number;
  readonly compressionThreshold?: number;
  readonly skills?: readonly AgentSkillDefinition[];
  readonly useWriteTodos?: boolean;
  readonly sandbox?: AgentSandboxConfig;
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
  readonly lsp?: boolean | AgentLspConfig;
  /**
   * Production-safety gate for createAgent harness seams. When omitted,
   * createAgent preserves its current (backward-compatible) defaults. Callers
   * who need production-safe behavior (e.g. non-interactive CLI migration)
   * set individual fields to `false` to disable the corresponding unsafe seam.
   *
   * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P01
   */
  readonly harness?: AgentHarnessOptions;
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

export interface FromConfigOptions {
  readonly config: Config;
  readonly messageBus?: MessageBus;
  readonly onApproval?: ApprovalHandler;
  readonly onOAuthPrompt?: OAuthPromptHandler;
  readonly editorCallbacks?: EditorCallbacks;
  readonly toolSchedulerFactory?: AgentSchedulerFactory;
  readonly sessionId?: string;
}

export const FromConfigValidatableSchema = z.object({
  sessionId: z.string().optional(),
});
