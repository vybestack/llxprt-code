/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderManager } from './ProviderManager.js';
import { IProvider } from './IProvider.js';
// import { ProviderPerformanceTracker } from './logging/ProviderPerformanceTracker.js'; // Not used in tests
import {
  registerSettingsService,
  resetSettingsService,
} from '../settings/settingsServiceInstance.js';
import { SettingsService } from '../settings/SettingsService.js';
import { clearActiveProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';

describe('ProviderPerformanceTracker', () => {
  let mockProvider: IProvider;

  beforeEach(() => {
    resetSettingsService();
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
    manager.accumulateSessionTokens('test-provider', {
      input: 100,
      output: 200,
      cache: 50,
      tool: 25,
      thought: 10,
    });

    // Verify updated state
    const updatedUsage = manager.getSessionTokenUsage();
    expect(updatedUsage.input).toBe(100);
    expect(updatedUsage.output).toBe(200);
    expect(updatedUsage.cache).toBe(50);
    expect(updatedUsage.tool).toBe(25);
    expect(updatedUsage.thought).toBe(10);
    expect(updatedUsage.total).toBe(385); // 100+200+50+25+10

    // Accumulate more tokens
    manager.accumulateSessionTokens('test-provider', {
      input: 50,
      output: 100,
      cache: 25,
      tool: 15,
      thought: 5,
    });

    // Verify final state
    const finalUsage = manager.getSessionTokenUsage();
    expect(finalUsage.input).toBe(150); // 100+50
    expect(finalUsage.output).toBe(300); // 200+100
    expect(finalUsage.cache).toBe(75); // 50+25
    expect(finalUsage.tool).toBe(40); // 25+15
    expect(finalUsage.thought).toBe(15); // 10+5
    expect(finalUsage.total).toBe(580); // 385+150+100+75+25+15
  });

  it('should reset session token usage', () => {
    const manager = new ProviderManager();
    resetSettingsService();

    // Register a mock provider
    manager.registerProvider(mockProvider);
    manager.setActiveProvider('test-provider');

    // Accumulate some tokens first
    manager.accumulateSessionTokens('test-provider', {
      input: 100,
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
