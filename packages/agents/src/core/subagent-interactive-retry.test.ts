/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createSubagentScope } from './__tests__/helpers/create-subagent-scope.js';
import { describe, expect, it } from 'bun:test';
import { ContextState } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { SubAgentScope } from './subagent.js';
import {
  acquireSubagentWorkspace,
  createRuntimeOverrides,
  installSubagentCleanup,
  scopeInputs,
} from './__tests__/subagent-test-helpers.js';
import { installResponsesLifecycleFixture } from './__tests__/responses-lifecycle-fixture.js';
import { setupTaskStreaming } from '../tools/taskStreaming.js';
import { setupAsyncStreaming } from '../tools/taskAsyncExecution.js';
import { startTaskHeartbeat } from '../tools/taskHeartbeat.js';
import type { LiveOutputUpdate } from '@vybestack/llxprt-code-tools';
import {
  SocketHarness,
  completingWithId,
  connectionLimitErrorFrame,
  frame,
  type FakeSocket,
} from '../../../providers/src/openai-responses/__tests__/openAIResponsesWebSocketTransport.test-helpers.js';

const createFixture = installResponsesLifecycleFixture();
const retainCleanup = installSubagentCleanup();
function emit(socket: FakeSocket, id: string, value: string): void {
  const args = JSON.stringify({
    emit_variable_name: 'result',
    emit_variable_value: value,
  });
  socket.message(
    frame({
      type: 'response.output_item.added',
      item: {
        type: 'function_call',
        id,
        call_id: id,
        name: 'self_emitvalue',
        arguments: args,
      },
    }),
  );
  socket.message(
    frame({
      type: 'response.function_call_arguments.done',
      item_id: id,
      arguments: args,
    }),
  );
}

async function createScope(
  harness: SocketHarness,
  maxTurns = 1,
): Promise<{
  fixture: ReturnType<typeof createFixture>;
  scope: SubAgentScope;
  rendered: string[];
  resetSnapshots: string[];
}> {
  const fixture = createFixture(harness);
  const { config } = fixture;
  const mcpRuntime = await acquireSubagentWorkspace(config, retainCleanup);
  const runtimeBundle = {
    telemetryRoot: fixture.telemetryRoot,
    toolRegistry: fixture.toolRegistry,
    runtimeContext: fixture.runtime,
    history: fixture.history,
    providerAdapter: fixture.runtime.provider,
    telemetryAdapter: fixture.runtime.telemetry,
    toolsView: fixture.runtime.tools,
    contentGenerator: fixture.contentGenerator,
  };
  const { overrides } = createRuntimeOverrides(
    mcpRuntime.workspaceFilesystem.paths,
    { runtimeBundle, environmentLoader: async () => [] },
  );
  const scope = await createSubagentScope(
    {
      name: 'retry-agent',
      prompt: { systemPrompt: 'Complete the task.' },
      model: { model: 'gpt-5.6-sol', temp: 0.5, top_p: 1 },
      run: {
        max_time_minutes: 1,
        max_turns: maxTurns,
        max_output_tokens_total: 200,
      },
      toolConfig: undefined,
      outputConfig: { outputs: { result: 'The completed task result.' } },
    },
    ...scopeInputs(config, overrides),
  );
  retainCleanup(() => scope.dispose());
  const rendered: string[] = [];
  const resetSnapshots: string[] = [];
  scope.onMessage = (message) => rendered.push(message);
  scope.onOutputReset = () => resetSnapshots.push(rendered.join(''));
  return { fixture, scope, rendered, resetSnapshots };
}

describe('interactive subagent logical attempt rollback with real Responses provider', () => {
  it('publishes Codex text before the server continues and resets abandoned Task output state', async () => {
    let observe = (): void => {};
    const observed = new Promise<void>((resolve) => {
      observe = resolve;
    });
    let enter = (): void => {};
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          emit(socket, 'abandoned-tool', 'unsafe');
          socket.message(
            frame({ type: 'response.output_text.delta', delta: 'ABANDONED\r' }),
          );
          enter();
          void observed.then(() => socket.message(connectionLimitErrorFrame()));
        };
      },
      completingWithId('replacement', '\nCompleted safely.'),
    ]);
    const { fixture, scope, rendered } = await createScope(harness);
    const resetSnapshots: string[] = [];
    scope.onOutputReset = () => resetSnapshots.push(rendered.join(''));
    const updates: LiveOutputUpdate[] = [];
    const handle = setupTaskStreaming(
      'retry-agent',
      'retry-agent-id',
      scope,
      (update) => {
        updates.push(update);
        if (update.mode === 'append' && update.data === 'ABANDONED') observe();
      },
      startTaskHeartbeat,
    );
    const run = scope.runInteractive(new ContextState(), {
      schedulerFactory: () => ({
        schedule: () => {
          throw new Error('Abandoned external tools must not execute');
        },
      }),
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await entered;
      await Promise.race([
        observed,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  'First Codex text was not published while response remained open',
                ),
              ),
            1500,
          );
        }),
      ]);
      await run;
      handle.emitClosingSubagentTag();
      const appended = updates.flatMap((update) =>
        update.mode === 'append' ? [update.data] : [],
      );
      expect(resetSnapshots).toStrictEqual(['ABANDONED\r']);
      expect(appended.slice(1, -1)).toStrictEqual([
        'ABANDONED',
        '\n[Subagent response interrupted. Previous attempt output is abandoned; retrying.]\n',
        '\nCompleted safely.',
      ]);
      expect(scope.output.final_message).toBe('Completed safely.');
      expect(scope.output.emitted_vars).toStrictEqual({});
      expect(scope.output.output_tokens_total).toBeLessThan(200);
      expect(harness.sockets).toHaveLength(2);
      expect(fixture.httpRequests()).toBe(0);
    } finally {
      clearTimeout(timer);
      observe();
      scope.cancel();
      await run;
      handle.emitClosingSubagentTag();
      handle.heartbeat.stop();
    }
  });

  it('preserves earlier committed tool iterations without executing or rendering them again', async () => {
    let sends = 0;
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          sends += 1;
          if (sends === 1) {
            socket.message(
              frame({
                type: 'response.output_text.delta',
                delta: 'Committed progress.',
              }),
            );
            emit(socket, 'committed-tool', 'retained');
            socket.message(
              frame({
                type: 'response.completed',
                response: { id: 'committed', status: 'completed' },
              }),
            );
          } else {
            socket.message(
              frame({ type: 'response.output_text.delta', delta: 'ABANDONED' }),
            );
            emit(socket, 'abandoned-tool', 'unsafe');
            socket.message(connectionLimitErrorFrame());
          }
        };
      },
      completingWithId('replacement', 'Completed safely.'),
    ]);
    const { fixture, scope, rendered, resetSnapshots } = await createScope(
      harness,
      2,
    );
    await scope.runInteractive(new ContextState(), {
      schedulerFactory: () => ({
        schedule: () => {
          throw new Error('No external tools expected');
        },
      }),
    });
    expect(scope.output.emitted_vars).toStrictEqual({ result: 'retained' });
    expect(
      rendered.filter((message) =>
        message.includes('Emitted variable result successfully'),
      ),
    ).toHaveLength(1);
    expect(
      rendered.filter((message) => message.includes('Committed progress.')),
    ).toHaveLength(1);
    expect(
      rendered.filter((message) => message.includes('ABANDONED')),
    ).toHaveLength(1);
    expect(resetSnapshots).toHaveLength(1);
    expect(resetSnapshots[0]).toContain('Committed progress.');
    expect(resetSnapshots[0]).toContain('ABANDONED');
    expect(scope.output.final_message).toContain('Completed safely.');
    expect(scope.output.final_message).not.toContain('ABANDONED');
    const rebuilt: unknown = JSON.parse(harness.sockets[1].sent[0]);
    expect(JSON.stringify(rebuilt)).toContain('committed-tool');
    expect(JSON.stringify(rebuilt)).toContain('retained');
    expect(JSON.stringify(rebuilt)).not.toContain('abandoned-tool');
    expect(sends).toBe(2);
    expect(harness.sockets[1].sent).toHaveLength(1);
    expect(fixture.httpRequests()).toBe(0);
  });
  for (const replacementTool of [false, true]) {
    it(`resets live abandoned output and retains only successful final text and emitted values with replacement tool=${replacementTool}`, async () => {
      let successfulSends = 0;
      const harness = new SocketHarness([
        (socket) => {
          socket.open();
          socket.onSend = () => {
            socket.message(
              frame({
                type: 'response.output_text.delta',
                delta: 'ABANDONED'.repeat(100),
              }),
            );
            emit(socket, 'abandoned-A', 'unsafe');
            socket.message(connectionLimitErrorFrame());
          };
        },
        (socket) => {
          socket.open();
          socket.onSend = () => {
            successfulSends += 1;
            if (replacementTool) emit(socket, 'successful-B', 'safe');
            socket.message(
              frame({
                type: 'response.output_text.delta',
                delta: 'Completed safely.',
              }),
            );
            socket.message(
              frame({
                type: 'response.completed',
                response: { id: 'fresh', status: 'completed' },
              }),
            );
          };
        },
      ]);
      const { fixture, scope, rendered, resetSnapshots } =
        await createScope(harness);

      await scope.runInteractive(new ContextState(), {
        schedulerFactory: () => ({
          schedule: () => {
            throw new Error('No external tools expected');
          },
        }),
      });

      expect(scope.output.final_message).toContain('Completed safely.');
      expect(scope.output.final_message).not.toContain('ABANDONED');
      expect(
        rendered.filter((message) =>
          message.includes('Emitted variable result successfully'),
        ),
      ).toHaveLength(replacementTool ? 1 : 0);
      expect(resetSnapshots).toStrictEqual(['ABANDONED'.repeat(100)]);
      expect(
        rendered.filter((message) => message.includes('ABANDONED')),
      ).toHaveLength(1);
      expect(rendered.join('')).toContain('Completed safely.');
      expect(scope.output.emitted_vars).toStrictEqual(
        replacementTool ? { result: 'safe' } : {},
      );
      expect(scope.output.output_tokens_total).toBeLessThan(200);
      expect(successfulSends).toBe(1);
      expect(harness.sockets).toHaveLength(2);
      expect(fixture.httpRequests()).toBe(0);
    });
  }
  it('marks abandoned output through async Task streaming on a real retry', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.message(
            frame({ type: 'response.output_text.delta', delta: 'ABANDONED\r' }),
          );
          socket.message(connectionLimitErrorFrame());
        };
      },
      completingWithId('replacement', '\nCompleted safely.'),
    ]);
    const { fixture, scope, resetSnapshots } = await createScope(harness);
    const updates: LiveOutputUpdate[] = [];
    const streaming = setupAsyncStreaming(
      'retry-agent',
      scope,
      'retry-agent-id',
      (update) => updates.push(update),
    );

    await scope.runInteractive(new ContextState(), {
      schedulerFactory: () => ({
        schedule: () => {
          throw new Error('No external tools expected');
        },
      }),
    });
    streaming?.emitAsyncClosingSubagentTag();

    const streamed = updates
      .flatMap((update) => (update.mode === 'append' ? [update.data] : []))
      .join('');
    expect(streamed).toContain(
      '[Subagent response interrupted. Previous attempt output is abandoned; retrying.]',
    );
    expect(streamed).toContain('ABANDONED');
    expect(streamed).toContain('Completed safely.');
    expect(streamed).not.toContain('\r');
    expect(streamed).toContain(
      '</subagent name="retry-agent" id="retry-agent-id">',
    );
    expect(resetSnapshots).toHaveLength(1);
    expect(scope.output.final_message).toBe('Completed safely.');
    expect(scope.output.final_message).not.toContain('ABANDONED');
    expect(harness.sockets).toHaveLength(2);
    expect(fixture.httpRequests()).toBe(0);
  });
});
