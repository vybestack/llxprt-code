/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderManager } from '../providers/ProviderManager.js';
import type { IProviderManager } from '../providers/IProviderManager.js';
import type { IProvider } from '../providers/IProvider.js';
import type { Config } from '../config/config.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
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
import type {
  AgentRuntimeProviderAdapter,
  AgentRuntimeTelemetryAdapter,
  ToolRegistryView,
} from './AgentRuntimeContext.js';

/**
 * Creates a mutable provider adapter backed by a ProviderManager instance.
 */
export function createProviderAdapterFromManager(
  manager?: ProviderManager | IProviderManager,
): AgentRuntimeProviderAdapter {
  if (!manager) {
    return {
      getActiveProvider: () => {
        throw new Error(
          'AgentRuntimeContext provider adapter requires a ProviderManager instance.',
        );
      },
      setActiveProvider: () => {
        throw new Error(
          'AgentRuntimeContext provider adapter requires a ProviderManager instance.',
        );
      },
      getProviderByName: () => {
        throw new Error(
          'AgentRuntimeContext provider adapter requires a ProviderManager instance.',
        );
      },
    };
  }

  return {
    getActiveProvider: () => manager.getActiveProvider(),
    setActiveProvider: (name: string) => manager.setActiveProvider(name),
    getProviderByName:
      typeof (manager as unknown as { getProviderByName?: unknown })
        .getProviderByName === 'function'
        ? (name: string) =>
            (
              manager as unknown as {
                getProviderByName: (providerName: string) => unknown;
              }
            ).getProviderByName(name) as IProvider | undefined
        : undefined,
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
      const legacy = new LegacyApiResponseEvent(
        event.model,
        event.durationMs,
        event.promptId ?? event.runtimeId ?? 'runtime',
        event.usageMetadata,
        event.responseText,
        event.error,
      );
      logApiResponse(config, legacy);
    },
    logApiError: (event) => {
      const legacy = new LegacyApiErrorEvent(
        event.model,
        event.error,
        event.durationMs,
        event.promptId ?? event.runtimeId ?? 'runtime',
        event.errorType,
        event.statusCode,
      );
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
      const schema = (tool as unknown as { schema?: Record<string, unknown> })
        .schema;
      const description =
        typeof schema?.description === 'string'
          ? (schema.description as string)
          : typeof (tool as { description?: string }).description === 'string'
            ? ((tool as { description: string }).description as string)
            : '';
      const parameterSchema =
        (schema as { parameters?: Record<string, unknown> })?.parameters ??
        (schema as { parametersJsonSchema?: Record<string, unknown> })
          ?.parametersJsonSchema;

      return {
        name: (tool as { name?: string }).name ?? name,
        description,
        parameterSchema,
      };
    },
  };
}
