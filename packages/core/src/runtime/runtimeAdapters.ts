import type {
  RootTelemetry,
  TelemetrySpan,
} from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeProviderManager } from './contracts/RuntimeProviderManager.js';
import type { Config } from '../config/config.js';
import {
  hasToolSchema,
  resolveToolDescription,
  type ToolSelection,
} from '@vybestack/llxprt-code-tools';
import {
  logApiRequest,
  logApiResponse,
  logApiError,
} from '../telemetry/loggers.js';
import {
  ApiRequestEvent as LegacyApiRequestEvent,
  ApiResponseEvent as LegacyApiResponseEvent,
  ApiErrorEvent as LegacyApiErrorEvent,
} from '../telemetry/types.js';
import { randomUUID } from 'node:crypto';
import type {
  AgentRuntimeProviderAdapter,
  AgentRuntimeTelemetryAdapter,
  ToolRegistryView,
} from './AgentRuntimeContext.js';

/**
 * Creates a mutable provider adapter backed by a RuntimeProviderManager instance.
 */
export function createProviderAdapterFromManager(
  manager?: Pick<
    RuntimeProviderManager,
    'getActiveProvider' | 'setActiveProvider' | 'getProviderByName'
  >,
): AgentRuntimeProviderAdapter {
  if (!manager) {
    return {
      getActiveProvider: () => {
        throw new Error(
          'AgentRuntimeContext provider adapter requires a RuntimeProviderManager instance.',
        );
      },
      setActiveProvider: () => {
        throw new Error(
          'AgentRuntimeContext provider adapter requires a RuntimeProviderManager instance.',
        );
      },
      getProviderByName: () => {
        throw new Error(
          'AgentRuntimeContext provider adapter requires a RuntimeProviderManager instance.',
        );
      },
    };
  }

  return {
    getActiveProvider: () => {
      const provider = manager.getActiveProvider();
      if (!provider) {
        throw new Error(
          'AgentRuntimeContext provider adapter requires an active provider.',
        );
      }
      return provider;
    },
    setActiveProvider: (name: string) => {
      void manager.setActiveProvider(name);
    },
    getProviderByName: (name: string) => manager.getProviderByName(name),
  };
}

function normalizeAttemptIdentity(attemptId: string | undefined): string {
  const trimmed = attemptId?.trim();
  return trimmed === '' ? randomUUID() : (trimmed ?? randomUUID());
}

export function createTelemetryAdapter(
  config: Config,
  telemetry: RootTelemetry,
): AgentRuntimeTelemetryAdapter {
  const spans = new Map<string, TelemetrySpan>();
  const identity = (event: { promptId?: string; runtimeId?: string }): string =>
    event.promptId ?? event.runtimeId ?? 'runtime';
  return {
    logApiRequest: (event) => {
      if (telemetry.isEnabled()) {
        const key = identity(event);
        spans.get(key)?.end();
        spans.set(
          key,
          telemetry.spans.start('llxprt.api.request', {
            attributes: {
              model: event.model,
              'session.id': config.getSessionId(),
            },
          }),
        );
      }
      logApiRequest(
        config,
        new LegacyApiRequestEvent(
          event.model,
          identity(event),
          event.requestText,
        ),
        telemetry,
      );
    },
    logApiResponse: (event) => {
      spans.get(identity(event))?.end();
      spans.delete(identity(event));
      const usageForLegacy =
        event.usageMetadata ??
        (event.usage !== undefined
          ? {
              inputTokenCount: event.usage.inputTokens,
              outputTokenCount: event.usage.outputTokens,
              totalTokenCount: event.usage.totalTokens,
            }
          : undefined);
      // Stable prompt identity matches logApiRequest's correlation key.
      // Trim whitespace so padded IDs normalize to their core value.
      // Empty/whitespace-only attemptId is treated as missing so the
      // aggregator cannot dedupe unrelated attempts under a blank key.
      const attemptId = normalizeAttemptIdentity(event.attemptId);
      const legacy = new LegacyApiResponseEvent(
        event.model,
        event.durationMs,
        identity(event),
        usageForLegacy,
        event.responseText,
        event.error,
        undefined,
        attemptId,
      );
      legacy.provider = event.provider;
      logApiResponse(config, legacy, telemetry);
    },
    logApiError: (event) => {
      spans.get(identity(event))?.end();
      spans.delete(identity(event));
      // Stable prompt identity matches logApiRequest's correlation key.
      // Trim whitespace so padded IDs normalize to their core value.
      // Empty/whitespace-only attemptId is treated as missing so the
      // aggregator cannot dedupe unrelated attempts under a blank key.
      const attemptId = normalizeAttemptIdentity(event.attemptId);
      const legacy = new LegacyApiErrorEvent(
        event.model,
        event.error,
        event.durationMs,
        identity(event),
        event.errorType,
        event.statusCode,
        attemptId,
      );
      legacy.provider = event.provider;
      logApiError(config, legacy, telemetry);
    },
  };
}

/**
 * Creates a ToolRegistryView from an optional ToolSelection.
 */
export function createToolRegistryViewFromRegistry(
  registry?: ToolSelection,
): ToolRegistryView {
  if (!registry) {
    return {
      listToolNames: () => [],
      getToolMetadata: () => undefined,
    };
  }

  return {
    listToolNames: () => registry.getAllToolNames(),
    getToolMetadata: (name) => {
      const tool = registry.getTool(name);
      if (!tool) {
        return undefined;
      }
      const schema = hasToolSchema(tool) ? tool.schema : undefined;
      const description = resolveToolDescription(schema, tool.description);
      const parameterSchema = structuredClone(schema?.parametersJsonSchema);

      return {
        name: tool.name,
        description,
        parameterSchema,
      };
    },
  };
}
