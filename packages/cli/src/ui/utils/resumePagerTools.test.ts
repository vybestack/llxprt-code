/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordingService } from '@vybestack/llxprt-code-core';
import { createScrollbackPagerStore } from '../stores/turn/scrollbackPager.js';
import { ToolCallStatus } from '../types.js';

describe('resume cursor tool projection', () => {
  it('displays the paired response when a tool group is paged from the journal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'resume-pager-tools-'));
    const recording = new SessionRecordingService({
      chatsDir: root,
      sessionId: 'tools',
      projectHash: 'project',
      provider: 'test',
      model: 'test',
      workspaceDirs: [],
    });
    try {
      recording.recordContent({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'read-1',
            name: 'read_file',
            parameters: { path: 'example.ts' },
          },
        ],
      });
      recording.recordContent({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'read-1',
            toolName: 'read_file',
            result: 'file body',
          },
        ],
      });
      await recording.flush();
      const filePath = recording.getFilePath();
      if (filePath === null) throw new Error('Missing test journal');
      const pager = createScrollbackPagerStore({
        filePath,
        pageRows: 1,
        viewport: {
          visibleKeys: [],
          viewportLines: 5,
          rowHeightLines: () => 1,
        },
        settings: {
          marginViewports: 1,
          byteFloorBytes: 1024,
          purgeDebounceMs: 0,
        },
      });
      try {
        await pager.resumeFromJournal();
        const group = pager
          .getState()
          .rows.find((row) => row.item.type === 'tool_group')?.item;
        if (group?.type !== 'tool_group')
          throw new Error('Missing tool group display');
        expect(
          group.tools.map((tool) => [
            tool.callId,
            tool.status,
            tool.resultDisplay,
          ]),
        ).toStrictEqual([['read-1', ToolCallStatus.Success, 'file body']]);
      } finally {
        await pager.close();
      }
    } finally {
      await recording.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
