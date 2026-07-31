/**
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Retention behaviour of the session recording queue (issue #2852).
 *
 * The queue must be released by draining, never by dropping. The session file
 * is the durable transcript, so an overflowing queue may not silently stop
 * recording or discard buffered records.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionRecordingService } from './SessionRecordingService.js';

const created: string[] = [];

function createService(): SessionRecordingService {
  const chatsDir = mkdtempSync(path.join(tmpdir(), 'llxprt-recording-'));
  created.push(chatsDir);
  return new SessionRecordingService({
    sessionId: 'bounded-recording',
    projectHash: 'project',
    chatsDir,
    workspaceDirs: [chatsDir],
    cwd: chatsDir,
    provider: 'test',
    model: 'test',
  });
}

function readRecords(service: SessionRecordingService): unknown[] {
  const filePath = service.getFilePath();
  if (filePath === null) {
    return [];
  }
  return readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('SessionRecordingService queue retention', () => {
  it('writes every record even when far more are produced than the high-water mark', async () => {
    const service = createService();
    const total = 10_000;

    for (let index = 0; index < total; index += 1) {
      service.recordContent({
        speaker: 'ai',
        blocks: [{ type: 'text', text: `record-${index}` }],
      });
    }

    await service.flush();

    const records = readRecords(service) as Array<{ type: string }>;
    expect({
      active: service.isActive(),
      contentRecords: records.filter((record) => record.type === 'content')
        .length,
    }).toStrictEqual({ active: true, contentRecords: total });

    await service.dispose();
  });

  it('keeps recording active after producing far more than the high-water mark', async () => {
    const service = createService();

    for (let index = 0; index < 20_000; index += 1) {
      service.recordProviderSwitch(`provider-${index}`, 'x'.repeat(64));
    }

    expect(service.isActive()).toBe(true);
    await service.dispose();
  });

  it('releases the pending queue once the drain completes', async () => {
    const service = createService();

    for (let index = 0; index < 500; index += 1) {
      service.recordContent({
        speaker: 'ai',
        blocks: [{ type: 'text', text: `record-${index}` }],
      });
    }
    expect(service.getPendingRecordCount()).toBeGreaterThan(0);

    await service.flush();

    expect({
      pendingRecords: service.getPendingRecordCount(),
      pendingBytes: service.getPendingByteCount(),
    }).toStrictEqual({ pendingRecords: 0, pendingBytes: 0 });

    await service.dispose();
  });

  it('preserves buffered pre-content records once content materialises the file', async () => {
    const service = createService();

    for (let index = 0; index < 5_000; index += 1) {
      service.recordProviderSwitch(`provider-${index}`, 'model');
    }
    service.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'hello' }],
    });

    await service.flush();

    const records = readRecords(service) as Array<{ type: string }>;
    const switches = records.filter(
      (record) => record.type === 'provider_switch',
    );
    expect(switches).toHaveLength(5_000);

    await service.dispose();
  });
});
