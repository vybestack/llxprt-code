/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { replaySession, replaySessionThroughSequence } from './ReplayEngine.js';
import { replaySession as eagerReplay } from './eager-replay.test.helpers.js';
import { JournalResolver } from './journalResolver.js';
import {
  assertReplayOk,
  PROJECT_HASH,
  sessionStartLine,
} from './replay-test-helpers.js';
import type { IContent } from '../services/history/IContent.js';

let dir: string;
describe('production replay unification', () => {
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-unify-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it(
    'replays every interleaved mutation prefix against explicit rows and independent eager fold',
    replayMutationPrefixes,
  );

  it(
    'preserves raw live response markers and binding chronology while replay strips resume markers',
    preserveRawMarkers,
  );

  it(
    'keeps complete unterminated legacy rows and exact corruption diagnostics',
    preserveLegacyDiagnostics,
  );

  it(
    'matches an independent eager fold across seeded mutation journals',
    replaySeededMutations,
  );

  it(
    'preserves byte watermarks and inclusive sequence cutoffs without processing later invalid versions',
    respectReplayWatermarks,
  );
});

function row(text: string, seq: number): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: {
      chronology: { seq, userTurn: 1, step: seq, recordedAt: 0 },
      responsesStored: true,
      id: `response-${text}`,
    },
  };
}

function event(seq: number, type: string, payload: unknown): string {
  return JSON.stringify({
    v: 2,
    seq,
    ts: '2026-09-21T00:00:00Z',
    type,
    payload,
  });
}

function texts(rows: readonly IContent[]): string[] {
  return rows.map((r) =>
    r.blocks.map((b) => (b.type === 'text' ? b.text : '')).join(''),
  );
}

function mutationLines(): string[] {
  return [
    sessionStartLine(1),
    event(2, 'content', { content: row('A', 1) }),
    event(3, 'content', { content: row('B', 2) }),
    event(4, 'chronology_bind', {
      rowIndex: 0,
      chronology: { seq: 10, userTurn: 2, step: 3, recordedAt: 4 },
      invalidateResponses: true,
      content: row('admitted A', 1),
    }),
    event(5, 'synthetic_insert', {
      afterSeq: 10,
      chronologySeq: 11,
      content: row('synthetic', 11),
    }),
    event(6, 'density_mutation', {
      removedSeqs: [2],
      replacements: [{ replacedSeq: 10, replacement: row('dense A', 999) }],
    }),
    event(7, 'content', { content: row('C', 12) }),
    event(8, 'rewind', { itemsRemoved: 99, cutSeq: 12 }),
    event(9, 'semantic_media_purge', {
      history: [row('purged A', 10), row('purged synthetic', 11)],
      frontier: { contentIndex: 1, blockIndex: 0 },
    }),
    event(10, 'density_mutation', {
      removedSeqs: [],
      replacements: [
        { replacedSeq: 11, replacement: row('dense synthetic', 99) },
      ],
    }),
    event(11, 'rewind', { itemsRemoved: 1 }),
    event(12, 'compressed', {
      summary: row('summary', 20),
      itemsCompressed: 1,
    }),
    event(13, 'compression_detail', {
      fromSeq: 10,
      toSeq: 11,
      itemsCompressed: 1,
    }),
    event(14, 'content', { content: row('head', 21) }),
    event(15, 'synthetic_insert', {
      afterSeq: 20,
      chronologySeq: 22,
      content: row('inserted head', 22),
    }),
    event(16, 'rewind', { itemsRemoved: 99, cutSeq: 21 }),
  ];
}

const expectedTexts = [
  [],
  ['A'],
  ['A', 'B'],
  ['admitted A', 'B'],
  ['admitted A', 'synthetic', 'B'],
  ['dense A', 'synthetic'],
  ['dense A', 'synthetic', 'C'],
  ['dense A', 'synthetic'],
  ['purged A', 'purged synthetic'],
  ['purged A', 'dense synthetic'],
  ['purged A'],
  ['summary'],
  ['summary'],
  ['summary', 'head'],
  ['summary', 'inserted head', 'head'],
  ['summary', 'inserted head'],
];

async function replayMutationPrefixes(): Promise<void> {
  const file = path.join(dir, 'session.jsonl');
  const lines = mutationLines();
  await fs.writeFile(file, lines.join('\n') + '\n');
  for (let count = 1; count <= lines.length; count++) {
    const prefix = path.join(dir, 'prefix.jsonl');
    await fs.writeFile(prefix, lines.slice(0, count).join('\n') + '\n');
    const replay = await replaySessionThroughSequence(
      file,
      PROJECT_HASH,
      count,
    );
    const raw = await replaySession(prefix, PROJECT_HASH);
    const oracle = await eagerReplay(prefix, PROJECT_HASH);
    assertReplayOk(replay);
    assertReplayOk(raw);
    assertReplayOk(oracle);
    expect(texts(replay.history)).toStrictEqual(expectedTexts[count - 1]);
    expect(replay.history).toStrictEqual(raw.history);
    expect(replay.history).toStrictEqual(oracle.history);
    expect(replay.warnings).toStrictEqual([]);
  }
}

async function preserveRawMarkers(): Promise<void> {
  const file = path.join(dir, 'session.jsonl');
  await fs.writeFile(file, mutationLines().slice(0, 6).join('\n') + '\n');
  const resolver = await JournalResolver.open(file);
  const rows: IContent[] = [];
  try {
    for await (const entry of resolver.resolve()) rows.push(entry.content);
  } finally {
    await resolver.close();
  }
  expect(texts(rows)).toStrictEqual(['dense A', 'synthetic']);
  expect(rows[0].metadata?.chronology).toStrictEqual({
    seq: 10,
    userTurn: 2,
    step: 3,
    recordedAt: 4,
  });
  expect(rows.map((r) => r.metadata?.responsesStored)).toStrictEqual([
    true,
    true,
  ]);
  const replay = await replaySession(file, PROJECT_HASH);
  assertReplayOk(replay);
  expect(replay.history.map((r) => r.metadata?.responsesStored)).toStrictEqual([
    undefined,
    undefined,
  ]);
}

async function preserveLegacyDiagnostics(): Promise<void> {
  const file = path.join(dir, 'session.jsonl');
  const lines = [
    sessionStartLine(1),
    '{broken',
    event(2, 'content', { content: row('A', 1) }),
    event(2, 'rewind', { itemsRemoved: 0, cutSeq: 'bad' }),
    event(3, 'content', { content: { speaker: 'invalid', blocks: [] } }),
    event(4, 'unknown', {}),
    event(5, 'content', { content: row('tail', 2) }),
  ];
  await fs.writeFile(file, lines.join('\n'));
  const replay = await replaySession(file, PROJECT_HASH);
  const oracle = await eagerReplay(file, PROJECT_HASH);
  expect(replay).toStrictEqual(oracle);
  assertReplayOk(replay);
  expect(texts(replay.history)).toStrictEqual(['A', 'tail']);
  expect(replay.sequenceCorrupt).toBe(true);
  expect(replay.warnings).toContain('Line 2: failed to parse JSON');
}

async function replaySeededMutations(): Promise<void> {
  for (const seed of [7, 31, 854, 2026]) {
    const file = path.join(dir, `seed-${seed}.jsonl`);
    const lines = [sessionStartLine(1)];
    let random = seed;
    for (let index = 0; index < 48; index++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const seq = index + 2;
      const choice = random % 7;
      if (choice === 0)
        lines.push(event(seq, 'rewind', { itemsRemoved: random % 3 }));
      else if (choice === 1)
        lines.push(
          event(seq, 'compressed', {
            summary: row(`summary-${index}`, index),
            itemsCompressed: index,
          }),
        );
      else if (choice === 2)
        lines.push(
          event(seq, 'semantic_media_purge', {
            history: [row(`purge-${index}`, index)],
            frontier: { contentIndex: 0, blockIndex: 0 },
          }),
        );
      else if (choice === 3)
        lines.push(
          event(seq, 'density_mutation', {
            removedSeqs: [index - 1],
            replacements: [
              {
                replacedSeq: index - 2,
                replacement: row(`dense-${index}`, index),
              },
            ],
          }),
        );
      else if (choice === 4)
        lines.push(
          event(seq, 'synthetic_insert', {
            afterSeq: index - 1,
            chronologySeq: index,
            content: row(`insert-${index}`, index),
          }),
        );
      else if (choice === 5)
        lines.push(
          event(seq, 'chronology_bind', {
            rowIndex: 0,
            chronology: { seq: index, userTurn: 1, step: index, recordedAt: 0 },
          }),
        );
      else
        lines.push(
          event(seq, 'content', { content: row(`append-${index}`, index) }),
        );
      await fs.writeFile(file, lines.join('\n') + '\n');
      expect(await replaySession(file, PROJECT_HASH)).toStrictEqual(
        await eagerReplay(file, PROJECT_HASH),
      );
    }
  }
}

async function respectReplayWatermarks(): Promise<void> {
  const file = path.join(dir, 'watermark.jsonl');
  const prefix = mutationLines().slice(0, 6).join('\n') + '\n';
  await fs.writeFile(file, prefix);
  await fs.appendFile(
    file,
    JSON.stringify({ v: 99, seq: 7, type: 'content', payload: {} }) + '\n',
  );
  const resolver = await JournalResolver.open(file, {
    maxBytes: Buffer.byteLength(prefix),
    chunkBytes: 7,
  });
  const actual: string[] = [];
  try {
    for await (const entry of resolver.resolve())
      actual.push(...texts([entry.content]));
  } finally {
    await resolver.close();
  }
  expect(actual).toStrictEqual(['dense A', 'synthetic']);
  const replay = await replaySessionThroughSequence(file, PROJECT_HASH, 6);
  assertReplayOk(replay);
  expect(texts(replay.history)).toStrictEqual(['dense A', 'synthetic']);
  expect(replay.lastSeq).toBe(6);
  expect(replay.warnings).toStrictEqual([]);
  const rejected = await replaySession(file, PROJECT_HASH);
  expect(rejected).toMatchObject({
    ok: false,
    error: 'Unsupported recording version 99 at line 7',
  });
}
