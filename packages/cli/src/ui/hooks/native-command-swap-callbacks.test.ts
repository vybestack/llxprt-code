/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { dirname } from 'node:path';
import { readdir } from 'node:fs/promises';
import {
  RecordingIntegration,
  SessionLockManager,
  createLockedSessionRecorder,
  getProjectHash,
  type SessionRecordingPort,
  type SessionMetadata,
  type LockHandle,
} from '@vybestack/llxprt-code-core';
import { CliSessionPersistence } from '../../cliSessionPersistence.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import {
  commandDeps,
  durable,
  finishFaultTest,
  nativeCommandFixture,
  recording,
  turn,
} from '../../__tests__/native-command-fixture.js';
import { processSlashCommand } from './slashCommandHandlers.js';
import type { Message } from '../types.js';

interface SwapState {
  recording: SessionRecordingPort | null;
  integration: RecordingIntegration | null;
  lock: LockHandle | null;
  metadata: SessionMetadata | null;
}

describe('native CLI recording swap callbacks', () => {
  for (const stage of ['swap', 'restore-callback', 'prior-cleanup'] as const) {
    it(`preserves the CLI swap contract through ${stage} with an actual Agent history`, async () => {
      const fixture = await nativeCommandFixture();
      const target = await fixture.agent('callback-native-target');
      let primaryFailure: unknown;
      let state: SwapState | undefined;
      try {
        await target.session.setRecording({ enabled: true });
        await turn(target, 'target rows');
        const targetPath = await recording(target);
        await target.dispose();
        const chatsDir = dirname(targetPath);
        const mediaStore = fixture.live.agentClient.mediaStore;
        if (mediaStore === undefined)
          throw new Error('Missing actual media owner');
        const original = await createLockedSessionRecorder({
          sessionId: 'raw-current',
          projectHash: getProjectHash(fixture.root),
          chatsDir,
          workspaceDirs: [fixture.root],
          provider: 'fake',
          model: 'fake-model',
          mediaStore,
        });
        const history = fixture.live.agentClient.getHistoryService();
        if (history === null)
          throw new Error('Missing actual CLI Agent history');
        const integration = new RecordingIntegration(original);
        await integration.subscribeToJournal(history, fixture.live.session);
        await turn(fixture.live, 'previous raw recording');
        await integration.flushAtTurnBoundary();
        const path = original.getFilePath();
        if (path === null) throw new Error('Missing prior native file');
        const previous: SwapState = {
          recording: original,
          integration,
          lock: original.getOwnedLockHandle(),
          metadata: {
            sessionId: 'raw-current',
            projectHash: getProjectHash(fixture.root),
            provider: 'fake',
            model: 'fake-model',
            workspaceDirs: [fixture.root],
            startTime: '2026-10-20T00:00:00.000Z',
            kind: 'main',
          },
        };
        state = previous;
        let id = 'raw-current';
        const messages: Message[] = [];
        const context = createMockCommandContext({
          services: {
            agent: fixture.live,
            config: {
              projectTempDir: dirname(chatsDir),
              getProjectRoot: () => fixture.root,
              getSessionId: () => id,
              getProvider: () => 'fake',
              getModel: () => 'fake-model',
              directories: () => [fixture.root],
              getSessionRecordingQueueByteLimit: () => 8 * 1024 * 1024,
              adoptSessionId: (value: string): void => {
                id = value;
              },
            },
          },
        });
        const persistence = new CliSessionPersistence(
          { projectRoot: fixture.root, chatsDir },
          { mediaStore },
        );
        const deps = {
          ...commandDeps(context, messages),
          sessionPersistence: persistence,
          recordingSwapCallbacks: {
            getCurrentRecording: (): SessionRecordingPort | null =>
              state?.recording ?? null,
            getCurrentIntegration: (): RecordingIntegration | null =>
              state?.integration ?? null,
            getCurrentLockHandle: (): LockHandle | null => state?.lock ?? null,
            getCurrentMetadata: (): SessionMetadata | null =>
              state?.metadata ?? null,
            setRecording: (
              recorder: SessionRecordingPort | null,
              nextIntegration: RecordingIntegration | null,
              lock: LockHandle | null,
              metadata: SessionMetadata | null,
            ): void => {
              state = {
                recording: recorder,
                integration: nextIntegration,
                lock,
                metadata,
              };
              if (stage === 'prior-cleanup') return;
              if (recorder !== original)
                throw new Error('swap callback failed after publication');
              if (stage === 'restore-callback')
                throw new Error('restore callback failed');
            },
          },
        };
        const before = {
          prior: await durable(path),
          target: await durable(targetPath),
        };
        const dispose = original.dispose.bind(original);
        const cleanup = vi
          .spyOn(original, 'dispose')
          .mockImplementation(async () => {
            await dispose();
            if (stage === 'prior-cleanup')
              throw new Error('old recorder cleanup failed');
          });
        try {
          expect(
            await processSlashCommand(
              deps,
              '/continue callback-native-target',
              undefined,
              undefined,
              false,
            ),
          ).toStrictEqual({ type: 'handled' });
        } finally {
          cleanup.mockRestore();
          persistence.close();
        }
        await verifySwap(
          stage,
          state,
          previous,
          id,
          messages,
          path,
          targetPath,
          before,
        );
        await turn(fixture.live, 'after callback transition');
        await state.integration?.flushAtTurnBoundary();
        const activePath = state.recording?.getFilePath();
        if (activePath === null || activePath === undefined)
          throw new Error('Missing current recording');
        expect((await durable(activePath)).count).toBe(4);
        const untouchedPath = stage === 'prior-cleanup' ? path : targetPath;
        const untouched =
          stage === 'prior-cleanup' ? before.prior : before.target;
        expect(await durable(untouchedPath)).toStrictEqual(untouched);
        await state.integration?.dispose();
        await state.recording?.dispose();
        state = undefined;
        expect(
          (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
        ).toStrictEqual([]);
      } catch (error) {
        primaryFailure = error;
        throw error;
      } finally {
        await state?.integration?.dispose();
        await state?.recording?.dispose();
        await finishFaultTest(fixture, target, primaryFailure);
      }
    }, 30000);
  }
});

async function verifySwap(
  stage: 'swap' | 'restore-callback' | 'prior-cleanup',
  state: SwapState,
  previous: SwapState,
  id: string,
  messages: Message[],
  path: string,
  targetPath: string,
  before: {
    prior: Awaited<ReturnType<typeof durable>>;
    target: Awaited<ReturnType<typeof durable>>;
  },
): Promise<void> {
  const details = messages
    .map((message) => ('content' in message ? message.content : message.type))
    .join('; ');
  if (stage === 'prior-cleanup') {
    expect(details).toContain(
      'Session transition committed but prior-session cleanup failed: old recorder cleanup failed',
    );
    expect(messages.every((message) => message.type !== 'error')).toBe(true);
    expect(state.recording?.getFilePath()).toBe(targetPath);
    expect(state.recording?.isActive()).toBe(true);
    expect(id).toBe('callback-native-target');
    expect(
      await SessionLockManager.isLocked(dirname(path), 'raw-current'),
    ).toBe(false);
    return;
  }
  expect(details).toContain('swap callback failed after publication');
  const required =
    stage === 'restore-callback'
      ? ['restore callback failed', 'rollback failed']
      : [];
  for (const detail of required) expect(details).toContain(detail);
  expect(state).toStrictEqual(previous);
  expect(id).toBe('raw-current');
  expect(previous.recording?.isActive()).toBe(true);
  expect(await durable(path)).toStrictEqual(before.prior);
  expect(await durable(targetPath)).toStrictEqual(before.target);
  expect(
    await SessionLockManager.isLocked(dirname(path), 'callback-native-target'),
  ).toBe(false);
}
