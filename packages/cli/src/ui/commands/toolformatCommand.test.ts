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
    expect(result).toBeDefined();
    type MessageAction = Extract<typeof result, { type: 'message' }>;
    const msgResult = result as MessageAction;
    expect(msgResult.content).toContain('Current tool format: openai');
    expect(mockRuntime.getActiveToolFormatState).toHaveBeenCalled();
  });

  it('clears overrides when auto is provided', async () => {
    const result = await toolformatCommand.action!(mockContext, 'auto');
    expect(mockRuntime.setActiveToolFormatOverride).toHaveBeenCalledWith(null);
    expect(result?.type).toBe('message');
    expect(result).toBeDefined();
    type MessageAction2 = Extract<typeof result, { type: 'message' }>;
    const msgResult = result as MessageAction2;
    expect(msgResult.messageType).toBe('info');
    expect(msgResult.content).toContain('override cleared');
  });

  it('rejects invalid formats', async () => {
    const result = await toolformatCommand.action!(mockContext, 'invalid');
    expect(result?.type).toBe('message');
    expect(result).toBeDefined();
    type MessageAction3 = Extract<typeof result, { type: 'message' }>;
    const msgResult = result as MessageAction3;
    expect(msgResult.messageType).toBe('error');
    expect(msgResult.content).toContain('Invalid tool format');
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
    expect(result).toBeDefined();
    type MessageAction4 = Extract<typeof result, { type: 'message' }>;
    const msgResult = result as MessageAction4;
    expect(msgResult.messageType).toBe('info');
    expect(msgResult.content).toContain("override set to 'hermes'");
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
    expect(result).toBeDefined();
    type MessageAction5 = Extract<typeof result, { type: 'message' }>;
    const msgResult = result as MessageAction5;
    expect(msgResult.messageType).toBe('info');
  });

  it('surfaces runtime errors when override update fails', async () => {
    mockRuntime.setActiveToolFormatOverride.mockRejectedValue(
      new Error('failure'),
    );

    const result = await toolformatCommand.action!(mockContext, 'xml');

    expect(result?.type).toBe('message');
    expect(result).toBeDefined();
    type MessageAction6 = Extract<typeof result, { type: 'message' }>;
    const msgResult = result as MessageAction6;
    expect(msgResult.messageType).toBe('error');
    expect(msgResult.content).toContain('failure');
  });
});
