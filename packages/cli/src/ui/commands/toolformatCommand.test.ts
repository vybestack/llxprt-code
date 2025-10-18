/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toolformatCommand } from './toolformatCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { CommandContext } from './types.js';

const mockRuntime = {
  getActiveToolFormatState: vi.fn(),
  setActiveToolFormatOverride: vi.fn(),
};

vi.mock('../../runtime/runtimeSettings.js', () => mockRuntime);

describe('toolformatCommand', () => {
  let mockContext: CommandContext;
  let mockSettingsService: {
    getSettings: ReturnType<typeof vi.fn>;
    updateSettings: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetAllMocks();

    mockRuntime.getActiveToolFormatState.mockResolvedValue({
      providerName: 'openai',
      currentFormat: 'openai',
      override: null,
      isAutoDetected: true,
    });

    mockRuntime.setActiveToolFormatOverride.mockResolvedValue({
      providerName: 'openai',
      currentFormat: 'openai',
      override: null,
      isAutoDetected: true,
    });

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

  it('shows the current format when invoked without arguments', async () => {
    const result = await toolformatCommand.action!(mockContext, '');
    expect(result?.type).toBe('message');
    if (result?.type === 'message') {
      expect(result.content).toContain('Current tool format: openai');
    }
    expect(mockRuntime.getActiveToolFormatState).toHaveBeenCalled();
  });

  it('clears overrides when auto is provided', async () => {
    const result = await toolformatCommand.action!(mockContext, 'auto');
    expect(mockRuntime.setActiveToolFormatOverride).toHaveBeenCalledWith(null);
    expect(mockSettingsService.updateSettings).toHaveBeenCalledWith('openai', {
      toolFormat: 'auto',
    });
    expect(result?.type).toBe('message');
  });

  it('rejects invalid formats', async () => {
    const result = await toolformatCommand.action!(mockContext, 'invalid');
    expect(result?.type).toBe('message');
    if (result?.type === 'message') {
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('Invalid tool format');
    }
  });

  it('persists valid overrides through SettingsService', async () => {
    mockRuntime.setActiveToolFormatOverride.mockResolvedValue({
      providerName: 'openai',
      currentFormat: 'hermes',
      override: 'hermes',
      isAutoDetected: false,
    });

    const result = await toolformatCommand.action!(mockContext, 'hermes');

    expect(mockRuntime.setActiveToolFormatOverride).toHaveBeenCalledWith(
      'hermes',
    );
    expect(mockSettingsService.updateSettings).toHaveBeenCalledWith('openai', {
      toolFormat: 'hermes',
    });
    expect(result?.type).toBe('message');
  });

  it('falls back to legacy settings when SettingsService unavailable', async () => {
    mockContext.services.config = {
      getSettingsService: vi.fn().mockReturnValue(null),
    } as never;

    const result = await toolformatCommand.action!(mockContext, 'hermes');

    expect(mockRuntime.setActiveToolFormatOverride).toHaveBeenCalledWith(
      'hermes',
    );
    expect(mockContext.services.settings.setValue).toHaveBeenCalledWith(
      'User',
      'providerToolFormatOverrides',
      { openai: 'hermes' },
    );
    expect(result?.type).toBe('message');
  });

  it('surfaces errors from SettingsService updates', async () => {
    mockSettingsService.updateSettings = vi
      .fn()
      .mockRejectedValue(new Error('failure'));

    const result = await toolformatCommand.action!(mockContext, 'xml');

    expect(result?.type).toBe('message');
    if (result?.type === 'message') {
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('failure');
    }
  });
});
