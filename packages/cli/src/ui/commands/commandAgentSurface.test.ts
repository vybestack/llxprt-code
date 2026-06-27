/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  Agent,
  AgentPolicyControl,
  AgentTasksControl,
  AgentHookControl,
  AgentAuthControl,
} from '@vybestack/llxprt-code-agents';
import { compressCommand } from './compressCommand.js';
import { policiesCommand } from './policiesCommand.js';
import { taskCommand } from './tasksCommand.js';
import { baseurlCommand } from './baseurlCommand.js';
import { logoutCommand } from './logoutCommand.js';
import { hooksCommand } from './hooksCommand.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core';
import { MessageType } from '../types.js';
import type { CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

function buildContextWithAgent(agent: Partial<Agent>): CommandContext {
  return createMockCommandContext({
    services: { agent: agent as Agent },
  });
}

describe('compressCommand — agent surface', () => {
  it('calls agent.compress() when agent is available', async () => {
    const compressMock = vi.fn().mockResolvedValue({
      status: 'compressed' as const,
      originalTokenCount: 1000,
      newTokenCount: 500,
    });
    const context = buildContextWithAgent({
      compress: compressMock,
    });

    await compressCommand.action!(context, '');

    expect(compressMock).toHaveBeenCalledTimes(1);
    expect(compressMock).toHaveBeenCalledWith(
      expect.objectContaining({ promptId: expect.any(String) }),
    );

    const addItem = context.ui.addItem as ReturnType<typeof vi.fn>;
    expect(addItem).toHaveBeenCalled();
    const lastCall = addItem.mock.calls[addItem.mock.calls.length - 1];
    expect(lastCall[0].type).toBe(MessageType.COMPRESSION);
    expect(lastCall[0].compression.isPending).toBe(false);
    expect(lastCall[0].compression.originalTokenCount).toBe(1000);
    expect(lastCall[0].compression.newTokenCount).toBe(500);
  });

  it('does not call config.getAgentClient when agent is available', async () => {
    const getAgentClient = vi.fn();
    const compressMock = vi.fn().mockResolvedValue({
      status: 'skipped' as const,
    });
    const context = buildContextWithAgent({
      compress: compressMock,
    });
    // Provide a real config mock so the fallback path is reachable but NOT used
    (
      context.services as { config: { getAgentClient: typeof getAgentClient } }
    ).config = {
      getAgentClient,
    } as unknown as CommandContext['services']['config'];

    await compressCommand.action!(context, '');

    expect(compressMock).toHaveBeenCalledTimes(1);
    expect(getAgentClient).not.toHaveBeenCalled();
  });
});

describe('policiesCommand — agent surface', () => {
  it('reads rules from agent.policy when agent is available', async () => {
    const getRules = vi.fn().mockReturnValue([
      {
        priority: 2.0,
        toolName: 'shell',
        decision: PolicyDecision.ALLOW,
        source: 'user',
      },
    ]);
    const getDefaultDecision = vi.fn().mockReturnValue(PolicyDecision.ASK_USER);
    const isNonInteractive = vi.fn().mockReturnValue(false);

    const context = buildContextWithAgent({
      policy: {
        getRules,
        getDefaultDecision,
        isNonInteractive,
      } as unknown as AgentPolicyControl,
    });

    const result = (await policiesCommand.action!(context, '')) as {
      messageType: string;
      content: string;
    };

    expect(getRules).toHaveBeenCalledTimes(1);
    expect(getDefaultDecision).toHaveBeenCalledTimes(1);
    expect(isNonInteractive).toHaveBeenCalledTimes(1);
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('shell');
    expect(result.content).toContain('ALLOW');
    expect(result.content).toContain('ASK_USER');
    expect(result.content).toContain('false');
  });

  it('shows no-rules message when agent returns empty list', async () => {
    const context = buildContextWithAgent({
      policy: {
        getRules: () => [],
        getDefaultDecision: () => PolicyDecision.DENY,
        isNonInteractive: () => true,
      } as unknown as AgentPolicyControl,
    });

    const result = (await policiesCommand.action!(context, '')) as {
      messageType: string;
      content: string;
    };

    expect(result.messageType).toBe('info');
    expect(result.content).toContain('No policy rules configured.');
  });
});

describe('tasksCommand — agent surface', () => {
  it('lists tasks from agent.tasks when agent is available', async () => {
    const listMock = vi.fn().mockReturnValue([
      {
        id: 'coder-abc123',
        status: 'running',
        launchedAt: Date.now() - 5000,
        goalPrompt: 'Do something',
        subagentName: 'coder',
      },
    ]);

    const context = buildContextWithAgent({
      tasks: { list: listMock } as unknown as AgentTasksControl,
    });

    const listSub = taskCommand.subCommands?.find((c) => c.name === 'list');
    expect(listSub).toBeDefined();
    await listSub!.action!(context, '');

    expect(listMock).toHaveBeenCalledTimes(1);
    const addItem = context.ui.addItem as ReturnType<typeof vi.fn>;
    const lastCall = addItem.mock.calls[addItem.mock.calls.length - 1];
    expect(lastCall[0].text).toContain('coder-abc123');
    expect(lastCall[0].text).toContain('Do something');
  });

  it('cancels a task via agent.tasks.cancel when agent is available', async () => {
    const getMock = vi.fn().mockReturnValue({
      id: 'coder-abc123',
      status: 'running',
    });
    const cancelMock = vi.fn().mockReturnValue(true);

    const context = buildContextWithAgent({
      tasks: {
        list: () => [],
        get: getMock,
        cancel: cancelMock,
        listRunning: () => [],
      } as unknown as AgentTasksControl,
    });

    const endSub = taskCommand.subCommands?.find((c) => c.name === 'end');
    expect(endSub).toBeDefined();
    await endSub!.action!(context, 'coder-abc123');

    expect(getMock).toHaveBeenCalledWith('coder-abc123');
    expect(cancelMock).toHaveBeenCalledWith('coder-abc123');
    const addItem = context.ui.addItem as ReturnType<typeof vi.fn>;
    const lastCall = addItem.mock.calls[addItem.mock.calls.length - 1];
    expect(lastCall[0].text).toContain('Cancelled');
  });
});

describe('baseurlCommand — agent surface', () => {
  it('calls agent.auth.setBaseUrl when agent is available', async () => {
    const setBaseUrl = vi.fn().mockResolvedValue(undefined);
    const context = buildContextWithAgent({
      getProvider: () => 'qwen',
      auth: { setBaseUrl } as unknown as AgentAuthControl,
    });

    const result = (await baseurlCommand.action!(
      context,
      'https://api.example.com',
    )) as {
      messageType: string;
      content: string;
    };

    expect(setBaseUrl).toHaveBeenCalledWith('https://api.example.com');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('https://api.example.com');
  });

  it('clears base URL when empty arg is given', async () => {
    const setBaseUrl = vi.fn().mockResolvedValue(undefined);
    const context = buildContextWithAgent({
      getProvider: () => 'qwen',
      auth: { setBaseUrl } as unknown as AgentAuthControl,
    });

    const result = (await baseurlCommand.action!(context, '')) as {
      messageType: string;
      content: string;
    };

    expect(setBaseUrl).toHaveBeenCalledWith(null);
    expect(result.content).toContain('cleared');
  });
});

describe('logoutCommand — agent surface', () => {
  it('calls agent.auth.logout when agent is available', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const status = vi.fn().mockReturnValue('authenticated');
    const context = buildContextWithAgent({
      auth: { logout, status } as unknown as AgentAuthControl,
    });

    const result = (await logoutCommand.action!(context, 'qwen')) as {
      messageType: string;
      content: string;
    };

    expect(logout).toHaveBeenCalledWith('qwen');
    expect(status).toHaveBeenCalledWith('qwen');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('Successfully logged out');
  });

  it('reports cleanup when not authenticated', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const status = vi.fn().mockReturnValue('unauthenticated');
    const context = buildContextWithAgent({
      auth: { logout, status } as unknown as AgentAuthControl,
    });

    const result = (await logoutCommand.action!(context, 'gemini')) as {
      messageType: string;
      content: string;
    };

    expect(result.content).toContain('Cleaned up');
  });
});

describe('hooksCommand — agent surface', () => {
  it('enables a hook via agent.hooks.enable', async () => {
    const enable = vi.fn();
    const listHooks = vi
      .fn()
      .mockReturnValue([
        { name: 'preToolCall', eventName: 'pre_tool_call', enabled: false },
      ]);
    const context = buildContextWithAgent({
      hooks: { listHooks, enable } as unknown as AgentHookControl,
    });

    const enableSub = hooksCommand.subCommands?.find(
      (c) => c.name === 'enable',
    );
    expect(enableSub).toBeDefined();
    await enableSub!.action!(context, 'preToolCall');

    expect(enable).toHaveBeenCalledWith('preToolCall');
    const addItem = context.ui.addItem as ReturnType<typeof vi.fn>;
    const lastCall = addItem.mock.calls[addItem.mock.calls.length - 1];
    expect(lastCall[0].text).toContain('Enabled hook');
  });

  it('disables a hook via agent.hooks.disable', async () => {
    const disable = vi.fn();
    const listHooks = vi
      .fn()
      .mockReturnValue([
        { name: 'postToolCall', eventName: 'post_tool_call', enabled: true },
      ]);
    const context = buildContextWithAgent({
      hooks: { listHooks, disable } as unknown as AgentHookControl,
    });

    const disableSub = hooksCommand.subCommands?.find(
      (c) => c.name === 'disable',
    );
    expect(disableSub).toBeDefined();
    await disableSub!.action!(context, 'postToolCall');

    expect(disable).toHaveBeenCalledWith('postToolCall');
    const addItem = context.ui.addItem as ReturnType<typeof vi.fn>;
    const lastCall = addItem.mock.calls[addItem.mock.calls.length - 1];
    expect(lastCall[0].text).toContain('Disabled hook');
  });

  it('disables all hooks via agent.hooks.setDisabledHooks', async () => {
    const setDisabledHooks = vi.fn();
    const listHooks = vi.fn().mockReturnValue([
      { name: 'hook1', eventName: 'pre_tool_call', enabled: true },
      { name: 'hook2', eventName: 'post_tool_call', enabled: true },
    ]);
    const context = buildContextWithAgent({
      hooks: { listHooks, setDisabledHooks } as unknown as AgentHookControl,
    });

    const disableAllSub = hooksCommand.subCommands?.find(
      (c) => c.name === 'disable-all',
    );
    expect(disableAllSub).toBeDefined();
    await disableAllSub!.action!(context, '');

    expect(setDisabledHooks).toHaveBeenCalledWith(['hook1', 'hook2']);
    const addItem = context.ui.addItem as ReturnType<typeof vi.fn>;
    const lastCall = addItem.mock.calls[addItem.mock.calls.length - 1];
    expect(lastCall[0].text).toContain('Disabled all 2');
  });

  it('enables all hooks by clearing disabled set via agent.hooks', async () => {
    const setDisabledHooks = vi.fn();
    const listHooks = vi.fn().mockReturnValue([
      { name: 'hook1', eventName: 'pre_tool_call', enabled: false },
      { name: 'hook2', eventName: 'post_tool_call', enabled: true },
    ]);
    const context = buildContextWithAgent({
      hooks: { listHooks, setDisabledHooks } as unknown as AgentHookControl,
    });

    const enableAllSub = hooksCommand.subCommands?.find(
      (c) => c.name === 'enable-all',
    );
    expect(enableAllSub).toBeDefined();
    await enableAllSub!.action!(context, '');

    expect(setDisabledHooks).toHaveBeenCalledWith([]);
    const addItem = context.ui.addItem as ReturnType<typeof vi.fn>;
    const lastCall = addItem.mock.calls[addItem.mock.calls.length - 1];
    expect(lastCall[0].text).toContain('Enabled all 2');
  });
});

describe('error paths — agent surface rejections', () => {
  it('reports error when agent.compress() rejects', async () => {
    const compressMock = vi
      .fn()
      .mockRejectedValue(new Error('Network timeout'));
    const context = buildContextWithAgent({
      compress: compressMock,
    });

    await compressCommand.action!(context, '');

    const addItem = context.ui.addItem as ReturnType<typeof vi.fn>;
    const errorCall = addItem.mock.calls.find(
      (call) => call[0]?.type === MessageType.ERROR,
    );
    expect(errorCall).toBeDefined();
    expect(errorCall![0].text).toContain('Failed to compress chat history');
    expect(errorCall![0].text).toContain('Network timeout');
  });

  it('reports error when agent.auth.setBaseUrl() rejects', async () => {
    const setBaseUrl = vi
      .fn()
      .mockRejectedValue(new Error('Permission denied'));
    const context = buildContextWithAgent({
      getProvider: () => 'qwen',
      auth: { setBaseUrl } as unknown as AgentAuthControl,
    });

    const result = (await baseurlCommand.action!(
      context,
      'https://bad.example.com',
    )) as {
      messageType: string;
      content: string;
    };

    expect(result.messageType).toBe('error');
    expect(result.content).toContain('Failed to update base URL');
    expect(result.content).toContain('Permission denied');
  });

  it('reports error when agent.auth.logout() rejects', async () => {
    const logout = vi.fn().mockRejectedValue(new Error('Token revoked'));
    const status = vi.fn().mockReturnValue('authenticated');
    const context = buildContextWithAgent({
      auth: { logout, status } as unknown as AgentAuthControl,
    });

    const result = (await logoutCommand.action!(context, 'qwen')) as {
      messageType: string;
      content: string;
    };

    expect(result.messageType).toBe('error');
    expect(result.content).toContain('Failed to logout');
    expect(result.content).toContain('Token revoked');
  });
});
