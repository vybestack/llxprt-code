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

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => mockRuntime,
}));

describe('toolformatCommand', () => {
  let mockContext: CommandContext;
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

    mockContext = createMockCommandContext();
    mockContext.services.settings.merged.providerToolFormatOverrides = {
      openai: 'xml',
    };
    mockContext.services.settings.setValue = vi.fn();
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
    expect(result?.type).toBe('message');
    if (result?.type === 'message') {
      expect(result.messageType).toBe('info');
      expect(result.content).toContain('override cleared');
    }
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
    expect(result?.type).toBe('message');
    if (result?.type === 'message') {
      expect(result.messageType).toBe('info');
      expect(result.content).toContain("override set to 'hermes'");
    }
  });

  it('works when settings service is unavailable', async () => {
    mockContext.services.config = {
      getSettingsService: vi.fn().mockReturnValue(null),
    } as never;

    const result = await toolformatCommand.action!(mockContext, 'hermes');

    expect(mockRuntime.setActiveToolFormatOverride).toHaveBeenCalledWith(
      'hermes',
    );
    expect(result?.type).toBe('message');
    if (result?.type === 'message') {
      expect(result.messageType).toBe('info');
    }
  });

  it('surfaces runtime errors when override update fails', async () => {
    mockRuntime.setActiveToolFormatOverride.mockRejectedValue(
      new Error('failure'),
    );

    const result = await toolformatCommand.action!(mockContext, 'xml');

    expect(result?.type).toBe('message');
    if (result?.type === 'message') {
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('failure');
    }
  });
});
