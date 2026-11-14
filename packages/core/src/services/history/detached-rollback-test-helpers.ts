/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import type { SessionRecordingPort } from '../../recording/recordingPort.js';
import {
  withNativeDetachedFixture,
  type NativeDetachedFixture,
} from './__tests__/support/detached-contract-fixture.js';
import {
  durableRowsOf,
  rollbackRow,
} from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';

export function detachedRow(index: number, bytes = 2048): IContent {
  return {
    ...rollbackRow(index, bytes),
    metadata: {
      id: 'duplicate',
      chronology: {
        seq: index + 1,
        userTurn: index + 1,
        step: 0,
        recordedAt: 0,
      },
    },
  };
}

export async function* detachedRows(
  size: number,
  bytes = 2048,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) yield detachedRow(index, bytes);
}

export interface DetachedFixture extends NativeDetachedFixture {
  readonly recorder: SessionRecordingPort;
}

export async function withDetachedFixture<T>(
  action: (fixture: DetachedFixture) => Promise<T>,
  pending = false,
): Promise<T> {
  return withNativeDetachedFixture(async (fixture) => {
    if (pending) fixture.pauseWriter();
    return action({
      ...fixture,
      recorder: fixture.recording,
    });
  });
}

export async function detachedDigest(
  rows: AsyncIterable<IContent>,
): Promise<{ count: number; bytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let count = 0;
  let bytes = 0;
  for await (const row of rows) {
    const value = JSON.stringify(row);
    hash.update(value + '\n');
    bytes += Buffer.byteLength(value);
    count++;
  }
  return { count, bytes, sha256: hash.digest('hex') };
}

export async function detachedDurableDigest(
  recorder: SessionRecordingPort,
): Promise<Awaited<ReturnType<typeof detachedDigest>>> {
  return detachedDigest(
    (async function* () {
      yield* await durableRowsOf(recorder);
    })(),
  );
}
