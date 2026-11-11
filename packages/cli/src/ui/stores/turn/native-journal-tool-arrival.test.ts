/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  JournalSession,
  NativeJournalPageReader,
} from '@vybestack/llxprt-code-core';
import { JournalArrivalRecorder } from '@vybestack/llxprt-code-core/journal/arrival-recorder.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { ROW_BLOCK_TYPE } from '@vybestack/llxprt-code-core/journal/rowRecord.js';
import { ToolCallStatus } from '../../types.js';
import {
  createScrollbackPagerStore,
  type ScrollbackPagerStore,
} from './scrollbackPager.js';

function pager(filePath: string): ScrollbackPagerStore {
  return createScrollbackPagerStore({
    filePath,
    orphanBeforeTranscriptId: 0n,
    viewport: { visibleKeys: [], viewportLines: 10, rowHeightLines: () => 1 },
    pageRows: 16,
    settings: {
      marginViewports: 0,
      byteFloorBytes: Infinity,
      purgeDebounceMs: 0,
    },
  });
}

async function expectVisibleCalls(file: string, ids: string[]): Promise<void> {
  const reader = await NativeJournalPageReader.open(file);
  try {
    const entry = await reader.entryAt(reader.rows - 1);
    expect(await reader.callIds(entry)).toStrictEqual(ids);
    const content = await reader.readToolPage(entry, 0, 16);
    expect(
      content.blocks
        .filter((block) => block.type === 'tool_call')
        .map((block) => block.id),
    ).toStrictEqual(ids);
  } finally {
    await reader.close();
  }
  const store = pager(file);
  try {
    await store.resumeFromJournal();
    const tools = store
      .getState()
      .rows.flatMap((row) =>
        row.item.type === 'tool_group' ? row.item.tools : [],
      );
    expect(tools.map((tool) => tool.callId)).toStrictEqual(ids);
    expect(tools.every((tool) => tool.status === ToolCallStatus.Pending)).toBe(
      true,
    );
    expect(
      store.getState().rows.some((row) => row.item.text === 'Approval request'),
    ).toBe(true);
    expect(store.getState().error).toBeNull();
  } finally {
    await store.close();
  }
}

describe('transcript opening during tool arrival', () => {
  const directory = useTempDir('native-tool-arrival-');

  it('defers an unfinished tool response without losing the completed result', async () => {
    const session = await JournalSession.create(
      join(directory(), 'response.llxj'),
    );
    const recorder = new JournalArrivalRecorder(session.store);
    try {
      const row = await recorder.beginRow(
        encodeContentRow({ speaker: 'tool', blocks: [] }, { owner: 0 }),
        { id: 'response', submissionId: 'request' },
      );
      const block = await recorder.beginBlock(
        row,
        ROW_BLOCK_TYPE.tool_response,
      );
      const partial = await NativeJournalPageReader.open(session.path);
      try {
        const entry = await partial.entryAt(0);
        expect(await partial.responseIds(entry)).toStrictEqual([]);
        expect((await partial.readToolPage(entry, 0, 16)).blocks).toStrictEqual(
          [],
        );
      } finally {
        await partial.close();
      }
      await recorder.appendField(
        block,
        new TextEncoder().encode(
          JSON.stringify({
            type: 'tool_response',
            callId: 'skill',
            toolName: 'activate_skill',
            result: 'activated',
          }),
        ),
      );
      await recorder.endBlock(block);
      await recorder.sealRow(row);
      const complete = await NativeJournalPageReader.open(session.path);
      try {
        const entry = await complete.entryAt(0);
        expect(await complete.responseIds(entry)).toStrictEqual(['skill']);
        expect(
          (await complete.readToolPage(entry, 0, 16)).blocks,
        ).toStrictEqual([
          {
            type: 'tool_response',
            callId: 'skill',
            toolName: 'activate_skill',
            result: 'activated',
          },
        ]);
      } finally {
        await complete.close();
      }
    } finally {
      await recorder.close();
      await session.close();
    }
  });

  for (const named of [false, true]) {
    it(`defers unfinished tool blocks and publishes completed calls (named=${named})`, async () => {
      const session = await JournalSession.create(
        join(directory(), `${named}.llxj`),
      );
      const recorder = new JournalArrivalRecorder(session.store);
      try {
        await session.append([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Approval request' }],
          },
        ]);
        const row = await recorder.beginRow(
          encodeContentRow({ speaker: 'ai', blocks: [] }, { owner: 0 }),
          { id: 'attempt', submissionId: 'request' },
        );
        const first = await recorder.beginBlock(row, ROW_BLOCK_TYPE.tool_call);
        await expectVisibleCalls(session.path, []);
        await recorder.appendField(
          first,
          new TextEncoder().encode(
            JSON.stringify({
              type: 'tool_call',
              id: 'first',
              name: 'lookup',
              parameters: {},
            }),
          ),
        );
        await recorder.endBlock(first);
        await expectVisibleCalls(session.path, ['first']);
        const block = named
          ? await recorder.beginNamedBlock(row, ROW_BLOCK_TYPE.tool_call)
          : await recorder.beginBlock(row, ROW_BLOCK_TYPE.tool_call);
        await expectVisibleCalls(session.path, ['first']);
        if (named) {
          await recorder.appendText(block, 'id', 'skill');
          await recorder.flush();
          await expectVisibleCalls(session.path, ['first']);
          await recorder.appendText(block, 'name', 'activate_skill');
          await recorder.appendText(block, 'parameters', '{"name":');
          await recorder.flush();
          await expectVisibleCalls(session.path, ['first']);
          await recorder.appendText(block, 'parameters', '"pr-creator"}');
        } else {
          await recorder.appendField(
            block,
            new TextEncoder().encode('{"type":"tool_call","id":"skill",'),
          );
          await recorder.flush();
          await expectVisibleCalls(session.path, ['first']);
          await recorder.appendField(
            block,
            new TextEncoder().encode(
              '"name":"activate_skill","parameters":{"name":"pr-creator"}}',
            ),
          );
        }
        await recorder.flush();
        await expectVisibleCalls(session.path, ['first']);
        const live = pager(session.path);
        try {
          await live.resumeFromJournal();
          await recorder.endBlock(block);
          await recorder.sealRow(row);
          await live.pageForward();
          const calls = live
            .getState()
            .rows.flatMap((row) =>
              row.item.type === 'tool_group' ? row.item.tools : [],
            );
          expect(calls.map((tool) => tool.callId)).toStrictEqual([
            'first',
            'skill',
          ]);
          expect(calls.map((tool) => tool.status)).toStrictEqual([
            ToolCallStatus.Pending,
            ToolCallStatus.Pending,
          ]);
          expect(live.getState().error).toBeNull();
        } finally {
          await live.close();
        }
        await expectVisibleCalls(session.path, ['first', 'skill']);
      } finally {
        await recorder.close();
        await session.close();
      }
    });
  }
});
