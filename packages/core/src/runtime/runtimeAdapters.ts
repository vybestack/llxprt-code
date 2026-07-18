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
  type ToolRegistry,
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
  manager?: RuntimeProviderManager,
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

/**
 * Creates a telemetry adapter that bridges to legacy Config-backed loggers.
 */
export function createTelemetryAdapterFromConfig(
  config: Config,
): AgentRuntimeTelemetryAdapter {
  return {
    logApiRequest: (event) => {
      const legacy = new LegacyApiRequestEvent(
        event.model,
        event.promptId ?? event.runtimeId ?? 'runtime',
        event.requestText,
      );
      logApiRequest(config, legacy);
    },
    logApiResponse: (event) => {
      const usageForLegacy =
        event.usageMetadata ??
        (event.usage !== undefined
          ? {
              promptTokenCount: event.usage.inputTokens,
              candidatesTokenCount: event.usage.outputTokens,
              totalTokenCount: event.usage.totalTokens,
            }
          : undefined);
      // Stable prompt identity matches logApiRequest's correlation key.
      const promptId = event.promptId ?? event.runtimeId ?? 'runtime';
      // Trim whitespace so padded IDs normalize to their core value.
      // Empty/whitespace-only attemptId is treated as missing so the
      // aggregator cannot dedupe unrelated attempts under a blank key.
      const trimmedAttemptId = event.attemptId?.trim();
      const attemptId =
        trimmedAttemptId !== undefined && trimmedAttemptId !== ''
          ? trimmedAttemptId
          : randomUUID();
      const legacy = new LegacyApiResponseEvent(
        event.model,
        event.durationMs,
        promptId,
        usageForLegacy,
        event.responseText,
        event.error,
        undefined,
        attemptId,
      );
      legacy.provider = event.provider;
      logApiResponse(config, legacy);
    },
    logApiError: (event) => {
      // Stable prompt identity matches logApiRequest's correlation key.
      const promptId = event.promptId ?? event.runtimeId ?? 'runtime';
      // Trim whitespace so padded IDs normalize to their core value.
      // Empty/whitespace-only attemptId is treated as missing so the
      // aggregator cannot dedupe unrelated attempts under a blank key.
      const trimmedAttemptId = event.attemptId?.trim();
      const attemptId =
        trimmedAttemptId !== undefined && trimmedAttemptId !== ''
          ? trimmedAttemptId
          : randomUUID();
      const legacy = new LegacyApiErrorEvent(
        event.model,
        event.error,
        event.durationMs,
        promptId,
        event.errorType,
        event.statusCode,
        attemptId,
      );
      legacy.provider = event.provider;
      logApiError(config, legacy);
    },
  };
}

/**
 * Creates a ToolRegistryView from an optional ToolRegistry.
 */
export function createToolRegistryViewFromRegistry(
  registry?: ToolRegistry,
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
      const parameterSchema = schema?.parametersJsonSchema;

      return {
        name: tool.name,
        description,
        parameterSchema,
      };
    },
  };
}
