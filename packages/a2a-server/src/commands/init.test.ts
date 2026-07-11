/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { InitCommand } from './init.js';
import * as path from 'node:path';
import { CoderAgentEvent } from '../types.js';
import type { ExecutionEventBus } from '@a2a-js/sdk/server';
import type { TaskStatusUpdateEvent } from '@a2a-js/sdk';
import { createMockConfig } from '../utils/testing_utils.js';
import type { CommandContext } from './types.js';
import type { Config } from '@vybestack/llxprt-code-core';

describe('InitCommand', () => {
  const mockExistsSync = vi.fn();
  const mockWriteFileSync = vi.fn();
  const mockLogInfo = vi.fn();
  let eventBus: ExecutionEventBus;
  let command: InitCommand;
  let context: CommandContext;
  let publishSpy: ReturnType<typeof vi.spyOn>;
  let mockExecute: ReturnType<typeof vi.fn>;
  const mockWorkspacePath = path.resolve('/tmp');

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['CODER_AGENT_WORKSPACE_PATH'] = mockWorkspacePath;
    eventBus = {
      publish: vi.fn(),
    } as unknown as ExecutionEventBus;
    command = new InitCommand({
      existsSync: mockExistsSync,
      writeFileSync: mockWriteFileSync,
      createId: () => 'test-id',
      logInfo: mockLogInfo,
    });
    const mockConfig = createMockConfig({
      getModel: () => 'gemini-pro',
    });
    const mockExecutorInstance = {
      execute: vi.fn(),
      cancelTask: vi.fn(),
    };
    context = {
      config: mockConfig as unknown as Config,
      agentExecutor: mockExecutorInstance,
      eventBus,
    } as CommandContext;
    publishSpy = vi.spyOn(eventBus, 'publish');
    mockExecute = vi.fn();
    mockExecutorInstance.execute.mockImplementation(mockExecute);
  });

  it('has requiresWorkspace set to true', () => {
    expect(command.requiresWorkspace).toBe(true);
  });

  it('has streaming set to true', () => {
    expect(command.streaming).toBe(true);
  });

  describe('execute', () => {
    it('handles info when LLXPRT.md already exists', async () => {
      mockExistsSync.mockReturnValue(true);

      await command.execute(context, []);

      // Check that publish was called with the right event
      expect(publishSpy).toHaveBeenCalled();
      const publishCall = publishSpy.mock.calls[0][0];
      const event = publishCall as TaskStatusUpdateEvent;
      expect(event.kind).toBe('status-update');
      expect(event.status.state).toBe('completed');
      const message = event.status.message!;
      const firstPart = message.parts[0] as { text: string };
      expect(firstPart.text).toContain('LLXPRT.md');
      expect(firstPart.text).toContain('already exists');

      // Verify logger was also called
      expect(mockLogInfo).toHaveBeenCalledWith(
        '[EventBus event]: ',
        expect.objectContaining({
          kind: 'status-update',
        }),
      );
    });

    describe('when LLXPRT.md does not exist', () => {
      beforeEach(() => {
        mockExistsSync.mockReturnValue(false);
      });

      it('writes the file and executes the agent', async () => {
        await command.execute(context, []);

        expect(mockWriteFileSync).toHaveBeenCalledWith(
          path.join(mockWorkspacePath, 'LLXPRT.md'),
          '',
          'utf8',
        );
        expect(mockExecute).toHaveBeenCalled();
      });

      it('passes autoExecute: true to the agent executor', async () => {
        await command.execute(context, []);

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
