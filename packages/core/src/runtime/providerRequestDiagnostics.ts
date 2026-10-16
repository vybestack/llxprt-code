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
import { assertRequestArtifactExporter } from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { acknowledgeTerminalTelemetry } from '@vybestack/llxprt-code-telemetry/telemetry/loggers.js';
import { deepFreeze } from '../profiles/contracts/routingContexts.js';

/**
 * Request-artifact telemetry (issue #854): the request/conversation request
 * events can be acknowledged by the exporter before the provider sends.
 */
export interface RequestTelemetryOptions {
  readonly signal?: AbortSignal;
  readonly acknowledged?: boolean;
}

export interface ProviderRequestDiagnostics {
  readonly conversationLoggingEnabled: boolean;
  readonly conversationLogPath: string;
  /**
   * Telemetry is enabled, API-body plus prompt logging are opted in, and the
   * session's exporter can carry request artifacts. An exporter that cannot
   * (console) is never asked to, so the request is logged without a body.
   */
  readonly requestBodyLoggingEnabled: boolean;
  readonly redaction: RedactionConfig;
  /** Throws when this session's telemetry cannot export request artifacts. */
  assertRequestArtifactExporter(): void;
  /**
   * Publishes the (at most two) log records `build` emits with export
   * acknowledgement. The returned function runs the deferred metric and
   * aggregation effects once the caller accepts the publication.
   */
  acknowledgeTerminalTelemetry(
    build: () => void,
    signal?: AbortSignal,
  ): Promise<() => void>;
  recordApiError(event: ApiErrorEvent): void;
  recordApiRequest(
    event: ApiRequestEvent,
    options?: RequestTelemetryOptions,
  ): void | Promise<void>;
  recordApiResponse(event: ApiResponseEvent): void;
  recordTokenUsage(event: TokenUsageEvent): void;
  recordConversationRequest(
    event: ConversationRequestEvent,
    options?: RequestTelemetryOptions,
  ): void | Promise<void>;
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
    get requestBodyLoggingEnabled() {
      const privacy = settings.telemetry.readPrivacySettings();
      return (
        settings.telemetry.isEnabled() &&
        privacy.logApiBodies &&
        privacy.logPrompts &&
        settings.telemetry.supportsRequestArtifacts()
      );
    },
    conversationLogPath: owner.getConversationLogPath(),
    assertRequestArtifactExporter: () =>
      assertRequestArtifactExporter(settings.telemetry),
    acknowledgeTerminalTelemetry: (build, signal) =>
      acknowledgeTerminalTelemetry(settings.telemetry, build, signal),
    redaction: deepFreeze(structuredClone(redaction)),
    recordApiError: (event) => logApiError(owner, event, settings.telemetry),
    recordApiRequest: (event, options) =>
      logApiRequest(
        owner,
        event,
        settings.telemetry,
        options?.signal,
        options?.acknowledged,
      ),
    recordApiResponse: (event) =>
      logApiResponse(owner, event, settings.telemetry),
    recordTokenUsage: (event) =>
      logTokenUsage(owner, event, settings.telemetry),
    recordConversationRequest: (event, options) =>
      logConversationRequest(
        owner,
        event,
        settings.telemetry,
        options?.signal,
        options?.acknowledged,
      ),
    recordConversationResponse: (event) =>
      logConversationResponse(owner, event, settings.telemetry),
    ...(accumulateSessionTokens === undefined
      ? {}
      : { accumulateSessionTokens }),
  };
}
