/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';
import { clearCommand } from './clearCommand';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { getCliRuntimeServices } from '../../runtime/runtimeSettings.js';
// Mock the telemetry service
vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual('@vybestack/llxprt-code-core');
  return {
    ...actual,
    uiTelemetryService: {
      setLastPromptTokenCount: vi.fn(),
    },
  };
});

vi.mock('../../runtime/runtimeSettings.js', () => ({
  getCliRuntimeServices: vi.fn(),
}));

import {
  Config,
  GeminiClient,
  uiTelemetryService,
} from '@vybestack/llxprt-code-core';

describe('clearCommand', () => {
  let mockContext: CommandContext;
  let mockResetChat: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockResetChat = vi.fn().mockResolvedValue(undefined);
    const mockGetChatRecordingService = vi.fn();
    vi.clearAllMocks();
    vi.mocked(getCliRuntimeServices).mockReset();

    mockContext = createMockCommandContext({
      services: {
        config: {
          getGeminiClient: () =>
            ({
              resetChat: mockResetChat,
              getChat: () => ({
                getChatRecordingService: mockGetChatRecordingService,
              }),
            }) as unknown as GeminiClient,
          setSessionId: vi.fn(),
        },
      },
    });
  });

  it('should set debug message, reset chat, reset telemetry, update history token count, and clear UI when config is available', async () => {
    if (!clearCommand.action) {
      throw new Error('clearCommand must have an action.');
    }

    await clearCommand.action(mockContext, '');

    expect(mockContext.ui.setDebugMessage).toHaveBeenCalledWith(
      'Clearing terminal and resetting chat.',
    );
    expect(mockContext.ui.setDebugMessage).toHaveBeenCalledTimes(1);

    expect(mockResetChat).toHaveBeenCalledTimes(1);
    expect(uiTelemetryService.setLastPromptTokenCount).toHaveBeenCalledWith(0);
    expect(uiTelemetryService.setLastPromptTokenCount).toHaveBeenCalledTimes(1);
    expect(mockContext.ui.updateHistoryTokenCount).toHaveBeenCalledWith(0);
    expect(mockContext.ui.updateHistoryTokenCount).toHaveBeenCalledTimes(1);
    expect(mockContext.ui.clear).toHaveBeenCalledTimes(1);

    // Check the order of operations.
    const setDebugMessageOrder = (mockContext.ui.setDebugMessage as Mock).mock
      .invocationCallOrder[0];
    const resetChatOrder = mockResetChat.mock.invocationCallOrder[0];
    const resetTelemetryOrder = (
      uiTelemetryService.setLastPromptTokenCount as Mock
    ).mock.invocationCallOrder[0];
    const updateHistoryTokenCountOrder = (
      mockContext.ui.updateHistoryTokenCount as Mock
    ).mock.invocationCallOrder[0];
    const clearOrder = (mockContext.ui.clear as Mock).mock
      .invocationCallOrder[0];

    expect(setDebugMessageOrder).toBeLessThan(resetChatOrder);
    expect(resetChatOrder).toBeLessThan(resetTelemetryOrder);
    expect(resetTelemetryOrder).toBeLessThan(updateHistoryTokenCountOrder);
    expect(updateHistoryTokenCountOrder).toBeLessThan(clearOrder);
  });

  it('should fallback to runtime services when command context lacks config', async () => {
    if (!clearCommand.action) {
      throw new Error('clearCommand must have an action.');
    }

    const runtimeResetChat = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getCliRuntimeServices).mockReturnValue({
      config: {
        getGeminiClient: () =>
          ({
            resetChat: runtimeResetChat,
          }) as unknown as GeminiClient,
      } as Config,
      settingsService: {} as unknown,
      providerManager: {} as unknown,
    });

    const nullConfigContext = createMockCommandContext({
      services: {
        config: null,
      },
    });

    await clearCommand.action(nullConfigContext, '');

    expect(nullConfigContext.ui.setDebugMessage).toHaveBeenCalledWith(
      'Clearing terminal and resetting chat.',
    );
    expect(runtimeResetChat).toHaveBeenCalledTimes(1);
    expect(uiTelemetryService.setLastPromptTokenCount).toHaveBeenCalledTimes(1);
    expect(nullConfigContext.ui.updateHistoryTokenCount).toHaveBeenCalledWith(
      0,
    );
    expect(nullConfigContext.ui.clear).toHaveBeenCalledTimes(1);
  });

  it('should skip reset when no config is available anywhere', async () => {
    if (!clearCommand.action) {
      throw new Error('clearCommand must have an action.');
    }

    vi.mocked(getCliRuntimeServices).mockImplementation(() => {
      throw new Error('runtime unavailable');
    });

    const nullConfigContext = createMockCommandContext({
      services: {
        config: null,
      },
    });

    await clearCommand.action(nullConfigContext, '');

    expect(nullConfigContext.ui.setDebugMessage).toHaveBeenCalledWith(
      'Clearing terminal.',
    );
    expect(mockResetChat).not.toHaveBeenCalled();
    expect(uiTelemetryService.setLastPromptTokenCount).toHaveBeenCalledWith(0);
    expect(uiTelemetryService.setLastPromptTokenCount).toHaveBeenCalledTimes(1);
    expect(nullConfigContext.ui.clear).toHaveBeenCalledTimes(1);
  });
});
