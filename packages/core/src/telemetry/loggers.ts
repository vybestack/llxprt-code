/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  logs,
  type LogRecord,
  type LogAttributes,
} from '@opentelemetry/api-logs';
import { SemanticAttributes } from '@opentelemetry/semantic-conventions';
import { Config } from '../config/config.js';
import {
  EVENT_API_ERROR,
  EVENT_API_REQUEST,
  EVENT_API_RESPONSE,
  EVENT_CLI_CONFIG,
  EVENT_TOOL_CALL,
  EVENT_USER_PROMPT,
  EVENT_NEXT_SPEAKER_CHECK,
  SERVICE_NAME,
  EVENT_SLASH_COMMAND,
  EVENT_TOOL_OUTPUT_TRUNCATED,
  EVENT_FILE_OPERATION,
  EVENT_MALFORMED_JSON_RESPONSE,
  EVENT_MODEL_ROUTING,
  EVENT_EXTENSION_INSTALL,
  EVENT_EXTENSION_UNINSTALL,
  EVENT_EXTENSION_ENABLE,
  EVENT_EXTENSION_DISABLE,
} from './constants.js';
import {
  ApiErrorEvent,
  ApiRequestEvent,
  ApiResponseEvent,
  StartSessionEvent,
  ToolCallEvent,
  UserPromptEvent,
  NextSpeakerCheckEvent,
  LoopDetectedEvent,
  SlashCommandEvent,
  ConversationRequestEvent,
  ConversationResponseEvent,
  ProviderSwitchEvent,
  ProviderCapabilityEvent,
  KittySequenceOverflowEvent,
  TokenUsageEvent,
  PerformanceMetricsEvent,
  ToolOutputTruncatedEvent,
  FileOperationEvent,
  MalformedJsonResponseEvent,
  ModelRoutingEvent,
  ExtensionInstallEvent,
  ExtensionUninstallEvent,
  ExtensionEnableEvent,
  ExtensionDisableEvent,
} from './types.js';
import {
  recordApiErrorMetrics,
  recordTokenUsageMetrics,
  recordApiResponseMetrics,
  recordToolCallMetrics,
  recordFileOperationMetric,
  recordModelRoutingMetrics,
  FileOperation,
} from './metrics.js';
import { isTelemetrySdkInitialized } from './sdk.js';
import { uiTelemetryService, type UiEvent } from './uiTelemetry.js';
import { safeJsonStringify } from '../utils/safeJsonStringify.js';

type SessionConfig = Pick<Config, 'getSessionId'>;
type TelemetryPromptConfig = Pick<Config, 'getTelemetryLogPromptsEnabled'>;
type ToolLoggingConfig = SessionConfig & TelemetryPromptConfig;

const shouldLogUserPrompts = (config: TelemetryPromptConfig): boolean =>
  config.getTelemetryLogPromptsEnabled();

function getCommonAttributes(config: SessionConfig): LogAttributes {
  return {
    'session.id': config.getSessionId(),
  };
}

export function logCliConfiguration(
  config: Config,
  event: StartSessionEvent,
): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': EVENT_CLI_CONFIG,
    'event.timestamp': new Date().toISOString(),
    model: event.model,
    embedding_model: event.embedding_model,
    sandbox_enabled: event.sandbox_enabled,
    core_tools_enabled: event.core_tools_enabled,
    approval_mode: event.approval_mode,
    api_key_enabled: event.api_key_enabled,
    vertex_ai_enabled: event.vertex_ai_enabled,
    log_user_prompts_enabled: event.telemetry_log_user_prompts_enabled,
    file_filtering_respect_git_ignore: event.file_filtering_respect_git_ignore,
    debug_mode: event.debug_enabled,
    mcp_servers: event.mcp_servers,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: 'CLI configuration loaded.',
    attributes,
  };
  logger.emit(logRecord);
}

export function logUserPrompt(config: Config, event: UserPromptEvent): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': EVENT_USER_PROMPT,
    'event.timestamp': new Date().toISOString(),
    prompt_length: event.prompt_length,
  };

  if (shouldLogUserPrompts(config)) {
    attributes.prompt = event.prompt;
  }

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `User prompt. Length: ${event.prompt_length}.`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logToolCall(
  config: ToolLoggingConfig,
  event: ToolCallEvent,
): void {
  if (process.env.VERBOSE === 'true') {
    console.error(`[TELEMETRY] logToolCall: ${event.function_name}`);
  }

  const uiEvent = {
    ...event,
    'event.name': EVENT_TOOL_CALL,
    'event.timestamp': new Date().toISOString(),
  } as UiEvent;
  uiTelemetryService.addEvent(uiEvent);
  if (!isTelemetrySdkInitialized()) {
    if (process.env.VERBOSE === 'true') {
      console.error(`[TELEMETRY] SDK not initialized, skipping log`);
    }
    return;
  }

  const { metadata, ...eventWithoutMetadata } = event;
  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...eventWithoutMetadata,
    'event.name': EVENT_TOOL_CALL,
    'event.timestamp': new Date().toISOString(),
    function_args: safeJsonStringify(event.function_args, 2),
  };

  // Handle metadata separately to ensure proper typing
  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      attributes[`metadata.${key}`] =
        typeof value === 'object' ? safeJsonStringify(value) : String(value);
    }
  }
  if (event.error) {
    attributes['error.message'] = event.error;
    if (event.error_type) {
      attributes['error.type'] = event.error_type;
    }
  }

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Tool call: ${event.function_name}${event.decision ? `. Decision: ${event.decision}` : ''}. Success: ${event.success}. Duration: ${event.duration_ms}ms.`,
    attributes,
  };
  logger.emit(logRecord);
  recordToolCallMetrics(
    config,
    event.function_name,
    event.duration_ms,
    event.success,
    event.decision,
    event.tool_type,
  );
}

export function logToolOutputTruncated(
  config: Config,
  event: ToolOutputTruncatedEvent,
): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_TOOL_OUTPUT_TRUNCATED,
    'event.timestamp': new Date().toISOString(),
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Tool output truncated for ${event.tool_name}.`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logFileOperation(
  config: Config,
  event: FileOperationEvent,
): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': EVENT_FILE_OPERATION,
    'event.timestamp': new Date().toISOString(),
    tool_name: event.tool_name,
    operation: event.operation,
  };

  if (event.lines) {
    attributes['lines'] = event.lines;
  }
  if (event.mimetype) {
    attributes['mimetype'] = event.mimetype;
  }
  if (event.extension) {
    attributes['extension'] = event.extension;
  }
  if (event.programming_language) {
    attributes['programming_language'] = event.programming_language;
  }

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `File operation: ${event.operation}. Lines: ${event.lines}.`,
    attributes,
  };
  logger.emit(logRecord);

  recordFileOperationMetric(
    config,
    event.operation as FileOperation,
    event.lines,
    event.mimetype,
    event.extension,
  );
}

export function logApiRequest(config: Config, event: ApiRequestEvent): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_API_REQUEST,
    'event.timestamp': new Date().toISOString(),
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `API request to ${event.model}.`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logApiError(config: Config, event: ApiErrorEvent): void {
  const uiEvent = {
    ...event,
    'event.name': EVENT_API_ERROR,
    'event.timestamp': new Date().toISOString(),
  } as UiEvent;
  uiTelemetryService.addEvent(uiEvent);
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_API_ERROR,
    'event.timestamp': new Date().toISOString(),
    ['error.message']: event.error,
    model_name: event.model,
    duration: event.duration_ms,
  };

  if (event.error_type) {
    attributes['error.type'] = event.error_type;
  }
  if (typeof event.status_code === 'number') {
    attributes[SemanticAttributes.HTTP_STATUS_CODE] = event.status_code;
  }

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `API error for ${event.model}. Error: ${event.error}. Duration: ${event.duration_ms}ms.`,
    attributes,
  };
  logger.emit(logRecord);
  recordApiErrorMetrics(
    config,
    event.model,
    event.duration_ms,
    event.status_code,
    event.error_type,
  );
}

export function logApiResponse(config: Config, event: ApiResponseEvent): void {
  const uiEvent = {
    ...event,
    'event.name': EVENT_API_RESPONSE,
    'event.timestamp': new Date().toISOString(),
  } as UiEvent;
  uiTelemetryService.addEvent(uiEvent);
  if (!isTelemetrySdkInitialized()) return;
  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_API_RESPONSE,
    'event.timestamp': new Date().toISOString(),
  };
  if (event.response_text) {
    attributes.response_text = event.response_text;
  }
  if (event.error) {
    attributes['error.message'] = event.error;
  } else if (event.status_code) {
    if (typeof event.status_code === 'number') {
      attributes[SemanticAttributes.HTTP_STATUS_CODE] = event.status_code;
    }
  }

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `API response from ${event.model}. Status: ${event.status_code || 'N/A'}. Duration: ${event.duration_ms}ms.`,
    attributes,
  };
  logger.emit(logRecord);
  recordApiResponseMetrics(
    config,
    event.model,
    event.duration_ms,
    event.status_code,
    event.error,
  );
  recordTokenUsageMetrics(
    config,
    event.model,
    event.input_token_count,
    'input',
  );
  recordTokenUsageMetrics(
    config,
    event.model,
    event.output_token_count,
    'output',
  );
  recordTokenUsageMetrics(
    config,
    event.model,
    event.cached_content_token_count,
    'cache',
  );
  recordTokenUsageMetrics(
    config,
    event.model,
    event.thoughts_token_count,
    'thought',
  );
  recordTokenUsageMetrics(config, event.model, event.tool_token_count, 'tool');
}

export function logLoopDetected(
  config: Config,
  event: LoopDetectedEvent,
): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Loop detected. Type: ${event.loop_type}.`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logNextSpeakerCheck(
  config: Config,
  event: NextSpeakerCheckEvent,
): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_NEXT_SPEAKER_CHECK,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Next speaker check.`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logSlashCommand(
  config: Config,
  event: SlashCommandEvent,
): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_SLASH_COMMAND,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Slash command: ${event.command}.`,
    attributes,
  };
  logger.emit(logRecord);
}

// Generic function to log telemetry events to the configured system
function logTelemetryEvent(config: Config, event: unknown): void {
  if (!isTelemetrySdkInitialized()) return;

  const logger = logs.getLogger(SERVICE_NAME);
  const eventObj = event as Record<string, unknown>;
  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': eventObj['event.name'] as string,
    'event.timestamp': eventObj['event.timestamp'] as string,
  };

  // Add other event properties, ensuring they are compatible with LogAttributes
  Object.keys(eventObj).forEach((key) => {
    if (
      key !== 'event.name' &&
      key !== 'event.timestamp' &&
      eventObj[key] !== undefined
    ) {
      const value = eventObj[key];
      // Convert complex objects to strings to ensure compatibility with LogAttributes
      if (typeof value === 'object' && value !== null) {
        attributes[key] = JSON.stringify(value);
      } else if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        attributes[key] = value;
      }
    }
  });

  const logRecord: LogRecord = {
    body: `Telemetry event: ${eventObj['event.name']}`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logConversationRequest(
  config: Config,
  event: ConversationRequestEvent,
): void {
  if (!config.getConversationLoggingEnabled()) {
    return;
  }

  try {
    logTelemetryEvent(config, event);
  } catch (error) {
    console.warn('Failed to log conversation request:', error);
  }
}

export function logConversationResponse(
  config: Config,
  event: ConversationResponseEvent,
): void {
  if (!config.getConversationLoggingEnabled()) {
    return;
  }

  try {
    logTelemetryEvent(config, event);
  } catch (error) {
    console.warn('Failed to log conversation response:', error);
  }
}

export function logProviderSwitch(
  config: Config,
  event: ProviderSwitchEvent,
): void {
  if (!config.getConversationLoggingEnabled()) {
    return;
  }

  try {
    logTelemetryEvent(config, event);
  } catch (error) {
    console.warn('Failed to log provider switch:', error);
  }
}

export function logProviderCapability(
  config: Config,
  event: ProviderCapabilityEvent,
): void {
  if (!config.getConversationLoggingEnabled()) {
    return;
  }

  try {
    logTelemetryEvent(config, event);
  } catch (error) {
    console.warn('Failed to log provider capability:', error);
  }
}

export function logKittySequenceOverflow(
  config: Config,
  event: KittySequenceOverflowEvent,
): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Kitty sequence overflow. Length: ${event.sequence_length}.`,
    attributes,
  };
  logger.emit(logRecord);
}

/**
 * Logs token usage per conversation turn.
 * @param config The configuration object.
 * @param event The TokenUsageEvent to log.
 */
export function logTokenUsage(config: Config, event: TokenUsageEvent): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Token usage. Provider: ${event.provider}, ConversationId: ${event.conversationId}, Input: ${event.input}, Output: ${event.output}, Cache: ${event.cache}, Tool: ${event.tool}, Thought: ${event.thought}, Total: ${event.total}.`,
    attributes,
  };
  logger.emit(logRecord);
}

/**
 * Logs performance metrics such as tokens per minute.
 * @param config The configuration object.
 * @param event The PerformanceMetricsEvent to log.
 */
export function logPerformanceMetrics(
  config: Config,
  event: PerformanceMetricsEvent,
): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Performance metrics. Provider: ${event.provider}, TokensPerMinute: ${event.tokensPerMinute}, ThrottleWaitTimeMs: ${event.throttleWaitTimeMs}, TotalRequests: ${event.totalRequests}, ErrorRate: ${event.errorRate}.`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logMalformedJsonResponse(
  config: Config,
  event: MalformedJsonResponseEvent,
): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': EVENT_MALFORMED_JSON_RESPONSE,
    'event.timestamp': new Date().toISOString(),
    model: event.model,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Malformed JSON response from ${event.model}.`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logModelRouting(
  config: Config,
  event: ModelRoutingEvent,
): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    model: event.model,
    source: event.source,
    contextLimit: event.contextLimit,
    reason: event.reason,
    fallback: event.fallback,
    'event.name': EVENT_MODEL_ROUTING,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Model routing decision. Model: ${event.model}, Source: ${event.source}`,
    attributes,
  };
  logger.emit(logRecord);

  recordModelRoutingMetrics(config, event);
}

export function logExtensionInstallEvent(
  config: Config,
  event: ExtensionInstallEvent,
): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': EVENT_EXTENSION_INSTALL,
    'event.timestamp': new Date().toISOString(),
    extension_name: event.extension_name,
    extension_version: event.extension_version,
    extension_source: event.extension_source,
    status: event.status,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Installed extension ${event.extension_name}`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logExtensionUninstall(
  config: Config,
  event: ExtensionUninstallEvent,
): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': EVENT_EXTENSION_UNINSTALL,
    'event.timestamp': new Date().toISOString(),
    extension_name: event.extension_name,
    status: event.status,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Uninstalled extension ${event.extension_name}`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logExtensionEnable(
  config: Config,
  event: ExtensionEnableEvent,
): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': EVENT_EXTENSION_ENABLE,
    'event.timestamp': new Date().toISOString(),
    extension_name: event.extension_name,
    setting_scope: event.setting_scope,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Enabled extension ${event.extension_name}`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logExtensionDisable(
  config: Config,
  event: ExtensionDisableEvent,
): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': EVENT_EXTENSION_DISABLE,
    'event.timestamp': new Date().toISOString(),
    extension_name: event.extension_name,
    setting_scope: event.setting_scope,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Disabled extension ${event.extension_name}`,
    attributes,
  };
  logger.emit(logRecord);
}
