/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3732: the session_start header must carry the provider/model in
 * effect when the recording materializes, not the values at construction.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionRecordingService } from './SessionRecordingService.js';
import { replaySession } from './ReplayEngine.js';
import { isSessionStartHeader } from './sessionStartHeader.js';
import type { SessionRecordLine, SessionStartPayload } from './types.js';

const PROJECT_HASH = 'header-binding-project';

function isRecordLine(value: unknown): value is SessionRecordLine {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'type') === 'string' &&
    typeof Reflect.get(value, 'seq') === 'number'
  );
}

async function readRecords(filePath: string): Promise<SessionRecordLine[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return raw
    .trim()
    .split('\n')
    .map((line): SessionRecordLine => {
      const parsed: unknown = JSON.parse(line);
      if (!isRecordLine(parsed)) {
        throw new Error(`Not a session record line: ${line}`);
      }
      return parsed;
    });
}

function headerOf(records: readonly SessionRecordLine[]): SessionStartPayload {
  expect(records[0].type).toBe('session_start');
  const payload = records[0].payload;
  if (!isSessionStartHeader(payload)) {
    throw new Error('First record is not a valid session_start header');
  }
  return payload;
}

interface LiveProviderModel {
  provider: string;
  model: string;
}

describe('SessionRecordingService session_start header (issue #3732)', () => {
  let chatsDir: string;
  let live: LiveProviderModel;
  const services: SessionRecordingService[] = [];

  beforeEach(async () => {
    chatsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-header-'));
    live = { provider: 'unknown', model: '' };
  });

  afterEach(async () => {
    setSystemTime();
    for (const service of services.splice(0)) {
      await service.dispose();
    }
    await fs.rm(chatsDir, { recursive: true, force: true });
  });

  function createService(
    overrides: {
      maxQueueBytes?: number;
      withResolver?: boolean;
    } = {},
  ): SessionRecordingService {
    const { withResolver = true, maxQueueBytes } = overrides;
    const service = new SessionRecordingService({
      sessionId: 'header-binding-session',
      projectHash: PROJECT_HASH,
      chatsDir,
      workspaceDirs: [chatsDir],
      provider: 'unknown',
      model: '',
      ...(maxQueueBytes === undefined ? {} : { maxQueueBytes }),
      ...(withResolver
        ? {
            resolveProviderModel: () => ({
              provider: live.provider,
              model: live.model,
            }),
          }
        : {}),
    });
    services.push(service);
    return service;
  }

  function recordFirstMessage(service: SessionRecordingService): void {
    service.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'hello' }],
    });
  }

  it('writes the provider/model in effect at materialization even when no provider_switch was recorded', async () => {
    const service = createService();

    live = { provider: 'codex', model: 'gpt-6-luna' };
    recordFirstMessage(service);
    await service.flush();

    const records = await readRecords(service.getFilePath()!);
    const header = headerOf(records);
    expect({
      provider: header.provider,
      model: header.model,
      types: records.map((record) => record.type),
    }).toStrictEqual({
      provider: 'codex',
      model: 'gpt-6-luna',
      types: ['session_start', 'content'],
    });
  });

  it('keeps a recorded provider_switch as history and replays codex/gpt-6-luna', async () => {
    const service = createService();

    live = { provider: 'codex', model: 'gpt-6-luna' };
    service.recordProviderSwitch('codex', 'gpt-6-luna');
    recordFirstMessage(service);
    await service.flush();

    const records = await readRecords(service.getFilePath()!);
    const replay = await replaySession(service.getFilePath()!, PROJECT_HASH);
    expect({
      header: `${headerOf(records).provider}/${headerOf(records).model}`,
      types: records.map((record) => record.type),
      replayed: replay.ok
        ? `${replay.metadata.provider}/${replay.metadata.model}`
        : replay.error,
    }).toStrictEqual({
      header: 'codex/gpt-6-luna',
      types: ['session_start', 'provider_switch', 'content'],
      replayed: 'codex/gpt-6-luna',
    });
  });

  it('leaves sessionId, seq, and the construction-time startTime of the header unchanged', async () => {
    const constructedAt = new Date('2026-10-09T10:00:00.000Z');
    setSystemTime(constructedAt);
    const service = createService();
    setSystemTime(new Date('2026-10-09T11:30:00.000Z'));

    live = { provider: 'codex', model: 'gpt-6-luna' };
    service.recordProviderSwitch('codex', 'gpt-6-luna');
    recordFirstMessage(service);
    await service.flush();

    const records = await readRecords(service.getFilePath()!);
    const header = headerOf(records);
    expect({
      sessionId: header.sessionId,
      startTime: header.startTime,
      headerSeq: records[0].seq,
      headerTs: records[0].ts,
      seqs: records.map((record) => record.seq),
    }).toStrictEqual({
      sessionId: 'header-binding-session',
      startTime: constructedAt.toISOString(),
      headerSeq: 1,
      headerTs: constructedAt.toISOString(),
      seqs: [1, 2, 3],
    });
  });

  it('keeps the startup provider/model in the header when nothing changes before materialization', async () => {
    const service = createService();

    recordFirstMessage(service);
    await service.flush();

    const header = headerOf(await readRecords(service.getFilePath()!));
    expect({ provider: header.provider, model: header.model }).toStrictEqual({
      provider: 'unknown',
      model: '',
    });
  });

  it('keeps the construction-time header when no resolver is supplied', async () => {
    const service = createService({ withResolver: false });

    live = { provider: 'codex', model: 'gpt-6-luna' };
    service.recordProviderSwitch('codex', 'gpt-6-luna');
    recordFirstMessage(service);
    await service.flush();

    const header = headerOf(await readRecords(service.getFilePath()!));
    expect({ provider: header.provider, model: header.model }).toStrictEqual({
      provider: 'unknown',
      model: '',
    });
  });

  it('does not rewrite the on-disk header when the provider changes after materialization', async () => {
    const service = createService();
    recordFirstMessage(service);
    await service.flush();
    const filePath = service.getFilePath()!;

    live = { provider: 'codex', model: 'gpt-6-luna' };
    service.recordProviderSwitch('codex', 'gpt-6-luna');
    await service.flush();

    const records = await readRecords(filePath);
    const header = headerOf(records);
    const replay = await replaySession(filePath, PROJECT_HASH);
    expect({
      header: { provider: header.provider, model: header.model },
      types: records.map((record) => record.type),
      replayed: replay.ok
        ? `${replay.metadata.provider}/${replay.metadata.model}`
        : replay.error,
    }).toStrictEqual({
      header: { provider: 'unknown', model: '' },
      types: ['session_start', 'content', 'provider_switch'],
      replayed: 'codex/gpt-6-luna',
    });
  });

  it('does not rewrite the header of a resumed recording', async () => {
    const first = createService();
    recordFirstMessage(first);
    await first.flush();
    const filePath = first.getFilePath()!;
    const lastSeq = (await readRecords(filePath)).length;

    const resumed = createService();
    resumed.initializeForResume(filePath, lastSeq);
    live = { provider: 'codex', model: 'gpt-6-luna' };
    resumed.recordSessionEvent('info', 'resumed');
    await resumed.flush();

    const header = headerOf(await readRecords(filePath));
    expect({ provider: header.provider, model: header.model }).toStrictEqual({
      provider: 'unknown',
      model: '',
    });
  });

  it('binds the header when the first content arrives as a prepared batch, and a rolled-back batch leaves the header rebindable', async () => {
    const service = createService();
    const message = {
      speaker: 'human' as const,
      blocks: [{ type: 'text' as const, text: 'batched' }],
    };

    live = { provider: 'codex', model: 'gpt-6-luna' };
    const rolledBack = service.prepareContentBatch([message]);
    rolledBack.publish();
    rolledBack.rollback();
    live = { provider: 'anthropic', model: 'claude-opus-5-5' };
    const batch = service.prepareContentBatch([message]);
    batch.publish();
    batch.finalize();
    await service.flush();

    const header = headerOf(await readRecords(service.getFilePath()!));
    expect({ provider: header.provider, model: header.model }).toStrictEqual({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
    });
  });

  it('writes the header for the provider/model live at publication, not at prepare, when no provider_switch was recorded', async () => {
    const service = createService();
    const message = {
      speaker: 'human' as const,
      blocks: [{ type: 'text' as const, text: 'prepared early' }],
    };

    const batch = service.prepareContentBatch([message]);
    live = { provider: 'codex', model: 'gpt-6-luna' };
    batch.publish();
    batch.finalize();
    await service.flush();

    const records = await readRecords(service.getFilePath()!);
    const header = headerOf(records);
    expect({
      provider: header.provider,
      model: header.model,
      types: records.map((record) => record.type),
    }).toStrictEqual({
      provider: 'codex',
      model: 'gpt-6-luna',
      types: ['session_start', 'content'],
    });
  });

  it('reports pending bytes equal to the bytes written after the header is rebuilt', async () => {
    const service = createService();

    live = { provider: 'codex', model: 'gpt-6-luna' };
    recordFirstMessage(service);
    const pendingBytes = service.getPendingByteCount();
    await service.flush();

    const written = await fs.stat(service.getFilePath()!);
    expect({
      pendingBytes,
      afterFlush: service.getPendingByteCount(),
    }).toStrictEqual({ pendingBytes: written.size, afterFlush: 0 });
  });

  describe('queue byte limit', () => {
    /** Bytes of header+content when the header already says codex/gpt-6-luna. */
    async function boundHeaderBytes(): Promise<number> {
      live = { provider: 'codex', model: 'gpt-6-luna' };
      const probe = createService();
      recordFirstMessage(probe);
      return probe.getPendingByteCount();
    }

    it('counts the rebuilt header against the limit and rejects the event cleanly when it does not fit', async () => {
      const exactBytes = await boundHeaderBytes();
      const limited = createService({ maxQueueBytes: exactBytes - 1 });
      const headerOnlyBytes = limited.getPendingByteCount();

      expect(() => recordFirstMessage(limited)).toThrow(
        /queue byte limit exceeded/,
      );

      expect({
        materialized: limited.getFilePath() !== null,
        pendingBytes: limited.getPendingByteCount(),
      }).toStrictEqual({ materialized: false, pendingBytes: headerOnlyBytes });
    });

    it('accepts an event whose rebuilt header fits the limit exactly', async () => {
      const exactBytes = await boundHeaderBytes();
      const exact = createService({ maxQueueBytes: exactBytes });

      recordFirstMessage(exact);

      expect(exact.getPendingByteCount()).toBe(exactBytes);
    });

    it('rejects publication cleanly, leaving state unchanged, when a live change after prepare makes the rebuilt header exceed the limit', async () => {
      const message = {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'hello' }],
      };
      const probe = createService();
      recordFirstMessage(probe);
      const unboundBytes = probe.getPendingByteCount();

      const limited = createService({ maxQueueBytes: unboundBytes });
      const headerOnlyBytes = limited.getPendingByteCount();
      const batch = limited.prepareContentBatch([message]);
      live = { provider: 'codex', model: 'gpt-6-luna' };

      expect(() => batch.publish()).toThrow(
        /Session recording queue byte limit exceeded/,
      );

      expect({
        materialized: limited.getFilePath() !== null,
        pendingBytes: limited.getPendingByteCount(),
        pendingRecords: limited.getPendingRecordCount(),
      }).toStrictEqual({
        materialized: false,
        pendingBytes: headerOnlyBytes,
        pendingRecords: 1,
      });
    });

    it('rejects a prepared batch whose rebuilt header does not fit the limit', async () => {
      const exactBytes = await boundHeaderBytes();
      const limited = createService({ maxQueueBytes: exactBytes - 1 });

      expect(() =>
        limited.prepareContentBatch([
          { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
        ]),
      ).toThrow(/queue byte limit exceeded/);
    });
  });
});
