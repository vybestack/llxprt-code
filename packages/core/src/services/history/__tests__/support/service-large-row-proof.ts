/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll, beforeAll, expect } from 'bun:test';
import {
  ageOutIdleCode,
  medianSettledHeap,
} from '../../../../journal/__tests__/support/compactionMemory.js';
import { resumeSession } from '../../../../recording/resumeSession.js';
import { RecordingIntegration } from '../../../../recording/RecordingIntegration.js';
import { historyOriginId } from '../../historyOriginId.js';
import type { IContent } from '../../IContent.js';
import {
  admitLargeRow,
  diskDigest,
  LARGE_METADATA,
  largeHistory,
  largeRig,
  MIB,
  publicDigest,
  type RowDigest,
} from './service-large-row.js';

type Rig = Awaited<ReturnType<typeof largeRig>>;
type Persisted = Awaited<ReturnType<typeof diskDigest>>;
type Sample = (label: string) => Promise<number>;
export interface LargeRoundTrip {
  readonly bytes: number;
  readonly hash: string;
  readonly admissionGrowth: number;
  readonly growth: readonly number[];
  readonly retained: readonly IContent[];
}

export function largeRowAccepted(result: LargeRoundTrip): boolean {
  return (
    result.admissionGrowth < MIB &&
    result.growth.every((growth) => growth < MIB)
  );
}

async function warmLargeRow(bytes: number): Promise<void> {
  await roundTrip(
    await largeRig(),
    await medianSettledHeap('warm'),
    bytes,
    false,
    medianSettledHeap,
  );
}

async function recordMeasurement(
  result: LargeRoundTrip,
  trap: boolean,
): Promise<void> {
  const directory = process.env['W21_LARGE_ROW_EVIDENCE'];
  if (directory === undefined) return;
  await Bun.write(
    `${directory}/${result.bytes / MIB}-${trap ? 'trap' : 'bounded'}.json`,
    JSON.stringify(
      {
        bytes: result.bytes,
        hash: result.hash,
        admissionGrowth: result.admissionGrowth,
        growth: result.growth,
        heldRows: result.retained.length,
        accepted: largeRowAccepted(result),
      },
      null,
      2,
    ),
  );
}

export function useLargeRowProof(
  size: number,
): (trap?: boolean) => Promise<LargeRoundTrip> {
  let prepared: { rig: Rig; baseline: number } | undefined;
  beforeAll(async () => {
    await ageOutIdleCode();
    await warmLargeRow(size * MIB);
    const rig = await largeRig();
    prepared = { rig, baseline: Number.NaN };
    prepared = { rig, baseline: await medianSettledHeap('before admission') };
  }, 60_000);
  afterAll(async () => {
    if (prepared !== undefined) await prepared.rig.close();
  });
  return async (trap = false) => {
    if (prepared === undefined || !Number.isFinite(prepared.baseline))
      throw new Error('Missing warmed large-row fixture');
    const retaining = trap || process.env['W21_LARGE_ROW_RETAIN'] === '1';
    const result = await roundTrip(
      prepared.rig,
      prepared.baseline,
      size * MIB,
      retaining,
      medianSettledHeap,
    );
    await recordMeasurement(result, retaining);
    return result;
  };
}

async function roundTrip(
  rig: Rig,
  baseline: number,
  bytes: number,
  trap: boolean,
  sample: Sample,
): Promise<LargeRoundTrip> {
  const retained: IContent[] = [];
  try {
    const written = await admitLargeRow(rig.history, rig.origin, bytes);
    await rig.integration.flushAtTurnBoundary();
    const admissionGrowth =
      (await sample('after admission and mirror flush')) - baseline;
    const expected: RowDigest[] = [
      { ...written, speaker: 'human', metadata: LARGE_METADATA, blocks: 1 },
    ];
    expect(await publicDigest(rig.history, retained, trap)).toStrictEqual(
      expected,
    );
    const persisted = await diskDigest(rig.recording);
    expect(persisted.rows).toStrictEqual(expected);
    expect(persisted.owners).toStrictEqual([historyOriginId(rig.origin)]);
    expect(persisted.offsets).toHaveLength(1);
    expect(persisted.offsets[0]).toBeGreaterThan(0);
    expect(persisted.bodyBytes[0]).toBeGreaterThan(bytes);
    expect(persisted.offsets[0] + persisted.bodyBytes[0]).toBeLessThan(
      persisted.durableEnd,
    );
    const afterRead =
      (await sample('after public and independent mirror reads')) - baseline;
    const resumed = await resumeAndContinue(
      rig,
      expected,
      persisted,
      sample,
      baseline,
    );
    return {
      bytes,
      hash: written.hash,
      admissionGrowth,
      growth: [afterRead, ...resumed],
      retained,
    };
  } finally {
    await rig.close();
  }
}

async function resumeAndContinue(
  rig: Rig,
  expected: readonly RowDigest[],
  persisted: Persisted,
  sample: Sample,
  baseline: number,
): Promise<number[]> {
  const sessionId = rig.recording.getSessionId();
  const projectHash = rig.recording.getProjectHash();
  const originalPath = rig.recording.getFilePath();
  await rig.close();
  const resumed = await resumeSession(
    {
      continueRef: sessionId,
      projectHash,
      chatsDir: rig.directory,
      currentProvider: 'anthropic',
      currentModel: 'large-row-model',
      workspaceDirs: ['/work'],
    },
    { LLXPRT_HISTORY_BACKEND: 'journal' },
  );
  if (!resumed.ok) throw new Error(resumed.error);
  const restored = largeHistory();
  const integration = new RecordingIntegration(resumed.recording);
  try {
    await restored.adoptResumeBoot(resumed.recording, resumed.boot);
    await integration.subscribeToJournal(restored, rig.origin);
    expect(resumed.recording.getFilePath()).toBe(originalPath);
    expect(resumed.recording.getSessionId()).toBe(sessionId);
    expect(resumed.recording.getProjectHash()).toBe(projectHash);
    expect(await publicDigest(restored)).toStrictEqual([...expected]);
    expect(await diskDigest(resumed.recording)).toStrictEqual(persisted);
    const afterResume =
      (await sample('after fresh adoption and resumed reads')) - baseline;
    await restored.addBatch(
      [{ speaker: 'ai', blocks: [{ type: 'text', text: 'after resume' }] }],
      undefined,
      { origin: rig.origin },
    );
    await integration.flushAtTurnBoundary();
    const continued = await publicDigest(restored);
    const disk = await diskDigest(resumed.recording);
    expect(continued).toHaveLength(2);
    expect(continued[0]).toStrictEqual(expected[0]);
    expect(disk.rows).toStrictEqual(continued);
    expect(disk.owners).toStrictEqual([
      historyOriginId(rig.origin),
      historyOriginId(rig.origin),
    ]);
    expect(disk.offsets[0]).toBe(persisted.offsets[0]);
    expect(disk.offsets[1]).toBe(persisted.durableEnd);
    const afterContinue =
      (await sample('after continued durable write and reads')) - baseline;
    return [afterResume, afterContinue];
  } finally {
    await integration.dispose();
    await restored.dispose();
    await resumed.recording.dispose();
  }
}
