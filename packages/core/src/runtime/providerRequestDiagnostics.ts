import type { SessionSettingsOwner } from '../session/session-settings-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config, RedactionConfig } from '../config/config.js';
import type {
  ApiErrorEvent,
  ApiRequestEvent,
  ApiResponseEvent,
  TokenUsageEvent,
  ConversationRequestEvent,
  ConversationResponseEvent,
} from '../telemetry/types.js';
import {
  logApiError,
  logApiRequest,
  logApiResponse,
  logTokenUsage,
  logConversationRequest,
  logConversationResponse,
} from '../telemetry/loggers.js';
import { deepFreeze } from '../profiles/contracts/routingContexts.js';

export interface ProviderRequestDiagnostics {
  readonly conversationLoggingEnabled: boolean;
  readonly conversationLogPath: string;
  readonly redaction: RedactionConfig;
  recordApiError(event: ApiErrorEvent): void;
  recordApiRequest(event: ApiRequestEvent): void;
  recordApiResponse(event: ApiResponseEvent): void;
  recordTokenUsage(event: TokenUsageEvent): void;
  recordConversationRequest(event: ConversationRequestEvent): void;
  recordConversationResponse(event: ConversationResponseEvent): void;
  accumulateSessionTokens?: (
    providerName: string,
    usage: {
      input: number;
      output: number;
      cache: number;
      tool: number;
      thought: number;
      cacheReads?: number;
      cacheWrites?: number | null;
    },
  ) => void;
}

export function captureProviderRequestDiagnostics(
  owner: Config,
  settings: SessionSettingsOwner,
  accumulateSessionTokens?: ProviderRequestDiagnostics['accumulateSessionTokens'],
): ProviderRequestDiagnostics {
  const redaction = owner.getRedactionConfig();
  return {
    get conversationLoggingEnabled() {
      return settings.readConversationLoggingEnabled();
    },
    conversationLogPath: owner.getConversationLogPath(),
    redaction: deepFreeze(structuredClone(redaction)),
    recordApiError: (event) => logApiError(owner, event, settings.telemetry),
    recordApiRequest: (event) =>
      logApiRequest(owner, event, settings.telemetry),
    recordApiResponse: (event) =>
      logApiResponse(owner, event, settings.telemetry),
    recordTokenUsage: (event) =>
      logTokenUsage(owner, event, settings.telemetry),
    recordConversationRequest: (event) =>
      logConversationRequest(owner, event, settings.telemetry),
    recordConversationResponse: (event) =>
      logConversationResponse(owner, event, settings.telemetry),
    ...(accumulateSessionTokens === undefined
      ? {}
      : { accumulateSessionTokens }),
  };
}
