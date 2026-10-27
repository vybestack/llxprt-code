/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { NativeJournalPageReader } from '@vybestack/llxprt-code-core/journal/native-journal-page-reader.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolCallRequestInfo } from '@vybestack/llxprt-code-core/core/turn.js';
import type { ToolCallBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { bindSchedulerOwner } from '../../../session/assembleSchedulerOwner.js';
import { CoreToolScheduler } from '../../coreToolScheduler.js';
import { AgenticLoop } from '../AgenticLoop.js';
import { appendResponseChunk } from '../../responseArrival.js';
import { toolRequestFromBlock } from '../../turnChunkEvents.js';
import {
  AgentEventType,
  createAskPolicyEngine,
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  finishedEvent,
} from './agenticLoop-test-helpers.js';

function activeApproval(
  calls: ReadonlyArray<
    import('@vybestack/llxprt-code-core/scheduler/types.js').ToolCall
  >,
): import('@vybestack/llxprt-code-tools').ToolCallConfirmationDetails['onConfirm'] {
  const call = calls.find(
    (candidate) => candidate.status === 'awaiting_approval',
  );
  if (
    call?.status !== 'awaiting_approval' ||
    !('onConfirm' in call.confirmationDetails)
  )
    throw new Error('Missing approval');
  return call.confirmationDetails.onConfirm;
}

async function approvalRows(path: string): Promise<unknown[]> {
  const reader = await NativeJournalPageReader.open(path);
  const rows: unknown[] = [];
  try {
    for await (const row of reader.entries()) {
      const presentation = await reader.presentation(row);
      if (presentation?.descriptor.type !== 'tool-approval') continue;
      const content = await reader.readContent(row);
      rows.push(
        JSON.parse(
          content.blocks
            .flatMap((block) => (block.type === 'text' ? [block.text] : []))
            .join(''),
        ),
      );
    }
  } finally {
    await reader.close();
  }
  return rows;
}

async function requestFor(
  history: HistoryService,
): Promise<ToolCallRequestInfo> {
  const arrival = await history.openResponseArrival({
    id: 'approval-attempt',
    submissionId: 'submission',
  });
  const block: ToolCallBlock = {
    type: 'tool_call',
    id: 'approval-call',
    name: 'lookup',
    parameters: { param: 'input' },
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
  request: ToolCallRequestInfo,
  tool: MockTool,
): AgenticLoop {
  const registry = createToolRegistryForTest([tool]);
  const policy = createAskPolicyEngine();
  const bus = new MessageBus(policy, false);
  const { config, settingsOwner } = createTestConfig({
    messageBus: bus,
    toolRegistry: registry,
    policyEngine: policy,
    interactive: true,
    approvalMode: ApprovalMode.DEFAULT,
  });
  const { client } = createScriptedAgentClient([
    [{ type: AgentEventType.ToolCallRequest, value: request }, finishedEvent()],
    [finishedEvent()],
  ]);
  return new AgenticLoop({
    agentClient: { ...client, getHistoryService: () => history },
    config,
    messageBus: bus,
    createSchedulerOwner: bindSchedulerOwner(
      config,
      bus,
      true,
      registry,
      (options) => new CoreToolScheduler(options),
      () => settingsOwner.readToolExecutionPolicy(),
      () => settingsOwner.readToolGovernance([]),
      () => ApprovalMode.DEFAULT,
      settingsOwner.telemetry,
    ),
  });
}

class FailingApprovalHistory extends HistoryService {
  override appendDisplay(): ReturnType<HistoryService['appendDisplay']> {
    return Promise.reject(new Error('approval disk failed'));
  }
}

class FailingDecisionHistory extends HistoryService {
  private writes = 0;
  override appendDisplay(
    ...args: Parameters<HistoryService['appendDisplay']>
  ): ReturnType<HistoryService['appendDisplay']> {
    this.writes++;
    if (this.writes === 2)
      return Promise.reject(new Error('decision disk failed'));
    return super.appendDisplay(...args);
  }
}

async function fixture(directory: string, history = new HistoryService()) {
  const recording = createSessionRecorder({
    sessionId: 'approval',
    projectHash: 'approval',
    chatsDir: directory,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  await history.attachJournal(recording, true);
  const request = await requestFor(history);
  const path = history.journalPath();
  if (path === null) throw new Error('Missing journal');
  return {
    history,
    request,
    path,
    close: async (): Promise<void> => {
      await history.dispose();
      await recording.dispose();
    },
  };
}

describe('approval journal publication boundaries', () => {
  const directory = useTempDir('approval-journal-');
  [ToolConfirmationOutcome.ProceedOnce, ToolConfirmationOutcome.Cancel].forEach(
    (outcome) => {
      it(`persists request and ${outcome} before exposing approval or calling the tool`, async () => {
        const session = await fixture(directory());
        let executions = 0;
        let decisions = 0;
        const tool = new MockTool({
          name: 'lookup',
          shouldConfirmExecute: async () => ({
            type: 'exec',
            title: 'Run lookup',
            command: 'lookup input',
            rootCommand: 'lookup',
            rootCommands: ['lookup'],
            onConfirm: async () => {
              const rows = await approvalRows(session.path);
              expect(rows).toHaveLength(2);
              expect(rows[1]).toMatchObject({
                outcome,
                status:
                  outcome === ToolConfirmationOutcome.Cancel
                    ? 'cancelled'
                    : 'scheduled',
              });
              decisions++;
            },
          }),
          execute: async () => {
            executions++;
            return { llmContent: 'done', returnDisplay: 'done' };
          },
        });
        try {
          const loop = loopFor(session.history, session.request, tool);
          let approvals = 0;
          for await (const event of loop.run(
            'go',
            new AbortController().signal,
          )) {
            if (event.kind !== 'awaiting_approval') continue;
            const waiting = event.toolCalls.find(
              (call) => call.status === 'awaiting_approval',
            );
            if (
              waiting?.status !== 'awaiting_approval' ||
              !('onConfirm' in waiting.confirmationDetails)
            )
              throw new Error('Missing active approval');
            const rows = await approvalRows(session.path);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
              status: 'awaiting_approval',
              request: { name: 'lookup', args: { param: 'input' } },
              details: { command: 'lookup input' },
            });
            expect(JSON.stringify(rows)).not.toContain('onConfirm');
            approvals++;
            await waiting.confirmationDetails.onConfirm(outcome);
          }
          expect(approvals).toBe(1);
          expect(decisions).toBe(1);
          expect(executions).toBe(
            outcome === ToolConfirmationOutcome.Cancel ? 0 : 1,
          );
          await session.close();
          expect(await approvalRows(session.path)).toHaveLength(2);
        } finally {
          await session.close();
        }
      });
    },
  );

  it('persists abort before owner release without executing or reviving a confirmation', async () => {
    const session = await fixture(directory());
    const controller = new AbortController();
    const tool = new MockTool({
      name: 'lookup',
      execute: async () => {
        throw new Error('Aborted approval executed');
      },
    });
    tool.shouldConfirm = true;
    try {
      let approvals = 0;
      for await (const event of loopFor(
        session.history,
        session.request,
        tool,
      ).run('go', controller.signal)) {
        if (event.kind === 'awaiting_approval') {
          approvals++;
          controller.abort();
        }
      }
      expect(approvals).toBe(1);
      await session.close();
      const rows = await approvalRows(session.path);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        status: 'cancelled',
        outcome: ToolConfirmationOutcome.Cancel,
        aborted: true,
      });
    } finally {
      await session.close();
    }
  });

  it('does not invoke a tool decision callback when its journal write fails', async () => {
    const session = await fixture(directory(), new FailingDecisionHistory());
    let decisions = 0;
    let executions = 0;
    const tool = new MockTool({
      name: 'lookup',
      shouldConfirmExecute: async () => ({
        type: 'info',
        title: 'Lookup',
        prompt: 'Allow lookup?',
        onConfirm: async () => {
          decisions++;
        },
      }),
      execute: async () => {
        executions++;
        return { llmContent: 'done', returnDisplay: 'done' };
      },
    });
    const stream = loopFor(session.history, session.request, tool).run(
      'go',
      new AbortController().signal,
    );
    try {
      let event = await stream.next();
      while (event.done !== true && event.value.kind !== 'awaiting_approval')
        event = await stream.next();
      if (event.done === true || event.value.kind !== 'awaiting_approval')
        throw new Error('Missing approval');
      const confirm = activeApproval(event.value.toolCalls);
      await expect(
        confirm(ToolConfirmationOutcome.ProceedOnce),
      ).rejects.toThrow('decision disk failed');
      await stream.return(undefined);
      expect(decisions).toBe(0);
      expect(executions).toBe(0);
      expect(await approvalRows(session.path)).toHaveLength(2);
    } finally {
      await stream.return(undefined);
      await session.close();
    }
  });

  it('fails the turn before publication when the approval request cannot be persisted', async () => {
    const session = await fixture(directory(), new FailingApprovalHistory());
    const tool = new MockTool({
      name: 'lookup',
      execute: async () => {
        throw new Error('Unpersisted approval executed');
      },
    });
    tool.shouldConfirm = true;
    let exposed = 0;
    try {
      const consume = async (): Promise<void> => {
        for await (const event of loopFor(
          session.history,
          session.request,
          tool,
        ).run('go', new AbortController().signal)) {
          if (
            event.kind === 'awaiting_approval' ||
            event.kind === 'tools_complete'
          )
            exposed++;
        }
      };
      await expect(consume()).rejects.toThrow('approval disk failed');
      expect(exposed).toBe(0);
    } finally {
      await session.close();
    }
  });
});
