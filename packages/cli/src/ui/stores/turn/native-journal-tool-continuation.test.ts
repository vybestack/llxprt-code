/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import {
  buildAgent,
  drain,
} from '../../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { ToolCallStatus } from '../../types.js';
import { NativeJournalCursor } from './native-journal-cursor.js';

describe('journal tool continuation', () => {
  it('joins a tool response across its persisted display presentation', async () => {
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl', {
      approvalMode: ApprovalMode.YOLO,
      workingDir: process.cwd(),
    });
    try {
      await agent.session.setRecording({ enabled: true });
      await drain(agent.stream('read the package file'));
      const history = agent.agentClient.getHistoryService();
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
