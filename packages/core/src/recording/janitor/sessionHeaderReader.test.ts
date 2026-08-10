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
 * Behavioral tests for the canonical JSONL session header reader (AC-1).
 *
 * Creates sessions using the real SessionRecordingService and proves the
 * header reader discovers them. Covers BOM-prefixed and long first-line
 * (>4096 bytes) behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readSessionJsonlHeader } from './sessionHeaderReader.js';
import { SessionRecordingService } from '../SessionRecordingService.js';
import type { SessionRecordingServiceConfig } from '../types.js';

function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'janitor-header-'));
}

function makeConfig(chatsDir: string): SessionRecordingServiceConfig {
  return {
    sessionId: 'test-session-' + crypto.randomUUID(),
    projectHash: crypto.randomUUID().replace(/-/g, '').slice(0, 64),
    chatsDir,
    workspaceDirs: [chatsDir],
    provider: 'test-provider',
    model: 'test-model',
  };
}

describe('readSessionJsonlHeader — real recorder output', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reads the header from a real SessionRecordingService file', async () => {
    const config = makeConfig(tempDir);
    const svc = new SessionRecordingService(config);
    svc.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'hello' }],
    });
    await svc.dispose();

    const filePath = svc.getFilePath();
    expect(filePath).not.toBeNull();

    const header = await readSessionJsonlHeader(filePath!);
    expect(header).not.toBeNull();
    expect(header!.sessionId).toBe(config.sessionId);
    // The service writes the actual startTime from the session_start event —
    // assert it is a real ISO timestamp, not a truthy placeholder.
    expect(typeof header!.startTime).toBe('string');
    expect(header!.startTime.length).toBeGreaterThan(0);
    // Ensure it parses as a valid date.
    expect(new Date(header!.startTime).getTime()).not.toBeNaN();
  });

  it('returns null for an empty file', async () => {
    const filePath = path.join(tempDir, 'session-empty.jsonl');
    await fs.writeFile(filePath, '');
    const header = await readSessionJsonlHeader(filePath);
    expect(header).toBeNull();
  });

  it('returns null for a file with no session_start event', async () => {
    const filePath = path.join(tempDir, 'session-noheader.jsonl');
    await fs.writeFile(
      filePath,
      JSON.stringify({ type: 'content', payload: {} }) + '\n',
    );
    const header = await readSessionJsonlHeader(filePath);
    expect(header).toBeNull();
  });

  it('returns null for a non-existent file', async () => {
    const header = await readSessionJsonlHeader(
      path.join(tempDir, 'nonexistent.jsonl'),
    );
    expect(header).toBeNull();
  });

  it('handles BOM-prefixed JSONL (AC-1)', async () => {
    const sessionId = 'bom-test-session-id';
    const startTime = new Date().toISOString();
    const payload = JSON.stringify({
      v: 1,
      seq: 0,
      ts: startTime,
      type: 'session_start',
      payload: { sessionId, startTime, projectHash: 'abc123' },
    });

    const filePath = path.join(tempDir, 'session-bom.jsonl');
    // Write with UTF-8 BOM prefix
    await fs.writeFile(filePath, '\uFEFF' + payload + '\n');

    const header = await readSessionJsonlHeader(filePath);
    expect(header).not.toBeNull();
    expect(header!.sessionId).toBe(sessionId);
    expect(header!.startTime).toBe(startTime);
  });

  it('handles first header line larger than 4096 bytes (AC-1)', async () => {
    const sessionId = 'long-header-session-id';
    const startTime = new Date().toISOString();
    // Create a payload with a very long workspaceDirs entry to exceed 4096 bytes
    const longPath = 'x'.repeat(5000);
    const payload = JSON.stringify({
      v: 1,
      seq: 0,
      ts: startTime,
      type: 'session_start',
      payload: {
        sessionId,
        startTime,
        projectHash: 'abc123',
        workspaceDirs: [longPath],
      },
    });

    expect(payload.length).toBeGreaterThan(4096);

    const filePath = path.join(tempDir, 'session-long.jsonl');
    await fs.writeFile(filePath, payload + '\n');

    const header = await readSessionJsonlHeader(filePath);
    expect(header).not.toBeNull();
    expect(header!.sessionId).toBe(sessionId);
    expect(header!.startTime).toBe(startTime);
  });

  it('returns null for corrupted/unparseable JSON first line', async () => {
    const filePath = path.join(tempDir, 'session-bad.jsonl');
    await fs.writeFile(filePath, 'this is not json\n');
    const header = await readSessionJsonlHeader(filePath);
    expect(header).toBeNull();
  });

  it('returns null for a valid session_start with an unsafe/path-like sessionId', async () => {
    const startTime = new Date().toISOString();
    const payload = JSON.stringify({
      v: 1,
      seq: 0,
      ts: startTime,
      type: 'session_start',
      payload: {
        sessionId: '../../etc/passwd',
        startTime,
        projectHash: 'abc123',
      },
    });
    const filePath = path.join(tempDir, 'session-unsafe.jsonl');
    await fs.writeFile(filePath, payload + '\n');
    const header = await readSessionJsonlHeader(filePath);
    expect(header).toBeNull();
  });
});
