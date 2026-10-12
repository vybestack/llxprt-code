import type { SessionImageSelection } from './session-image-assembly.js';
import type {
  RuntimeTokenizerFactory,
  RuntimeContentGeneratorFactory,
  ContentGenerator,
} from '@vybestack/llxprt-code-core';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type {
  WorkspaceTrustControlPort,
  WorkspaceIdePort,
} from '@vybestack/llxprt-code-core';
import type { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type {
  ToolSelection,
  ToolPublication,
} from '@vybestack/llxprt-code-tools';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { WorkspaceLspOwner } from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type {
  ContinueTarget,
  RuntimeProviderManager,
  UnreadableRecording,
} from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
/**
 * @plan:PLAN-20260617-COREAPI.P03
 * @requirement:REQ-002, REQ-006, REQ-017
 * @plan:PLAN-20260621-COREAPIREMED.P06
 * @requirement:REQ-001
 */
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import type {
  AgentRuntimeFactoryBindings,
  TokenStore,
} from '@vybestack/llxprt-code-core';
import type { RuntimeActivationBindings } from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import type { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';

import type { TokenStorage } from '@vybestack/llxprt-code-mcp';
import type { McpHostServices } from '@vybestack/llxprt-code-mcp/host/hostServices.js';

import { z } from 'zod';
import type { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type {
  ApprovalMode,
  Config,
  LlxprtExtension,
  MCPServerConfig,
} from '@vybestack/llxprt-code-core/config/config.js';
import type { PolicyEngineConfig } from '@vybestack/llxprt-code-core/policy/types.js';
import type {
  HookDefinition,
  HookEventName,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { OutputFormat } from '@vybestack/llxprt-code-core/utils/output-format.js';
import { ProviderActivationIntentSchema } from './config-schema.js';
import type { ActivationPreflight } from './activationPreflightState.js';

export interface ProviderAuth {
  readonly apiKey?: string;
  readonly apiKeyFile?: string;
  readonly keyName?: string;
  readonly baseUrl?: string;
  readonly oauth?: boolean;
}

/**
 * Declarative provider-activation / authentication intent (#2374, part of
 * #1595). Frontends assemble this as DATA; agent construction
 * (executeProviderActivation / fromConfig) interprets it and performs the
 * imperative switchActiveProvider / refreshAuth / credential-override sequence
 * the CLI bootstrap and Zed integration previously orchestrated by hand.
 *
 * Every field is readonly and serializable so an intent can travel in a config
 * document or a profile.
 */
export interface ProviderActivationIntent {
  /** Explicit provider to activate (from config/profile/CLI). */
  readonly provider?: string;
  /** Fallback provider when none is configured (CLI uses active-or-'gemini'). */
  readonly defaultProvider?: string;
  /** Model override (CLI --model / profile model). */
  readonly model?: string;
  /**
   * Merged model params to apply (profile then CLI, CLI wins). Stale params
   * not in this map are cleared from the active provider.
   */
  readonly modelParams?: Readonly<Record<string, unknown>>;
  /** CLI credential overrides applied BEFORE the provider switch. */
  readonly cliOverrides?: Readonly<{
    readonly key?: string;
    readonly keyfile?: string;
    readonly keyName?: string;
    readonly baseUrl?: string;
    readonly set?: readonly string[];
  }>;
  /**
   * Auth execution mode:
   * - 'auto' (default): refreshAuth with method derived internally;
   * - 'provider-or-oauth': the Zed fallback — refreshAuth('provider') when a
   *   provider is active on the manager, else refreshAuth('oauth');
   * - 'none': skip auth refresh entirely (external auth / --use-external-auth).
   */
  readonly authMode?: 'auto' | 'provider-or-oauth' | 'none';
  /** Auth method passed to refreshAuth in auto mode. */
  readonly authMethod?: string;
  /** In auto mode, retain the active provider if a requested switch fails. */
  readonly providerSwitchPolicy?: 'strict' | 'best-effort';
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
  readonly type?: 'sse' | 'http' | 'streamable-http';
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
) => AgentSchedulerHandle | Promise<AgentSchedulerHandle>;

type MemoryOwnershipOptions = {
  readonly memoryOwner?:
    | { readonly owner: WorkspaceMemoryOwner; readonly ownership?: 'caller' }
    | { readonly owner: WorkspaceMemoryOwner; readonly ownership: 'agent' };
};

import type { HostGitHubBrokerSelection } from './host-github-broker-owner.js';

export interface AgentConfig
  extends MemoryOwnershipOptions,
    HostGitHubBrokerSelection,
    SessionImageSelection {
  readonly trustPort?: WorkspaceTrustControlPort;
  readonly idePort?: WorkspaceIdePort;
  readonly mediaOwner?: SessionMediaOwner;
  readonly provider: string;
  readonly model: string;
  readonly modelParams?: AgentModelParams;
  readonly auth?: AgentAuth;
  readonly tools?: readonly string[];
  readonly excludeTools?: readonly string[];
  /**
   * MCP server declarations. Typed as the core shape because hosts load
   * server configs through core's public settings/extension loaders (#3221).
   */
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
  /**
   * Extensions loaded through core's public extension loader. The full
   * LlxprtExtension payload (installMetadata and future fields included)
   * flows through unchanged (#3221).
   */
  readonly extensions?: readonly LlxprtExtension[];
  readonly ide?: AgentIde;
  readonly hooks?: AgentHooks;
  readonly memory?: string;
  readonly skillsSupport?: boolean;
  readonly disabledSkills?: readonly string[];
  readonly adminSkillsEnabled?: boolean;
  readonly streamIdleTimeoutMs?: number;
  readonly streamFirstResponseTimeoutMs?: number;
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
   * Explicit activation intent takes precedence over provider/model/auth fields.
   * When omitted, createAgent synthesizes an intent from those fields and uses
   * the same executor. Model params on an explicit intent replace active params.
   */
  readonly activation?: ProviderActivationIntent;
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
  readonly definitionOwner?: WorkspaceDefinitionOwner;
  readonly definitionOwnership?: 'agent' | 'caller';
  readonly filesystemOwner?: WorkspaceFilesystemOwner;
  readonly filesystemOwnership?: 'agent' | 'caller';
  readonly lspOwner?: WorkspaceLspOwner;
  readonly lspOwnership?: 'agent' | 'caller';
  readonly mcpHost?: Partial<McpHostServices>;
  readonly mcpTokenStorage?: TokenStorage;
  readonly editorCallbacks?: EditorCallbacks;
  /**
   * Caller-owned factory. Scheduler instances the Agent creates through this
   * factory are Agent-owned resources and are disposed by Agent.dispose().
   * The factory function itself is never disposed.
   */
  readonly toolSchedulerFactory?: AgentSchedulerFactory;
  readonly runtimeFactoryBindings?: AgentRuntimeFactoryBindings;
  readonly tokenizerFactory?: RuntimeTokenizerFactory;
  readonly contentGeneratorFactory?: RuntimeContentGeneratorFactory<ContentGenerator>;
  readonly runtimeActivationBindings?: RuntimeActivationBindings;
  readonly tokenStore?: TokenStore;
  /**
   * UNSTABLE escape hatch. Long-tail settings merged into ConfigParameters by
   * the adapter. Throws if it shadows a typed AgentConfig field. Subject to
   * change without notice.
   */
  readonly settings?: Readonly<Record<string, unknown>>;
}

import type { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';

interface FromConfigBaseOptions
  extends HostGitHubBrokerSelection,
    SessionImageSelection {
  readonly oauthManager?: OAuthManager;
  readonly providerFileLifecycle?: ProviderFileLifecycle;
  readonly tokenizerFactory?: RuntimeTokenizerFactory;
  readonly contentGeneratorFactory?: RuntimeContentGeneratorFactory<ContentGenerator>;
  readonly trustPort?: WorkspaceTrustControlPort;
  readonly idePort?: WorkspaceIdePort;
  readonly hookOwner?: SessionHookOwner;
  readonly definitionOwner?: WorkspaceDefinitionOwner;
  readonly definitionOwnership?: 'agent' | 'caller';
  readonly filesystemOwner?: WorkspaceFilesystemOwner;
  readonly filesystemOwnership?: 'agent' | 'caller';
  readonly lspOwner?: WorkspaceLspOwner;
  readonly lspOwnership?: 'agent' | 'caller';
  readonly policyOwner?: RuntimePolicyOwner;
  readonly agentClient?: AgentClientContract;
  readonly providerManager?: RuntimeProviderManager;
  readonly runtimeFactoryBindings?: AgentRuntimeFactoryBindings;
  readonly runtimeActivationBindings?: RuntimeActivationBindings;
  readonly tokenStore?: TokenStore;
  readonly asyncTaskManager?: AsyncTaskManager;
  readonly config: Config;
  readonly settingsService: SettingsService;
  readonly settingsOwner?: SessionSettingsOwner;
  readonly messageBus?: MessageBus;
  readonly onApproval?: ApprovalHandler;
  readonly onOAuthPrompt?: OAuthPromptHandler;
  readonly editorCallbacks?: EditorCallbacks;
  readonly prepareSessionTools?: (
    config: Config,
    messageBus: MessageBus,
    tools: Pick<ToolSelection, 'getAllTools'> & ToolPublication,
  ) => void;
  readonly toolSchedulerFactory?: AgentSchedulerFactory;
  readonly sessionId?: string;
  /**
   * Which owner may change the supplied Config's session identity on resume.
   * Borrowed facades keep their recording identity private by default.
   */
  readonly sessionIdentityOwnership?: 'config' | 'facade';
  /**
   * Declarative provider-activation / auth intent (#2374). When supplied,
   * fromConfig executes the intent via executeProviderActivation INSTEAD of the
   * legacy bare config.refreshAuth(undefined) call, so frontends no longer need
   * to orchestrate switchActiveProvider / refreshAuth / credential overrides by
   * hand. When omitted, fromConfig preserves the backward-compatible bare
   * refreshAuth path.
   */
  readonly activation?: ProviderActivationIntent;
}

export type FromConfigOptions = FromConfigBaseOptions &
  MemoryOwnershipOptions &
  (
    | {
        readonly mcpRuntime: McpRuntimeOwner;
        readonly mcpOwnership?: 'agent' | 'caller';
        readonly mcpHost?: never;
        readonly mcpTokenStorage?: never;
      }
    | {
        readonly mcpRuntime?: undefined;
        readonly mcpOwnership?: 'agent';
        readonly mcpHost?: Partial<McpHostServices>;
        readonly mcpTokenStorage?: TokenStorage;
      }
  ) &
  (
    | {
        readonly activationPreflight: ActivationPreflight;
        readonly activation: ProviderActivationIntent;
      }
    | { readonly activationPreflight?: undefined }
  );

export const FromConfigValidatableSchema = z.object({
  sessionId: z.string().optional(),
  activation: ProviderActivationIntentSchema.optional(),
});

/** Browser targets plus the recordings session discovery skipped as unreadable. */
export interface BrowserListing {
  readonly targets: readonly ContinueTarget[];
  readonly unreadableRecordings: readonly UnreadableRecording[];
}
