/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { withTestNamedWriters } from '../../packages/core/src/journal/__tests__/support/namedWriterOwner.js';
import { JournalRecordingService } from '../../packages/core/src/recording/journalRecordingService.js';
import type { RefusalPayload } from '../../packages/core/src/recording/refusalPayload.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import {
  hasRecoveryContent,
  readJournalIndex,
} from '../lib/refusal-survey-journal-index.ts';

const temporaryDirectories: string[] = [];
const services: JournalRecordingService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

const REFUSAL_TIME = Date.parse('2026-11-02T10:00:00.000Z');

const REFUSAL: RefusalPayload = {
  time: new Date(REFUSAL_TIME).toISOString(),
  provider: 'anthropic',
  model: 'claude-test',
  promptId: 'prompt-1',
  turnId: null,
  attemptIndex: 1,
  finishReason: 'refusal',
  action: 'stop',
};

function row(
  speaker: IContent['speaker'],
  text: string,
  promptId: string,
  seq: number,
  recordedAt: number,
): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
    metadata: {
      promptId,
      chronology: { seq, userTurn: 1, step: seq, recordedAt },
    },
  };
}

async function recordSession(
  before: readonly IContent[],
  after: readonly IContent[],
): Promise<string> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'refusal-survey-journal-'),
  );
  temporaryDirectories.push(root);
  const service = JournalRecordingService.create(
    withTestNamedWriters({
      sessionId: 'journal-session',
      projectHash: 'journal-project',
      chatsDir: path.join(root, 'chats'),
      workspaceDirs: [],
      provider: 'anthropic',
      model: 'claude-test',
    }),
  );
  services.push(service);
  const session = await service.session();
  await session.append([...before]);
  service.recordRefusal(REFUSAL);
  await service.flush();
  await session.append([...after]);
  await service.dispose();
  services.splice(services.indexOf(service), 1);
  return root;
}

describe('refusal survey journal reader', () => {
  it('keeps unrelated later prompts from proving recovery when old identity is missing', async () => {
    const root = await recordSession(
      [],
      [
        row(
          'ai',
          'unrelated prompt B response',
          'prompt-2',
          1,
          REFUSAL_TIME + 1_000,
        ),
      ],
    );
    const journal = await readJournalIndex(root, { count: 0, examples: [] });

    expect(hasRecoveryContent(journal, 'prompt-1', 1)).toBeUndefined();
    expect(hasRecoveryContent(journal, 'prompt-1', 0)).toBe(false);
    expect(hasRecoveryContent(journal, 'another-prompt', 1)).toBe(false);
  });

  it('reads the refusal from the state map and orders it by row chronology', async () => {
    const malformed = { count: 0, examples: [] };
    const root = await recordSession(
      [
        row('human', 'refused question', 'prompt-1', 1, REFUSAL_TIME - 2_000),
        row('ai', 'same millisecond', 'prompt-1', 2, REFUSAL_TIME),
      ],
      [
        row('ai', 'recovered answer', 'prompt-1', 3, REFUSAL_TIME + 60_000),
        row('ai', 'much later', 'prompt-1', 4, REFUSAL_TIME + 10 * 60_000),
      ],
    );
    const journal = await readJournalIndex(root, malformed);

    expect(malformed).toStrictEqual({ count: 0, examples: [] });
    expect(
      journal.map((record) => [
        record.seq,
        record.type,
        record.ts,
        record.session,
        record.type === 'content'
          ? record.payload['content']
          : record.payload['prompt_id'],
      ]),
    ).toStrictEqual([
      [0, 'session_start', expect.any(String), 'journal-session', undefined],
      [
        1,
        'content',
        new Date(REFUSAL_TIME - 2_000).toISOString(),
        'journal-session',
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'refused question' }],
        },
      ],
      [
        2,
        'content',
        REFUSAL.time,
        'journal-session',
        { speaker: 'ai', blocks: [{ type: 'text', text: 'same millisecond' }] },
      ],
      [3, 'refusal', REFUSAL.time, 'journal-session', 'prompt-1'],
      [
        4,
        'content',
        new Date(REFUSAL_TIME + 60_000).toISOString(),
        'journal-session',
        { speaker: 'ai', blocks: [{ type: 'text', text: 'recovered answer' }] },
      ],
      [
        5,
        'content',
        new Date(REFUSAL_TIME + 10 * 60_000).toISOString(),
        'journal-session',
        { speaker: 'ai', blocks: [{ type: 'text', text: 'much later' }] },
      ],
    ]);
    const refusal = journal.find((record) => record.type === 'refusal');
    expect(refusal?.payload['attempt_index']).toBe(1);
    expect(journal[1]?.payload['prompt_id']).toBe('prompt-1');
  });
});
