/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P08
 */

import { GenerateContentResponseUsageMetadata } from '@google/genai';
import { Config } from '../config/config.js';
import { type CompletedToolCall } from '../core/coreToolScheduler.js';
import { DEFAULT_AGENT_ID } from '../core/turn.js';
import { ToolConfirmationOutcome, type FileDiff } from '../tools/tools.js';
import { DiscoveredMCPTool } from '../tools/mcp-tool.js';
import type { IContent } from '../services/history/IContent.js';
import type {
  ProviderCapabilities,
  ProviderContext,
  ToolCall,
  ProviderPerformanceMetrics,
} from '../providers/types.js';

export enum ToolCallDecision {
  ACCEPT = 'accept',
  REJECT = 'reject',
  MODIFY = 'modify',
  AUTO_ACCEPT = 'auto_accept',
}

export function getDecisionFromOutcome(
  outcome: ToolConfirmationOutcome,
): ToolCallDecision {
  switch (outcome) {
    case ToolConfirmationOutcome.ProceedOnce:
      return ToolCallDecision.ACCEPT;
    case ToolConfirmationOutcome.ProceedAlways:
    case ToolConfirmationOutcome.ProceedAlwaysServer:
    case ToolConfirmationOutcome.ProceedAlwaysTool:
      return ToolCallDecision.AUTO_ACCEPT;
    case ToolConfirmationOutcome.ModifyWithEditor:
      return ToolCallDecision.MODIFY;
    case ToolConfirmationOutcome.Cancel:
    default:
      return ToolCallDecision.REJECT;
  }
}

export class StartSessionEvent {
  'event.name': 'cli_config';
  'event.timestamp': string; // ISO 8601
  model: string;
  embedding_model: string | undefined;
  sandbox_enabled: boolean;
  core_tools_enabled: string;
  approval_mode: string;
  api_key_enabled: boolean;
  vertex_ai_enabled: boolean;
  debug_enabled: boolean;
  mcp_servers: string;
  telemetry_enabled: boolean;
  telemetry_log_user_prompts_enabled: boolean;
  file_filtering_respect_git_ignore: boolean;

  constructor(config: Config) {
    const generatorConfig = config.getContentGeneratorConfig();
    const mcpServers = config.getMcpServers();

    const useGemini = !!generatorConfig?.apiKey && !generatorConfig?.vertexai;
    const useVertex = !!generatorConfig?.vertexai;

    this['event.name'] = 'cli_config';
    this.model = config.getModel();
    this.embedding_model = config.getEmbeddingModel();
    this.sandbox_enabled =
      typeof config.getSandbox() === 'string' || !!config.getSandbox();
    this.core_tools_enabled = (config.getCoreTools() ?? []).join(',');
    this.approval_mode = config.getApprovalMode();
    this.api_key_enabled = useGemini || useVertex;
    this.vertex_ai_enabled = useVertex;
    this.debug_enabled = config.getDebugMode();
    this.mcp_servers = mcpServers ? Object.keys(mcpServers).join(',') : '';
    this.telemetry_enabled = config.getTelemetryEnabled();
    this.telemetry_log_user_prompts_enabled =
      config.getTelemetryLogPromptsEnabled();
    this.file_filtering_respect_git_ignore =
      config.getFileFilteringRespectGitIgnore();
  }
}

export class EndSessionEvent {
  'event.name': 'end_session';
  'event.timestamp': string; // ISO 8601
  session_id?: string;

  constructor(config?: Config) {
    this['event.name'] = 'end_session';
    this['event.timestamp'] = new Date().toISOString();
    this.session_id = config?.getSessionId();
  }
}

export class UserPromptEvent {
  'event.name': 'user_prompt';
  'event.timestamp': string; // ISO 8601
  prompt_length: number;
  prompt_id: string;
  prompt?: string;

  constructor(prompt_length: number, prompt_Id: string, prompt?: string) {
    this['event.name'] = 'user_prompt';
    this['event.timestamp'] = new Date().toISOString();
    this.prompt_length = prompt_length;
    this.prompt_id = prompt_Id;
    this.prompt = prompt;
  }
}

export class ToolCallEvent {
  'event.name': 'tool_call';
  'event.timestamp': string; // ISO 8601
  function_name: string;
  function_args: Record<string, unknown>;
  duration_ms: number;
  success: boolean;
  decision?: ToolCallDecision;
  error?: string;
  error_type?: string;
  prompt_id: string;
  tool_type: 'native' | 'mcp';
  metadata?: Record<string, unknown>;
  agent_id: string;

  constructor(call: CompletedToolCall) {
    this['event.name'] = 'tool_call';
    this['event.timestamp'] = new Date().toISOString();
    this.function_name = call.request.name;
    this.function_args = call.request.args;
    this.duration_ms = call.durationMs ?? 0;
    this.success = call.status === 'success';
    this.decision = call.outcome
      ? getDecisionFromOutcome(call.outcome)
      : undefined;
    this.error = call.response.error?.message;
    this.error_type = call.response.errorType;
    this.prompt_id = call.request.prompt_id;
    this.tool_type =
      typeof call.tool !== 'undefined' && call.tool instanceof DiscoveredMCPTool
        ? 'mcp'
        : 'native';
    this.agent_id = call.request.agentId ?? DEFAULT_AGENT_ID;

    if (
      call.status === 'success' &&
      typeof call.response.resultDisplay === 'object' &&
      call.response.resultDisplay !== null &&
      'diffStat' in call.response.resultDisplay
    ) {
      const diffStat = (call.response.resultDisplay as FileDiff).diffStat;
      if (diffStat) {
        this.metadata = {
          ai_added_lines: diffStat.ai_added_lines,
          ai_removed_lines: diffStat.ai_removed_lines,
          user_added_lines: diffStat.user_added_lines,
          user_removed_lines: diffStat.user_removed_lines,
        };
      }
    }
  }
}

export class ApiRequestEvent {
  'event.name': 'api_request';
  'event.timestamp': string; // ISO 8601
  model: string;
  prompt_id: string;
  request_text?: string;

  constructor(model: string, prompt_id: string, request_text?: string) {
    this['event.name'] = 'api_request';
    this['event.timestamp'] = new Date().toISOString();
    this.model = model;
    this.prompt_id = prompt_id;
    this.request_text = request_text;
  }
}

export class ApiErrorEvent {
  'event.name': 'api_error';
  'event.timestamp': string; // ISO 8601
  model: string;
  error: string;
  error_type?: string;
  status_code?: number | string;
  duration_ms: number;
  prompt_id: string;

  constructor(
    model: string,
    error: string,
    duration_ms: number,
    prompt_id: string,
    error_type?: string,
    status_code?: number | string,
  ) {
    this['event.name'] = 'api_error';
    this['event.timestamp'] = new Date().toISOString();
    this.model = model;
    this.error = error;
    this.error_type = error_type;
    this.status_code = status_code;
    this.duration_ms = duration_ms;
    this.prompt_id = prompt_id;
  }
}

export class ApiResponseEvent {
  'event.name': 'api_response';
  'event.timestamp': string; // ISO 8601
  model: string;
  status_code?: number | string;
  duration_ms: number;
  error?: string;
  input_token_count: number;
  output_token_count: number;
  cached_content_token_count: number;
  thoughts_token_count: number;
  tool_token_count: number;
  total_token_count: number;
  response_text?: string;
  prompt_id: string;

  constructor(
    model: string,
    duration_ms: number,
    prompt_id: string,
    usage_data?: GenerateContentResponseUsageMetadata,
    response_text?: string,
    error?: string,
  ) {
    this['event.name'] = 'api_response';
    this['event.timestamp'] = new Date().toISOString();
    this.model = model;
    this.duration_ms = duration_ms;
    this.status_code = 200;
    this.input_token_count = usage_data?.promptTokenCount ?? 0;
    this.output_token_count = usage_data?.candidatesTokenCount ?? 0;
    this.cached_content_token_count = usage_data?.cachedContentTokenCount ?? 0;
    this.thoughts_token_count = usage_data?.thoughtsTokenCount ?? 0;
    this.tool_token_count = usage_data?.toolUsePromptTokenCount ?? 0;
    this.total_token_count = usage_data?.totalTokenCount ?? 0;
    this.response_text = response_text;
    this.error = error;
    this.prompt_id = prompt_id;
  }
}

export enum LoopType {
  CONSECUTIVE_IDENTICAL_TOOL_CALLS = 'consecutive_identical_tool_calls',
  CHANTING_IDENTICAL_SENTENCES = 'chanting_identical_sentences',
  MAX_TURNS_EXCEEDED = 'max_turns_exceeded',
}

export class LoopDetectedEvent {
  'event.name': 'loop_detected';
  'event.timestamp': string; // ISO 8601
  loop_type: LoopType;
  prompt_id: string;

  constructor(loop_type: LoopType, prompt_id: string) {
    this['event.name'] = 'loop_detected';
    this['event.timestamp'] = new Date().toISOString();
    this.loop_type = loop_type;
    this.prompt_id = prompt_id;
  }
}

export class NextSpeakerCheckEvent {
  'event.name': 'next_speaker_check';
  'event.timestamp': string; // ISO 8601
  prompt_id: string;
  finish_reason: string;
  result: string;

  constructor(prompt_id: string, finish_reason: string, result: string) {
    this['event.name'] = 'next_speaker_check';
    this['event.timestamp'] = new Date().toISOString();
    this.prompt_id = prompt_id;
    this.finish_reason = finish_reason;
    this.result = result;
  }
}

export class SlashCommandEvent {
  'event.name': 'slash_command';
  'event.timestamp': string; // ISO 8106
  command: string;
  subcommand?: string;

  constructor(command: string, subcommand?: string) {
    this['event.name'] = 'slash_command';
    this['event.timestamp'] = new Date().toISOString();
    this.command = command;
    this.subcommand = subcommand;
  }
}

export class MalformedJsonResponseEvent {
  'event.name': 'malformed_json_response';
  'event.timestamp': string; // ISO 8601
  model: string;

  constructor(model: string) {
    this['event.name'] = 'malformed_json_response';
    this['event.timestamp'] = new Date().toISOString();
    this.model = model;
  }
}

export class ConversationRequestEvent {
  'event.name': 'conversation_request';
  'event.timestamp': string; // ISO 8601
  provider_name: string;
  conversation_id: string;
  turn_number: number;
  prompt_id: string;
  redacted_messages: IContent[];
  redacted_tools?: Array<{
    functionDeclarations: Array<{
      name: string;
      description?: string;
      parameters?: unknown;
    }>;
  }>;
  tool_format?: string;
  provider_switched?: boolean;

  constructor(
    provider_name: string,
    conversation_id: string,
    turn_number: number,
    prompt_id: string,
    redacted_messages: IContent[],
    redacted_tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parameters?: unknown;
      }>;
    }>,
    tool_format?: string,
    provider_switched?: boolean,
  ) {
    this['event.name'] = 'conversation_request';
    this['event.timestamp'] = new Date().toISOString();
    this.provider_name = provider_name;
    this.conversation_id = conversation_id;
    this.turn_number = turn_number;
    this.prompt_id = prompt_id;
    this.redacted_messages = redacted_messages;
    this.redacted_tools = redacted_tools;
    this.tool_format = tool_format;
    this.provider_switched = provider_switched;
  }
}

export class ConversationResponseEvent {
  'event.name': 'conversation_response';
  'event.timestamp': string; // ISO 8601
  provider_name: string;
  conversation_id: string;
  turn_number: number;
  prompt_id: string;
  redacted_content: string;
  duration_ms: number;
  success: boolean;
  error?: string;
  tool_calls?: unknown[];

  constructor(
    provider_name: string,
    conversation_id: string,
    turn_number: number,
    prompt_id: string,
    redacted_content: string,
    duration_ms: number,
    success: boolean,
    error?: string,
    tool_calls?: unknown[],
  ) {
    this['event.name'] = 'conversation_response';
    this['event.timestamp'] = new Date().toISOString();
    this.provider_name = provider_name;
    this.conversation_id = conversation_id;
    this.turn_number = turn_number;
    this.prompt_id = prompt_id;
    this.redacted_content = redacted_content;
    this.duration_ms = duration_ms;
    this.success = success;
    this.error = error;
    this.tool_calls = tool_calls;
  }
}

export class ProviderSwitchEvent {
  'event.name': 'provider_switch';
  'event.timestamp': string; // ISO 8601
  from_provider: string;
  to_provider: string;
  conversation_id: string;
  context_preserved: boolean;

  constructor(
    from_provider: string,
    to_provider: string,
    conversation_id: string,
    context_preserved: boolean,
  ) {
    this['event.name'] = 'provider_switch';
    this['event.timestamp'] = new Date().toISOString();
    this.from_provider = from_provider;
    this.to_provider = to_provider;
    this.conversation_id = conversation_id;
    this.context_preserved = context_preserved;
  }
}

/**
 * @plan PLAN-20250909-TOKTRACK.P10
 */
export class EnhancedConversationResponseEvent extends ConversationResponseEvent {
  provider_context: ProviderContext;
  performance_metrics: ProviderPerformanceMetrics;
  tool_calls_detailed: ToolCall[];

  constructor(
    provider_name: string,
    conversation_id: string,
    turn_number: number,
    prompt_id: string,
    redacted_content: string,
    duration_ms: number,
    success: boolean,
    error?: string,
    tool_calls?: ToolCall[],
    performance_metrics?: ProviderPerformanceMetrics,
    provider_context?: ProviderContext,
  ) {
    super(
      provider_name,
      conversation_id,
      turn_number,
      prompt_id,
      redacted_content,
      duration_ms,
      success,
      error,
      tool_calls,
    );

    this.tool_calls_detailed = tool_calls || [];
    this.performance_metrics =
      performance_metrics || this.createDefaultMetrics(provider_name);
    this.provider_context =
      provider_context || this.createDefaultContext(provider_name);
  }

  private createDefaultMetrics(
    providerName: string,
  ): ProviderPerformanceMetrics {
    return {
      providerName,
      totalRequests: 0,
      totalTokens: 0,
      averageLatency: 0,
      timeToFirstToken: null,
      tokensPerSecond: 0,
      tokensPerMinute: 0,
      throttleWaitTimeMs: 0,
      chunksReceived: 0,
      errorRate: 0,
      errors: [],
      sessionTokenUsage: {
        input: 0,
        output: 0,
        cache: 0,
        tool: 0,
        thought: 0,
        total: 0,
      },
    };
  }

  private createDefaultContext(providerName: string): ProviderContext {
    return {
      providerName,
      currentModel: 'unknown',
      toolFormat: 'unknown',
      isPaidMode: false,
      capabilities: {
        supportsStreaming: true,
        supportsTools: false,
        supportsVision: false,
        maxTokens: 4096,
        supportedFormats: [],
      },
      sessionStartTime: Date.now(),
    };
  }
}

export class ProviderCapabilityEvent {
  'event.name': 'provider_capability';
  'event.timestamp': string;
  provider_name: string;
  capabilities: ProviderCapabilities;
  context: ProviderContext;

  constructor(
    provider_name: string,
    capabilities: ProviderCapabilities,
    context: ProviderContext,
  ) {
    this['event.name'] = 'provider_capability';
    this['event.timestamp'] = new Date().toISOString();
    this.provider_name = provider_name;
    this.capabilities = capabilities;
    this.context = context;
  }
}

export class KittySequenceOverflowEvent {
  'event.name': 'kitty_sequence_overflow';
  'event.timestamp': string;
  sequence_length: number;
  sequence: string;

  constructor(sequence_length: number, sequence: string) {
    this['event.name'] = 'kitty_sequence_overflow';
    this['event.timestamp'] = new Date().toISOString();
    this.sequence_length = sequence_length;
    this.sequence = sequence;
  }
}

// TokenUsageEvent for tracking token usage
export class TokenUsageEvent {
  'event.name': 'token_usage';
  'event.timestamp': string;
  provider: string;
  conversationId: string;
  input: number;
  output: number;
  cache: number;
  tool: number;
  thought: number;
  total: number;

  constructor(
    provider: string,
    conversationId: string,
    input: number,
    output: number,
    cache: number,
    tool: number,
    thought: number,
    total: number,
  ) {
    this['event.name'] = 'token_usage';
    this['event.timestamp'] = new Date().toISOString();
    this.provider = provider;
    this.conversationId = conversationId;
    this.input = input;
    this.output = output;
    this.cache = cache;
    this.tool = tool;
    this.thought = thought;
    this.total = total;
  }
}

// PerformanceMetricsEvent for tracking performance metrics
export class PerformanceMetricsEvent {
  'event.name': 'performance_metrics';
  'event.timestamp': string;
  provider: string;
  tokensPerMinute: number;
  throttleWaitTimeMs: number;
  totalRequests: number;
  errorRate: number;

  constructor(
    provider: string,
    tokensPerMinute: number,
    throttleWaitTimeMs: number,
    totalRequests: number,
    errorRate: number,
  ) {
    this['event.name'] = 'performance_metrics';
    this['event.timestamp'] = new Date().toISOString();
    this.provider = provider;
    this.tokensPerMinute = tokensPerMinute;
    this.throttleWaitTimeMs = throttleWaitTimeMs;
    this.totalRequests = totalRequests;
    this.errorRate = errorRate;
  }
}

// IDE connection telemetry types for compatibility
export enum IdeConnectionType {
  EXTENSION = 'extension',
  CLI = 'cli',
  WEB = 'web',
}

export class IdeConnectionEvent {
  'event.name': 'ide_connection';
  'event.timestamp': string;
  connectionType: IdeConnectionType;
  version?: string;

  constructor(connectionType: IdeConnectionType, version?: string) {
    this['event.name'] = 'ide_connection';
    this['event.timestamp'] = new Date().toISOString();
    this.connectionType = connectionType;
    this.version = version;
  }
}

export enum FileOperation {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
}

export class ToolOutputTruncatedEvent {
  eventName: 'tool_output_truncated';
  prompt_id: string;
  tool_name: string;
  original_content_length: number;
  truncated_content_length: number;
  threshold: number;
  lines?: number;

  constructor(
    promptId: string,
    params: {
      toolName: string;
      originalContentLength: number;
      truncatedContentLength: number;
      threshold: number;
      lines?: number;
    },
  ) {
    this.eventName = 'tool_output_truncated';
    this.prompt_id = promptId;
    this.tool_name = params.toolName;
    this.original_content_length = params.originalContentLength;
    this.truncated_content_length = params.truncatedContentLength;
    this.threshold = params.threshold;
    this.lines = params.lines;
  }
}

export class FileOperationEvent {
  tool_name: string;
  operation: FileOperation | string;
  lines?: number;
  mimetype?: string;
  extension?: string;
  programming_language?: string;

  constructor(
    toolName: string,
    operation: FileOperation | string,
    lines?: number,
    mimetype?: string,
    extension?: string,
    programmingLanguage?: string,
  ) {
    this.tool_name = toolName;
    this.operation = operation;
    this.lines = lines;
    this.mimetype = mimetype;
    this.extension = extension;
    this.programming_language = programmingLanguage;
  }
}

export class ModelRoutingEvent {
  model: string;
  source: string;
  contextLimit: number;
  reason?: string;
  fallback: boolean;
  error?: unknown;

  constructor(
    model: string,
    source: string,
    contextLimit: number,
    reason?: string,
    fallback: boolean = false,
    error?: unknown,
  ) {
    this.model = model;
    this.source = source;
    this.contextLimit = contextLimit;
    this.reason = reason;
    this.fallback = fallback;
    this.error = error;
  }
}

export class ExtensionInstallEvent {
  extension_name: string;
  extension_version: string;
  extension_source: string;
  status: string;

  constructor(name: string, version: string, source: string, status: string) {
    this.extension_name = name;
    this.extension_version = version;
    this.extension_source = source;
    this.status = status;
  }
}

export class ExtensionUninstallEvent {
  extension_name: string;
  status: string;

  constructor(name: string, status: string) {
    this.extension_name = name;
    this.status = status;
  }
}

export class ExtensionEnableEvent {
  extension_name: string;
  setting_scope: string;

  constructor(name: string, scope: string) {
    this.extension_name = name;
    this.setting_scope = scope;
  }
}

export class ExtensionDisableEvent {
  extension_name: string;
  setting_scope: string;

  constructor(name: string, scope: string) {
    this.extension_name = name;
    this.setting_scope = scope;
  }
}

export type TelemetryEvent =
  | StartSessionEvent
  | EndSessionEvent
  | UserPromptEvent
  | ToolCallEvent
  | ApiRequestEvent
  | ApiErrorEvent
  | ApiResponseEvent
  | LoopDetectedEvent
  | NextSpeakerCheckEvent
  | SlashCommandEvent
  | MalformedJsonResponseEvent
  | ConversationRequestEvent
  | ConversationResponseEvent
  | EnhancedConversationResponseEvent
  | ProviderSwitchEvent
  | ProviderCapabilityEvent
  | KittySequenceOverflowEvent
  | TokenUsageEvent
  | PerformanceMetricsEvent;
