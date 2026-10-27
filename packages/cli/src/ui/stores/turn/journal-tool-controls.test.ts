/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-core';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { NativeJournalCursor } from './native-journal-cursor.js';
import { withJournalToolControls } from './journal-tool-controls.js';
import {
  ToolCallStatus,
  type HistoryItem,
  type IndividualToolCallDisplay,
} from '../../types.js';

describe('journal-positioned tool controls', () => {
  const directory = useTempDir('journal-controls-');

  async function withRequests(
    run: (items: HistoryItem[]) => Promise<void>,
  ): Promise<void> {
    const recording = createSessionRecorder({
      sessionId: 'controls',
      projectHash: 'controls',
      chatsDir: directory(),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    const history = new HistoryService();
    await history.attachJournal(recording, true);
    try {
      for (const id of ['first-attempt', 'second-attempt']) {
        const arrival = await history.openResponseArrival({
          id,
          submissionId: 'submission',
        });
        await arrival.append({
          type: 'tool_call',
          id: 'reused-call',
          name: 'lookup',
          parameters: { query: id },
        });
        await arrival.seal({});
      }
      const path = history.journalPath();
      if (path === null) throw new Error('Missing journal');
      const cursor = await NativeJournalCursor.open(path, {}, 16);
      try {
        const entries = (await cursor.pageBack(16)).entries;
        await run(
          entries.flatMap((entry) =>
            entry.kind === 'projected' ? [entry.item] : [],
          ),
        );
      } finally {
        await cursor.close();
      }
    } finally {
      await history.dispose();
      await recording.dispose();
    }
  }

  it('binds approval only to the exact journal request, even when call ids repeat', async () => {
    await withRequests(async (items) => {
      const groups = items.filter((item) => item.type === 'tool_group');
      expect(groups).toHaveLength(2);
      const active = groups.find(
        (item) => item.tools[0].journalIdentity?.attemptId === 'second-attempt',
      );
      if (active?.type !== 'tool_group')
        throw new Error('Missing exact request identity');
      let decision: ToolConfirmationOutcome | undefined;
      const control: IndividualToolCallDisplay = {
        ...active.tools[0],
        status: ToolCallStatus.Confirming,
        name: 'must not replace journal tool name',
        description: 'must not replace journal parameters',
        resultDisplay: 'must not enter the journal window',
        confirmationDetails: {
          type: 'info',
          title: 'Approve lookup',
          prompt: 'Run lookup?',
          onConfirm: async (outcome) => {
            decision = outcome;
          },
        },
      };
      const overlaid = groups.map((item) =>
        withJournalToolControls(item, [
          { type: 'tool_group', tools: [control] },
        ]),
      );
      const confirming = overlaid.flatMap((item) =>
        item.tools.filter((tool) => tool.status === ToolCallStatus.Confirming),
      );
      expect(confirming).toHaveLength(1);
      expect(confirming[0].name).toBe('lookup');
      expect(confirming[0].description).not.toBe(control.description);
      expect(confirming[0].resultDisplay).not.toBe(control.resultDisplay);
      await confirming[0].confirmationDetails?.onConfirm(
        ToolConfirmationOutcome.ProceedAlways,
      );
      expect(decision).toBe(ToolConfirmationOutcome.ProceedAlways);
      expect(
        withJournalToolControls(active, []).tools[0].confirmationDetails,
      ).toBeUndefined();
      const identity = active.tools[0].journalIdentity;
      if (identity === undefined) throw new Error('Missing request identity');
      const mismatched = {
        ...control,
        journalIdentity: { ...identity, attemptId: 'wrong-attempt' },
      };
      expect(
        withJournalToolControls(active, [
          { type: 'tool_group', tools: [mismatched] },
        ]).tools[0].confirmationDetails,
      ).toBeUndefined();
      const terminal = { ...control, status: ToolCallStatus.Success };
      expect(
        withJournalToolControls(active, [
          { type: 'tool_group', tools: [terminal] },
        ]).tools[0].confirmationDetails,
      ).toBeUndefined();
    });
  });
});
