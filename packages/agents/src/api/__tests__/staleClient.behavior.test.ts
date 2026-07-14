/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

import { describe, it, expect, vi } from 'vitest';
import {
  buildAgent,
  drain,
  countType,
  internalConfig,
  type AgentEvent,
} from './helpers/agentHarness.js';
import { ToolControl } from '../control/toolControl.js';
import type { ToolControlDeps } from '../control/toolControl.js';
import { getToolKeyStorage } from '@vybestack/llxprt-code-core';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';

/** Builds a ToolControl with a mock resolveClient returning a recording client. */
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

  const config = {
    getModel: () => options.configModel,
  } as unknown as ToolControlDeps['config'];

  const deps: ToolControlDeps = {
    messageBus: new MessageBus(),
    config,
    editorCallbacksHolder: { editorCallbacks: {} },
    displayCallbacksHolder: {},
    resolveClient: () => currentClient,
    keysDeps: { getStorage: () => getToolKeyStorage() },
  };

  return {
    toolControl: new ToolControl(deps),
    recordedCalls,
    setClient: (client: AgentClientContract) => {
      currentClient = client;
    },
  };
}

const SAMPLE_COMPLETED: CompletedToolCall[] = [
  {
    request: {
      callId: 'caller-call-1',
      name: 'list_directory',
      args: { path: '/tmp' },
      isClientInitiated: true,
    },
    response: {
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
  } as CompletedToolCall,
];

describe('stale-client rebuild guard + recordCompletedToolCalls (issue #2372 Phase A changes 4 + 5)', () => {
  it('agent.stream() rebuilds the loop when the config agent client has changed (stale-client guard)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const config = internalConfig(agent);

      // Drive one turn so the loop is initialized and bound to the initial client.
      const first = await drain(agent.stream('first turn'));
      expect(countType(first, 'done')).toBe(1);

      // Capture the clients BEFORE and AFTER refreshAuth, and spy on their
      // sendMessageStream so we can prove the second turn hit the NEW client.
      const originalClient = config.getAgentClient();
      const originalSendSpy = vi.spyOn(
        originalClient,
        'sendMessageStream' as keyof typeof originalClient,
      );

      // Simulate an external refreshAuth that replaces the client on the config.
      await config.refreshAuth(undefined);
      const newClient = config.getAgentClient();
      expect(newClient).not.toBe(originalClient);

      const newSendSpy = vi.spyOn(
        newClient,
        'sendMessageStream' as keyof typeof newClient,
      );

      // The next stream() call must detect the stale client and rebuild.
      const events: AgentEvent[] = await drain(agent.stream('second turn'));
      expect(countType(events, 'done')).toBe(1);

      // The second turn MUST have hit the NEW client, not the original.
      expect(newSendSpy).toHaveBeenCalled();
      // The original client's sendMessageStream was spied AFTER the first turn
      // completed, so it should have zero calls — the second turn did not use it.
      expect(originalSendSpy).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it('stale-client guard does not rebuild when the client is unchanged (no-op)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const config = internalConfig(agent);
      const first = await drain(agent.stream('first'));
      expect(countType(first, 'done')).toBe(1);

      // Spy on the current client's sendMessageStream before the second turn.
      // Since the client is unchanged, the stale-client guard is a no-op and
      // the SAME client must be reused.
      const currentClient = config.getAgentClient();
      const sendSpy = vi.spyOn(
        currentClient,
        'sendMessageStream' as keyof typeof currentClient,
      );

      // No client change — the second turn should still drive successfully.
      const events = await drain(agent.stream('second'));
      expect(countType(events, 'done')).toBe(1);

      // The same client WAS called (not rebuilt to a different client).
      expect(sendSpy).toHaveBeenCalled();
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

  it('recordCompletedToolCalls is best-effort: does not throw when resolveClient throws', () => {
    // Construct a ToolControl directly with a resolveClient that throws,
    // proving the catch path does not propagate the error.
    const config = {
      getModel: () => 'fallback-model',
    } as unknown as ToolControlDeps['config'];

    const deps: ToolControlDeps = {
      messageBus: new MessageBus(),
      config,
      editorCallbacksHolder: { editorCallbacks: {} },
      displayCallbacksHolder: {},
      resolveClient: () => {
        throw new Error('chat unavailable');
      },
      keysDeps: { getStorage: () => getToolKeyStorage() },
    };

    const toolControl = new ToolControl(deps);

    // Must not throw even though resolveClient throws.
    expect(() => {
      toolControl.recordCompletedToolCalls(SAMPLE_COMPLETED);
    }).not.toThrow();
  });
});
