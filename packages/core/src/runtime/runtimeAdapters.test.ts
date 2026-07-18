/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createProviderAdapterFromManager,
  createToolRegistryViewFromRegistry,
  createTelemetryAdapterFromConfig,
} from './runtimeAdapters.js';
import type { RuntimeProviderManager } from './contracts/RuntimeProviderManager.js';
import type { RuntimeProvider } from './contracts/RuntimeProvider.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { MockTool } from '../test-utils/tools.js';
import {
  makeFakeConfig,
  getTestRuntimeMessageBus,
} from '../test-utils/config.js';
import * as loggers from '../telemetry/loggers.js';

/**
 * Minimal infrastructure double implementing the RuntimeProviderManager contract.
 * This is infrastructure for the adapter under test, NOT the component under test.
 */
function createManagerDouble(
  providersByName: Record<string, RuntimeProvider>,
  activeName?: string,
): RuntimeProviderManager {
  let active = activeName;
  return {
    getActiveProvider: () =>
      active ? (providersByName[active] ?? undefined) : undefined,
    getActiveProviderName: () => active,
    setActiveProvider: (name: string) => {
      active = name;
    },
    getAvailableModels: async () => [],
    listProviders: () => Object.keys(providersByName),
    getProviderByName: (name: string) => providersByName[name],
    registerProvider: () => {},
    getProviderMetrics: () => ({}),
    getSessionTokenUsage: () => ({
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    }),
    getServerToolsProvider: () => undefined,
    setServerToolsProvider: () => {},
    setConfig: () => {},
    hasActiveProvider: () => active !== undefined && active in providersByName,
    accumulateSessionTokens: () => {},
  };
}

describe('createProviderAdapterFromManager', () => {
  describe('getProviderByName', () => {
    it('delegates to the manager contract and returns the named provider', () => {
      const provider = {
        name: 'openai',
        makeRequest: () => Promise.resolve(),
      } as unknown as RuntimeProvider;
      const manager = createManagerDouble({ openai: provider }, 'openai');
      const adapter = createProviderAdapterFromManager(manager);

      // getProviderByName must be present because the contract declares it
      expect(typeof adapter.getProviderByName).toBe('function');
      expect(adapter.getProviderByName!('openai')).toBe(provider);
    });

    it('returns undefined when the manager has no such provider', () => {
      const provider = {
        name: 'openai',
        makeRequest: () => Promise.resolve(),
      } as unknown as RuntimeProvider;
      const manager = createManagerDouble({ openai: provider }, 'openai');
      const adapter = createProviderAdapterFromManager(manager);

      expect(adapter.getProviderByName!('nope')).toBeUndefined();
    });
  });

  describe('getActiveProvider', () => {
    it('delegates to the manager and returns the active provider', () => {
      const provider = {
        name: 'openai',
        makeRequest: () => Promise.resolve(),
      } as unknown as RuntimeProvider;
      const manager = createManagerDouble({ openai: provider }, 'openai');
      const adapter = createProviderAdapterFromManager(manager);

      expect(adapter.getActiveProvider()).toBe(provider);
    });

    it('throws when the manager has no active provider', () => {
      const manager = createManagerDouble({}, undefined);
      const adapter = createProviderAdapterFromManager(manager);

      expect(() => adapter.getActiveProvider()).toThrow(
        'AgentRuntimeContext provider adapter requires an active provider.',
      );
    });
  });

  describe('setActiveProvider', () => {
    it('delegates to the manager', () => {
      const provider = {
        name: 'openai',
        makeRequest: () => Promise.resolve(),
      } as unknown as RuntimeProvider;
      const manager = createManagerDouble({ openai: provider }, undefined);
      const adapter = createProviderAdapterFromManager(manager);

      adapter.setActiveProvider('openai');
      expect(manager.getActiveProviderName()).toBe('openai');
      expect(adapter.getActiveProvider()).toBe(provider);
    });
  });

  describe('when no manager is provided', () => {
    it('getProviderByName throws a descriptive error', () => {
      const adapter = createProviderAdapterFromManager(undefined);
      expect(() => adapter.getProviderByName!('openai')).toThrow(
        'AgentRuntimeContext provider adapter requires a RuntimeProviderManager instance.',
      );
    });

    it('getActiveProvider throws a descriptive error', () => {
      const adapter = createProviderAdapterFromManager(undefined);
      expect(() => adapter.getActiveProvider()).toThrow(
        'AgentRuntimeContext provider adapter requires a RuntimeProviderManager instance.',
      );
    });

    it('setActiveProvider throws a descriptive error', () => {
      const adapter = createProviderAdapterFromManager(undefined);
      expect(() => adapter.setActiveProvider('openai')).toThrow(
        'AgentRuntimeContext provider adapter requires a RuntimeProviderManager instance.',
      );
    });
  });
});

describe('createToolRegistryViewFromRegistry', () => {
  function createRegistryWithTools(): ToolRegistry {
    const config = makeFakeConfig();
    const registry = new ToolRegistry(
      config as never,
      getTestRuntimeMessageBus(config),
    );
    registry.registerTool(
      new MockTool(
        'with-schema',
        'with-schema',
        'A tool with a schema descriptor.',
      ),
    );
    return registry;
  }

  it('returns description and parameterSchema from the tool schema', () => {
    const registry = createRegistryWithTools();
    const view = createToolRegistryViewFromRegistry(registry);

    expect(view.listToolNames()).toContain('with-schema');

    const metadata = view.getToolMetadata('with-schema');
    expect(metadata).toBeDefined();
    expect(metadata!.name).toBe('with-schema');
    expect(metadata!.description).toBe('A tool with a schema descriptor.');
    expect(metadata!.parameterSchema).toBeDefined();
    expect(metadata!.parameterSchema!.type).toBe('object');
    // Verify the schema is sourced from the tool's actual parameter schema,
    // not a generic stub — check the MockTool's declared param property.
    expect(metadata!.parameterSchema!.properties?.['param']).toMatchObject({
      type: 'string',
    });
  });

  it('returns undefined for a tool that does not exist', () => {
    const registry = createRegistryWithTools();
    const view = createToolRegistryViewFromRegistry(registry);
    expect(view.getToolMetadata('nonexistent')).toBeUndefined();
  });

  it('returns an empty view when no registry is provided', () => {
    const view = createToolRegistryViewFromRegistry(undefined);
    expect(view.listToolNames()).toStrictEqual([]);
    expect(view.getToolMetadata('anything')).toBeUndefined();
  });
});

describe('createTelemetryAdapterFromConfig', () => {
  function captureLogCalls(): ReturnType<typeof vi.fn> {
    const fn = vi.fn();
    vi.spyOn(loggers, 'logApiResponse').mockImplementation(fn);
    return fn;
  }

  function captureErrorLogCalls(): ReturnType<typeof vi.fn> {
    const fn = vi.fn();
    vi.spyOn(loggers, 'logApiError').mockImplementation(fn);
    return fn;
  }

  const baseConfig = makeFakeConfig() as never;

  it('passes through a caller-provided attemptId in the response adapter', () => {
    const spy = captureLogCalls();
    const adapter = createTelemetryAdapterFromConfig(baseConfig);
    adapter.logApiResponse({
      model: 'test-model',
      durationMs: 100,
      attemptId: 'caller-attempt-1',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const passedAttemptId = spy.mock.calls[0][1] as { attempt_id?: string };
    expect(passedAttemptId.attempt_id).toBe('caller-attempt-1');
  });

  it('trims whitespace from a padded response attemptId', () => {
    const spy = captureLogCalls();
    const adapter = createTelemetryAdapterFromConfig(baseConfig);
    adapter.logApiResponse({
      model: 'test-model',
      durationMs: 100,
      attemptId: '  caller-attempt-1  ',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const passedAttemptId = spy.mock.calls[0][1] as { attempt_id?: string };
    expect(passedAttemptId.attempt_id).toBe('caller-attempt-1');
  });

  it('generates a UUID when response attemptId is undefined', () => {
    const spy = captureLogCalls();
    const adapter = createTelemetryAdapterFromConfig(baseConfig);
    adapter.logApiResponse({ model: 'test-model', durationMs: 100 });

    expect(spy).toHaveBeenCalledTimes(1);
    const passedAttemptId = spy.mock.calls[0][1] as { attempt_id?: string };
    expect(passedAttemptId.attempt_id).toBeTruthy();
    // UUID v4 format check
    expect(passedAttemptId.attempt_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('generates a UUID when response attemptId is empty string', () => {
    const spy = captureLogCalls();
    const adapter = createTelemetryAdapterFromConfig(baseConfig);
    adapter.logApiResponse({
      model: 'test-model',
      durationMs: 100,
      attemptId: '',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const passedAttemptId = spy.mock.calls[0][1] as { attempt_id?: string };
    expect(passedAttemptId.attempt_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('generates a UUID when response attemptId is whitespace-only', () => {
    const spy = captureLogCalls();
    const adapter = createTelemetryAdapterFromConfig(baseConfig);
    adapter.logApiResponse({
      model: 'test-model',
      durationMs: 100,
      attemptId: '   ',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const passedAttemptId = spy.mock.calls[0][1] as { attempt_id?: string };
    expect(passedAttemptId.attempt_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('passes through a caller-provided attemptId in the error adapter', () => {
    const spy = captureErrorLogCalls();
    const adapter = createTelemetryAdapterFromConfig(baseConfig);
    adapter.logApiError({
      model: 'test-model',
      durationMs: 100,
      error: 'fail',
      attemptId: 'caller-attempt-err-1',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const passedAttemptId = spy.mock.calls[0][1] as { attempt_id?: string };
    expect(passedAttemptId.attempt_id).toBe('caller-attempt-err-1');
  });

  it('trims whitespace from a padded error attemptId', () => {
    const spy = captureErrorLogCalls();
    const adapter = createTelemetryAdapterFromConfig(baseConfig);
    adapter.logApiError({
      model: 'test-model',
      durationMs: 100,
      error: 'fail',
      attemptId: '  caller-attempt-err-1  ',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const passedAttemptId = spy.mock.calls[0][1] as { attempt_id?: string };
    expect(passedAttemptId.attempt_id).toBe('caller-attempt-err-1');
  });

  it('generates a UUID when error attemptId is undefined', () => {
    const spy = captureErrorLogCalls();
    const adapter = createTelemetryAdapterFromConfig(baseConfig);
    adapter.logApiError({
      model: 'test-model',
      durationMs: 100,
      error: 'fail',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const passedAttemptId = spy.mock.calls[0][1] as { attempt_id?: string };
    expect(passedAttemptId.attempt_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('generates a UUID when error attemptId is empty string', () => {
    const spy = captureErrorLogCalls();
    const adapter = createTelemetryAdapterFromConfig(baseConfig);
    adapter.logApiError({
      model: 'test-model',
      durationMs: 100,
      error: 'fail',
      attemptId: '',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const passedAttemptId = spy.mock.calls[0][1] as { attempt_id?: string };
    expect(passedAttemptId.attempt_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('generates a UUID when error attemptId is whitespace-only', () => {
    const spy = captureErrorLogCalls();
    const adapter = createTelemetryAdapterFromConfig(baseConfig);
    adapter.logApiError({
      model: 'test-model',
      durationMs: 100,
      error: 'fail',
      attemptId: '  ',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const passedAttemptId = spy.mock.calls[0][1] as { attempt_id?: string };
    expect(passedAttemptId.attempt_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
