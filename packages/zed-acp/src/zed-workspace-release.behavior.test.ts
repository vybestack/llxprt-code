/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  getProjectHash,
  SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { PhysicalTerminalPeer } from './__tests__/physical-terminal-peer.js';
import { unusedProfileApplication } from './test-profile-application.js';
import { ZedAgent } from './zedIntegration.js';
import { nodeChatSessionFileLister } from './zed-session-loader.js';

async function materializeRecording(
  config: Config,
  sessionId: string,
): Promise<string> {
  const recording = new SessionRecordingService({
    sessionId,
    projectHash: getProjectHash(config.getProjectRoot()),
    chatsDir: config.projectChatsDir,
    workspaceDirs: [config.getProjectRoot()],
    cwd: config.getProjectRoot(),
    provider: 'fake',
    model: 'recorded-workspace-model',
  });
  try {
    recording.recordContent({
      speaker: 'human',
      blocks: [
        {
          type: 'text',
          text: 'Physical recorded session retained before release',
        },
      ],
    });
    await recording.flush();
    const file = recording.getFilePath();
    if (file === null) throw new Error('Recording did not materialize');
    return file;
  } finally {
    await recording.dispose();
  }
}

function errorLeaves(error: unknown): unknown[] {
  if (error instanceof AggregateError) return error.errors.flatMap(errorLeaves);
  if (error instanceof Error && 'errors' in error) {
    const errors = error.errors;
    if (Array.isArray(errors)) return errors.flatMap(errorLeaves);
  }
  return [error];
}

function failKeyClose(
  authority: CredentialAuthority,
  failure: unknown,
  onClose?: () => void,
): () => void {
  const acquire = authority.createProviderKeyStorage.bind(authority);
  const capture = vi
    .spyOn(authority, 'createProviderKeyStorage')
    .mockImplementation(() => {
      const keys = acquire();
      const close = keys.close.bind(keys);
      keys.close = () => {
        close();
        onClose?.();
        throw failure;
      };
      return keys;
    });
  return () => {
    capture.mockRestore();
  };
}

describe('ACP live and durable release failures', () => {
  const credentials = useOwnedCredentials();
  it.each(['close', 'delete'])(
    'reports mandatory live cleanup failure while preserving %s durable intent',
    async (operation) => {
      const directory = await mkdtemp(join(tmpdir(), 'acp-workspace-release-'));
      const peer = new PhysicalTerminalPeer();
      const config = new Config({
        sessionId: 'durable-owner',
        cwd: directory,
        targetDir: directory,
        storageRoot: directory,
        provider: 'fake',
        model: 'workspace-model',
        debugMode: false,
      });
      const authority = credentials().authority;
      const release = new Error('physical credential transport release failed');
      const restore = failKeyClose(authority, release);
      const workspace = new ZedAgent(
        config,
        peer.connection,
        unusedProfileApplication,
        () => new SettingsService(),
        async () => [],
        undefined,
        undefined,
        { credentialAuthority: authority },
      );
      let primary: { readonly reason: unknown } | undefined;
      try {
        await peer.initialize();
        const session = await workspace.newSession({
          cwd: directory,
          mcpServers: [],
        });
        const file = await materializeRecording(config, session.sessionId);
        expect(await readFile(file, 'utf8')).toContain(
          'Physical recorded session retained before release',
        );
        const [result] = await Promise.allSettled([
          operation === 'close'
            ? workspace.closeSession({ sessionId: session.sessionId })
            : workspace.deleteSession({ sessionId: session.sessionId }),
        ]);
        expect(result.status).toBe('rejected');
        if (result.status !== 'rejected')
          throw new Error('Mandatory live cleanup failure was hidden');
        expect(errorLeaves(result.reason)).toContain(release);
        expect(credentials().snapshot()).toStrictEqual([1]);
        expect(credentials().keySnapshot()).toStrictEqual([1]);
        const [recorded] = await Promise.allSettled([readFile(file, 'utf8')]);
        expect(recorded.status).toBe(
          operation === 'close' ? 'fulfilled' : 'rejected',
        );
        if (operation === 'close')
          await workspace.deleteSession({ sessionId: session.sessionId });
        await expect(readFile(file, 'utf8')).rejects.toMatchObject({
          code: 'ENOENT',
        });
        await workspace.disposeAll();
        await expect(
          workspace.initialize({ protocolVersion: 1, clientCapabilities: {} }),
        ).rejects.toThrow('ACP workspace is disposed');
      } catch (error) {
        primary = { reason: error };
      }
      restore();
      const results = await Promise.allSettled([
        workspace.disposeAll(),
        peer.dispose(),
        config.dispose(),
      ]);
      const files = await Promise.allSettled([
        rm(directory, { recursive: true, force: true }),
      ]);
      const failures = [...results, ...files].flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length > 0)
        throw new AggregateError(
          [...(primary === undefined ? [] : [primary.reason]), ...failures],
          'Workspace fixture cleanup failed',
        );
      if (primary !== undefined) throw primary.reason;
    },
    30000,
  );
  it.each([
    { operation: 'new', closeBeforeConstruction: false },
    { operation: 'new', closeBeforeConstruction: true },
    { operation: 'load', closeBeforeConstruction: false },
    { operation: 'load', closeBeforeConstruction: true },
    { operation: 'resume', closeBeforeConstruction: false },
    { operation: 'resume', closeBeforeConstruction: true },
  ])(
    'reports late owned Session release through cached workspace shutdown %#',
    async ({ operation, closeBeforeConstruction }) => {
      const directory = await mkdtemp(join(tmpdir(), 'acp-pending-release-'));
      const peer = new PhysicalTerminalPeer();
      const config = new Config({
        sessionId: 'pending-release-owner',
        cwd: directory,
        targetDir: directory,
        provider: 'fake',
        model: 'workspace-model',
        debugMode: false,
      });
      const release = new Error('late Session key close failed');
      let closed!: () => void;
      const keyClosed = new Promise<void>((resolve) => {
        closed = resolve;
      });
      const restore = failKeyClose(credentials().authority, release, closed);
      const workspace = new ZedAgent(
        config,
        peer.connection,
        unusedProfileApplication,
        () => new SettingsService(),
        nodeChatSessionFileLister,
        undefined,
        undefined,
        { credentialAuthority: credentials().authority },
      );
      let primary: { readonly reason: unknown } | undefined;
      let released = false;
      let startupOutcome: Promise<unknown> = Promise.resolve();
      try {
        await peer.initialize();
        const sessionId = 'late-resumed-owner';
        if (operation !== 'new') await materializeRecording(config, sessionId);
        peer.holdUpdates();
        let startup: Promise<unknown>;
        if (operation === 'new') {
          startup = workspace.newSession({ cwd: directory, mcpServers: [] });
        } else if (operation === 'load') {
          startup = workspace.loadSession({
            sessionId,
            cwd: directory,
            mcpServers: [],
          });
        } else {
          startup = workspace.resumeSession({ sessionId, cwd: directory });
        }
        startupOutcome = Promise.allSettled([startup]);
        if (!closeBeforeConstruction) await peer.whenUpdated();
        const closing = workspace.disposeAll();
        const outcome = Promise.allSettled([closing]);
        expect(new Set([closing, workspace.disposeAll()]).size).toBe(1);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  'Constructed unpublished Session stayed live behind startup delivery',
                ),
              ),
            1000,
          );
        });
        try {
          await Promise.race([keyClosed, deadline]);
        } finally {
          clearTimeout(timer);
        }
        expect(credentials().keySnapshot()).toStrictEqual([1]);
        peer.releaseUpdates();
        const [[result]] = await Promise.all([outcome, startupOutcome]);
        released = true;
        expect(result.status).toBe('rejected');
        if (result.status !== 'rejected')
          throw new Error(
            'Owned late release failure was hidden from workspace disposal',
          );
        expect(errorLeaves(result.reason)).toContain(release);
        expect(
          errorLeaves(result.reason).filter((leaf) => leaf === release),
        ).toHaveLength(1);
        expect(credentials().snapshot()).toStrictEqual([1]);
        expect(credentials().keySnapshot()).toStrictEqual([1]);
      } catch (error) {
        primary = { reason: error };
      }
      peer.releaseUpdates();
      restore();
      const results = await Promise.allSettled([
        startupOutcome,
        ...(released ? [] : [workspace.disposeAll()]),
        peer.dispose(),
        config.dispose(),
      ]);
      const files = await Promise.allSettled([
        rm(directory, { recursive: true, force: true }),
      ]);
      const failures = [...results, ...files].flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length > 0)
        throw new AggregateError(
          [...(primary === undefined ? [] : [primary.reason]), ...failures],
          'Pending Session fixture cleanup failed',
        );
      if (primary !== undefined) throw primary.reason;
    },
    30000,
  );
});
