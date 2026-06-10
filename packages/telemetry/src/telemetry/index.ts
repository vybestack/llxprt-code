/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export enum TelemetryTarget {
  GCP = 'gcp',
  LOCAL = 'local',
}

const DEFAULT_TELEMETRY_TARGET = TelemetryTarget.LOCAL;
const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4317';

export { DEFAULT_TELEMETRY_TARGET, DEFAULT_OTLP_ENDPOINT };
export {
  initializeTelemetry,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  flushTelemetry,
} from './sdk.js';
export {
  logCliConfiguration,
  logUserPrompt,
  logToolCall,
  logHookCall,
  logApiRequest,
  logApiError,
  logApiResponse,
  logSlashCommand,
  logKittySequenceOverflow,
  logLoopDetected,
  logNextSpeakerCheck,
  logToolOutputTruncated,
  logFileOperation,
  logConversationRequest,
  logConversationResponse,
  logProviderSwitch,
  logProviderCapability,
  logTokenUsage,
  logPerformanceMetrics,
  logMalformedJsonResponse,
  logModelRouting,
  logExtensionInstallEvent,
  logExtensionUninstall,
  logExtensionEnable,
  logExtensionDisable,
} from './loggers.js';
export {
  StartSessionEvent,
  EndSessionEvent,
  UserPromptEvent,
  ToolCallEvent,
  HookCallEvent,
  ApiRequestEvent,
  ApiErrorEvent,
  ApiResponseEvent,
  SlashCommandEvent,
  KittySequenceOverflowEvent,
  LoopDetectedEvent,
  LoopType,
  NextSpeakerCheckEvent,
  MalformedJsonResponseEvent,
  ConversationRequestEvent,
  ConversationResponseEvent,
  EnhancedConversationResponseEvent,
  ProviderSwitchEvent,
  ProviderCapabilityEvent,
  TokenUsageEvent,
  PerformanceMetricsEvent,
  ToolOutputTruncatedEvent,
  FileOperationEvent,
  ModelRoutingEvent,
  ExtensionInstallEvent,
  ExtensionUninstallEvent,
  ExtensionEnableEvent,
  ExtensionDisableEvent,
  IdeConnectionType,
  IdeConnectionEvent,
} from './types.js';
export type {
  TelemetryEvent,
  ProviderCapabilities,
  ProviderContext,
  ToolCall,
  ProviderPerformanceMetrics,
} from './types.js';
export {
  ToolCallDecision,
  getDecisionFromOutcome,
} from './tool-call-decision.js';
export {
  FileOperation as FileOperationMetric,
  initializeMetrics,
  recordToolCallMetrics,
  recordTokenUsageMetrics,
  recordApiResponseMetrics,
  recordApiErrorMetrics,
  recordFileOperationMetric,
  recordModelRoutingMetrics,
  getMeter,
} from './metrics.js';
export { SpanStatusCode, ValueType } from '@opentelemetry/api';
export { SemanticAttributes } from '@opentelemetry/semantic-conventions';
export * from './uiTelemetry.js';
export { ToolConfirmationOutcome } from '../internal/interfaces.js';
export type {
  TelemetryConfig,
  SessionConfig,
  TelemetryPromptConfig,
  ToolLoggingConfig as ToolLoggingConfigInterface,
  DiffStat,
  ToolCallRequest,
  ToolCallError,
  ToolCallResponse,
  CompletedToolCallShape,
  HookInput,
  HookConfig,
  HookExecutionResult,
} from '../internal/interfaces.js';
export { HookEventName } from '../internal/interfaces.js';
