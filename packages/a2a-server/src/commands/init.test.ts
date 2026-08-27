/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { InitCommand } from './init.js';
import * as path from 'node:path';
import { CoderAgentEvent } from '../types.js';
import type {
  ExecutionEventBus,
  AgentExecutionEvent,
} from '@a2a-js/sdk/server';
import type { CommandContext } from './types.js';

describe('InitCommand', () => {
  const mockExistsSync = vi.fn();
  const mockWriteFileSync = vi.fn();
  let eventBus: ExecutionEventBus;
  let context: CommandContext;
  let mockExecute: ReturnType<typeof vi.fn>;
  const mockWorkspacePath = path.resolve('/tmp');

  function streamedEvents(): AgentExecutionEvent[] {
    const events: AgentExecutionEvent[] = [];
    const original = eventBus.publish.bind(eventBus);
    eventBus.publish = (event: AgentExecutionEvent) => {
      events.push(event);
      original(event);
    };
    return events;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['CODER_AGENT_WORKSPACE_PATH'] = mockWorkspacePath;
    eventBus = {
      publish: vi.fn(),
    } as unknown as ExecutionEventBus;
    const mockExecutorInstance = {
      execute: vi.fn(),
      cancelTask: vi.fn(),
    };
    context = {
      extensions: [],
      model: 'test-model',
      checkpointing: {
        enabled: false,
        getProjectTempCheckpointsDir: () => '/tmp/test-checkpoints',
      },
      agentExecutor: mockExecutorInstance,
      eventBus,
    } as CommandContext;
    mockExecute = vi.fn();
    mockExecutorInstance.execute.mockImplementation(mockExecute);
  });

  function makeCommand(): InitCommand {
    return new InitCommand({
      existsSync: mockExistsSync,
      writeFileSync: mockWriteFileSync,
      createId: () => 'test-id',
      logInfo: vi.fn(),
    });
  }

  it('has requiresWorkspace set to true', () => {
    const command = makeCommand();
    expect(command.requiresWorkspace).toBe(true);
  });

  it('has streaming set to true', () => {
    const command = makeCommand();
    expect(command.streaming).toBe(true);
  });

  describe('execute', () => {
    it('handles info when LLXPRT.md already exists', async () => {
      mockExistsSync.mockReturnValue(true);
      const events = streamedEvents();
      const command = makeCommand();

      await command.execute(context, []);

      const event = events[0];
      expect(event.kind).toBe('status-update');
      if (event.kind !== 'status-update') {
        throw new Error('expected a status-update event');
      }
      expect(event.status.state).toBe('completed');
      const message = event.status.message!;
      const firstPart = message.parts[0] as { text: string };
      expect(firstPart.text).toContain('LLXPRT.md');
      expect(firstPart.text).toContain('already exists');
    });

    describe('when LLXPRT.md does not exist', () => {
      beforeEach(() => {
        mockExistsSync.mockReturnValue(false);
      });

      it('writes the file and executes the agent', async () => {
        await makeCommand().execute(context, []);

        expect(mockWriteFileSync).toHaveBeenCalledWith(
          path.join(mockWorkspacePath, 'LLXPRT.md'),
          '',
          'utf8',
        );
        expect(mockExecute).toHaveBeenCalled();
      });

      it('passes autoExecute: true to the agent executor', async () => {
        await makeCommand().execute(context, []);

        expect(mockExecute).toHaveBeenCalledWith(
          expect.objectContaining({
            userMessage: expect.objectContaining({
              parts: expect.arrayContaining([
                expect.objectContaining({
                  text: expect.stringContaining(
                    'analyze the current directory',
                  ),
                }),
              ]),
              metadata: {
                coderAgent: {
                  kind: CoderAgentEvent.StateAgentSettingsEvent,
                  workspacePath: mockWorkspacePath,
                  autoExecute: true,
                },
              },
            }),
          }),
          eventBus,
        );
      });
    });
  });
});
