/**
 * @plan:PLAN-20260617-COREAPI.P03
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-002, REQ-017, REQ-013
 */

import { z } from 'zod';
import {
  ApprovalMode,
  AuthProviderType,
  type MCPServerConfig,
} from '@vybestack/llxprt-code-core/config/config.js';
import type {
  LspConfig,
  LspServerConfig,
} from '@vybestack/llxprt-code-ide-integration';
import type {
  AgentSchedulerFactory,
  ApprovalHandler,
  EditorCallbacks,
  OAuthPromptHandler,
} from './config-types.js';

export const ProviderAuthSchema = z
  .object({
    apiKey: z.string().optional(),
    apiKeyFile: z.string().optional(),
    keyName: z.string().optional(),
    baseUrl: z.string().optional(),
    oauth: z.boolean().optional(),
  })
  .strict();

export const AgentAuthSchema = ProviderAuthSchema.extend({
  profile: z.string().optional(),
  perProvider: z.record(ProviderAuthSchema).optional(),
}).strict();

export const AgentFileFilteringSchema = z
  .object({
    respectGitIgnore: z.boolean().optional(),
    respectLlxprtIgnore: z.boolean().optional(),
    enableRecursiveFileSearch: z.boolean().optional(),
    disableFuzzySearch: z.boolean().optional(),
  })
  .strict();

export const AgentTelemetrySchema = z
  .object({
    enabled: z.boolean().optional(),
    target: z.string().optional(),
    otlpEndpoint: z.string().optional(),
    logPrompts: z.boolean().optional(),
    outfile: z.string().optional(),
    redactSensitiveData: z.boolean().optional(),
  })
  .strict();

export const AgentCompressionSchema = z
  .object({
    contextPercentageThreshold: z.number().optional(),
    strategy: z.string().optional(),
    profile: z.string().optional(),
  })
  .strict();

export const AgentRecordingSchema = z
  .object({
    enabled: z.boolean().optional(),
    path: z.string().optional(),
    format: z.string().optional(),
  })
  .strict();

export const AgentIdeSchema = z
  .object({
    mode: z.boolean().optional(),
    experimentalZed: z.boolean().optional(),
  })
  .strict();

export const AgentShellSchema = z.enum(['allowlist', 'all', 'none']);

export const AgentToolOutputLimitsSchema = z
  .object({
    truncateThreshold: z.number().optional(),
    truncateLines: z.number().optional(),
    enableTruncation: z.boolean().optional(),
  })
  .strict();

/**
 * Production-safety gate for createAgent harness seams.
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P01
 */
export const AgentHarnessSchema = z
  .object({
    forceInteractive: z.boolean().optional(),
    forceConfirmations: z.boolean().optional(),
    includeProcessCwd: z.boolean().optional(),
  })
  .strict();

export const BlockedMcpServerEntrySchema = z
  .object({
    name: z.string(),
    extensionName: z.string(),
  })
  .strict();

export const AgentSchedulerFactoryOptionsSchema = z
  .object({
    sessionId: z.string(),
    interactiveMode: z.boolean().optional(),
  })
  .strict();

/**
 * Structural validation for an MCP server configuration.
 *
 * The public {@link MCPServerConfig} is a CLASS with ~20 positional constructor
 * arguments. Forcing public API callers to instantiate that class is a poor
 * surface, so the schema validates the STRUCTURAL field shape instead of an
 * instance. The adapter ({@link toConfigParameters}) deep-clones the value
 * (JSON round-trip), producing plain objects that the core Config consumes
 * structurally as MCPServerConfig — so an instance is never required.
 *
 * Extra/unknown keys are passed through (no `.strict()`) so forward-compatible
 * server fields are not rejected. The inferred type is widened to
 * `MCPServerConfig` at the {@link AgentConfigSchema} boundary so the public
 * `AgentConfig.mcpServers` type stays clean for consumers.
 *
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-013
 */
export const McpServerConfigSchema = z.object({
  // stdio transport
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
  // sse transport
  url: z.string().optional(),
  // streamable http transport
  httpUrl: z.string().optional(),
  headers: z.record(z.string()).optional(),
  // websocket transport
  tcp: z.string().optional(),
  // transport selector for URL-based servers
  type: z.enum(['sse', 'http']).optional(),
  // common
  timeout: z.number().optional(),
  trust: z.boolean().optional(),
  // metadata
  description: z.string().optional(),
  includeTools: z.array(z.string()).optional(),
  excludeTools: z.array(z.string()).optional(),
  extensionName: z.string().optional(),
  extension: z.record(z.unknown()).optional(),
  // OAuth configuration
  oauth: z.record(z.unknown()).optional(),
  authProviderType: z.nativeEnum(AuthProviderType).optional(),
  targetAudience: z.string().optional(),
  targetServiceAccount: z.string().optional(),
});
const LspServerConfigSchema = z
  .object({
    id: z.string(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    rootUri: z.string().optional(),
  })
  .passthrough() as z.ZodType<LspServerConfig>;

export const LspConfigSchema = z.union([
  z.boolean(),
  z
    .object({
      servers: z.array(LspServerConfigSchema),
    })
    .passthrough(),
]) as z.ZodType<boolean | LspConfig>;

export const AgentConfigSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
    modelParams: z.record(z.unknown()).optional(),
    auth: AgentAuthSchema.optional(),
    tools: z.array(z.string()).optional(),
    excludeTools: z.array(z.string()).optional(),
    mcpServers: z
      .record(McpServerConfigSchema)
      .optional() as unknown as z.ZodOptional<
      z.ZodRecord<z.ZodString, z.ZodType<MCPServerConfig>>
    >,
    approvalMode: z.nativeEnum(ApprovalMode).optional(),
    systemPrompt: z.string().optional(),
    workingDir: z.string().optional(),
    sessionId: z.string().optional(),
    includeDirectories: z.array(z.string()).optional(),
    fileFiltering: AgentFileFilteringSchema.optional(),
    telemetry: AgentTelemetrySchema.optional(),
    proxy: z.string().optional(),
    maxSessionTurns: z.number().optional(),
    compression: AgentCompressionSchema.optional(),
    checkpointing: z.boolean().optional(),
    recording: AgentRecordingSchema.optional(),
    policy: z.record(z.unknown()).optional(),
    extensions: z.array(z.record(z.unknown())).optional(),
    ide: AgentIdeSchema.optional(),
    hooks: z.record(z.unknown()).optional(),
    memory: z.string().optional(),
    skillsSupport: z.boolean().optional(),
    disabledSkills: z.array(z.string()).optional(),
    adminSkillsEnabled: z.boolean().optional(),
    streamIdleTimeoutMs: z.number().optional(),
    toolOutputLimits: AgentToolOutputLimitsSchema.optional(),
    outputFormat: z.string().optional(),
    shell: AgentShellSchema.optional(),
    contextLimit: z.number().optional(),
    compressionThreshold: z.number().optional(),
    skills: z.array(z.record(z.unknown())).optional(),
    useWriteTodos: z.boolean().optional(),
    sandbox: z.record(z.unknown()).optional(),
    folderTrust: z.boolean().optional(),
    embeddingModel: z.string().optional(),
    debugMode: z.boolean().optional(),
    continueOnFailedApiCall: z.boolean().optional(),
    allowedTools: z.array(z.string()).optional(),
    coreTools: z.array(z.string()).optional(),
    toolDiscoveryCommand: z.string().optional(),
    toolCallCommand: z.string().optional(),
    mcpServerCommand: z.string().optional(),
    allowedMcpServers: z.array(z.string()).optional(),
    blockedMcpServers: z.array(BlockedMcpServerEntrySchema).optional(),
    mcpEnabled: z.boolean().optional(),
    extensionsEnabled: z.boolean().optional(),
    projectHooks: z.record(z.unknown()).optional(),
    disabledHooks: z.array(z.string()).optional(),
    interactive: z.boolean().optional(),
    lsp: LspConfigSchema.optional(),
    harness: AgentHarnessSchema.optional(),
    /**
     * UNSTABLE escape hatch. Long-tail settings merged into ConfigParameters.
     * The adapter throws if a key shadows a typed AgentConfig field.
     */
    settings: z.record(z.unknown()).optional(),
  })
  .strict();

export type ParsedAgentConfig = z.infer<typeof AgentConfigSchema>;

export type AgentConfigWithCallbacks = ParsedAgentConfig & {
  readonly onApproval?: ApprovalHandler;
  readonly onOAuthPrompt?: OAuthPromptHandler;
  readonly editorCallbacks?: EditorCallbacks;
  readonly toolSchedulerFactory?: AgentSchedulerFactory;
};

export type {
  AgentConfig,
  AgentHarnessOptions,
  AgentSchedulerFactory,
  AgentSchedulerHandle,
  ApprovalHandler,
  EditorCallbacks,
  OAuthPromptHandler,
} from './config-types.js';
