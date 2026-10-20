/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import type {
  IContent,
  ChronologyTraceEntry,
} from '@vybestack/llxprt-code-core';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';

describe('session history operations', () => {
  const makeOwner = useCommandOwners();

  it('retains native tool, thought and chronology values across client replacement', async () => {
    const owner = await makeOwner('native-history');
    expect(owner.session.isHistoryInitialized()).toBe(false);
    await owner.session.replaceHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'read source' }],
        metadata: {
          turnId: 'native-human-7',
          chronology: {
            seq: 41,
            userTurn: 7,
            step: 1,
            recordedAt: 1700000000010,
          },
        },
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'inspect first',
            sourceField: 'reasoning_content',
          },
          {
            type: 'tool_call',
            id: 'read-1',
            name: 'read_file',
            parameters: { path: 'source.ts' },
          },
        ],
        metadata: {
          model: 'native-model',
          turnId: 'native-ai-7',
          chronology: {
            seq: 42,
            userTurn: 7,
            step: 2,
            recordedAt: 1700000000020,
          },
        },
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'read-1',
            toolName: 'read_file',
            result: { body: 'source body', lines: [1, 2] },
          },
        ],
        metadata: {
          turnId: 'native-tool-7',
          chronology: {
            seq: 43,
            userTurn: 7,
            step: 3,
            recordedAt: 1700000000030,
          },
        },
      },
    ]);
    const expectedSnapshot: {
      messages: IContent[];
      chronology: ChronologyTraceEntry[];
    } = {
      messages: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'read source' }],
          metadata: {
            turnId: 'native-human-7',
            chronology: {
              seq: 41,
              userTurn: 7,
              step: 1,
              recordedAt: 1700000000010,
            },
          },
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'inspect first',
              sourceField: 'reasoning_content',
            },
            {
              type: 'tool_call',
              id: 'read-1',
              name: 'read_file',
              parameters: { path: 'source.ts' },
            },
          ],
          metadata: {
            model: 'native-model',
            turnId: 'native-ai-7',
            chronology: {
              seq: 42,
              userTurn: 7,
              step: 2,
              recordedAt: 1700000000020,
            },
          },
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'read-1',
              toolName: 'read_file',
              result: { body: 'source body', lines: [1, 2] },
            },
          ],
          metadata: {
            turnId: 'native-tool-7',
            chronology: {
              seq: 43,
              userTurn: 7,
              step: 3,
              recordedAt: 1700000000030,
            },
          },
        },
      ],
      chronology: [
        {
          seq: 41,
          userTurn: 7,
          step: 1,
          recordedAt: 1700000000010,
          speaker: 'human',
          blockTypes: ['text'],
          toolCallIds: [],
          toolResponseIds: [],
          isSummary: false,
        },
        {
          seq: 42,
          userTurn: 7,
          step: 2,
          recordedAt: 1700000000020,
          speaker: 'ai',
          blockTypes: ['thinking', 'tool_call'],
          toolCallIds: ['read-1'],
          toolResponseIds: [],
          isSummary: false,
        },
        {
          seq: 43,
          userTurn: 7,
          step: 3,
          recordedAt: 1700000000030,
          speaker: 'tool',
          blockTypes: ['tool_response'],
          toolCallIds: [],
          toolResponseIds: ['read-1'],
          isSummary: false,
        },
      ],
    };
    expect(owner.session.isHistoryInitialized()).toBe(true);
    const before = owner.session.readHistorySnapshot();
    expect(before?.messages.map((item) => item.speaker)).toStrictEqual([
      'human',
      'ai',
      'tool',
    ]);
    expect(before?.messages[1].blocks.map((block) => block.type)).toStrictEqual(
      ['thinking', 'tool_call'],
    );
    expect(before?.messages[2].blocks).toContainEqual(
      expect.objectContaining({
        result: { body: 'source body', lines: [1, 2] },
      }),
    );
    expect(before?.chronology).toHaveLength(3);
    expect(before).toStrictEqual(expectedSnapshot);
    await owner.sessionClient.refreshAuth();
    const carried = await owner.session.getHistory();
    if (!before) throw new Error('Native history snapshot is missing');
    expect([...carried]).toStrictEqual(expectedSnapshot.messages);
    await owner.session.replaceHistory(carried);
    expect(owner.session.readHistorySnapshot()).toStrictEqual(expectedSnapshot);
  });

  it('follows new session history for tokens and detaches without disposing it', async () => {
    const owner = await makeOwner('history-observer');
    const counts: number[] = [];
    const stop = owner.session.subscribeHistoryTokens((count) =>
      counts.push(count),
    );
    await owner.session.replaceHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'source '.repeat(40) }],
      },
    ]);
    await sleep(250);
    expect(counts.some((count) => count > 0)).toBe(true);
    const populated = counts.at(-1);
    await owner.session.startNewSession();
    await sleep(150);
    expect(counts.at(-1)).toBeLessThan(populated ?? 0);
    expect(owner.session.readHistorySnapshot()?.messages).toStrictEqual([]);
    stop();
    const stopped = counts.length;
    await owner.session.replaceHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'after detach' }] },
    ]);
    await sleep(150);
    expect(counts).toHaveLength(stopped);
    expect(owner.session.readHistorySnapshot()?.messages).toHaveLength(1);
  });

  it('records native replacement once through the session recording owner', async () => {
    const owner = await makeOwner('history-recording');
    await owner.session.setRecording({ enabled: true });
    await owner.session.replaceHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'replacement body' }],
      },
    ]);
    await owner.session.flushRecording();
    const path = owner.session.getRecording().path;
    if (!path) throw new Error('Recording was not materialized');
    const events = (await readFile(path, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(
      events.filter((event) =>
        JSON.stringify(event).includes('replacement body'),
      ),
    ).toHaveLength(1);
  });
  it('records after replacing the active client without borrowing the retired history', async () => {
    const owner = await makeOwner('replacement-recording');
    await owner.session.replaceHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'seed before refresh' }],
      },
    ]);
    await owner.session.setRecording({ enabled: true });
    await owner.sessionClient.refreshAuth();
    await owner.session.replaceHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'body after refresh' }],
      },
    ]);
    await owner.session.flushRecording();
    const path = owner.session.getRecording().path;
    if (!path) throw new Error('Recording missing');
    expect(await readFile(path, 'utf8')).toContain('body after refresh');
  });
});
