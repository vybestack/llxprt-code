/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderManager } from './ProviderManager.js';
import { LoggingProviderWrapper } from './LoggingProviderWrapper.js';
import type { IProvider } from './IProvider.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
// import { ProviderPerformanceTracker } from './logging/ProviderPerformanceTracker.js'; // Not used in tests
import {
  registerSettingsService,
  resetSettingsService,
} from '@vybestack/llxprt-code-settings';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

function createRuntimeConfigStub(): Config {
  return {
    getConversationLoggingEnabled: () => false,
    getProviderManager: () => ({ accumulateSessionTokens: () => {} }),
    getRedactionConfig: () => ({
      redactApiKeys: false,
      redactCredentials: false,
      redactFilePaths: false,
      redactUrls: false,
      redactEmails: false,
      redactPersonalInfo: false,
    }),
  } as unknown as Config;
}

function setTestRuntimeContext(settingsService = new SettingsService()): void {
  setActiveProviderRuntimeContext(
    createProviderRuntimeContext({
      settingsService,
      config: createRuntimeConfigStub(),
      metadata: { source: 'ProviderManager.test' },
    }),
  );
}

describe('ProviderManager provider ordering', () => {
  const createProvider = (name: string): IProvider =>
    ({
      name,
      getModels: vi.fn().mockResolvedValue([]),
      getDefaultModel: vi.fn().mockReturnValue('test-model'),
      generateChatCompletion: vi.fn(),
      getServerTools: vi.fn().mockReturnValue([]),
      invokeServerTool: vi.fn().mockRejectedValue(new Error('Not implemented')),
    }) as unknown as IProvider;

  beforeEach(() => {
    resetSettingsService();
    setTestRuntimeContext();
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('prioritizes core providers and sorts remaining alphabetically', () => {
    const manager = new ProviderManager();

    const providerNames = [
      'openai-responses',
      'gamma',
      'anthropic',
      'beta',
      'gemini',
      'openai',
      'alpha',
    ];

    for (const name of providerNames) {
      manager.registerProvider(createProvider(name));
    }

    expect(manager.listProviders()).toStrictEqual([
      'anthropic',
      'gemini',
      'openai',
      'openai-responses',
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  it('falls back to active runtime config when init provides only settings service', () => {
    const settingsService = new SettingsService();
    const runtimeConfig = {
      getConversationLoggingEnabled: () => false,
      getProviderManager: () => ({ accumulateSessionTokens: () => {} }),
      getRedactionConfig: () => ({
        redactApiKeys: false,
        redactCredentials: false,
        redactFilePaths: false,
        redactUrls: false,
        redactEmails: false,
        redactPersonalInfo: false,
      }),
    } as unknown as Config;
    setActiveProviderRuntimeContext({
      settingsService,
      config: runtimeConfig,
      runtimeId: 'provider-manager.config-fallback-test',
      metadata: { source: 'ProviderManager.test' },
    });

    const manager = new ProviderManager({ settingsService });
    manager.registerProvider(createProvider('fallback-provider'));

    expect(manager.getProviderByName('fallback-provider')).toBeInstanceOf(
      LoggingProviderWrapper,
    );
  });
});

describe('ProviderPerformanceTracker', () => {
  let mockProvider: IProvider;

  it('returns null metrics when no active provider is set', () => {
    const manager = new ProviderManager();

    expect(manager.getProviderMetrics()).toBeNull();
  });
  beforeEach(() => {
    resetSettingsService();
    setTestRuntimeContext();
    registerSettingsService(new SettingsService());
    mockProvider = {
      name: 'test-provider',
      isDefault: false,
      getModels: vi.fn().mockResolvedValue([]),
      getDefaultModel: vi.fn().mockReturnValue('default-model'),
      generateChatCompletion: vi.fn(),
      getServerTools: vi.fn().mockReturnValue([]),
      invokeServerTool: vi.fn().mockRejectedValue(new Error('Not implemented')),
    } as unknown as IProvider;
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('should accumulate session tokens correctly', () => {
    const manager = new ProviderManager();

    // Register a mock provider
    manager.registerProvider(mockProvider);
    manager.setActiveProvider('test-provider');

    // Verify initial state
    const initialUsage = manager.getSessionTokenUsage();
    expect(initialUsage.input).toBe(0);
    expect(initialUsage.output).toBe(0);
    expect(initialUsage.cache).toBe(0);
    expect(initialUsage.tool).toBe(0);
    expect(initialUsage.thought).toBe(0);
    expect(initialUsage.total).toBe(0);

    // Accumulate tokens
    // input includes cache tokens (total input), cache is tracked separately
    manager.accumulateSessionTokens('test-provider', {
      input: 150,
      output: 200,
      cache: 50,
      tool: 25,
      thought: 10,
    });

    // Verify updated state
    const updatedUsage = manager.getSessionTokenUsage();
    expect(updatedUsage.input).toBe(150);
    expect(updatedUsage.output).toBe(200);
    expect(updatedUsage.cache).toBe(50);
    expect(updatedUsage.tool).toBe(25);
    expect(updatedUsage.thought).toBe(10);
    expect(updatedUsage.total).toBe(385); // 150+200+25+10

    // Accumulate more tokens
    manager.accumulateSessionTokens('test-provider', {
      input: 75,
      output: 100,
      cache: 25,
      tool: 15,
      thought: 5,
    });

    // Verify final state
    const finalUsage = manager.getSessionTokenUsage();
    expect(finalUsage.input).toBe(225); // 150+75
    expect(finalUsage.output).toBe(300); // 200+100
    expect(finalUsage.cache).toBe(75); // 50+25
    expect(finalUsage.tool).toBe(40); // 25+15
    expect(finalUsage.thought).toBe(15); // 10+5
    expect(finalUsage.total).toBe(580); // 385+75+100+15+5
  });

  it('should reset session token usage', () => {
    const manager = new ProviderManager();
    resetSettingsService();

    // Register a mock provider
    manager.registerProvider(mockProvider);
    manager.setActiveProvider('test-provider');

    // Accumulate some tokens first
    manager.accumulateSessionTokens('test-provider', {
      input: 150,
      output: 200,
      cache: 50,
      tool: 25,
      thought: 10,
    });

    // Verify tokens were accumulated
    const usage = manager.getSessionTokenUsage();
    expect(usage.total).toBe(385);

    // Reset usage
    manager.resetSessionTokenUsage();

    // Verify reset state
    const resetUsage = manager.getSessionTokenUsage();
    expect(resetUsage.input).toBe(0);
    expect(resetUsage.output).toBe(0);
    expect(resetUsage.cache).toBe(0);
    expect(resetUsage.tool).toBe(0);
    expect(resetUsage.thought).toBe(0);
    expect(resetUsage.total).toBe(0);
  });
});
