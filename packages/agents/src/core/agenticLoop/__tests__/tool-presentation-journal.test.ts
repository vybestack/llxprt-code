import { bindTurnModel } from '../../../session/bind-turn-model.js';
import { TurnToolExecutionOwner } from '../../../session/turn-tool-execution-owner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { NativeJournalPageReader } from '@vybestack/llxprt-code-core/journal/native-journal-page-reader.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { ToolCallBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { bindSchedulerOwner } from '../../../session/assembleSchedulerOwner.js';
import { CoreToolScheduler } from '../../coreToolScheduler.js';
import { AgenticLoop } from '../AgenticLoop.js';
import { appendResponseChunk } from '../../responseArrival.js';
import { toolRequestFromBlock } from '../../turnChunkEvents.js';
import {
  AgentEventType,
  createAllowPolicyEngine,
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  finishedEvent,
} from './agenticLoop-test-helpers.js';

class FailingDisplayHistory extends HistoryService {
  override appendDisplay(): ReturnType<HistoryService['appendDisplay']> {
    return Promise.reject(new Error('display storage failed'));
  }
}

async function recordedRequest(history: HistoryService) {
  const arrival = await history.openResponseArrival({
    id: 'actual-attempt',
    submissionId: 'submission',
  });
  const block: ToolCallBlock = {
    type: 'tool_call',
    id: 'lookup-call',
    name: 'lookup',
    parameters: {},
  };
  await appendResponseChunk(
    arrival,
    { content: { speaker: 'ai', blocks: [block] } },
    true,
  );
  await arrival.seal({});
  return toolRequestFromBlock(block, 0, 'submission', 'primary');
}

function loopFor(
  history: HistoryService,
  request: Awaited<ReturnType<typeof recordedRequest>>,
): AgenticLoop {
  const tool = new MockTool({
    name: 'lookup',
    execute: async () => ({
      llmContent: 'model-only result',
      returnDisplay: 'user-facing result',
    }),
  });
  const registry = createToolRegistryForTest([tool]);
  const policy = createAllowPolicyEngine();
  const bus = new MessageBus(policy, false);
  const { config, settingsOwner } = createTestConfig({
    messageBus: bus,
    toolRegistry: registry,
    policyEngine: policy,
    interactive: false,
  });
  const { client } = createScriptedAgentClient([
    [{ type: AgentEventType.ToolCallRequest, value: request }, finishedEvent()],
    [finishedEvent()],
  ]);
  return new AgenticLoop({
    ...bindTurnModel({ ...client, getHistoryService: () => history }),
    config,

    tools: new TurnToolExecutionOwner(
      bus,
      undefined,
      bindSchedulerOwner(
        config,
        bus,
        false,
        registry,
        (options) => new CoreToolScheduler(options),
        () => settingsOwner.readToolExecutionPolicy(),
        () => settingsOwner.readToolGovernance([]),
        undefined,
        settingsOwner.telemetry,
      ),
    ),
  });
}

async function toolDisplay(
  path: string,
  request: Awaited<ReturnType<typeof recordedRequest>>,
): Promise<string | undefined> {
  const reader = await NativeJournalPageReader.open(path);
  try {
    for await (const row of reader.entries()) {
      if (row.transcriptId.toString() !== request.journalIdentity?.transcriptId)
        continue;
      const presentation = await reader.toolPresentation(row, request.callId);
      return presentation?.content.blocks
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
    }
    throw new Error('Missing persisted request');
  } finally {
    await reader.close();
  }
}

describe('agentic loop journal tool presentation', () => {
  const directory = useTempDir('loop-tool-display-');

  it('propagates display write failure without emitting completion or continuing', async () => {
    const history = new FailingDisplayHistory();
    try {
      const loop = loopFor(history, await recordedRequest(history));
      let completionSeen = false;
      const consume = async (): Promise<void> => {
        for await (const event of loop.run(
          'go',
          new AbortController().signal,
        )) {
          if (event.kind === 'tools_complete') completionSeen = true;
        }
      };
      await expect(consume()).rejects.toThrow('display storage failed');
      expect(completionSeen).toBe(false);
    } finally {
      await history.dispose();
    }
  });

  it('completes tools on the unlinked primary when recording is disabled', async () => {
    const history = new HistoryService();
    try {
      const loop = loopFor(history, await recordedRequest(history));
      let completions = 0;
      for await (const event of loop.run('go', new AbortController().signal)) {
        if (event.kind === 'tools_complete') completions++;
      }
      expect(completions).toBe(1);
      expect(history.journalPath()).toBeNull();
      const rows = await Array.fromAsync(history.streamRawHistory());
      expect(rows).toHaveLength(1);
      expect(rows[0].blocks.map((block) => block.type)).toStrictEqual([
        'tool_call',
      ]);
    } finally {
      await history.dispose();
    }
  });
  it('persists distinct result presentation before exposing tool completion', async () => {
    const recording = createSessionRecorder({
      sessionId: 'display',
      projectHash: 'display',
      chatsDir: directory(),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    const history = new HistoryService();
    await history.attachJournal(recording, true);
    try {
      const request = await recordedRequest(history);
      const loop = loopFor(history, request);
      const path = history.journalPath();
      if (path === null) throw new Error('Missing journal path');
      let completions = 0;
      for await (const event of loop.run('go', new AbortController().signal)) {
        if (event.kind !== 'tools_complete') continue;
        completions++;
        expect(await toolDisplay(path, request)).toBe('user-facing result');
      }
      expect(completions).toBe(1);
      await history.dispose();
      await recording.dispose();
      expect(await toolDisplay(path, request)).toBe('user-facing result');
    } finally {
      await history.dispose();
      await recording.dispose();
    }
  });
});
