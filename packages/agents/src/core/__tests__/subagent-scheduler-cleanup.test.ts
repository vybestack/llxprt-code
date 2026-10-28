import { createTestChildOrchestrator } from './child-launch-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ContextState } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { describe, expect, it, vi } from 'bun:test';
import { withDisposalJoinFixture } from '../../api/__tests__/helpers/async-child-disposal-join-fixture.js';
import { AggregateDisposeError } from '../../api/disposeErrors.js';
import { ChatSession } from '../chatSession.js';

const parentSignal = new AbortController().signal;

describe('subagent cleanup error retention', () => {
  it.each([false, true])(
    'retains scheduler cleanup errors with execution failure=%s',
    async (failExecution) => {
      await withDisposalJoinFixture(
        async ({
          config,
          settingsOwner,
          agent,
          parentTools,
          workspaceTrust,
          workspacePaths,
          instructionReads,
          readMcpInstructions,
        }) => {
          const subagentManager = agent.workspace.subagentDefinitions;
          const profileManager = agent.workspace.profileDefinitions;
          const primary = new Error('stream failed');
          const secondary = new Error('scheduler cleanup failed');
          const stream = vi
            .spyOn(ChatSession.prototype, 'sendMessageStream')
            .mockImplementation(async () =>
              (async function* () {
                if (failExecution) throw primary;
                yield* [];
              })(),
            );
          const orchestrator = createTestChildOrchestrator({
            credentialAuthority: new CredentialAuthority(),
            workspaceTrust,
            createChildSettings: () => settingsOwner.createChildStore(),
            readRunPolicy: () => settingsOwner.readSubagentRunPolicy(),
            toolRegistry: await parentTools(),
            workspacePaths,
            instructions: instructionReads,
            foregroundConfig: config,
            subagentManager,
            profileManager,
            messageBus: new MessageBus(),
            readMcpInstructions,
          });
          const run = await orchestrator.launch(
            {
              name: 'disposal-child',
              runConfig: { max_turns: 1, max_time_minutes: 1 },
            },
            parentSignal,
          );
          const context = new ContextState();
          context.set('task_goal', 'Complete.');
          try {
            let failure: unknown;
            try {
              await run.scope.runInteractive(context, {
                schedulerFactory: () => ({
                  schedule: async () => {},
                  dispose: async () => {
                    throw secondary;
                  },
                }),
              });
            } catch (error) {
              failure = error;
            }
            expect(failure).toBeInstanceOf(AggregateDisposeError);
            if (!(failure instanceof AggregateDisposeError)) throw failure;
            const flatten = (error: unknown): unknown[] =>
              error instanceof AggregateDisposeError
                ? error.errors.flatMap(flatten)
                : [error];
            expect(
              flatten(failure).map((error) =>
                error instanceof Error ? error.message : String(error),
              ),
            ).toStrictEqual(
              failExecution
                ? ['stream failed', 'scheduler cleanup failed']
                : ['scheduler cleanup failed'],
            );
          } finally {
            stream.mockRestore();
            await run.dispose();
          }
        },
      );
    },
    30000,
  );
});
