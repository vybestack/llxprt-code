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

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionRecordingService } from './SessionRecordingService.js';

const created: string[] = [];
const services: SessionRecordingService[] = [];

function createService(): SessionRecordingService {
  const chatsDir = mkdtempSync(path.join(tmpdir(), 'llxprt-recording-'));
  created.push(chatsDir);
  const service = new SessionRecordingService({
    sessionId: 'bounded-recording',
    projectHash: 'project',
    chatsDir,
    workspaceDirs: [chatsDir],
    cwd: chatsDir,
    provider: 'test',
    model: 'test',
  });
  services.push(service);
  return service;
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

describe('SessionRecordingService queue retention', () => {
  afterEach(async () => {
    // Disposal happens here rather than at the end of each test body, so an
    // assertion failure cannot leak a recording service or its temp dir.
    for (const service of services.splice(0)) {
      await service.dispose();
    }
    for (const dir of created.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
  });

  it('keeps recording active after producing far more than the high-water mark', async () => {
    const service = createService();

    for (let index = 0; index < 20_000; index += 1) {
      service.recordProviderSwitch(`provider-${index}`, 'x'.repeat(64));
    }

    expect(service.isActive()).toBe(true);
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
  });

  it('rejects a zero-byte queue bound before retaining the session header', () => {
    const chatsDir = mkdtempSync(path.join(tmpdir(), 'llxprt-recording-zero-'));
    created.push(chatsDir);

    expect(
      () =>
        new SessionRecordingService({
          sessionId: 'zero-bound',
          projectHash: 'project',
          chatsDir,
          workspaceDirs: [chatsDir],
          provider: 'test',
          model: 'test',
          maxQueueBytes: 0,
        }),
    ).toThrow(/queue byte limit/);
  });

  it('accepts an exact queue-byte reservation and rejects one byte over without dropping retained records', async () => {
    const probeDir = mkdtempSync(
      path.join(tmpdir(), 'llxprt-recording-probe-'),
    );
    created.push(probeDir);
    const probe = new SessionRecordingService({
      sessionId: 'bounded-recording',
      projectHash: 'project',
      chatsDir: probeDir,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    probe.recordProviderSwitch('bounded-provider', 'bounded-model');
    const exactBytes = probe.getPendingByteCount();
    await probe.dispose();

    const exactDir = mkdtempSync(
      path.join(tmpdir(), 'llxprt-recording-exact-'),
    );
    created.push(exactDir);
    const exact = new SessionRecordingService({
      sessionId: 'bounded-recording',
      projectHash: 'project',
      chatsDir: exactDir,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      maxQueueBytes: exactBytes,
    });
    services.push(exact);
    exact.recordProviderSwitch('bounded-provider', 'bounded-model');

    const overDir = mkdtempSync(path.join(tmpdir(), 'llxprt-recording-over-'));
    created.push(overDir);
    const over = new SessionRecordingService({
      sessionId: 'bounded-recording',
      projectHash: 'project',
      chatsDir: overDir,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      maxQueueBytes: exactBytes - 1,
    });
    services.push(over);

    expect(() =>
      over.recordProviderSwitch('bounded-provider', 'bounded-model'),
    ).toThrow(/queue byte limit/);
    expect(over.getPendingRecordCount()).toBe(1);
    expect(exact.getPendingByteCount()).toBe(exactBytes);
  });

  it('rejects a materializing record before creating a file or watcher state', async () => {
    const probeDir = mkdtempSync(
      path.join(tmpdir(), 'llxprt-recording-materialize-probe-'),
    );
    created.push(probeDir);
    const probeChats = path.join(probeDir, 'chats');
    const probe = new SessionRecordingService({
      sessionId: 'materialize-bound',
      projectHash: 'project',
      chatsDir: probeChats,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    const headerBytes = probe.getPendingByteCount();
    await probe.dispose();

    const boundedDir = mkdtempSync(
      path.join(tmpdir(), 'llxprt-recording-materialize-bounded-'),
    );
    created.push(boundedDir);
    const boundedChats = path.join(boundedDir, 'chats');
    const bounded = new SessionRecordingService({
      sessionId: 'materialize-bound',
      projectHash: 'project',
      chatsDir: boundedChats,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      maxQueueBytes: headerBytes,
    });
    services.push(bounded);

    expect(() =>
      bounded.recordContent({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'over the retained header bound' }],
      }),
    ).toThrow(/queue byte limit/);
    expect(bounded.getFilePath()).toBeNull();
    expect(existsSync(boundedChats)).toBe(false);
    expect(bounded.getPendingByteCount()).toBe(headerBytes);
  });

  it('preflights the complete content batch before changing recording state', () => {
    const probe = createService();
    const contents = [
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'first batch item' }],
      },
      {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: 'second batch item' }],
      },
    ];
    const probeHeaderBytes = probe.getPendingByteCount();
    const prepared = probe.prepareContentBatch(contents);
    prepared.publish();
    const batchBytes = probe.getPendingByteCount() - probeHeaderBytes;
    prepared.rollback();

    const chatsDir = mkdtempSync(path.join(tmpdir(), 'llxprt-batch-bound-'));
    created.push(chatsDir);
    const headerProbe = new SessionRecordingService({
      sessionId: 'bounded-recording',
      projectHash: 'project',
      chatsDir,
      workspaceDirs: [chatsDir],
      provider: 'test',
      model: 'test',
    });
    services.push(headerProbe);
    const headerBytes = headerProbe.getPendingByteCount();
    const bounded = new SessionRecordingService({
      sessionId: 'bounded-recording',
      projectHash: 'project',
      chatsDir,
      workspaceDirs: [chatsDir],
      provider: 'test',
      model: 'test',
      maxQueueBytes: headerBytes + batchBytes - 1,
    });
    services.push(bounded);

    expect(() => bounded.prepareContentBatch(contents)).toThrow(
      /queue byte limit/,
    );
    expect({
      filePath: bounded.getFilePath(),
      records: bounded.getPendingRecordCount(),
      bytes: bounded.getPendingByteCount(),
    }).toStrictEqual({ filePath: null, records: 1, bytes: headerBytes });
  });

  it('surfaces a background write failure after releasing every queued byte', async () => {
    const root = mkdtempSync(
      path.join(tmpdir(), 'llxprt-recording-write-fail-'),
    );

    created.push(root);
    const service = new SessionRecordingService({
      sessionId: 'write-failure',
      projectHash: 'project',
      chatsDir: root,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    services.push(service);
    service.initializeForResume(root, 0);
    service.recordProviderSwitch('next-provider', 'next-model');

    await expect(service.flush()).rejects.toBeInstanceOf(Error);
    expect(service.getPendingByteCount()).toBe(0);
    expect(service.getPendingRecordCount()).toBe(0);
  });
});
