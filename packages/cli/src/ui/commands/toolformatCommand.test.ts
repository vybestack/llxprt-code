/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { toolformatCommand } from './toolformatCommand.js';
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
  let mockSettingsService: unknown;
  beforeEach(() => {
    provider = mockProvider();
    providerManager = {
      hasActiveProvider: vi.fn().mockReturnValue(true),
      getActiveProvider: vi.fn().mockReturnValue(provider),
      listProviders: vi.fn().mockReturnValue([]),
      switchProvider: vi.fn(),
      resetAllProviders: vi.fn(),
    } as unknown as IProviderManager;
    (getProviderManager as unknown as Mock).mockReturnValue(providerManager);

    // Mock SettingsService
    mockSettingsService = {
      getSettings: vi.fn().mockResolvedValue({ toolFormat: undefined }),
      updateSettings: vi.fn().mockResolvedValue(undefined),
    };

    mockContext = createMockCommandContext();
    mockContext.services.settings.merged.providerToolFormatOverrides = {
      openai: 'xml',
    };
    mockContext.services.settings.setValue = vi.fn();
    mockContext.services.config = {
      getSettingsService: vi.fn().mockReturnValue(mockSettingsService),
    } as never;
  });

  it('shows current format and persist status if called with no arguments', async () => {
    const result = await toolformatCommand.action!(mockContext, '');
    expect(result).toBeDefined();
    expect(result?.type).toBe('message');
    if (result && result.type === 'message') {
      expect(result.content).toContain('Current tool format: openai');
      expect(result.content).toMatch(/auto-detected|manual override/);
    }
  });

  it('clears the override with auto', async () => {
    const result = await toolformatCommand.action!(mockContext, 'auto');
    expect(result?.type).toBe('message');
    if (result && result.type === 'message') {
      expect(result.content).toMatch(/override cleared|auto-detection/);
    }
    expect(provider.setToolFormatOverride).toHaveBeenCalledWith(null);
    // Should use SettingsService, not legacy settings
    expect(
      (mockSettingsService as { updateSettings: Mock }).updateSettings,
    ).toHaveBeenCalledWith('openai', { toolFormat: 'auto' });
  });

  it('errors for invalid format', async () => {
    const result = await toolformatCommand.action!(
      mockContext,
      'notrealformat',
    );
    expect(result?.type).toBe('message');
    if (result && result.type === 'message') {
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('Invalid tool format');
    }
  });

  it('sets a valid override and persists', async () => {
    const result = await toolformatCommand.action!(mockContext, 'hermes');
    expect(provider.setToolFormatOverride).toHaveBeenCalledWith('hermes');
    // Should use SettingsService, not legacy settings
    expect(
      (mockSettingsService as { updateSettings: Mock }).updateSettings,
    ).toHaveBeenCalledWith('openai', { toolFormat: 'hermes' });
    expect(result?.type).toBe('message');
    if (result && result.type === 'message') {
      expect(result.messageType).toBe('info');
      expect(result.content).toContain("override set to 'hermes'");
    }
  });

  it('shows error if no active provider', async () => {
    providerManager.hasActiveProvider = vi.fn().mockReturnValue(false);
    const result = await toolformatCommand.action!(mockContext, 'hermes');
    expect(result?.type).toBe('message');
    if (result && result.type === 'message') {
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('No active provider');
    }
  });

  describe('SettingsService integration', () => {
    it('uses SettingsService when available for setting format', async () => {
      const result = await toolformatCommand.action!(mockContext, 'xml');
      expect(
        (mockSettingsService as { updateSettings: Mock }).updateSettings,
      ).toHaveBeenCalledWith('openai', { toolFormat: 'xml' });
      expect(result?.type).toBe('message');
      if (result && result.type === 'message') {
        expect(result.messageType).toBe('info');
        expect(result.content).toContain("override set to 'xml'");
      }
    });

    it('uses SettingsService when available for clearing format', async () => {
      const result = await toolformatCommand.action!(mockContext, 'auto');
      expect(
        (mockSettingsService as { updateSettings: Mock }).updateSettings,
      ).toHaveBeenCalledWith('openai', { toolFormat: 'auto' });
      expect(result?.type).toBe('message');
      if (result && result.type === 'message') {
        expect(result.content).toMatch(/override cleared|auto-detection/);
      }
    });

    it('falls back to legacy settings when SettingsService is not available', async () => {
      // Remove SettingsService
      mockContext.services.config = {
        getSettingsService: vi.fn().mockReturnValue(null),
      } as never;

      const result = await toolformatCommand.action!(mockContext, 'hermes');
      expect(mockContext.services.settings.setValue).toHaveBeenCalledWith(
        'User',
        'providerToolFormatOverrides',
        { openai: 'hermes' },
      );
      expect(result?.type).toBe('message');
      if (result && result.type === 'message') {
        expect(result.messageType).toBe('info');
        expect(result.content).toContain("override set to 'hermes'");
      }
    });

    it('handles SettingsService errors gracefully', async () => {
      // Make SettingsService throw an error
      (mockSettingsService as { updateSettings: Mock }).updateSettings = vi
        .fn()
        .mockRejectedValue(new Error('Settings update failed'));

      const result = await toolformatCommand.action!(mockContext, 'xml');
      expect(result?.type).toBe('message');
      if (result && result.type === 'message') {
        expect(result.messageType).toBe('error');
        expect(result.content).toContain('Failed to set tool format override');
        expect(result.content).toContain('Settings update failed');
      }
    });
  });
});
