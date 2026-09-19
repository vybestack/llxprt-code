/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20260917-ISSUE854.P02
 * @requirement G2
 *
 * Behavioral tests for JournalCursor against real journal files on a real
 * filesystem (mkdtemp fixtures, no mock theater). Requirement G2 maps to
 * P02a per implementation-plan.md §10; behavior spec: issue-854-design.md §2.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { JournalCursor, MAX_RECORD_BYTES } from './journalCursor.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import type {
  JournalCursorOptions,
  JournalEntry,
  JournalPage,
} from './journalCursor.js';
import type {
  SessionEventType,
  SessionRecordingServiceConfig,
} from './types.js';
import type { IContent } from '../services/history/IContent.js';

const TS = '2026-01-01T00:00:00.000Z';
/**
 * Test chunk size. Must exceed the smallest serialized content envelope
 * (~170 bytes) so fixtures can pad lines to land exactly on chunk edges.
 */
const CHUNK = 192;

type ContentEntry = Extract<JournalEntry, { kind: 'content' }>;
type GroupEntry = Extract<JournalEntry, { kind: 'group' }>;
type OversizedEntry = Extract<JournalEntry, { kind: 'oversized' }>;

function makeConfig(chatsDir: string): SessionRecordingServiceConfig {
  return {
    sessionId: 'journal-cursor-test-000001',
    projectHash: 'abc123def456',
    chatsDir,
    workspaceDirs: ['/home/user/project'],
    cwd: '/home/user/project',
    provider: 'anthropic',
    model: 'claude-4',
  };
}

function textContent(speaker: IContent['speaker'], text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function callContent(callId: string): IContent {
  return {
    speaker: 'ai',
    blocks: [
      { type: 'tool_call', id: callId, name: 'runner', parameters: { q: 1 } },
    ],
  };
}

function responseContent(callId: string, result: string): IContent {
  return {
    speaker: 'tool',
    blocks: [{ type: 'tool_response', callId, toolName: 'runner', result }],
  };
}

function withPad(content: IContent, pad: string): IContent {
  return {
    speaker: content.speaker,
    blocks: [...content.blocks, { type: 'text', text: pad }],
  };
}

function envelopeJson(
  seq: number,
  type: SessionEventType,
  payload: unknown,
): string {
  return JSON.stringify({ v: 1, seq, ts: TS, type, payload });
}

function contentLine(seq: number, content: IContent): string {
  return envelopeJson(seq, 'content', { content });
}

const TEXT_LINE_FLOOR_BYTES =
  Buffer.byteLength(
    contentLine(0, withPad(textContent('human', ''), '')),
    'utf8',
  ) + 1;

function textFillFor(targetLineBytes: number): number {
  return targetLineBytes - TEXT_LINE_FLOOR_BYTES;
}

function paddedLineTo(
  seq: number,
  content: IContent,
  targetLineBytes: number,
): string {
  const floor =
    Buffer.byteLength(contentLine(seq, withPad(content, '')), 'utf8') + 1;
  if (targetLineBytes < floor) {
    throw new Error(
      `line floor is ${floor} bytes, cannot pad to ${targetLineBytes}`,
    );
  }
  return contentLine(
    seq,
    withPad(content, 'x'.repeat(targetLineBytes - floor)),
  );
}

function textOf(content: IContent): string {
  return content.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

class FixtureWriter {
  private offset = 0;

  constructor(private readonly filePath: string) {}

  async add(line: string): Promise<number> {
    const at = this.offset;
    await fs.appendFile(this.filePath, `${line}\n`, 'utf8');
    this.offset += Buffer.byteLength(line, 'utf8') + 1;
    return at;
  }

  async addRaw(text: string): Promise<number> {
    const at = this.offset;
    await fs.appendFile(this.filePath, text, 'utf8');
    this.offset += Buffer.byteLength(text, 'utf8');
    return at;
  }
}

function asContent(entry: JournalEntry | undefined): ContentEntry {
  if (entry === undefined || entry.kind !== 'content') {
    throw new Error('expected a content entry');
  }
  return entry;
}

function asGroup(entry: JournalEntry | undefined): GroupEntry {
  if (entry === undefined || entry.kind !== 'group') {
    throw new Error('expected a group entry');
  }
  return entry;
}

function contentSeqs(page: JournalPage): number[] {
  return page.entries.map((entry) =>
    entry.kind === 'content' ? entry.seq : -1,
  );
}

function contentTexts(page: JournalPage): string[] {
  return page.entries.map((entry) =>
    entry.kind === 'content' ? textOf(entry.content) : '',
  );
}

describe('JournalCursor @plan:PLAN-20260917-ISSUE854.P02 @requirement:G2', () => {
  let tempDir = '';
  let filePath = '';
  let opened: JournalCursor[] = [];
  let recordings: SessionRecordingService[] = [];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-cursor-test-'));
    filePath = path.join(tempDir, 'session-under-test.jsonl');
    opened = [];
    recordings = [];
  });

  afterEach(async () => {
    for (const cursor of opened.splice(0).reverse()) {
      await cursor.close().catch(() => undefined);
    }
    for (const recording of recordings.splice(0).reverse()) {
      await recording.dispose().catch(() => undefined);
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function openAndTrack(
    options: JournalCursorOptions = {},
  ): Promise<JournalCursor> {
    const cursor = await JournalCursor.open(filePath, options);
    opened.push(cursor);
    return cursor;
  }

  it('reads records in reverse byte order matching reverse seq order', async () => {
    const chatsDir = path.join(tempDir, 'chats');
    const recording = new SessionRecordingService(makeConfig(chatsDir));
    recordings.push(recording);
    for (let i = 1; i <= 7; i += 1) {
      const speaker = i % 2 === 1 ? 'human' : 'ai';
      recording.recordContent(textContent(speaker, `message ${i}`));
    }
    await recording.flush();
    const journalPath = recording.getFilePath();
    if (journalPath === null) {
      throw new Error('recording did not materialize a journal file');
    }

    const cursor = await JournalCursor.open(journalPath);
    opened.push(cursor);
    const page = await cursor.pageBack(100);

    expect(page.entries).toHaveLength(7);
    expect(contentSeqs(page)).toStrictEqual([8, 7, 6, 5, 4, 3, 2]);
    expect(contentTexts(page)).toStrictEqual([
      'message 7',
      'message 6',
      'message 5',
      'message 4',
      'message 3',
      'message 2',
      'message 1',
    ]);
    expect(page.envelopes.map((ref) => ref.seq)).toStrictEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    const offsets = page.envelopes.map((ref) => ref.offset);
    let previous = offsets[0];
    for (let i = 1; i < offsets.length; i += 1) {
      const current = offsets[i];
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
    expect(cursor.size()).toBeGreaterThan(0);
  });

  it('assembles a record spanning more than three chunks', async () => {
    const writer = new FixtureWriter(filePath);
    await writer.add(envelopeJson(1, 'session_start', { sessionId: 's' }));
    const bigText = 'y'.repeat(200);
    await writer.add(contentLine(2, textContent('ai', bigText)));
    await writer.add(contentLine(3, textContent('human', 'after')));

    const cursor = await openAndTrack({ chunkBytes: CHUNK });
    const page = await cursor.pageBack(10);

    expect(contentSeqs(page)).toStrictEqual([3, 2]);
    expect(contentTexts(page)[1]).toBe(bigText);
    expect(page.envelopes).toHaveLength(3);
  });

  it('decodes a multi-byte UTF-8 character split exactly at a chunk edge', async () => {
    const writer = new FixtureWriter(filePath);
    // Line 1 is padded to exactly one chunk so line 2 starts chunk-aligned.
    await writer.add(paddedLineTo(1, textContent('human', ''), CHUNK));
    // Measure the true byte prefix before the emoji from a probe line, then
    // fill with 1-byte 'a's to land the 4-byte emoji on the next chunk edge
    // with a 2/2 split across it.
    const emojiLocalByte = CHUNK - 2;
    const probe = contentLine(2, textContent('human', '😀tail'));
    const emojiPrefixBytes = Buffer.byteLength(
      probe.slice(0, probe.indexOf('😀')),
      'utf8',
    );
    const text = `${'a'.repeat(emojiLocalByte - emojiPrefixBytes)}😀tail`;
    const line2 = contentLine(2, textContent('human', text));
    const line2Offset = await writer.add(line2);
    const emojiFileOffset =
      line2Offset +
      Buffer.byteLength(line2.slice(0, line2.indexOf('😀')), 'utf8');
    expect(emojiFileOffset).toBe(CHUNK * 2 - 2);

    const cursor = await openAndTrack({ chunkBytes: CHUNK });
    const page = await cursor.pageBack(10);

    expect(contentSeqs(page)).toStrictEqual([2, 1]);
    expect(contentTexts(page)[0]).toBe(text);
  });

  it('reads records that end and start exactly at chunk boundaries', async () => {
    const writer = new FixtureWriter(filePath);
    const firstOffset = await writer.add(
      paddedLineTo(1, textContent('human', ''), CHUNK),
    );
    const secondOffset = await writer.add(
      paddedLineTo(2, textContent('ai', ''), CHUNK),
    );
    await writer.add(contentLine(3, textContent('human', 'tail')));

    const cursor = await openAndTrack({ chunkBytes: CHUNK });
    const page = await cursor.pageBack(10);

    expect(firstOffset).toBe(0);
    expect(secondOffset).toBe(CHUNK);
    expect(contentSeqs(page)).toStrictEqual([3, 2, 1]);
    expect(page.envelopes.map((ref) => ref.offset)).toStrictEqual([
      0,
      CHUNK,
      CHUNK * 2,
    ]);
  });

  it('ignores a torn tail and decodes CRLF-terminated lines', async () => {
    const writer = new FixtureWriter(filePath);
    await writer.addRaw(
      `${envelopeJson(1, 'session_start', { sessionId: 's' })}\r\n`,
    );
    const offset2 = await writer.addRaw(
      `${contentLine(2, textContent('human', 'complete'))}\r\n`,
    );
    const torn = contentLine(
      3,
      textContent('human', 'torn tail bytes never terminate'),
    );
    await writer.addRaw(torn.slice(0, Math.floor(torn.length / 2)));

    const cursor = await openAndTrack({ chunkBytes: CHUNK });
    const page = await cursor.pageBack(10);

    expect(contentSeqs(page)).toStrictEqual([2]);
    expect(contentTexts(page)).toStrictEqual(['complete']);
    expect(page.envelopes).toHaveLength(2);
    expect(page.envelopes.map((ref) => ref.type)).toStrictEqual([
      'session_start',
      'content',
    ]);
    expect(page.envelopes[1].offset).toBe(offset2);
    expect(cursor.windowStart()).toBe(0);
  });

  it('reassembles a head-continuation line from the earlier chunk', async () => {
    const writer = new FixtureWriter(filePath);
    await writer.add(envelopeJson(1, 'session_start', { sessionId: 's' }));
    const offsets: number[] = [];
    for (let seq = 2; seq <= 5; seq += 1) {
      offsets.push(
        await writer.add(
          paddedLineTo(seq, textContent('human', ''), CHUNK * 2),
        ),
      );
    }

    const cursor = await openAndTrack({ chunkBytes: CHUNK });
    const first = await cursor.pageBack(2);
    expect(contentSeqs(first)).toStrictEqual([5, 4]);
    const windowAfterFirst = cursor.windowStart();
    expect(windowAfterFirst).toBe(offsets[2]);

    const second = await cursor.pageBack(2);
    expect(contentSeqs(second)).toStrictEqual([3, 2]);
    expect(contentTexts(second)).toStrictEqual([
      'x'.repeat(textFillFor(CHUNK * 2)),
      'x'.repeat(textFillFor(CHUNK * 2)),
    ]);
    expect(cursor.windowStart()).toBe(offsets[0]);
  });

  it('keeps a tool group atomic when the pair straddles a page boundary', async () => {
    const writer = new FixtureWriter(filePath);
    // Open on an empty journal so the forward head starts at byte 0 and the
    // freshly appended pair pages forward as one entry.
    await fs.writeFile(filePath, '', 'utf8');
    const forward = await openAndTrack({ chunkBytes: CHUNK });
    await writer.add(envelopeJson(1, 'session_start', { sessionId: 's' }));
    const callOffset = await writer.add(
      paddedLineTo(2, callContent('call-1'), CHUNK * 2),
    );
    await writer.add(
      envelopeJson(3, 'session_event', {
        severity: 'info',
        message: 'between',
      }),
    );
    const responseLine = contentLine(4, responseContent('call-1', 'done'));
    const responseOffset = await writer.add(responseLine);

    const forwardPage = await forward.pageForward(1);
    expect(forwardPage.entries).toHaveLength(1);
    const group = asGroup(forwardPage.entries[0]);
    expect(group.call).not.toBeNull();
    expect(group.response).not.toBeNull();
    if (group.call === null || group.response === null) {
      throw new Error('group sides missing');
    }
    const callBlock = group.call.blocks[0];
    if (callBlock.type !== 'tool_call') {
      throw new Error('expected a tool_call block');
    }
    const responseBlock = group.response.blocks[0];
    if (responseBlock.type !== 'tool_response') {
      throw new Error('expected a tool_response block');
    }
    expect(callBlock.id).toBe('call-1');
    expect(responseBlock.callId).toBe('call-1');
    expect(responseBlock.result).toBe('done');
    expect(group.seqSpan).toStrictEqual([2, 4]);
    expect(group.offset).toBe(callOffset);
    expect(group.responseOffset).toBe(responseOffset);
    expect(forwardPage.envelopes.map((ref) => ref.type)).toStrictEqual([
      'session_start',
      'content',
      'session_event',
      'content',
    ]);
    expect(forward.windowEnd()).toBeGreaterThan(responseOffset);
    await forward.close();

    const backward = await openAndTrack({ chunkBytes: CHUNK });
    const backwardPage = await backward.pageBack(1);
    expect(backwardPage.entries).toHaveLength(1);
    const backwardGroup = asGroup(backwardPage.entries[0]);
    expect(backwardGroup.offset).toBe(callOffset);
    expect(backwardGroup.seqSpan).toStrictEqual([2, 4]);
    expect(backward.windowStart()).toBe(callOffset);
  });

  it('skips interleaved metadata envelopes and retains their offsets', async () => {
    const writer = new FixtureWriter(filePath);
    const offsets: number[] = [];
    offsets.push(
      await writer.add(envelopeJson(1, 'session_start', { sessionId: 's' })),
    );
    offsets.push(
      await writer.add(envelopeJson(2, 'session_metadata', { title: 't' })),
    );
    offsets.push(await writer.add(contentLine(3, textContent('human', 'A'))));
    offsets.push(
      await writer.add(
        envelopeJson(4, 'session_event', { severity: 'info', message: 'm' }),
      ),
    );
    offsets.push(
      await writer.add(
        envelopeJson(5, 'provider_switch', { provider: 'p', model: 'm' }),
      ),
    );
    offsets.push(await writer.add(contentLine(6, textContent('ai', 'B'))));
    offsets.push(
      await writer.add(envelopeJson(7, 'session_named', { name: 'n' })),
    );
    offsets.push(
      await writer.add(
        envelopeJson(8, 'checkpoint_created', { checkpointId: 'c', name: 'n' }),
      ),
    );
    offsets.push(await writer.add(contentLine(9, textContent('human', 'C'))));

    const cursor = await openAndTrack();
    const page = await cursor.pageBack(10);

    expect(contentSeqs(page)).toStrictEqual([9, 6, 3]);
    expect(contentTexts(page)).toStrictEqual(['C', 'B', 'A']);
    expect(page.envelopes.map((ref) => ref.offset)).toStrictEqual(offsets);
    expect(page.envelopes.map((ref) => ref.seq)).toStrictEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(page.envelopes.map((ref) => ref.type)).toStrictEqual([
      'session_start',
      'session_metadata',
      'content',
      'session_event',
      'provider_switch',
      'content',
      'session_named',
      'checkpoint_created',
      'content',
    ]);
    expect(cursor.windowStart()).toBe(0);
  });

  it('keeps repeated pageBack and pageForward windows stable without duplicates', async () => {
    const writer = new FixtureWriter(filePath);
    await writer.add(envelopeJson(1, 'session_start', { sessionId: 's' }));
    for (let seq = 2; seq <= 7; seq += 1) {
      await writer.add(contentLine(seq, textContent('human', `m${seq}`)));
    }

    const cursor = await openAndTrack();
    const seen: number[] = [];
    const collect = (page: JournalPage): void => {
      for (const entry of page.entries) {
        seen.push(entry.offset);
      }
    };

    const firstPage = await cursor.pageBack(2);
    collect(firstPage);
    expect(contentSeqs(firstPage)).toStrictEqual([7, 6]);
    const windowOne = cursor.windowStart();
    const secondPage = await cursor.pageBack(2);
    collect(secondPage);
    expect(contentSeqs(secondPage)).toStrictEqual([5, 4]);
    expect(cursor.windowStart()).toBeLessThan(windowOne);

    const thirdPage = await cursor.pageBack(9);
    collect(thirdPage);
    expect(contentSeqs(thirdPage)).toStrictEqual([3, 2]);
    const topWindow = cursor.windowStart();
    expect(topWindow).toBe(0);

    const drained = await cursor.pageBack(4);
    collect(drained);
    expect(drained.entries).toHaveLength(0);
    expect(cursor.windowStart()).toBe(topWindow);
    const drainedAgain = await cursor.pageBack(4);
    collect(drainedAgain);
    expect(drainedAgain.entries).toHaveLength(0);
    expect(cursor.windowStart()).toBe(topWindow);

    const forwardAtEof = await cursor.pageForward(4);
    collect(forwardAtEof);
    expect(forwardAtEof.entries).toHaveLength(0);
    const stableEnd = cursor.windowEnd();
    const forwardAgain = await cursor.pageForward(4);
    collect(forwardAgain);
    expect(forwardAgain.entries).toHaveLength(0);
    expect(cursor.windowEnd()).toBe(stableEnd);

    expect(new Set(seen).size).toBe(seen.length);
  });

  it('pages records appended after the cursor was opened', async () => {
    const writer = new FixtureWriter(filePath);
    await writer.add(envelopeJson(1, 'session_start', { sessionId: 's' }));
    await writer.add(contentLine(2, textContent('human', 'first')));

    const cursor = await openAndTrack();
    const initial = await cursor.pageBack(1);
    expect(contentSeqs(initial)).toStrictEqual([2]);
    const sizeBefore = cursor.size();

    await writer.add(contentLine(3, textContent('ai', 'grown')));
    expect(cursor.size()).toBe(sizeBefore);
    const grown = await cursor.pageForward(5);
    expect(contentSeqs(grown)).toStrictEqual([3]);
    expect(contentTexts(grown)).toStrictEqual(['grown']);
    expect(cursor.size()).toBeGreaterThan(sizeBefore);

    const line4 = contentLine(4, textContent('human', 'finished-late'));
    await writer.addRaw(line4.slice(0, 12));
    const tornPage = await cursor.pageForward(5);
    expect(tornPage.entries).toHaveLength(0);
    await writer.addRaw(`${line4.slice(12)}\n`);
    const donePage = await cursor.pageForward(5);
    expect(contentSeqs(donePage)).toStrictEqual([4]);
    expect(contentTexts(donePage)).toStrictEqual(['finished-late']);
  });

  it('opens empty and non-journal files with deterministic empty results', async () => {
    await fs.writeFile(filePath, '', 'utf8');
    const empty = await openAndTrack();
    expect(empty.size()).toBe(0);
    expect(empty.windowStart()).toBe(0);
    const emptyBack = await empty.pageBack(5);
    expect(emptyBack.entries).toHaveLength(0);
    expect(emptyBack.envelopes).toHaveLength(0);
    const emptyForward = await empty.pageForward(5);
    expect(emptyForward.entries).toHaveLength(0);
    await empty.close();

    await fs.writeFile(filePath, 'hello\nworld\n{"v":1,"seq":2\n', 'utf8');
    const junk = await openAndTrack();
    const junkBack = await junk.pageBack(10);
    expect(junkBack.entries).toHaveLength(0);
    expect(junkBack.envelopes).toHaveLength(3);
    expect(junkBack.envelopes.map((ref) => ref.type)).toStrictEqual([
      null,
      null,
      null,
    ]);
    expect(junk.windowStart()).toBe(0);

    await fs.writeFile(filePath, '﻿hello\nworld\n', 'utf8');
    const bom = await openAndTrack();
    const bomBack = await bom.pageBack(10);
    expect(bomBack.entries).toHaveLength(0);
    expect(bomBack.envelopes).toHaveLength(2);
    expect(bom.windowStart()).toBe(3);
  });

  it('bounds assembly memory and frees transient record buffers', async () => {
    const writer = new FixtureWriter(filePath);
    await writer.add(envelopeJson(1, 'session_start', { sessionId: 's' }));
    await writer.add(contentLine(2, textContent('ai', 'M'.repeat(40_000))));
    const oversizedLine = contentLine(
      3,
      textContent('ai', 'O'.repeat(MAX_RECORD_BYTES + 1000)),
    );
    const oversizedOffset = await writer.add(oversizedLine);
    await writer.add(contentLine(4, textContent('human', 'after-oversized')));

    const cursor = await openAndTrack({ chunkBytes: 1024 });
    const probe = async (
      target: JournalCursor,
    ): Promise<{
      ref: WeakRef<object>;
      kinds: string[];
      offset: number;
      length: number;
    }> => {
      const page = await target.pageBack(10);
      const kinds = page.entries.map((entry) => entry.kind);
      const big = asContent(
        page.entries.find(
          (entry) => entry.kind === 'content' && entry.seq === 2,
        ),
      );
      const oversized = page.entries.find(
        (entry): entry is OversizedEntry => entry.kind === 'oversized',
      );
      if (oversized === undefined) {
        throw new Error('oversized diagnostic entry missing');
      }
      return {
        ref: new WeakRef<object>(big.content),
        kinds,
        offset: oversized.offset,
        length: oversized.length,
      };
    };
    const { ref, kinds, offset, length } = await probe(cursor);

    expect(kinds).toStrictEqual(['content', 'oversized', 'content']);
    expect(offset).toBe(oversizedOffset);
    expect(length).toBe(Buffer.byteLength(oversizedLine, 'utf8') + 1);
    const metrics = cursor.metrics();
    expect(metrics.maxAssembledRecordBytes).toBeGreaterThanOrEqual(40_000);
    expect(metrics.maxAssembledRecordBytes).toBeLessThanOrEqual(
      MAX_RECORD_BYTES,
    );

    // Suspend once so the collection runs on a fresh stack: conservative
    // stack scanning would otherwise pin the probe target via a stale
    // register from the paging call frames for one GC cycle.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    Bun.gc(true);
    expect(ref.deref()).toBeUndefined();

    await cursor.close();
    await expect(cursor.pageBack(1)).rejects.toThrow('closed');
    await cursor.close();
  });
});
