/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { NativeJournalPageReader } from '@vybestack/llxprt-code-core/journal/native-journal-page-reader.js';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type ToolConfirmationRequest,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { ToolCallBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { appendResponseChunk } from './responseArrival.js';
import { processFunctionCalls } from './subagentToolProcessing.js';
import {
  createAskPolicyEngine,
  createTestConfig,
  createToolRegistryForTest,
} from './agenticLoop/__tests__/agenticLoop-test-helpers.js';

async function approvalStatuses(history: HistoryService): Promise<string[]> {
  const path = history.journalPath();
  if (path === null) throw new Error('Missing child journal');
  const reader = await NativeJournalPageReader.open(path);
  const statuses: string[] = [];
  try {
    for await (const row of reader.entries()) {
      const presentation = await reader.presentation(row);
      if (presentation?.descriptor.type !== 'tool-approval') continue;
      const content = await reader.readContent(row);
      const record: unknown = JSON.parse(
        content.blocks
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join(''),
      );
      if (
        typeof record !== 'object' ||
        record === null ||
        !('status' in record) ||
        typeof record.status !== 'string'
      )
        throw new Error('Invalid approval record');
      statuses.push(record.status);
    }
    return statuses;
  } finally {
    await reader.close();
  }
}

describe('non-interactive child dispatcher approval ownership', () => {
  const directory = useTempDir('child-dispatch-approval-');
  it('retains the response identity and persists both approval stages before execution', async () => {
    const history = new HistoryService();
    const recorder = createSessionRecorder({
      sessionId: 'child',
      projectHash: 'child',
      chatsDir: directory(),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    await history.attachJournal(recorder, true);
    const policy = createAskPolicyEngine();
    const bus = new MessageBus(policy, false);
    let stagesAtExecution: string[] = [];
    const tool = new MockTool({
      name: 'lookup',
      shouldConfirmExecute: async () => ({
        type: 'exec',
        title: 'Lookup',
        command: 'lookup',
        rootCommand: 'lookup',
        rootCommands: ['lookup'],
        onConfirm: async () => {},
      }),
      execute: async (params) => {
        stagesAtExecution = await approvalStatuses(history);
        return {
          llmContent: JSON.stringify(params),
          returnDisplay: JSON.stringify(params),
        };
      },
    });
    const registry = createToolRegistryForTest([tool]);
    const { config, settingsOwner } = createTestConfig({
      messageBus: bus,
      toolRegistry: registry,
      policyEngine: policy,
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });
    const unsubscribe = bus.subscribe<ToolConfirmationRequest>(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (request) => {
        setImmediate(() =>
          bus.publish({
            type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
            correlationId: request.correlationId,
            outcome: ToolConfirmationOutcome.ProceedOnce,
            confirmed: true,
          }),
        );
      },
    );
    try {
      const arrival = await history.openResponseArrival({
        id: 'child-attempt',
        submissionId: 'child-submission',
      });
      const block: ToolCallBlock = {
        type: 'tool_call',
        id: 'child-call',
        name: 'lookup',
        parameters: { param: 'query' },
      };
      await appendResponseChunk(
        arrival,
        { content: { speaker: 'ai', blocks: [block] } },
        true,
      );
      await arrival.seal({});
      const result = await processFunctionCalls(
        [block],
        new AbortController(),
        'child-submission',
        {
          history,
          config,
          messageBus: bus,
          output: {
            emitted_vars: {},
            terminate_reason: SubagentTerminateMode.ERROR,
          },
          subagentId: 'child',
          logger: new DebugLogger('child-approval-test'),
          toolExecutorContext: {
            telemetry: settingsOwner.telemetry,
            getToolRegistry: () => registry,
            getExcludeTools: () => [],
            getSessionId: () => 'child',
            getTelemetryLogPromptsEnabled: () => false,
            readApprovalMode: () => ApprovalMode.DEFAULT,
            readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
            readGovernance: () => settingsOwner.readToolGovernance([]),
          },
        },
      );
      expect(stagesAtExecution).toStrictEqual([
        'awaiting_approval',
        'scheduled',
      ]);
      expect(result.flatMap((content) => content.blocks)).toContainEqual(
        expect.objectContaining({
          type: 'tool_response',
          callId: 'child-call',
          toolName: 'lookup',
        }),
      );
    } finally {
      unsubscribe();
      await history.dispose();
      await recorder.dispose();
      await config.dispose();
    }
  });
});
