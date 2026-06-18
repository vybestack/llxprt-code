/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P08
 */

import type { TelemetryConfig } from '../internal/interfaces.js';
import { ToolConfirmationOutcome } from '../internal/interfaces.js';

export { ToolConfirmationOutcome };

export type { TelemetryConfig as Config };

export type {
  ProviderCapabilities,
  ProviderContext,
  ToolCall,
  ProviderPerformanceMetrics,
} from './events/provider-context.js';

export type { Config as TelemetryConfig } from './events/session-events.js';

export {
  StartSessionEvent,
  EndSessionEvent,
  UserPromptEvent,
} from './events/session-events.js';
import type {
  StartSessionEvent,
  EndSessionEvent,
  UserPromptEvent,
} from './events/session-events.js';

export {
  ApiRequestEvent,
  ApiErrorEvent,
  ApiResponseEvent,
} from './events/api-events.js';
import type {
  ApiRequestEvent,
  ApiErrorEvent,
  ApiResponseEvent,
} from './events/api-events.js';

export {
  ToolCallEvent,
  HookCallEvent,
  ToolOutputTruncatedEvent,
  FileOperation,
  FileOperationEvent,
} from './events/tool-events.js';
import type { ToolCallEvent, HookCallEvent } from './events/tool-events.js';

export {
  LoopDetectedEvent,
  LoopType,
  NextSpeakerCheckEvent,
  SlashCommandEvent,
  MalformedJsonResponseEvent,
} from './events/loop-events.js';
import type {
  LoopDetectedEvent,
  NextSpeakerCheckEvent,
  SlashCommandEvent,
  MalformedJsonResponseEvent,
} from './events/loop-events.js';

export {
  ConversationRequestEvent,
  ConversationResponseEvent,
  EnhancedConversationResponseEvent,
  ProviderSwitchEvent,
  ProviderCapabilityEvent,
} from './events/conversation-events.js';
import type {
  ConversationRequestEvent,
  ConversationResponseEvent,
  EnhancedConversationResponseEvent,
  ProviderSwitchEvent,
  ProviderCapabilityEvent,
} from './events/conversation-events.js';

export {
  KittySequenceOverflowEvent,
  TokenUsageEvent,
  PerformanceMetricsEvent,
  ModelRoutingEvent,
} from './events/metric-events.js';
import type {
  KittySequenceOverflowEvent,
  TokenUsageEvent,
  PerformanceMetricsEvent,
} from './events/metric-events.js';

export {
  ExtensionInstallEvent,
  ExtensionUninstallEvent,
  ExtensionEnableEvent,
  ExtensionDisableEvent,
  IdeConnectionType,
  IdeConnectionEvent,
} from './events/extension-events.js';

export { HookEventName } from '../internal/interfaces.js';

export {
  ToolCallDecision,
  getDecisionFromOutcome,
} from './tool-call-decision.js';

export type TelemetryEvent =
  | StartSessionEvent
  | EndSessionEvent
  | UserPromptEvent
  | ToolCallEvent
  | HookCallEvent
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
