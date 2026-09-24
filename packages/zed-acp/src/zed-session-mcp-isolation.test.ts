/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import {
  MessageBusType,
  type ToolConfirmationRequest,
  type ToolConfirmationResponse,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { DiscoveredMCPTool } from '@vybestack/llxprt-code-mcp';
import type { CallableTool } from '@vybestack/llxprt-code-tools';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { buildCliStyleConfig } from '../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import { AgentImpl } from '../../agents/src/api/agentImpl.js';
import { RecordingConnection } from './__tests__/zed-test-helpers.js';
import { buildZedSessionAgent } from './zed-agent-setup.js';

describe('Zed session MCP registry isolation', () => {
  it('reconciles MCP tools discovered after Zed B starts and A closes into B alone', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const connection = new RecordingConnection();
    const logger = new DebugLogger('llxprt:zed-session-mcp-test');
    const sessions: Array<Awaited<ReturnType<typeof buildZedSessionAgent>>> =
      [];
    const subscriptions: Array<() => void> = [];
    try {
      for (let i = 0; i < 2; i++) {
        sessions.push(
          await buildZedSessionAgent(
            built.config,
            connection as unknown as acp.AgentSideConnection,
            logger,
            i === 1 ? { terminal: true } : undefined,
            'same-zed-label',
            undefined,
          ),
        );
      }
      const [a, b] = sessions;
      if (!(b.agent instanceof AgentImpl))
        throw new Error('Expected a real Agent');
      const baseRegistry = built.config.getToolRegistry();
      const originalShell = baseRegistry.getTool('run_shell_command');
      const aRegistry = a.agent.getToolRegistry();
      const bRegistry = b.agent.getToolRegistry();
      expect(aRegistry).not.toBe(baseRegistry);
      expect(bRegistry).not.toBe(baseRegistry);
      expect(bRegistry).not.toBe(aRegistry);
      expect(b.config.getToolRegistry()).toBe(bRegistry);
      await b.agent.agentClient.setTools();
      const calls: string[] = [];
      const callable: CallableTool = {
        tool: async () => ({ functionDeclarations: [] }),
        callTool: async () => {
          calls.push('zed-b');
          return [
            {
              functionResponse: {
                name: 'late',
                response: { content: [{ type: 'text', text: 'done' }] },
              },
            },
          ];
        },
      };
      const discovered = new DiscoveredMCPTool(
        callable,
        'late-zed-b',
        'late',
        'MCP tool',
        { type: 'object' },
      );
      expect(aRegistry.getTool(discovered.name)).toBeUndefined();
      expect(bRegistry.getTool(discovered.name)).toBeUndefined();
      let wrongBusApprovals = 0;
      const policyUpdates: string[] = [];
      subscriptions.push(
        a.agent
          .getMessageBus()
          .subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, () => {
            wrongBusApprovals++;
          }),
        a.agent.getMessageBus().subscribe(MessageBusType.UPDATE_POLICY, () => {
          policyUpdates.push('A');
        }),
        b.agent.getMessageBus().subscribe(MessageBusType.UPDATE_POLICY, () => {
          policyUpdates.push('B');
        }),
      );
      await a.agent.dispose();
      baseRegistry.registerTool(discovered);
      await built.config.refreshDiscoveredMcpMetadata();
      expect(built.config.getToolRegistry()).toBe(baseRegistry);
      expect(baseRegistry.getTool('run_shell_command')).toBe(originalShell);
      expect(baseRegistry.getTool(discovered.name)).toBe(discovered);
      expect(aRegistry.getTool(discovered.name)).toBeUndefined();
      expect(b.config.getToolRegistry()).toBe(bRegistry);
      expect(bRegistry.getTool(discovered.name)).toBeInstanceOf(
        DiscoveredMCPTool,
      );
      expect(bRegistry.getTool(discovered.name)).not.toBe(discovered);
      const chat = b.agent.agentClient.getChat() as unknown as {
        generationConfig?: {
          tools?: Array<{ functionDeclarations?: Array<{ name?: string }> }>;
        };
      };
      expect(
        chat.generationConfig?.tools?.[0]?.functionDeclarations?.map(
          (tool) => tool.name,
        ),
      ).toContain(discovered.name);
      const approval = new Promise<ToolConfirmationRequest>((resolve) => {
        const unsubscribe = b.agent
          .getMessageBus()
          .subscribe<ToolConfirmationRequest>(
            MessageBusType.TOOL_CONFIRMATION_REQUEST,
            (request) => {
              unsubscribe();
              resolve(request);
            },
          );
        subscriptions.push(unsubscribe);
      });
      const scheduler = await b.agent.scheduler.acquire(
        b.agent,
        'session',
        { getPreferredEditor: () => undefined, onEditorClose: () => {} },
        { interactiveMode: true },
        {
          messageBus: b.agent.getMessageBus(),
          toolRegistry: built.config.getToolRegistry(),
        },
      );
      const completed = scheduler.schedule(
        [
          {
            callId: 'late-mcp',
            name: discovered.name,
            args: {},
            isClientInitiated: false,
            prompt_id: 'zed-b',
          },
        ],
        new AbortController().signal,
      );
      const request = await Promise.race([
        approval,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('No MCP approval on Zed B bus')),
            3000,
          ),
        ),
      ]);
      b.agent.getMessageBus().publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: request.correlationId,
        outcome: ToolConfirmationOutcome.ProceedAlwaysAndSave,
      } satisfies ToolConfirmationResponse);
      await completed;
      expect(policyUpdates).toStrictEqual(['B']);
      expect(wrongBusApprovals).toBe(0);
      expect(calls).toStrictEqual(['zed-b']);
      b.agent.scheduler.release(b.agent, 'session', scheduler);
    } finally {
      for (const unsubscribe of subscriptions) unsubscribe();
      await Promise.allSettled(
        sessions.map((session) => session.agent.dispose()),
      );
      await built.cleanup();
    }
  }, 30000);
});
