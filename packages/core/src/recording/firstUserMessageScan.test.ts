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
 * @plan PLAN-20260917-ISSUE854.WP17
 * @requirement R5
 *
 * Behavioral tests for the bounded first-user-message title scan. A counting
 * chunk observer proves the scan reads only as far as the first human row and
 * never loads the journal as a whole.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionDiscovery } from './SessionDiscovery.js';
import { MAX_RECORD_BYTES } from './journalCursor.js';

const CHUNK = 4096;

function startLine(sessionId: string, kind?: 'main' | 'subagent'): string {
  return JSON.stringify({
    v: 1,
    seq: 1,
    ts: '2026-01-01T00:00:00.000Z',
    type: 'session_start',
    payload: {
      sessionId,
      projectHash: 'hash',
      workspaceDirs: ['/w'],
      provider: 'anthropic',
      model: 'claude',
      startTime: '2026-01-01T00:00:00.000Z',
      ...(kind === undefined ? {} : { kind }),
    },
  });
}

function contentLine(
  seq: number,
  speaker: 'human' | 'ai',
  text: string,
): string {
  return JSON.stringify({
    v: 1,
    seq,
    ts: '2026-01-01T00:00:00.000Z',
    type: 'content',
    payload: { content: { speaker, blocks: [{ type: 'text', text }] } },
  });
}

describe('first user message title scan', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'first-user-scan-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function write(name: string, body: string): Promise<string> {
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, body);
    return filePath;
  }

  async function scan(
    filePath: string,
    maxLength = 120,
  ): Promise<{ title: string | null; bytesRead: number }> {
    let bytesRead = 0;
    const title = await SessionDiscovery.readFirstUserMessage(
      filePath,
      maxLength,
      {
        chunkBytes: CHUNK,
        onChunkRead: (n) => {
          bytesRead += n;
        },
      },
    );
    return { title, bytesRead };
  }

  it('stops reading at the first user message of a large journal', async () => {
    const rows = [startLine('s1'), contentLine(2, 'human', 'first question')];
    for (let i = 3; i < 4000; i++) {
      rows.push(contentLine(i, 'ai', 'x'.repeat(2000)));
    }
    const filePath = await write('large.jsonl', rows.join('\n') + '\n');
    const size = (await fs.stat(filePath)).size;
    expect(size).toBeGreaterThan(7_000_000);

    const { title, bytesRead } = await scan(filePath);

    expect(title).toBe('first question');
    expect(bytesRead).toBeLessThanOrEqual(CHUNK);
  });

  it('reads proportionally to the position of the first user row', async () => {
    const rows = [startLine('s1')];
    for (let i = 2; i < 52; i++)
      rows.push(contentLine(i, 'ai', 'y'.repeat(900)));
    rows.push(contentLine(52, 'human', 'late question'));
    for (let i = 53; i < 3000; i++) {
      rows.push(contentLine(i, 'ai', 'z'.repeat(2000)));
    }
    const filePath = await write('late.jsonl', rows.join('\n') + '\n');
    const prefixBytes = Buffer.byteLength(rows.slice(0, 52).join('\n')) + 1;

    const { title, bytesRead } = await scan(filePath);

    expect(title).toBe('late question');
    expect(bytesRead).toBeGreaterThanOrEqual(prefixBytes);
    expect(bytesRead).toBeLessThanOrEqual(prefixBytes + 2 * CHUNK);
  });

  it('skips a record over the record cap without buffering it', async () => {
    const huge = contentLine(2, 'human', 'h'.repeat(MAX_RECORD_BYTES + 1024));
    const filePath = await write(
      'oversized.jsonl',
      [startLine('s1'), huge, contentLine(3, 'human', 'after huge')].join(
        '\n',
      ) + '\n',
    );
    const { title } = await scan(filePath);
    expect(title).toBe('after huge');
  });

  it('keeps only the capped title of a large first message', async () => {
    const filePath = await write(
      'big-title.jsonl',
      [startLine('s1'), contentLine(2, 'human', 'T'.repeat(3_000_000))].join(
        '\n',
      ) + '\n',
    );
    const { title } = await scan(filePath, 120);
    expect(title).toBe('T'.repeat(120));
  });

  it('decodes multi-byte text split across chunk boundaries', async () => {
    const text = '日本語のタイトル🙂'.repeat(10);
    for (let pad = 0; pad < 4; pad++) {
      const filePath = await write(
        `multi-${pad}.jsonl`,
        [
          startLine('s1' + 'p'.repeat(CHUNK - 330 + pad)),
          contentLine(2, 'human', text),
        ].join('\n') + '\n',
      );
      const { title } = await scan(filePath, 1000);
      expect(title).toBe(text);
    }
  });

  it('cuts a multi-byte title at the character cap', async () => {
    const filePath = await write(
      'cut.jsonl',
      [startLine('s1'), contentLine(2, 'human', '漢'.repeat(500))].join('\n') +
        '\n',
    );
    const { title } = await scan(filePath, 10);
    expect(title).toBe('漢'.repeat(10));
  });

  it('returns null for empty, header-only and torn journals', async () => {
    expect((await scan(await write('empty.jsonl', ''))).title).toBeNull();
    expect(
      (await scan(await write('header.jsonl', startLine('s1') + '\n'))).title,
    ).toBeNull();
    const torn = contentLine(2, 'human', 'cut off here');
    const tornPath = await write(
      'torn.jsonl',
      startLine('s1') + '\n' + torn.slice(0, torn.length - 12),
    );
    expect((await scan(tornPath)).title).toBeNull();
  });

  it('skips damaged lines and still finds the first valid user row', async () => {
    const filePath = await write(
      'damaged.jsonl',
      [
        startLine('s1'),
        '{"type":"content","payload":{"content":{"speaker":"human"',
        'not json "speaker":"human"',
        contentLine(4, 'human', 'survivor'),
      ].join('\n') + '\n',
    );
    expect((await scan(filePath)).title).toBe('survivor');
  });

  it('accepts an unterminated final row that is complete JSON', async () => {
    const filePath = await write(
      'no-newline.jsonl',
      startLine('s1') + '\n' + contentLine(2, 'human', 'tail row'),
    );
    expect((await scan(filePath)).title).toBe('tail row');
  });

  it('returns null for a missing file', async () => {
    expect((await scan(path.join(dir, 'missing.jsonl'))).title).toBeNull();
  });

  it('never lists child sessions, so their titles are not scanned', async () => {
    await write(
      'session-main.jsonl',
      [startLine('main-1'), contentLine(2, 'human', 'main question')].join(
        '\n',
      ) + '\n',
    );
    await write(
      'session-child.jsonl',
      [
        startLine('child-1', 'subagent'),
        contentLine(2, 'human', 'child prompt'),
      ].join('\n') + '\n',
    );
    const { sessions } = await SessionDiscovery.listSessionsDetailed(
      dir,
      'hash',
    );
    expect(sessions.map((s) => s.sessionId)).toStrictEqual(['main-1']);
    const title = await SessionDiscovery.readFirstUserMessage(
      sessions[0].filePath,
    );
    expect(title).toBe('main question');
  });
});
