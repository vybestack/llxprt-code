import type { RootTelemetry } from './root-telemetry.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Attributes } from '@opentelemetry/api';
import { type LogRecord, type LogAttributes } from '@opentelemetry/api-logs';
import { SemanticAttributes } from '@opentelemetry/semantic-conventions';
import type {
  TelemetryConfig,
  TelemetryPromptConfig,
} from '../internal/interfaces.js';
import {
  EVENT_API_ERROR,
  EVENT_API_REQUEST,
  EVENT_API_RESPONSE,
  EVENT_CLI_CONFIG,
  EVENT_HOOK_CALL,
  EVENT_TOOL_CALL,
  EVENT_USER_PROMPT,
  EVENT_NEXT_SPEAKER_CHECK,
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
import type {
  ApiErrorEvent,
  ApiRequestEvent,
  ApiResponseEvent,
  HookCallEvent,
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
import { uiTelemetryService, type UiEvent } from './uiTelemetry.js';
import { safeJsonStringify } from '../utils/safeJsonStringify.js';
import { debugLogger } from '../utils/debugLogger.js';
import { getPerfPhaseObserver } from '../perf/perfPhaseObserver.js';

type Config = TelemetryConfig;
type SessionConfig = Pick<TelemetryConfig, 'getSessionId'>;
type ToolLoggingConfig = SessionConfig & TelemetryPromptConfig;

/**
 * Fail-open wrapper for local aggregation. Errors in the telemetry
 * service must never break the calling stream/tool/api path.
 */
function aggregateLocally(event: UiEvent): void {
  try {
    uiTelemetryService.addEvent(event);
  } catch (err) {
    try {
      debugLogger.error(
        `[TELEMETRY] Local aggregation failed (fail-open): ${err instanceof Error ? err.message : String(err)}`,
      );
    } catch {
      // Secondary logger failure must not escape the fail-open wrapper
    }
  }
}

/**
 * Fail-open wrapper for SDK export. Errors in the export pipeline must
 * never break the calling stream/tool/api path.
 */
/**
 * Fail-open wrapper for SDK metric recording. Errors in metric instruments
 * must never break the calling stream/tool/api/file/routing path.
 */
function getCommonAttributes(config: SessionConfig): Attributes {
  return { 'session.id': config.getSessionId() };
}

function formatStatusCode(statusCode: number | string | undefined): string {
  if (statusCode === undefined || statusCode === '' || statusCode === 0)
    return 'N/A';
  if (typeof statusCode === 'number' && Number.isNaN(statusCode)) return 'N/A';
  return String(statusCode);
}

export function logCliConfiguration(
  config: Config,
  event: StartSessionEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

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

  const logRecord: LogRecord = {
    body: 'CLI configuration loaded.',
    attributes,
  };
  telemetry.events.record(() => logRecord);
}

export function logUserPrompt(
  config: ToolLoggingConfig,
  event: UserPromptEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': EVENT_USER_PROMPT,
    'event.timestamp': new Date().toISOString(),
    prompt_length: event.prompt_length,
  };

  if (telemetry.readPrivacySettings().logPrompts) {
    attributes.prompt = event.prompt;
  }

  const logRecord: LogRecord = {
    body: `User prompt. Length: ${event.prompt_length}.`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
}

export function logToolCall(
  config: ToolLoggingConfig,
  event: ToolCallEvent,
  telemetry: RootTelemetry,
): void {
  if (process.env.VERBOSE === 'true') {
    debugLogger.error(`[TELEMETRY] logToolCall: ${event.function_name}`);
  }

  // Perf phase observer (P07): notify at the exact tool-completion boundary,
  // BEFORE the SDK/export gate so SDK-disabled mode still notifies. Invoked
  // directly (no try/catch) so internal errors propagate fail-fast (D8).
  // Default-off: null observer short-circuits with no allocation.
  const perfObserver = getPerfPhaseObserver();
  if (perfObserver !== null) {
    const boundaries = event.getPerfBoundaries();
    perfObserver.onToolCallCompleted({
      promptId: event.prompt_id,
      callId: event.call_id,
      startMs: boundaries.startMs,
      endMs: boundaries.endMs,
      durationMs: event.duration_ms,
    });
  }

  // Local aggregation always runs, regardless of SDK/export state
  const uiEvent = {
    ...event,
    'event.name': EVENT_TOOL_CALL,
    'event.timestamp': new Date().toISOString(),
  } as UiEvent;
  aggregateLocally(uiEvent);

  if (!telemetry.isEnabled()) {
    if (process.env.VERBOSE === 'true') {
      debugLogger.error(`[TELEMETRY] SDK not initialized, skipping export`);
    }
    return;
  }

  const { metadata, function_args, ...eventWithoutMetadata } = event;
  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...eventWithoutMetadata,
    'event.name': EVENT_TOOL_CALL,
    'event.timestamp': new Date().toISOString(),
    ...(telemetry.readPrivacySettings().logPrompts
      ? { function_args: safeJsonStringify(function_args, 2) }
      : {}),
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

  const logRecord: LogRecord = {
    body: `Tool call: ${event.function_name}${event.decision != null ? `. Decision: ${event.decision}` : ''}. Success: ${event.success}. Duration: ${event.duration_ms}ms.`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
  telemetry.measurements.toolCall(
    event.function_name,
    event.duration_ms,
    event.success,
    {
      ...getCommonAttributes(config),
      decision: event.decision,
      tool_type: event.tool_type,
    },
  );
}

export function logHookCall(
  config: SessionConfig,
  event: HookCallEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  const {
    hook_input,
    hook_output,
    hook_name,
    stdout,
    stderr,
    error,
    ...eventAttributes
  } = event;
  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...eventAttributes,
    'event.name': EVENT_HOOK_CALL,
    'event.timestamp': new Date().toISOString(),
    ...(telemetry.readPrivacySettings().logPrompts
      ? {
          hook_name,
          stdout,
          stderr,
          error,
          hook_input: safeJsonStringify(hook_input),
          hook_output: safeJsonStringify(hook_output),
        }
      : {}),
  };

  const logRecord: LogRecord = {
    body: `Hook call: ${event.hook_event_name}. Success: ${event.success}. Duration: ${event.duration_ms}ms.`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
}

export function logToolOutputTruncated(
  config: Config,
  event: ToolOutputTruncatedEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_TOOL_OUTPUT_TRUNCATED,
    'event.timestamp': new Date().toISOString(),
  };

  const logRecord: LogRecord = {
    body: `Tool output truncated for ${event.tool_name}.`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
}

export function logFileOperation(
  config: Config,
  event: FileOperationEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': EVENT_FILE_OPERATION,
    'event.timestamp': new Date().toISOString(),
    tool_name: event.tool_name,
    operation: event.operation,
  };

  if (
    event.lines !== undefined &&
    event.lines !== 0 &&
    !Number.isNaN(event.lines)
  ) {
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

  const logRecord: LogRecord = {
    body: `File operation: ${event.operation}. Lines: ${event.lines}.`,
    attributes,
  };
  telemetry.events.record(() => logRecord);

  telemetry.measurements.fileOperation({
    operation: event.operation,
    ...(event.lines === undefined ? {} : { lines: event.lines }),
    ...(event.mimetype === undefined ? {} : { mimetype: event.mimetype }),
    ...(event.extension === undefined ? {} : { extension: event.extension }),
    'session.id': config.getSessionId(),
  });
}

export function logApiRequest(
  config: Config,
  event: ApiRequestEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  // Strip the body before spreading: every other field stays exported as
  // before; only request_text is gated behind the explicit opt-in.
  const { request_text, ...eventWithoutBody } = event;
  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...eventWithoutBody,
    'event.name': EVENT_API_REQUEST,
    'event.timestamp': new Date().toISOString(),
    request_chars: request_text?.length ?? 0,
  };

  if (isApiBodyExportAllowed(telemetry) && request_text !== undefined) {
    attributes.request_text = truncateBody(
      request_text,
      telemetry.readPrivacySettings().maxChars,
    );
  }

  const logRecord: LogRecord = {
    body: `API request to ${event.model}.`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
}

export function logApiError(
  config: Config,
  event: ApiErrorEvent,
  telemetry: RootTelemetry,
): void {
  // Local aggregation always runs, regardless of SDK/export state
  const uiEvent = {
    ...event,
    'event.name': EVENT_API_ERROR,
    'event.timestamp': new Date().toISOString(),
  } as UiEvent;
  aggregateLocally(uiEvent);

  if (!telemetry.isEnabled()) return;

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

  const logRecord: LogRecord = {
    body: `API error for ${event.model}. Error: ${event.error}. Duration: ${event.duration_ms}ms.`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
  telemetry.measurements.modelResponse(
    event.model,
    event.duration_ms,
    event.status_code ?? 'error',
    { ...getCommonAttributes(config), error_type: event.error_type },
  );
}

export function logApiResponse(
  config: Config,
  event: ApiResponseEvent,
  telemetry: RootTelemetry,
): void {
  // Local aggregation always runs, regardless of SDK/export state
  const uiEvent = {
    ...event,
    'event.name': EVENT_API_RESPONSE,
    'event.timestamp': new Date().toISOString(),
  } as UiEvent;
  aggregateLocally(uiEvent);

  if (!telemetry.isEnabled()) return;

  const attributes = buildApiResponseAttributes(config, event, telemetry);
  const logRecord: LogRecord = {
    body: `API response from ${event.model}. Status: ${formatStatusCode(event.status_code)}. Duration: ${event.duration_ms}ms.`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
  telemetry.measurements.modelResponse(
    event.model,
    event.duration_ms,
    event.status_code ?? (event.error ? 'error' : 'ok'),
    getCommonAttributes(config),
  );
  recordTokenUsageMetricsForResponse(config, event, telemetry);
}

function buildApiResponseAttributes(
  config: Config,
  event: ApiResponseEvent,
  telemetry: RootTelemetry,
): LogAttributes {
  // Strip the body before spreading: every other field stays exported as
  // before; only response_text is gated behind the explicit opt-in.
  const { response_text, ...eventWithoutBody } = event;
  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...eventWithoutBody,
    'event.name': EVENT_API_RESPONSE,
    'event.timestamp': new Date().toISOString(),
    response_chars: response_text?.length ?? 0,
  };
  if (event.error) {
    attributes['error.message'] = event.error;
  } else if (
    event.status_code !== undefined &&
    typeof event.status_code === 'number'
  ) {
    attributes[SemanticAttributes.HTTP_STATUS_CODE] = event.status_code;
  }
  if (isApiBodyExportAllowed(telemetry) && response_text !== undefined) {
    attributes.response_text = truncateBody(
      response_text,
      telemetry.readPrivacySettings().maxChars,
    );
  }
  return attributes;
}

/**
 * Bodies are exported only under an explicit opt-in (`logApiBodies`) AND the
 * prompt-privacy gate (`logPrompts`): `logPrompts: false` must keep prompt
 * and conversation content out of every exported event unconditionally.
 */
function isApiBodyExportAllowed(telemetry: RootTelemetry): boolean {
  const privacy = telemetry.readPrivacySettings();
  return privacy.logApiBodies && privacy.logPrompts;
}

function truncateBody(body: string, maxChars: number): string {
  return body.length > maxChars ? body.slice(0, maxChars) : body;
}

function recordTokenUsageMetricsForResponse(
  config: Config,
  event: ApiResponseEvent,
  telemetry: RootTelemetry,
): void {
  telemetry.measurements.tokenUsage(
    event.model,
    event.input_token_count,
    'input',
    getCommonAttributes(config),
  );
  telemetry.measurements.tokenUsage(
    event.model,
    event.output_token_count,
    'output',
    getCommonAttributes(config),
  );
  telemetry.measurements.tokenUsage(
    event.model,
    event.cached_content_token_count,
    'cache',
    getCommonAttributes(config),
  );
  telemetry.measurements.tokenUsage(
    event.model,
    event.thoughts_token_count,
    'thought',
    getCommonAttributes(config),
  );
  telemetry.measurements.tokenUsage(
    event.model,
    event.tool_token_count,
    'tool',
    getCommonAttributes(config),
  );
}

export function logLoopDetected(
  config: Config,
  event: LoopDetectedEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
  };

  const logRecord: LogRecord = {
    body: `Loop detected. Type: ${event.loop_type}.`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
}

export function logNextSpeakerCheck(
  config: Config,
  event: NextSpeakerCheckEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_NEXT_SPEAKER_CHECK,
  };

  const logRecord: LogRecord = {
    body: `Next speaker check.`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
}

// SessionConfig (session id only) is the intentional permanent contract:
// slash-command logging needs no wider Config surface, and the narrower type
// keeps CLI callers that only carry a session-scoped config type-valid.
export function logSlashCommand(
  config: SessionConfig,
  event: SlashCommandEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_SLASH_COMMAND,
  };

  const logRecord: LogRecord = {
    body: `Slash command: ${event.command}.`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
}

// Generic function to log telemetry events to the configured system
function logTelemetryEvent(
  config: Config,
  event:
    | ConversationRequestEvent
    | ConversationResponseEvent
    | ProviderSwitchEvent
    | ProviderCapabilityEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;
  telemetry.events.record(() => {
    const attributes: LogAttributes = { ...getCommonAttributes(config) };
    for (const [key, value] of Object.entries(event)) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      )
        attributes[key] = value;
      else if (value !== undefined) attributes[key] = safeJsonStringify(value);
    }
    return { body: `Telemetry event: ${event['event.name']}`, attributes };
  });
}

export function logConversationRequest(
  config: Config,
  event: ConversationRequestEvent | ConversationResponseEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;
  const privacy = telemetry.readPrivacySettings();
  if (privacy.logConversations && privacy.logPrompts)
    logTelemetryEvent(config, event, telemetry);
}

export const logConversationResponse = logConversationRequest;

export function logProviderSwitch(
  config: Config,
  event: ProviderSwitchEvent | ProviderCapabilityEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;
  if (telemetry.readPrivacySettings().logConversations)
    logTelemetryEvent(config, event, telemetry);
}

export const logProviderCapability = logProviderSwitch;

export function logKittySequenceOverflow(
  config: Config,
  event: KittySequenceOverflowEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
  };

  const logRecord: LogRecord = {
    body: `Kitty sequence overflow. Length: ${event.sequence_length}.`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
}

/**
 * Logs token usage per conversation turn.
 * @param config The configuration object.
 * @param event The TokenUsageEvent to log.
 */
export function logTokenUsage(
  config: Config,
  event: TokenUsageEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
  };

  const logRecord: LogRecord = {
    body: `Token usage. Provider: ${event.provider}, ConversationId: ${event.conversationId}, Input: ${event.input}, Output: ${event.output}, Cache: ${event.cache}, Tool: ${event.tool}, Thought: ${event.thought}, Total: ${event.total}.`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
}

/**
 * Logs performance metrics such as tokens per minute.
 * @param config The configuration object.
 * @param event The PerformanceMetricsEvent to log.
 */
export function logPerformanceMetrics(
  config: Config,
  event: PerformanceMetricsEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
  };

  const logRecord: LogRecord = {
    body: `Performance metrics. Provider: ${event.provider}, TokensPerMinute: ${event.tokensPerMinute}, ThrottleWaitTimeMs: ${event.throttleWaitTimeMs}, TotalRequests: ${event.totalRequests}, ErrorRate: ${event.errorRate}.`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
}

export function logMalformedJsonResponse(
  config: Config,
  event: MalformedJsonResponseEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': EVENT_MALFORMED_JSON_RESPONSE,
    'event.timestamp': new Date().toISOString(),
    model: event.model,
  };

  const logRecord: LogRecord = {
    body: `Malformed JSON response from ${event.model}.`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
}

export function logModelRouting(
  config: Config,
  event: ModelRoutingEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    model: event.model,
    source: event.source,
    contextLimit: event.contextLimit,
    reason: event.reason,
    fallback: event.fallback,
    'event.name': EVENT_MODEL_ROUTING,
  };

  const logRecord: LogRecord = {
    body: `Model routing decision. Model: ${event.model}, Source: ${event.source}`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
}

export function logExtensionInstallEvent(
  config: Config,
  event: ExtensionInstallEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': EVENT_EXTENSION_INSTALL,
    'event.timestamp': new Date().toISOString(),
    extension_name: event.extension_name,
    extension_version: event.extension_version,
    extension_source: event.extension_source,
    status: event.status,
  };

  const logRecord: LogRecord = {
    body: `Installed extension ${event.extension_name}`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
}

export function logExtensionUninstall(
  config: Config,
  event: ExtensionUninstallEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': EVENT_EXTENSION_UNINSTALL,
    'event.timestamp': new Date().toISOString(),
    extension_name: event.extension_name,
    status: event.status,
  };

  const logRecord: LogRecord = {
    body: `Uninstalled extension ${event.extension_name}`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
}

export function logExtensionEnable(
  config: Config,
  event: ExtensionEnableEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': EVENT_EXTENSION_ENABLE,
    'event.timestamp': new Date().toISOString(),
    extension_name: event.extension_name,
    setting_scope: event.setting_scope,
  };

  const logRecord: LogRecord = {
    body: `Enabled extension ${event.extension_name}`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
}

export function logExtensionDisable(
  config: Config,
  event: ExtensionDisableEvent,
  telemetry: RootTelemetry,
): void {
  if (!telemetry.isEnabled()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': EVENT_EXTENSION_DISABLE,
    'event.timestamp': new Date().toISOString(),
    extension_name: event.extension_name,
    setting_scope: event.setting_scope,
  };

  const logRecord: LogRecord = {
    body: `Disabled extension ${event.extension_name}`,
    attributes,
  };
  telemetry.events.record(() => logRecord);
}
