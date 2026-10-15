/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { fromConfig } from '../../../agents/src/api/fromConfig.js';
import type { Agent } from '../../../agents/src/api/agent.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  ProviderFileLifecycle,
  resolveProviderFilePolicy,
} from '../providerFilePolicy.js';
import { releaseAdoptedFileScope } from '../../../agents/src/api/adoption-release.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../agents/src/core/subagent-cleanup.js';

function retainedFile(
  files: ProviderFileLifecycle,
  scopeId: string,
  deleteRemote: (fileId: string) => Promise<void>,
  mode: 'session' | 'workspace' = 'session',
) {
  return files.retain({
    cacheKey: 'owner-content',
    fileId: 'owner-file',
    bytes: 10,
    identity: {
      provider: 'kimi',
      baseURL: 'https://api.kimi.test/v1',
      credentialHash: 'owner-credential',
    },
    policy: resolveProviderFilePolicy({
      configuredMode: mode,
      configuredRetentionMs: 60000,
      configuredDeletion: mode === 'session' ? 'delete' : 'retain',
      providerFileReferences: true,
      zeroDataRetention: 'incompatible-while-retained',
      zeroDataRetentionRequired: false,
    }),
    scopeId: mode === 'session' ? scopeId : '/workspace/a',
    deleteRemote,
  });
}

describe('foreground Agent provider-file ownership', () => {
  const credentials = useOwnedCredentials();
  const retiring: Array<() => void | Promise<void>> = [];
  let first: Agent;
  let second: Agent;
  let firstConfig: Config;
  let secondConfig: Config;
  let observedSecondConfig: Config | undefined;
  let firstDisposalFailure: unknown;
  let firstFiles: ProviderFileLifecycle;
  let secondFiles: ProviderFileLifecycle;
  afterEach(async () => {
    await runCleanupSteps(retiring.splice(0).reverse());
  });
  async function openFirst(runtimeId: string): Promise<void> {
    const raw = await mkdtemp(join(tmpdir(), 'foreground-file-owner-'));
    retiring.push(() => rm(raw, { recursive: true, force: true }));
    try {
      const directory = await realpath(raw);
      const config = new Config({
        sessionId: runtimeId,
        targetDir: directory,
        cwd: directory,
        model: 'test-model',
        debugMode: false,
      });
      firstConfig = config;
      retiring.push(() => config.dispose());
      const settings = new SettingsService();
      const owner = new SessionSettingsOwner(settings);
      retiring.push(() => owner.dispose());
      owner.bindTelemetry(config);
      firstFiles = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      const agent = await fromConfig({
        config,
        settingsService: settings,
        settingsOwner: owner,
        credentialAuthority: credentials().authority,
        sessionId: runtimeId,
        providerFileLifecycle: firstFiles,
      });
      first = agent;
      retiring.push(() =>
        agent.dispose().catch((error: unknown) => {
          if (error !== firstDisposalFailure) throw error;
        }),
      );
    } catch (primary) {
      await cleanupAfterFailure(primary, () =>
        runCleanupSteps(retiring.splice(0).reverse()),
      );
    }
  }
  async function openSecond(runtimeId: string): Promise<void> {
    const raw = await mkdtemp(join(tmpdir(), 'foreground-file-peer-'));
    retiring.push(() => rm(raw, { recursive: true, force: true }));
    try {
      const directory = await realpath(raw);
      const config = new Config({
        sessionId: runtimeId,
        targetDir: directory,
        cwd: directory,
        model: 'test-model',
        debugMode: false,
      });
      secondConfig = config;
      retiring.push(() => config.dispose());
      const settings = new SettingsService();
      const owner = new SessionSettingsOwner(settings);
      retiring.push(() => owner.dispose());
      owner.bindTelemetry(config);
      secondFiles = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      const agent = await fromConfig({
        config,
        settingsService: settings,
        settingsOwner: owner,
        credentialAuthority: credentials().authority,
        sessionId: runtimeId,
        providerFileLifecycle: secondFiles,
        prepareSessionTools: (config) => {
          observedSecondConfig = config;
        },
      });
      second = agent;
      retiring.push(() => agent.dispose());
    } catch (primary) {
      await cleanupAfterFailure(primary, () =>
        runCleanupSteps(retiring.splice(0).reverse()),
      );
    }
  }
  it('joins disposal while a session file is retained without retiring its file scope early', async () => {
    await openFirst('retained-owner');
    const retained = await retainedFile(
      firstFiles,
      first.getRuntimeId(),
      async () => {},
    );
    let settled = false;
    const closing = first.dispose().then(() => {
      settled = true;
    });
    try {
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(firstFiles.retainsScope('session', first.getRuntimeId())).toBe(
        true,
      );
    } finally {
      await retained.lease.release();
      await closing;
    }
  });
  it('awaits session file deletion on the owning lifecycle before disposal', async () => {
    await openFirst('deleting-owner');
    const deleted: string[] = [];
    const retained = await retainedFile(
      firstFiles,
      first.getRuntimeId(),
      async (id) => {
        await Promise.resolve();
        deleted.push(id);
      },
    );
    await retained.lease.release();
    const result = await firstFiles.cleanupScope(
      'session',
      first.getRuntimeId(),
    );
    expect(result.failed).toBe(0);
    expect(deleted).toStrictEqual(['owner-file']);
    await expect(first.dispose()).resolves.toBeUndefined();
  });
  it('keeps a failed file on its exact owner and retries deletion without touching a same-label sibling', async () => {
    await openFirst('failed-owner');
    await openSecond('failed-owner');
    let unavailable = true;
    const deleted: string[] = [];
    const retained = await retainedFile(
      firstFiles,
      first.getRuntimeId(),
      async (id) => {
        if (unavailable) throw new Error('provider deletion unavailable');
        deleted.push(id);
      },
    );
    try {
      await retained.lease.release();
      const result = await firstFiles.cleanupScope(
        'session',
        first.getRuntimeId(),
      );
      expect(result.failed).toBe(1);
      expect(firstFiles.snapshot().deletionFailures).toStrictEqual(
        expect.arrayContaining([
          expect.objectContaining({ fileId: 'owner-file' }),
        ]),
      );
      const closing = first.dispose();
      await closing.catch((error: unknown) => {
        firstDisposalFailure = error;
      });
      await expect(closing).rejects.toThrow('Provider file cleanup incomplete');
      unavailable = false;
      const retried = await firstFiles.retryDeletions();
      expect(retried.failed).toBe(0);
      expect(deleted).toStrictEqual(['owner-file']);
      expect(observedSecondConfig).toBe(secondConfig);
    } finally {
      unavailable = false;
      await firstFiles.retryDeletions();
    }
  });
  it('waits for the last lease before finishing deferred deletion', async () => {
    await openFirst('deferred-owner');
    const deleted: string[] = [];
    const retained = await retainedFile(
      firstFiles,
      first.getRuntimeId(),
      async (id) => {
        deleted.push(id);
      },
    );
    const cleanup = await firstFiles.cleanupScope(
      'session',
      first.getRuntimeId(),
    );
    expect(cleanup.deferred).toBe(1);
    await retained.lease.release();
    await firstFiles.waitForScopeCleanup('session', first.getRuntimeId());
    expect(deleted).toStrictEqual(['owner-file']);
  });
  it('does not delete retained workspace files when the session ends', async () => {
    await openFirst('workspace-owner');
    const deleted: string[] = [];
    const retained = await retainedFile(
      firstFiles,
      first.getRuntimeId(),
      async (id) => {
        deleted.push(id);
      },
      'workspace',
    );
    await retained.lease.release();
    await firstFiles.cleanupScope('session', first.getRuntimeId());
    await first.dispose();
    expect(deleted).toStrictEqual([]);
  });
  it('separates lifecycles even when foreground owners use the same label', async () => {
    await openFirst('same-label');
    await openSecond('same-label');
    const retained = await retainedFile(
      firstFiles,
      first.getRuntimeId(),
      async () => {},
    );
    let firstSettled = false;
    const closing = first.dispose().then(() => {
      firstSettled = true;
    });
    try {
      expect(firstFiles).not.toBe(secondFiles);
      expect(secondFiles.snapshot().retainedFiles).toBe(0);
      await expect(second.dispose()).resolves.toBeUndefined();
      await Promise.resolve();
      expect(firstSettled).toBe(false);
    } finally {
      await retained.lease.release();
      await closing;
    }
  });
  it('cleans only the requested owner lifecycle for two equal-label owners', async () => {
    await openFirst('shared-file-label');
    await openSecond('shared-file-label');
    const a: string[] = [];
    const b: string[] = [];
    const firstFile = await retainedFile(
      firstFiles,
      first.getRuntimeId(),
      async (id) => {
        a.push(id);
      },
    );
    const secondFile = await retainedFile(
      secondFiles,
      second.getRuntimeId(),
      async (id) => {
        b.push(id);
      },
    );
    await firstFile.lease.release();
    await secondFile.lease.release();
    await releaseAdoptedFileScope(firstFiles, first.getRuntimeId());
    expect(a).toStrictEqual(['owner-file']);
    expect(b).toStrictEqual([]);
    await releaseAdoptedFileScope(secondFiles, second.getRuntimeId());
    expect(b).toStrictEqual(['owner-file']);
  });
  it('rejects cleanup when a caller supplies no provider-file owner', async () => {
    await expect(
      Reflect.apply(releaseAdoptedFileScope, undefined, [
        undefined,
        'ownerless-file',
      ]),
    ).rejects.toThrow('cleanupScope');
  });
  it('disposed foreground authority cannot be used again while its same-label sibling remains owned', async () => {
    await openFirst('disposed-owner');
    await openSecond('disposed-owner');
    await first.dispose();
    expect('providerManager' in firstConfig).toBe(false);
    await expect(first.setProvider('openai')).rejects.toThrow(
      'Session settings owner is closed',
    );
    expect(observedSecondConfig).toBe(secondConfig);
  });
  it('does not expose ambient runtime identity through its public factory', async () => {
    const factory = await import('../../../agents/src/api/index.js');
    expect(Object.keys(factory)).not.toContain('enterRuntimeScope');
  });
});
