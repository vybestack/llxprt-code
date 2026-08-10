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
 * Behavioral tests for the canonical bounded first-line reader (Item 7).
 *
 * Proves BOM handling, valid headers beyond 4096 bytes, and that a giant
 * no-newline file is classified as unreadable **without** whole-file buffering.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readBoundedFirstLine,
  BOUNDED_HEADER_MAX_BYTES,
} from './boundedHeaderReader.js';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'bounded-header-'));
}

describe('readBoundedFirstLine', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reads a normal single-line header', async () => {
    const filePath = path.join(tempDir, 'session-normal.jsonl');
    const payload = JSON.stringify({
      type: 'session_start',
      payload: { sessionId: 'abc-123', startTime: '2026-01-01T00:00:00Z' },
    });
    await fs.writeFile(filePath, payload + '\nmore data\n');
    const line = await readBoundedFirstLine(filePath);
    expect(line).toBe(payload);
  });

  it('strips a UTF-8 BOM prefix', async () => {
    const filePath = path.join(tempDir, 'session-bom.jsonl');
    const payload = JSON.stringify({
      type: 'session_start',
      payload: { sessionId: 'bom-id', startTime: '2026-01-01T00:00:00Z' },
    });
    await fs.writeFile(filePath, '\uFEFF' + payload + '\n');
    const line = await readBoundedFirstLine(filePath);
    expect(line).toBe(payload);
  });

  it('reads a valid header larger than 4096 bytes', async () => {
    const filePath = path.join(tempDir, 'session-long.jsonl');
    const longValue = 'x'.repeat(5000);
    const payload = JSON.stringify({
      type: 'session_start',
      payload: {
        sessionId: 'long-id',
        startTime: '2026-01-01T00:00:00Z',
        workspaceDirs: [longValue],
      },
    });
    expect(payload.length).toBeGreaterThan(4096);
    await fs.writeFile(filePath, payload + '\n');
    const line = await readBoundedFirstLine(filePath);
    expect(line).toBe(payload);
  });

  it('reads a single-line file with no trailing newline', async () => {
    const filePath = path.join(tempDir, 'session-nonl.jsonl');
    const payload = JSON.stringify({
      type: 'session_start',
      payload: { sessionId: 'no-newline-id' },
    });
    await fs.writeFile(filePath, payload);
    const line = await readBoundedFirstLine(filePath);
    expect(line).toBe(payload);
  });

  it('returns null for an empty file', async () => {
    const filePath = path.join(tempDir, 'session-empty.jsonl');
    await fs.writeFile(filePath, '');
    const line = await readBoundedFirstLine(filePath);
    expect(line).toBeNull();
  });

  it('returns null for a non-existent file', async () => {
    const line = await readBoundedFirstLine(path.join(tempDir, 'nope.jsonl'));
    expect(line).toBeNull();
  });

  it('returns null for a giant no-newline file exceeding the documented maximum', async () => {
    const filePath = path.join(tempDir, 'session-giant.jsonl');
    // Write a file larger than the maximum with no newline.
    const giant = 'a'.repeat(BOUNDED_HEADER_MAX_BYTES + 4096);
    await fs.writeFile(filePath, giant);
    const line = await readBoundedFirstLine(filePath);
    expect(line).toBeNull();
  });

  it('returns the first line of a very large file when the newline is within bounds', async () => {
    const filePath = path.join(tempDir, 'session-large-early-nl.jsonl');
    const header = JSON.stringify({
      type: 'session_start',
      payload: { sessionId: 'large-file' },
    });
    // Small header + newline, followed by a large amount of trailing data.
    const trailing = '\n' + 'z'.repeat(BOUNDED_HEADER_MAX_BYTES + 4096);
    await fs.writeFile(filePath, header + trailing);
    const line = await readBoundedFirstLine(filePath);
    expect(line).toBe(header);
  });

  it('reads a first line one byte under the max with a trailing newline', async () => {
    const filePath = path.join(tempDir, 'session-under-boundary.jsonl');
    // MAX-1 bytes of content + newline at byte MAX-1 (within the read limit).
    const content = 'x'.repeat(BOUNDED_HEADER_MAX_BYTES - 1) + '\n';
    await fs.writeFile(filePath, content);
    const line = await readBoundedFirstLine(filePath);
    expect(line).not.toBeNull();
    expect(line!.length).toBe(BOUNDED_HEADER_MAX_BYTES - 1);
  });

  it('returns null when the first line is exactly at the max with a trailing newline', async () => {
    const filePath = path.join(tempDir, 'session-exact-boundary.jsonl');
    // MAX bytes of content + newline at byte MAX (beyond the read limit).
    const content = 'x'.repeat(BOUNDED_HEADER_MAX_BYTES) + '\n';
    await fs.writeFile(filePath, content);
    const line = await readBoundedFirstLine(filePath);
    expect(line).toBeNull();
  });

  it('returns null when the first line is one byte over the max with a trailing newline', async () => {
    const filePath = path.join(tempDir, 'session-over-boundary.jsonl');
    const content = 'x'.repeat(BOUNDED_HEADER_MAX_BYTES + 1) + '\n';
    await fs.writeFile(filePath, content);
    const line = await readBoundedFirstLine(filePath);
    expect(line).toBeNull();
  });

  it('correctly decodes a multi-byte UTF-8 character split across the 64 KiB chunk boundary', async () => {
    const filePath = path.join(tempDir, 'session-multibyte.jsonl');
    // Place a 3-byte UTF-8 character so that its first byte is the last byte
    // of the first 64 KiB chunk, and its remaining bytes are in the second
    // chunk.  '€' is U+20AC → UTF-8 bytes E2 82 AC.
    const READ_CHUNK_SIZE = 64 * 1024;
    const before = 'a'.repeat(READ_CHUNK_SIZE - 1);
    const multiChar = '€';
    const after = 'bc';
    const header = before + multiChar + after + '\n';
    await fs.writeFile(filePath, header);
    const line = await readBoundedFirstLine(filePath);
    expect(line).not.toBeNull();
    expect(line).toBe(before + multiChar + after);
  });

  it('handles a BOM + header larger than 4096 bytes', async () => {
    const filePath = path.join(tempDir, 'session-bom-long.jsonl');
    const longValue = 'y'.repeat(5000);
    const payload = JSON.stringify({
      type: 'session_start',
      payload: { sessionId: 'bom-long', workspaceDirs: [longValue] },
    });
    await fs.writeFile(filePath, '\uFEFF' + payload + '\n');
    const line = await readBoundedFirstLine(filePath);
    expect(line).toBe(payload);
  });

  it('returns the first line only when multiple lines exist', async () => {
    const filePath = path.join(tempDir, 'session-multi.jsonl');
    const first = JSON.stringify({ type: 'session_start', payload: {} });
    const second = JSON.stringify({ type: 'content', payload: {} });
    await fs.writeFile(filePath, first + '\n' + second + '\n');
    const line = await readBoundedFirstLine(filePath);
    expect(line).toBe(first);
  });

  it('correctly strips BOM for a first line spanning multiple 64 KiB chunks', async () => {
    const filePath = path.join(tempDir, 'session-bom-chunked.jsonl');
    const READ_CHUNK_SIZE = 64 * 1024;
    // BOM + content that exceeds a single 64 KiB read so the reader must
    // continue across chunk boundaries with the BOM already stripped.
    const padding = 'b'.repeat(READ_CHUNK_SIZE + 100);
    const payload = JSON.stringify({
      type: 'session_start',
      payload: { sessionId: 'bom-chunked', startTime: '2026-01-01T00:00:00Z' },
    });
    await fs.writeFile(filePath, '\uFEFF' + padding + payload + '\n');
    const line = await readBoundedFirstLine(filePath);
    expect(line).toBe(padding + payload);
  });

  it('returns null for a file containing only a BOM', async () => {
    const filePath = path.join(tempDir, 'session-bom-only.jsonl');
    await fs.writeFile(filePath, '\uFEFF');
    const line = await readBoundedFirstLine(filePath);
    expect(line).toBeNull();
  });

  it('returns an empty string for a file containing only a BOM and a newline', async () => {
    const filePath = path.join(tempDir, 'session-bom-newline.jsonl');
    await fs.writeFile(filePath, '\uFEFF\n');
    const line = await readBoundedFirstLine(filePath);
    // The first line is empty after BOM stripping (distinct from an empty
    // file which returns null).  Downstream JSON parsing handles this.
    expect(line).toBe('');
  });
});
