import { buildCapturedAgent } from '../../../__tests__/captured-agent-fixture.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { ApprovalMode, JournalSession } from '@vybestack/llxprt-code-core';
import { join } from 'node:path';
import { JournalArrivalRecorder } from '@vybestack/llxprt-code-core/journal/arrival-recorder.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { drain } from '../../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { ToolCallStatus } from '../../types.js';
import { NativeJournalCursor } from './native-journal-cursor.js';

describe('journal tool continuation', () => {
  const directory = useTempDir('journal-final-text-');
  it('leaves an unopened text payload unprinted and projects the completed answer', async () => {
    const session = await JournalSession.create(
      join(directory(), 'final.llxj'),
    );
    const recorder = new JournalArrivalRecorder(session.store);
    try {
      const row = await recorder.beginRow(
        encodeContentRow({ speaker: 'ai', blocks: [] }, { owner: 0 }),
        { id: 'final', submissionId: 'parallel-tools' },
      );
      const block = await recorder.beginNamedBlock(row, 0);
      const opening = await NativeJournalCursor.open(session.path, {}, 16);
      try {
        expect((await opening.pageBack(16)).entries).toStrictEqual([]);
      } finally {
        await opening.close();
      }
      await recorder.appendTextDelta(block, 'RENDER_FINAL: complete.');
      await recorder.endBlock(block);
      await recorder.sealRow(row);
      const completed = await NativeJournalCursor.open(session.path, {}, 16);
      try {
        const page = await completed.pageBack(16);
        expect(
          page.entries.flatMap((entry) =>
            entry.kind === 'projected' ? [entry.item.text] : [],
          ),
        ).toStrictEqual(['RENDER_FINAL: complete.']);
      } finally {
        await completed.close();
      }
    } finally {
      await recorder.close();
      await session.close();
    }
  });
  it('joins a tool response across its persisted display presentation', async () => {
    const { agent, client, cleanup } = await buildCapturedAgent(
      'tool-call-then-answer.jsonl',
      {
        approvalMode: ApprovalMode.YOLO,
        workingDir: process.cwd(),
      },
    );
    try {
      await agent.session.setRecording({ enabled: true });
      await drain(agent.stream('read the package file'));
      const history = client.getHistoryService();
      if (history === null) throw new Error('Missing history');
      await history.waitForCommit();
      const path = history.journalPath();
      if (path === null) throw new Error('Missing journal');
      const cursor = await NativeJournalCursor.open(path, {}, 16);
      try {
        const page = await cursor.pageBack(16);
        const tools = page.entries.flatMap((entry) =>
          entry.kind === 'projected' && entry.item.type === 'tool_group'
            ? entry.item.tools
            : [],
        );
        expect(tools.map((tool) => tool.callId)).toStrictEqual(['call-tool-1']);
        expect(tools[0]?.status).toBe(ToolCallStatus.Success);
        expect(
          page.entries.some(
            (entry) =>
              entry.kind === 'projected' &&
              typeof entry.item.text === 'string' &&
              entry.item.text.includes('after the tool ran'),
          ),
        ).toBe(true);
      } finally {
        await cursor.close();
      }
    } finally {
      await cleanup();
    }
  });
});
