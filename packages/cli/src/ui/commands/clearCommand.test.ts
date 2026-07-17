/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Mock } from 'vitest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { clearCommand } from './clearCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
// Mock the telemetry service
vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual('@vybestack/llxprt-code-core');
  return {
    ...actual,
    triggerSessionEndHook: vi.fn().mockResolvedValue(undefined),
    triggerSessionStartHook: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@vybestack/llxprt-code-telemetry', async () => {
  const actual = await vi.importActual('@vybestack/llxprt-code-telemetry');
  return {
    ...actual,
    uiTelemetryService: {
      reset: vi.fn(),
    },
  };
});

import type { Config } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { assertDefined } from '../../test-utils/assertions.js';
import {
  triggerSessionEndHook,
  triggerSessionStartHook,
  SessionEndReason,
  SessionStartSource,
} from '@vybestack/llxprt-code-core';
import { uiTelemetryService } from '@vybestack/llxprt-code-telemetry';

const clearAction = clearCommand.action;
assertDefined(clearAction);

describe('clearCommand', () => {
  let mockContext: CommandContext;
  let mockResetChat: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockResetChat = vi.fn().mockResolvedValue(undefined);
    vi.clearAllMocks();

    mockContext = createMockCommandContext({
      services: {
        config: {
          setSessionId: vi.fn(),
        } as unknown as Config,
        agent: {
          resetChat: mockResetChat,
        } as unknown as Agent,
      },
    });
  });

  it('should set debug message, reset chat via agent, reset telemetry, update history token count, and clear UI when agent is available', async () => {
    await clearAction(mockContext, '');

    expect(mockContext.ui.setDebugMessage).toHaveBeenCalledWith(
      'Clearing terminal and resetting chat.',
    );
    expect(mockContext.ui.setDebugMessage).toHaveBeenCalledTimes(1);

    expect(mockResetChat).toHaveBeenCalledTimes(1);
    expect(uiTelemetryService.reset).toHaveBeenCalledTimes(1);
    expect(mockContext.ui.updateHistoryTokenCount).toHaveBeenCalledWith(0);
    expect(mockContext.ui.updateHistoryTokenCount).toHaveBeenCalledTimes(1);
    expect(mockContext.ui.clear).toHaveBeenCalledTimes(1);

    // Check the order of operations.
    const setDebugMessageOrder = (mockContext.ui.setDebugMessage as Mock).mock
      .invocationCallOrder[0];
    const resetChatOrder = mockResetChat.mock.invocationCallOrder[0];
    const resetTelemetryOrder = (uiTelemetryService.reset as Mock).mock
      .invocationCallOrder[0];
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

  it('should skip reset when no agent is available (terminal-only clear)', async () => {
    const noAgentContext = createMockCommandContext({
      services: {
        config: null,
        agent: null,
      },
    });

    await clearAction(noAgentContext, '');

    expect(noAgentContext.ui.setDebugMessage).toHaveBeenCalledWith(
      'Clearing terminal.',
    );
    expect(mockResetChat).not.toHaveBeenCalled();
    expect(uiTelemetryService.reset).toHaveBeenCalledTimes(1);
    expect(noAgentContext.ui.clear).toHaveBeenCalledTimes(1);
  });

  /**
   * Group A: Session hook tests for clearCommand
   * @plan PLAN-20250219-GMERGE021.R4
   * @requirement REQ-R4-1 (SessionEnd before clear, SessionStart after clear)
   *
   * These tests verify that clearCommand triggers session lifecycle hooks
   * in the correct order.
   */

  it('should trigger SessionEnd hook before resetChat when clearing', async () => {
    vi.clearAllMocks();

    await clearAction(mockContext, '');

    // Assert: triggerSessionEndHook called with SessionEndReason.Clear
    expect(triggerSessionEndHook).toHaveBeenCalledWith(
      mockContext.services.config,
      SessionEndReason.Clear,
    );

    // Assert: triggerSessionStartHook called with SessionStartSource.Clear
    expect(triggerSessionStartHook).toHaveBeenCalledWith(
      mockContext.services.config,
      SessionStartSource.Clear,
    );

    // Assert: triggerSessionEndHook called BEFORE resetChat
    const endHookOrder = (triggerSessionEndHook as Mock).mock
      .invocationCallOrder[0];
    const resetChatOrder = mockResetChat.mock.invocationCallOrder[0];
    expect(endHookOrder).toBeLessThan(resetChatOrder);

    // Assert: triggerSessionStartHook called AFTER resetChat
    const startHookOrder = (triggerSessionStartHook as Mock).mock
      .invocationCallOrder[0];
    expect(resetChatOrder).toBeLessThan(startHookOrder);
  });

  it('should complete clear even if SessionEnd hook throws', async () => {
    vi.clearAllMocks();

    // Mock triggerSessionEndHook to throw
    vi.mocked(triggerSessionEndHook).mockRejectedValueOnce(
      new Error('Hook failed'),
    );

    // Execute clear and ensure it doesn't throw
    await clearAction(mockContext, '');

    // Assert: clear still completes, resetChat still called
    expect(mockResetChat).toHaveBeenCalledTimes(1);
    expect(mockContext.ui.clear).toHaveBeenCalledTimes(1);
  });

  it('should complete clear even if SessionStart hook throws', async () => {
    vi.clearAllMocks();

    // Mock triggerSessionStartHook to throw
    vi.mocked(triggerSessionStartHook).mockRejectedValueOnce(
      new Error('Hook failed'),
    );

    // Execute clear and ensure it doesn't throw
    await clearAction(mockContext, '');

    // Assert: clear still completes
    expect(mockResetChat).toHaveBeenCalledTimes(1);
    expect(mockContext.ui.clear).toHaveBeenCalledTimes(1);
  });

  it('should not trigger hooks when agent is absent (terminal-only clear)', async () => {
    const noAgentContext = createMockCommandContext({
      services: {
        config: null,
        agent: null,
      },
    });

    await clearAction(noAgentContext, '');

    expect(triggerSessionEndHook).not.toHaveBeenCalled();
    expect(triggerSessionStartHook).not.toHaveBeenCalled();
  });

  it('should proceed with resetChat but not call hooks when agent is present but config is null', async () => {
    vi.clearAllMocks();

    const nullConfigContext = createMockCommandContext({
      services: {
        config: null,
        agent: {
          resetChat: mockResetChat,
        } as unknown as Agent,
      },
    });

    await clearAction(nullConfigContext, '');

    // agent.resetChat() still proceeds (the agent-branch path runs)
    expect(mockResetChat).toHaveBeenCalledTimes(1);
    expect(nullConfigContext.ui.clear).toHaveBeenCalledTimes(1);
    // Hooks are NOT called — triggerSessionEndHookSafe/triggerSessionStartHookSafe
    // early-return when config is null.
    expect(triggerSessionEndHook).not.toHaveBeenCalled();
    expect(triggerSessionStartHook).not.toHaveBeenCalled();
  });
});
