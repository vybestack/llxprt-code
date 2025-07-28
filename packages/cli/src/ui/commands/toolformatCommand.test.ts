/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toolformatCommand } from './toolformatCommand';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { CommandContext } from './types.js';
import { IProvider, IProviderManager } from '@vybestack/llxprt-code-core';

vi.mock('../../providers/providerManagerInstance.js');

function mockProvider(extra: Partial<IProvider> = {}) {
  return {
    name: 'openai',
    getToolFormat: vi.fn().mockReturnValue('openai'),
    setToolFormatOverride: vi.fn(),
    getModels: vi.fn().mockResolvedValue([]),
    generateChatCompletion: vi.fn(),
    getServerTools: vi.fn().mockReturnValue([]),
    invokeServerTool: vi.fn().mockResolvedValue({}),
    ...extra,
  } as unknown as IProvider;
}

describe('toolformatCommand', () => {
  let mockContext: CommandContext;
  let providerManager: IProviderManager;
  let provider: IProvider;
  beforeEach(() => {
    provider = mockProvider();
    providerManager = {
      hasActiveProvider: vi.fn().mockReturnValue(true),
      getActiveProvider: vi.fn().mockReturnValue(provider),
      listProviders: vi.fn().mockReturnValue([]),
      switchProvider: vi.fn(),
      resetAllProviders: vi.fn(),
    } as unknown as IProviderManager;
    (getProviderManager as unknown as vi.Mock).mockReturnValue(providerManager);
    mockContext = createMockCommandContext();
    mockContext.services.settings.merged.providerToolFormatOverrides = {
      openai: 'xml',
    };
    mockContext.services.settings.setValue = vi.fn();
  });

  it('shows current format and persist status if called with no arguments', () => {
    const result = toolformatCommand.action(mockContext, '');
    expect(result).toBeDefined();
    expect(result?.type).toBe('message');
    expect(result?.content).toContain('Current tool format: openai');
    expect(result?.content).toMatch(/auto-detected|manual override/);
  });

  it('clears the override with auto', () => {
    const result = toolformatCommand.action(mockContext, 'auto');
    expect(result?.type).toBe('message');
    expect(result?.content).toMatch(/override cleared|auto-detection/);
    expect(provider.setToolFormatOverride).toHaveBeenCalledWith(null);
    expect(mockContext.services.settings.setValue).toHaveBeenCalled();
  });

  it('errors for invalid format', () => {
    const result = toolformatCommand.action(mockContext, 'notrealformat');
    expect(result?.type).toBe('message');
    expect(result?.messageType).toBe('error');
    expect(result?.content).toContain('Invalid tool format');
  });

  it('sets a valid override and persists', () => {
    const result = toolformatCommand.action(mockContext, 'hermes');
    expect(provider.setToolFormatOverride).toHaveBeenCalledWith('hermes');
    expect(mockContext.services.settings.setValue).toHaveBeenCalledWith(
      'User',
      'providerToolFormatOverrides',
      { openai: 'hermes' },
    );
    expect(result?.type).toBe('message');
    expect(result?.messageType).toBe('info');
    expect(result?.content).toContain("override set to 'hermes'");
  });

  it('shows error if no active provider', () => {
    providerManager.hasActiveProvider = vi.fn().mockReturnValue(false);
    const result = toolformatCommand.action(mockContext, 'hermes');
    expect(result?.type).toBe('message');
    expect(result?.messageType).toBe('error');
    expect(result?.content).toContain('No active provider');
  });
});
