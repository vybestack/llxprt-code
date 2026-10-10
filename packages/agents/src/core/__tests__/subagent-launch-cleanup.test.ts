/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import * as runtime from '@vybestack/llxprt-code-providers/runtime.js';
import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { SubagentOrchestrator } from '../subagentOrchestrator.js';
import { AggregateDisposeError } from '../../api/disposeErrors.js';
import { withDisposalJoinFixture } from '../../api/__tests__/helpers/async-child-disposal-join-fixture.js';

describe('subagent cleanup error retention', () => {
  it.each(['activation', 'loader', 'scope', 'history'])(
    'retains the %s failure and the isolated runtime cleanup failure',
    async (stage) => {
      await withDisposalJoinFixture(
        async ({
          config,
          settingsOwner,
          agent,
          workspaceTrust,
          workspacePaths,
          instructionReads,
          readMcpInstructions,
        }) => {
          const subagentManager = agent.workspace.subagentDefinitions;
          const profileManager = agent.workspace.profileDefinitions;
          const primary = new Error(`${stage} failed`);
          const secondary = new Error('isolated cleanup failed');
          const historyFailure = new Error('history cleanup failed');
          let restoreHistory = (): void => {};
          const original = runtime.createIsolatedRuntimeContext;
          let released = false;
          const seam = vi
            .spyOn(runtime, 'createIsolatedRuntimeContext')
            .mockImplementation((options, settings) => {
              const handle = original(options, settings);
              return {
                ...handle,
                activate:
                  stage === 'activation'
                    ? async () => {
                        throw primary;
                      }
                    : handle.activate,
                cleanup: async () => {
                  await handle.cleanup();
                  released = true;
                  throw secondary;
                },
              };
            });
          try {
            const orchestrator = new SubagentOrchestrator({
              workspaceTrust,
              createChildSettings: () => settingsOwner.createChildStore(),
              readRunPolicy: () => settingsOwner.readSubagentRunPolicy(),
              toolRegistry: agent.agentClient.tools,
              workspacePaths,
              instructions: instructionReads,
              foregroundConfig: config,
              subagentManager,
              profileManager,
              messageBus: new MessageBus(),
              readMcpInstructions,
              runtimeLoader: async (options) => {
                if (stage === 'loader') throw primary;
                const bundle = await loadAgentRuntime(options);
                if (stage === 'history') {
                  const dispose = bundle.history.dispose.bind(bundle.history);
                  const history = vi
                    .spyOn(bundle.history, 'dispose')
                    .mockImplementation(() => {
                      dispose();
                      throw historyFailure;
                    });
                  restoreHistory = () => history.mockRestore();
                }
                return bundle;
              },
              scopeFactory: async () => {
                throw primary;
              },
            });
            let failure: unknown;
            try {
              await orchestrator.launch({ name: 'disposal-child' });
            } catch (error) {
              failure = error;
            }
            expect(released).toBe(true);
            expect(failure).toBeInstanceOf(AggregateDisposeError);
            if (!(failure instanceof AggregateDisposeError)) throw failure;
            const flatten = (error: unknown): unknown[] =>
              error instanceof AggregateDisposeError
                ? error.errors.flatMap(flatten)
                : [error];
            expect(flatten(failure)).toStrictEqual(
              stage === 'history'
                ? [primary, historyFailure, secondary]
                : [primary, secondary],
            );
          } finally {
            restoreHistory();
            seam.mockRestore();
          }
        },
      );
    },
    30000,
  );
});
