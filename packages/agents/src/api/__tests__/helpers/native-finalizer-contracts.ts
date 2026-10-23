/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { SessionLockManager } from '@vybestack/llxprt-code-core/recording/SessionLockManager.js';
import { expect } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { drain } from './agentHarness.js';
import { nativeFinalizerFiles } from './native-finalizer-files.js';
import {
  nativeRows,
  requireRecordingPath,
  rowTexts,
} from './native-session-fixture.js';
import { withRecordingFinalizerFixture } from './recording-finalizer-join-fixture.js';

type FinalizerFixture = Parameters<
  Parameters<typeof withRecordingFinalizerFixture>[0]
>[0];
type NativeFixture = FinalizerFixture & {
  readonly files: ReturnType<typeof nativeFinalizerFiles>;
};

function containsCause(error: unknown, cause: Error): boolean {
  if (error === cause) return true;
  if (!(error instanceof Error)) return false;
  if (containsCause(error.cause, cause)) return true;
  return (
    'errors' in error &&
    Array.isArray(error.errors) &&
    error.errors.some((nested: unknown) => containsCause(nested, cause))
  );
}

async function withNativeFinalizerFixture(
  scenario: (fixture: NativeFixture) => Promise<void>,
): Promise<void> {
  await (() =>
    withRecordingFinalizerFixture(async (fixture) => {
      const files = nativeFinalizerFiles(fixture.chatsDir);
      try {
        await scenario({ ...fixture, files });
      } finally {
        files.release.release();
        await Promise.allSettled([fixture.agent.dispose()]);
        files.restore();
      }
    }))();
}

function expectReleasedReaders(files: NativeFixture['files']): void {
  expect(files.openHandles).toBe(0);
  expect(files.ownership.snapshot().acquisitions).toBeGreaterThan(0);
  expect(files.ownership.snapshot().liveRows).toBe(0);
  expect(files.ownership.snapshot().liveSerializedBytes).toBe(0);
}

export async function joinNativePublicTurn(): Promise<void> {
  await withNativeFinalizerFixture(
    async ({ agent, chatsDir, sessionId, files }) => {
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'journal-seed' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = requireRecordingPath(agent.session.getRecording().path);
      files.arm({ kind: 'records', text: 'turn one reply' });
      let turnSettled = false;
      const turn = drain(
        agent.stream('public-turn-before-final-append'),
      ).finally(() => {
        turnSettled = true;
      });
      let disposal: Promise<void> | undefined;
      try {
        await files.entered.promise;
        expect(files.held?.path).toBe(path);
        expect(files.held?.position).toBeGreaterThan(0);
        expect(rowTexts(await nativeRows(path))).not.toContain(
          'turn one reply',
        );
        let settled = false;
        disposal = agent.dispose();
        expect(agent.dispose()).toBe(disposal);
        void disposal.then(() => {
          settled = true;
        });
        await expect(
          agent.session.setRecording({ enabled: true }),
        ).rejects.toThrow(/disposed|closed/);
        await setImmediate();
        expect(settled).toBe(false);
        expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(
          true,
        );
        files.release.release();
        await disposal;
        expect(turnSettled).toBe(true);
        expect(files.openHandles).toBe(0);
        await turn;
        expect(rowTexts(await nativeRows(path))).toStrictEqual([
          'journal-seed',
          'public-turn-before-final-append',
          'turn one reply',
        ]);
        expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(
          false,
        );
        expectReleasedReaders(files);
      } finally {
        files.release.release();
        await Promise.allSettled([turn, disposal]);
      }
    },
  );
}

async function pauseNativePersistence(
  { agent, files }: NativeFixture,
  fault: 'none' | 'trailer' | 'flush',
): Promise<{
  readonly history: NonNullable<
    ReturnType<NativeFixture['agent']['agentClient']['getHistoryService']>
  >;
  readonly path: string;
  readonly before: Awaited<ReturnType<typeof nativeRows>>;
  readonly failure: Error;
  readonly accepted: Promise<unknown>;
  readonly flushSettled: () => boolean;
}> {
  const history = agent.agentClient.getHistoryService();
  if (!history) throw new Error('Missing real history');
  await agent.setHistory([
    { speaker: 'human', blocks: [{ type: 'text', text: 'finalizer-seed' }] },
  ]);
  await agent.session.setRecording({ enabled: true });
  await drain(agent.stream('public-turn-before-recording-finalizer'));
  await agent.session.flushRecording();
  const path = requireRecordingPath(agent.session.getRecording().path);
  const before = await nativeRows(path);
  expect(rowTexts(before)).toStrictEqual([
    'finalizer-seed',
    'public-turn-before-recording-finalizer',
    'turn one reply',
  ]);
  const failure = new Error(`Accepted native ${fault} failed`);
  files.arm({
    kind: fault === 'flush' ? 'records' : 'trailer',
    ...(fault === 'none' ? {} : { failure }),
    failFlush: fault === 'flush',
  });
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'accepted-history-before-finalizer' }],
  });
  let flushSettled = false;
  const accepted = agent.session.flushRecording().then(
    () => {
      flushSettled = true;
      return undefined;
    },
    (error: unknown) => {
      flushSettled = true;
      return error;
    },
  );
  await files.entered.promise;
  expect(files.held?.path).toBe(path);
  expect(files.held?.position).toBeGreaterThan(0);
  expect(await nativeRows(path)).toStrictEqual(before);
  return {
    history,
    path,
    before,
    failure,
    accepted,
    flushSettled: () => flushSettled,
  };
}

async function finishNativePersistence(
  { agent, chatsDir, sessionId, files }: NativeFixture,
  paused: Awaited<ReturnType<typeof pauseNativePersistence>>,
  terminal: 'stop' | 'dispose',
  fault: 'none' | 'trailer' | 'flush',
): Promise<void> {
  const flushesBeforeRelease = files.flushes;
  let settled = false;
  const operation =
    terminal === 'dispose'
      ? agent.dispose()
      : agent.session.setRecording({ enabled: false });
  const ending = operation.then(
    () => {
      settled = true;
      return undefined;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  try {
    if (terminal === 'dispose') {
      expect(agent.dispose()).toBe(operation);
      await expect(agent.session.flushRecording()).rejects.toThrow(
        /disposed|closed/,
      );
    }
    await setImmediate();
    expect(settled).toBe(false);
    expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(true);
    files.release.release();
    const result = await ending;
    expect(paused.flushSettled()).toBe(true);
    expect(files.openHandles).toBe(0);
    const flushed = await paused.accepted;
    expect(containsCause(flushed, paused.failure)).toBe(fault !== 'none');
    expect(flushed === undefined).toBe(fault === 'none');
    expect(result).toBeUndefined();
    expect(flushesBeforeRelease).toBeGreaterThan(0);
    if (fault === 'flush') expect(files.flushes - flushesBeforeRelease).toBe(1);
    expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(false);
    expect(agent.session.getRecording().enabled).toBe(false);
    const committed = await nativeRows(paused.path);
    if (fault === 'none')
      expect(rowTexts(committed)).toStrictEqual([
        ...rowTexts(paused.before),
        'accepted-history-before-finalizer',
      ]);
    else expect(committed).toStrictEqual(paused.before);
    await expectClosedRecordingUnchanged(agent, chatsDir, paused);
    expectReleasedReaders(files);
  } finally {
    files.release.release();
    await Promise.allSettled([ending, paused.accepted]);
  }
}

async function expectClosedRecordingUnchanged(
  agent: NativeFixture['agent'],
  chatsDir: string,
  { path, history }: Awaited<ReturnType<typeof pauseNativePersistence>>,
): Promise<void> {
  const bytes = await readFile(path);
  const entries = (await readdir(chatsDir)).sort();
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'late-history-after-finalizer' }],
  });
  await history.waitForCommit();
  await agent.dispose();
  await expect(agent.session.setRecording({ enabled: true })).rejects.toThrow(
    /disposed|closed/,
  );
  expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
  expect((await readdir(chatsDir)).sort()).toStrictEqual(entries);
}

export async function joinNativePersistence(
  terminal: 'stop' | 'dispose',
  fault: 'none' | 'trailer' | 'flush',
): Promise<void> {
  await withNativeFinalizerFixture(async (fixture) => {
    const paused = await pauseNativePersistence(fixture, fault);
    await finishNativePersistence(fixture, paused, terminal, fault);
  });
}

export async function disposeLazyNativeRecording(): Promise<void> {
  await (() =>
    withRecordingFinalizerFixture(async ({ agent, chatsDir, sessionId }) => {
      await agent.session.setRecording({ enabled: true });
      expect(agent.session.getRecording().path).toBeUndefined();
      expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(true);
      const files = await readdir(chatsDir);
      expect(files.filter((file) => file.endsWith('.llxj'))).toStrictEqual([]);
      await agent.dispose();
      expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(
        false,
      );
      await expect(
        agent.session.setRecording({ enabled: true }),
      ).rejects.toThrow(/disposed|closed/);
      expect(
        (await readdir(chatsDir)).filter(
          (file) => file.endsWith('.llxj') || file.endsWith('.lock'),
        ),
      ).toStrictEqual([]);
    }))();
}
