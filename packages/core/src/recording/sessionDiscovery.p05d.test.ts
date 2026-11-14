/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFile, mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionLockManager } from './SessionLockManager.js';
import {
  LARGE_N,
  PAGE_BOUND,
  PROJECT_HASH,
  SMALL_N,
  seedRecording,
  useJournalReadProbe,
} from './__tests__/support/journalRecordingFixture.js';

describe('bounded journal continue-target discovery', () => {
  const directory = useTempDir('discovery-native-');
  const probe = useJournalReadProbe();
  const discover = (): ReturnType<
    typeof SessionDiscovery.listContinueTargetsDetailedBounded
  > =>
    SessionDiscovery.listContinueTargetsDetailedBounded(
      directory(),
      PROJECT_HASH,
    );

  for (const count of [SMALL_N, LARGE_N]) {
    it(`finds metadata for ${count} rows using bounded descriptor reads and zero row decodes`, async () => {
      const seed = await seedRecording(directory(), count, {
        name: 'alpha',
        checkpointAfter: count / 2,
      });
      probe().reset();
      const result = await discover();
      expect(result.recordingErrors).toStrictEqual([]);
      expect(
        result.targets
          .filter((target) => target.kind === 'session')
          .map((target) => target.session.sessionId),
      ).toStrictEqual([seed.recording.getSessionId()]);
      expect(
        result.targets.find((target) => target.kind === 'checkpoint'),
      ).toMatchObject({
        checkpointName: 'keep',
        sequence: seed.target?.sequence,
      });
      expect(probe().decodedRows).toBe(0);
      expect(probe().reads).toBeGreaterThan(0);
      expect(probe().reads).toBeLessThanOrEqual(PAGE_BOUND);
      expect(probe().peakReads).toBeLessThanOrEqual(PAGE_BOUND);
    }, 30_000);
  }

  it('uses metadata-only bounded reads at the production discovery entry point', async () => {
    const seed = await seedRecording(directory(), LARGE_N);
    probe().reset();
    const result = await SessionDiscovery.listContinueTargetsDetailed(
      directory(),
      PROJECT_HASH,
    );
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]).toMatchObject({
      kind: 'session',
      session: { sessionId: seed.recording.getSessionId() },
    });
    expect(probe().reads).toBeGreaterThan(0);
    expect(probe().reads).toBeLessThanOrEqual(PAGE_BOUND);
    expect(probe().decodedRows).toBe(0);
  }, 30_000);

  it('decides latest eligibility from trailer metadata without decoding content', async () => {
    const seed = await seedRecording(directory(), LARGE_N);
    probe().reset();
    expect(await SessionDiscovery.hasContentEvents(seed.filePath)).toBe(true);
    expect(probe().reads).toBeGreaterThan(0);
    expect(probe().reads).toBeLessThanOrEqual(PAGE_BOUND);
    expect(probe().decodedRows).toBe(0);
  });

  it('resolves latest, indexes, names, full IDs, prefixes and checkpoint names and IDs', async () => {
    const newest = await seedRecording(directory(), 4, {
      name: 'alpha',
      checkpointAfter: 2,
    });
    const older = await seedRecording(directory(), SMALL_N);
    await utimes(newest.filePath, 2e9, 2e9);
    await utimes(older.filePath, 1.9e9, 1.9e9);
    const result = await discover();
    for (const ref of [
      'latest',
      '1',
      'alpha',
      newest.recording.getSessionId(),
      newest.recording.getSessionId().slice(0, 9),
    ]) {
      expect(
        SessionDiscovery.resolveContinueRef(ref, result.targets),
      ).toMatchObject({
        target: {
          kind: 'session',
          session: { sessionId: newest.recording.getSessionId() },
        },
      });
    }
    expect(
      SessionDiscovery.resolveContinueRef('2', result.targets),
    ).toMatchObject({
      target: {
        kind: 'session',
        session: { sessionId: older.recording.getSessionId() },
      },
    });
    const target = newest.target;
    if (target === undefined) throw new Error('Missing checkpoint');
    for (const ref of ['keep', target.checkpointId])
      expect(
        SessionDiscovery.resolveContinueRef(ref, result.targets),
      ).toMatchObject({
        target: { kind: 'checkpoint', checkpointId: target.checkpointId },
      });
  });

  it('rejects ambiguous prefixes and unknown references', async () => {
    await seedRecording(directory(), 2, { sessionId: 'aaaaaaaa-1111' });
    await seedRecording(directory(), 2, { sessionId: 'aaaaaaaa-2222' });
    const result = await discover();
    expect(
      SessionDiscovery.resolveContinueRef('aaaaaaaa', result.targets),
    ).toMatchObject({ error: expect.stringContaining('Ambiguous') });
    expect(
      SessionDiscovery.resolveContinueRef('unknown', result.targets),
    ).toMatchObject({ error: expect.any(String) });
  });
  it('excludes subagent children while retaining main sessions', async () => {
    const main = await seedRecording(directory());
    const child = await seedRecording(directory(), 2, { kind: 'subagent' });
    const result = await discover();
    expect(
      result.targets.map((target) =>
        target.kind === 'session'
          ? target.session.sessionId
          : target.source.sessionId,
      ),
    ).toStrictEqual([main.recording.getSessionId()]);
    expect(result.targets).not.toContainEqual(
      expect.objectContaining({
        session: expect.objectContaining({
          sessionId: child.recording.getSessionId(),
        }),
      }),
    );
  });
  it('ignores an incomplete native tail without decoding rows', async () => {
    const seed = await seedRecording(directory(), 4);
    await appendFile(seed.filePath, new Uint8Array([1, 1, 0]));
    probe().reset();
    const result = await discover();
    expect(result.recordingErrors).toStrictEqual([]);
    expect(result.targets).toHaveLength(1);
    expect(probe().reads).toBeGreaterThan(0);
    expect(probe().decodedRows).toBe(0);
  });
  it('lists retired JSONL as unreadable instead of recovering its header', async () => {
    await mkdir(directory(), { recursive: true });
    const file = join(directory(), 'session-retired.jsonl');
    await writeFile(file, '{"v":1,"seq":1,"type":"session_start"}\n');
    const result = await discover();
    expect(result.targets).toStrictEqual([]);
    expect(result.skippedCount).toBe(1);
    expect(result.recordingErrors[0]).toContain(file);
    expect(result.recordingErrors[0]).toContain('cannot be resumed');
  });
  it('lists a native empty session with no checkpoints and no invented name', async () => {
    const seed = await seedRecording(directory(), 0);
    const result = await discover();
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]).toMatchObject({
      kind: 'session',
      session: { sessionId: seed.recording.getSessionId(), messageCount: 0 },
    });
    if (result.targets[0].kind !== 'session')
      throw new Error('Expected session');
    expect(result.targets[0].session.name).toBeUndefined();
  });
  it('lists locked sessions because locking is resume policy', async () => {
    const seed = await seedRecording(directory());
    const lock = await SessionLockManager.acquire(
      directory(),
      seed.recording.getSessionId(),
    );
    try {
      expect((await discover()).targets).toHaveLength(1);
    } finally {
      await lock.release();
    }
  });
});
