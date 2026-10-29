import { recordToolCompletions } from '../../session/record-tool-completions.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createToolControlDeps } from './helpers/fakeToolControlDeps.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';

/**
 * Behavioral tests for the stale-client rebuild guard and public
 * recordCompletedToolCalls (issue #2372 Phase A changes 4 + 5).
 *
 * (e) stale-client rebuild: when the config's agent client changes between
 *     turns (simulating a slash-command refreshAuth), agent.stream() rebuilds
 *     the loop against the NEW client before running the turn.
 * (f) recordCompletedToolCalls: a caller-scheduled CompletedToolCall recorded
 *     via agent.tools.recordCompletedToolCalls is routed to the live client's
 *     chat with the SAME batch and the resolved model (getCurrentSequenceModel
 *     ?? config.getModel), proving live-client resolution.
 */

import { describe, it, expect } from 'bun:test';
import {
  buildAgent,
  drain,
  countType,
  type AgentEvent,
} from './helpers/agentHarness.js';
import { ToolControl } from '../control/toolControl.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';

/** Builds a ToolControl using the real session persistence operation. */
function createToolControlWithRecordingClient(options: {
  sequenceModel: string | null;
  configModel: string;
}): {
  toolControl: ToolControl;
  recordedCalls: Array<{ model: string; batch: readonly CompletedToolCall[] }>;
  setClient: (client: AgentClientContract) => void;
} {
  const recordedCalls: Array<{
    model: string;
    batch: readonly CompletedToolCall[];
  }> = [];

  const buildRecordingClient = (
    sequenceModel: string | null,
  ): AgentClientContract =>
    ({
      getCurrentSequenceModel: () => sequenceModel,
      getChat: () => ({
        recordCompletedToolCalls: (
          model: string,
          batch: CompletedToolCall[],
        ) => {
          recordedCalls.push({ model, batch });
        },
      }),
    }) as unknown as AgentClientContract;

  let currentClient: AgentClientContract = buildRecordingClient(
    options.sequenceModel,
  );

  const toolControl = createToolControlDeps([], (calls) =>
    recordToolCompletions(currentClient, () => options.configModel, calls),
  ).control;

  return {
    toolControl,
    recordedCalls,
    setClient: (client: AgentClientContract) => {
      currentClient = client;
    },
  };
}

const completedTool = new MockTool('list_directory');
const SAMPLE_COMPLETED: CompletedToolCall[] = [
  {
    request: {
      callId: 'caller-call-1',
      prompt_id: 'caller-prompt-1',
      name: 'list_directory',
      args: { path: '/tmp' },
      isClientInitiated: true,
    },
    response: {
      callId: 'caller-call-1',
      resultDisplay: 'file1.txt',
      errorType: undefined,
      responseParts: [
        {
          type: 'tool_response',
          callId: 'caller-call-1',
          toolName: 'list_directory',
          result: { output: 'file1.txt' },
        },
      ],
      error: undefined,
    },
    status: 'success',
    tool: completedTool,
    invocation: completedTool.build({ path: '/tmp' }),
  },
];

describe('stale-client rebuild guard + recordCompletedToolCalls (issue #2372 Phase A changes 4 + 5)', () => {
  it('persists tool completions through a public model replacement without exposing either client', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await drain(agent.stream('initialize history'));
      agent.tools.recordCompletedToolCalls(SAMPLE_COMPLETED);
      expect(JSON.stringify(await agent.session.getHistory())).toContain(
        'caller-call-1',
      );
      await agent.setModel('replacement-recording-model');
      const next: CompletedToolCall[] = SAMPLE_COMPLETED.map((call) => ({
        ...call,
        request: { ...call.request, callId: 'replacement-call-2' },
        response: {
          ...call.response,
          callId: 'replacement-call-2',
          responseParts: call.response.responseParts.map((part) =>
            part.type === 'tool_response'
              ? { ...part, callId: 'replacement-call-2' }
              : part,
          ),
        },
      }));
      agent.tools.recordCompletedToolCalls(next);
      const history = JSON.stringify(await agent.session.getHistory());
      expect(history).toContain('caller-call-1');
      expect(history).toContain('replacement-call-2');
      expect(agent.getModel()).toBe('replacement-recording-model');
    } finally {
      await cleanup();
    }
  });

  it('agent.stream() rebuilds the loop when the config agent client has changed (stale-client guard)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text-two-turns.jsonl');
    try {
      // Drive one turn so the loop is initialized and bound to the initial client.
      const first = await drain(agent.stream('first turn'));
      expect(countType(first, 'done')).toBe(1);

      // Simulate an external refreshAuth that replaces the client on the config.
      await agent.sessionClient.refreshAuth(undefined);

      // The next stream() call must detect the stale client and rebuild. A turn
      // run on the retired client could not write to the history the agent reads.
      const events: AgentEvent[] = await drain(agent.stream('second turn'));
      expect(countType(events, 'done')).toBe(1);
      expect(countType(events, 'error')).toBe(0);
      const history = JSON.stringify(await agent.session.getHistory());
      expect(history).toContain('first turn');
      expect(history).toContain('second turn');
    } finally {
      await cleanup();
    }
  });

  it('stale-client guard does not rebuild when the client is unchanged (no-op)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text-two-turns.jsonl');
    try {
      const first = await drain(agent.stream('first'));
      expect(countType(first, 'done')).toBe(1);

      // No client change — the second turn should still drive successfully on
      // the same client.
      const events = await drain(agent.stream('second'));
      expect(countType(events, 'done')).toBe(1);
      expect(countType(events, 'error')).toBe(0);
      const history = JSON.stringify(await agent.session.getHistory());
      expect(history).toContain('first');
      expect(history).toContain('second');
    } finally {
      await cleanup();
    }
  });

  it('recordCompletedToolCalls routes the SAME batch and resolved model to the live client chat', () => {
    // sequenceModel is set — it wins over config.getModel.
    const { toolControl, recordedCalls } = createToolControlWithRecordingClient(
      {
        sequenceModel: 'seq-model-xyz',
        configModel: 'config-model-fallback',
      },
    );

    toolControl.recordCompletedToolCalls(SAMPLE_COMPLETED);

    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].model).toBe('seq-model-xyz');
    expect(recordedCalls[0].batch).toStrictEqual(SAMPLE_COMPLETED);
    expect(recordedCalls[0].batch[0].request.callId).toBe('caller-call-1');
  });

  it('recordCompletedToolCalls falls back to config.getModel() when getCurrentSequenceModel() is null', () => {
    const { toolControl, recordedCalls } = createToolControlWithRecordingClient(
      {
        sequenceModel: null,
        configModel: 'config-model-fallback',
      },
    );

    toolControl.recordCompletedToolCalls(SAMPLE_COMPLETED);

    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].model).toBe('config-model-fallback');
  });

  it('recordCompletedToolCalls routes to the NEW client after a swap (live-client resolution)', () => {
    const { toolControl, recordedCalls, setClient } =
      createToolControlWithRecordingClient({
        sequenceModel: 'seq-model-xyz',
        configModel: 'config-model-fallback',
      });

    // Record once against the original client.
    toolControl.recordCompletedToolCalls(SAMPLE_COMPLETED);
    expect(recordedCalls).toHaveLength(1);

    // Swap the client (simulating refreshAuth).
    const newRecordedCalls: Array<{
      model: string;
      batch: readonly CompletedToolCall[];
    }> = [];
    setClient({
      getCurrentSequenceModel: () => 'swapped-model',
      getChat: () => ({
        recordCompletedToolCalls: (
          model: string,
          batch: CompletedToolCall[],
        ) => {
          newRecordedCalls.push({ model, batch });
        },
      }),
    } as unknown as AgentClientContract);

    // Record again — must route to the NEW client, not the old one.
    toolControl.recordCompletedToolCalls(SAMPLE_COMPLETED);

    // The original client still has only 1 call.
    expect(recordedCalls).toHaveLength(1);
    // The new client received the call.
    expect(newRecordedCalls).toHaveLength(1);
    expect(newRecordedCalls[0].model).toBe('swapped-model');
    expect(newRecordedCalls[0].batch).toStrictEqual(SAMPLE_COMPLETED);
  });

  it('recordCompletedToolCalls is best-effort: does not throw when session history is unavailable', () => {
    // Construct a ToolControl directly with a history operation that throws,
    // proving the catch path does not propagate the error.
    const toolControl = createToolControlDeps([], () => {
      throw new Error('chat unavailable');
    }).control;

    // Must not throw even though resolveClient throws.
    expect(() => {
      toolControl.recordCompletedToolCalls(SAMPLE_COMPLETED);
    }).not.toThrow();
  });
});
