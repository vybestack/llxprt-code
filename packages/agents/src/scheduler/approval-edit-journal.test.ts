/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import * as editor from '@vybestack/llxprt-code-tools/utils/editor.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { NativeJournalPageReader } from '@vybestack/llxprt-code-core/journal/native-journal-page-reader.js';
import type { ApprovalLifecycleRecord } from '@vybestack/llxprt-code-core/scheduler/approval-lifecycle.js';
import type { WaitingToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import {
  ToolConfirmationOutcome,
  type ModifyContext,
} from '@vybestack/llxprt-code-tools';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { persistApprovalLifecycle } from '../core/agenticLoop/approvalLifecycleRecording.js';
import { ConfirmationCoordinator } from './confirmation-coordinator.js';
import {
  makeMessageBus,
  makeMockConfig,
  makeStatusMutator,
  makeEditorCallbacks,
} from './__tests__/confirmation-coordinator-test-helpers.js';

class EditableTool extends MockTool {
  getModifyContext(): ModifyContext<Record<string, unknown>> {
    return {
      getFilePath: () => '/journal-edit.txt',
      getCurrentContent: async () => 'before',
      getProposedContent: async (params) => String(params.content),
      createUpdatedParams: (_old, content, params) => ({ ...params, content }),
    };
  }
}

function waitingCall(): WaitingToolCall {
  const tool = new EditableTool('edit');
  const args = { content: 'proposed' };
  return {
    status: 'awaiting_approval',
    request: {
      callId: 'edit-call',
      name: 'edit',
      args,
      isClientInitiated: false,
      prompt_id: 'prompt',
      journalIdentity: { attemptId: 'edit-attempt', transcriptId: '1' },
    },
    tool,
    invocation: tool.build(args),
    confirmationDetails: {
      type: 'edit',
      title: 'Edit file',
      fileName: 'journal-edit.txt',
      filePath: '/journal-edit.txt',
      fileDiff: 'old diff',
      originalContent: 'before',
      newContent: 'proposed',
      onConfirm: async () => {},
    },
  };
}

async function journal(directory: string) {
  const history = new HistoryService();
  const recording = createSessionRecorder({
    sessionId: 'edit',
    projectHash: 'edit',
    chatsDir: directory,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  await history.attachJournal(recording, true);
  return {
    history,
    close: async (): Promise<void> => {
      await history.dispose();
      await recording.dispose();
    },
  };
}

async function storedApprovals(history: HistoryService): Promise<unknown[]> {
  const path = history.journalPath();
  if (path === null) throw new Error('Missing journal');
  const reader = await NativeJournalPageReader.open(path);
  try {
    const records: unknown[] = [];
    for await (const row of reader.entries()) {
      const presentation = await reader.presentation(row);
      if (presentation?.descriptor.type !== 'tool-approval') continue;
      const content = await reader.readContent(row);
      records.push(
        JSON.parse(
          content.blocks
            .flatMap((block) => (block.type === 'text' ? [block.text] : []))
            .join(''),
        ),
      );
    }
    return records;
  } finally {
    await reader.close();
  }
}

function coordinatorFor(
  call: WaitingToolCall,
  persistApproval: (record: ApprovalLifecycleRecord) => Promise<void>,
  onArgs: (args: unknown) => void,
  onDetails: (details: WaitingToolCall['confirmationDetails']) => void,
  onScheduled: () => void,
  editorCallbacks = makeEditorCallbacks(),
): ConfirmationCoordinator {
  return new ConfirmationCoordinator(
    makeMessageBus(),
    makeMockConfig(),
    {
      ...makeStatusMutator(),
      setArgs: (_id, args) => onArgs(args),
      setAwaitingApproval: (_id, details) => onDetails(details),
      setScheduled: onScheduled,
    },
    {
      getToolCalls: () => [call],
      getHookOwner: () => undefined,
      attemptExecution: async () => {},
      persistApproval,
    },
    editorCallbacks,
    async () => {},
  );
}

describe('edited approval journal ordering', () => {
  const directory = useTempDir('approval-edit-journal-');
  it('persists editor-produced arguments and diff before publishing the refreshed request', async () => {
    const session = await journal(directory());
    const call = waitingCall();
    const editorBoundary = vi
      .spyOn(editor, 'openDiff')
      .mockImplementation(async (_oldPath, newPath) => {
        await writeFile(newPath, 'editor accepted');
      });
    let durable: ApprovalLifecycleRecord | undefined;
    let published = 0;
    const coordinator = coordinatorFor(
      call,
      async (record) => {
        await persistApprovalLifecycle(record, session.history);
        durable = record;
      },
      (args) => {
        expect(args).toStrictEqual(durable?.request.args);
        expect(durable?.details).toMatchObject({
          newContent: 'editor accepted',
        });
        published++;
      },
      (details) => {
        if (details.type !== 'edit' || details.fileDiff === 'old diff') return;
        expect(durable?.details).toMatchObject({ fileDiff: details.fileDiff });
        published++;
      },
      () => {
        throw new Error('Editor result must be reconfirmed');
      },
      {
        getPreferredEditor: () => 'vscode',
        onEditorClose: () => {},
      },
    );
    try {
      await coordinator.handleConfirmationResponse(
        call.request.callId,
        async () => {},
        ToolConfirmationOutcome.ModifyWithEditor,
        new AbortController().signal,
      );
      expect(published).toBe(2);
      const rows = await storedApprovals(session.history);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        request: { args: { content: 'editor accepted' } },
        details: { newContent: 'editor accepted' },
        status: 'awaiting_approval',
      });
    } finally {
      editorBoundary.mockRestore();
      coordinator.dispose();
      await session.close();
    }
  });

  it('persists refreshed inline arguments and presentation before publishing either', async () => {
    const session = await journal(directory());
    const call = waitingCall();
    let durable: ApprovalLifecycleRecord | undefined;
    let published = 0;
    let scheduled = 0;
    const coordinator = coordinatorFor(
      call,
      async (record) => {
        await persistApprovalLifecycle(record, session.history);
        durable = record;
      },
      (args) => {
        expect(args).toStrictEqual(durable?.request.args);
        expect(durable?.request.args).toMatchObject({ content: 'accepted' });
        published++;
      },
      (details) => {
        expect(durable?.details).toMatchObject({
          fileDiff: details.type === 'edit' ? details.fileDiff : '',
          newContent: 'accepted',
        });
        published++;
      },
      () => {
        scheduled++;
      },
    );
    try {
      await coordinator.handleConfirmationResponse(
        call.request.callId,
        async () => {},
        ToolConfirmationOutcome.ProceedOnce,
        new AbortController().signal,
        { newContent: 'accepted' },
      );
      expect(published).toBe(2);
      expect(scheduled).toBe(1);
      const rows = await storedApprovals(session.history);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        request: { args: { content: 'accepted' } },
        details: { originalContent: 'before', newContent: 'accepted' },
        status: 'scheduled',
      });
    } finally {
      coordinator.dispose();
      await session.close();
    }
  });

  it('does not publish edited arguments or schedule when their refreshed journal write fails', async () => {
    const session = await journal(directory());
    const call = waitingCall();
    let writes = 0;
    let publications = 0;
    let scheduled = 0;
    const coordinator = coordinatorFor(
      call,
      async (record) => {
        if (++writes === 2) throw new Error('edited approval disk failed');
        await persistApprovalLifecycle(record, session.history);
      },
      () => {
        publications++;
      },
      () => {
        publications++;
      },
      () => {
        scheduled++;
      },
    );
    try {
      await expect(
        coordinator.handleConfirmationResponse(
          call.request.callId,
          async () => {},
          ToolConfirmationOutcome.ProceedOnce,
          new AbortController().signal,
          { newContent: 'accepted' },
        ),
      ).rejects.toThrow('edited approval disk failed');
      expect(publications).toBe(0);
      expect(scheduled).toBe(0);
      expect(await storedApprovals(session.history)).toHaveLength(1);
    } finally {
      coordinator.dispose();
      await session.close();
    }
  });
  it('keeps editor-produced arguments private when the refreshed journal write fails', async () => {
    const session = await journal(directory());
    const call = waitingCall();
    const editorBoundary = vi
      .spyOn(editor, 'openDiff')
      .mockImplementation(async (_oldPath, newPath) => {
        await writeFile(newPath, 'editor accepted');
      });
    let writes = 0;
    let publications = 0;
    const coordinator = coordinatorFor(
      call,
      async (record) => {
        if (++writes === 2) throw new Error('edited approval disk failed');
        await persistApprovalLifecycle(record, session.history);
      },
      () => {
        publications++;
      },
      (details) => {
        if (details.type === 'edit' && details.fileDiff !== 'old diff')
          publications++;
      },
      () => {
        throw new Error('Unpersisted edit scheduled');
      },
      {
        getPreferredEditor: () => 'vscode',
        onEditorClose: () => {},
      },
    );
    try {
      await expect(
        coordinator.handleConfirmationResponse(
          call.request.callId,
          async () => {},
          ToolConfirmationOutcome.ModifyWithEditor,
          new AbortController().signal,
        ),
      ).rejects.toThrow('edited approval disk failed');
      expect(publications).toBe(0);
      expect(await storedApprovals(session.history)).toHaveLength(1);
    } finally {
      editorBoundary.mockRestore();
      coordinator.dispose();
      await session.close();
    }
  });
});
