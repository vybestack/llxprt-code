/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  createProviderAdapterFromManager,
  createToolRegistryViewFromRegistry,
} from './runtimeAdapters.js';
import type { RuntimeProviderManager } from './contracts/RuntimeProviderManager.js';
import type { RuntimeProvider } from './contracts/RuntimeProvider.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { MockTool } from '../test-utils/tools.js';
import {
  makeFakeConfig,
  getTestRuntimeMessageBus,
} from '../test-utils/config.js';

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

  describe('when no manager is provided', () => {
    it('getProviderByName throws a descriptive error', () => {
      const adapter = createProviderAdapterFromManager(undefined);
      expect(() => adapter.getProviderByName!('openai')).toThrow(
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
  });

  it('returns undefined for a tool that does not exist', () => {
    const registry = createRegistryWithTools();
    const view = createToolRegistryViewFromRegistry(registry);
    expect(view.getToolMetadata('nonexistent')).toBeUndefined();
  });

  it('returns an empty view when no registry is provided', () => {
    const view = createToolRegistryViewFromRegistry(undefined);
    expect(view.listToolNames()).toEqual([]);
    expect(view.getToolMetadata('anything')).toBeUndefined();
  });
});
