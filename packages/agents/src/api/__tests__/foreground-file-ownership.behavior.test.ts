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
import { resolveProviderFilePolicy } from '@vybestack/llxprt-code-providers';

import type { Agent } from '../agent.js';
import { fromConfig } from '../fromConfig.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';

function retainedFile(
  agent: Agent,
  deleteRemote: (fileId: string) => Promise<void>,
  mode: 'session' | 'workspace' = 'session',
) {
  return agent.retainProviderFile({
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
    deleteRemote,
  });
}

describe('foreground Agent provider-file ownership', () => {
  const credentials = useOwnedCredentials();
  const retiring: Array<() => void | Promise<void>> = [];
  let first: Agent;
  let second: Agent;
  let firstConfig: Config;
  let firstDisposalFailure: unknown;
  afterEach(async () => {
    await runCleanupSteps(retiring.splice(0).reverse());
  });
  async function openAgent(
    runtimeId: string,
    prefix: string,
  ): Promise<{ agent: Agent; config: Config }> {
    const raw = await mkdtemp(join(tmpdir(), prefix));
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
      retiring.push(() => config.dispose());
      const agent = await fromConfig(
        config,
        new SettingsService(),
        { sessionId: runtimeId },
        credentials().authority,
      );
      retiring.push(() =>
        agent.dispose().catch((error: unknown) => {
          if (error !== firstDisposalFailure) throw error;
        }),
      );
      return { agent, config };
    } catch (primary) {
      return cleanupAfterFailure(primary, () =>
        runCleanupSteps(retiring.splice(0).reverse()),
      );
    }
  }
  async function openFirst(runtimeId: string): Promise<void> {
    const opened = await openAgent(runtimeId, 'foreground-file-owner-');
    first = opened.agent;
    firstConfig = opened.config;
  }
  async function openSecond(runtimeId: string): Promise<void> {
    second = (await openAgent(runtimeId, 'foreground-file-peer-')).agent;
  }
  it('joins disposal while a session file is retained without retiring its file scope early', async () => {
    await openFirst('retained-owner');
    const retained = await retainedFile(first, async () => {});
    let settled = false;
    const closing = first.dispose().then(() => {
      settled = true;
    });
    try {
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(first.captureProviderFiles().retainedFiles).toBe(1);
    } finally {
      await retained.lease.release();
      await closing;
    }
  });
  it('awaits session file deletion on the owning lifecycle before disposal', async () => {
    await openFirst('deleting-owner');
    const deleted: string[] = [];
    const retained = await retainedFile(first, async (id) => {
      await Promise.resolve();
      deleted.push(id);
    });
    await retained.lease.release();
    await expect(first.dispose()).resolves.toBeUndefined();
    expect(deleted).toStrictEqual(['owner-file']);
  });
  it('keeps a failed file on its exact owner and retries deletion without touching a same-label sibling', async () => {
    await openFirst('failed-owner');
    await openSecond('failed-owner');
    let unavailable = true;
    const deleted: string[] = [];
    const retained = await retainedFile(first, async (id) => {
      if (unavailable) throw new Error('provider deletion unavailable');
      deleted.push(id);
    });
    try {
      await retained.lease.release();
      const closing = first.dispose();
      await closing.catch((error: unknown) => {
        firstDisposalFailure = error;
      });
      await expect(closing).rejects.toThrow(
        /Provider file cleanup incomplete.*failed=1/,
      );
      expect(first.captureProviderFiles().deletionFailures).toStrictEqual(
        expect.arrayContaining([
          expect.objectContaining({ fileId: 'owner-file' }),
        ]),
      );
      unavailable = false;
      const retried = await first.retryProviderFileDeletions();
      expect(retried.failed).toBe(0);
      expect(deleted).toStrictEqual(['owner-file']);
      expect(second.captureProviderFiles().retainedFiles).toBe(0);
      await expect(second.dispose()).resolves.toBeUndefined();
    } finally {
      unavailable = false;
      await first.retryProviderFileDeletions();
    }
  });
  it('waits for the last lease before finishing deferred deletion', async () => {
    await openFirst('deferred-owner');
    const deleted: string[] = [];
    const retained = await retainedFile(first, async (id) => {
      deleted.push(id);
    });
    let settled = false;
    const closing = first.dispose().then(() => {
      settled = true;
    });
    try {
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(first.captureProviderFiles().retainedFiles).toBe(1);
      expect(deleted).toStrictEqual([]);
    } finally {
      await retained.lease.release();
      await closing;
    }
    expect(deleted).toStrictEqual(['owner-file']);
  });
  it('does not delete retained workspace files when the session ends', async () => {
    await openFirst('workspace-owner');
    const deleted: string[] = [];
    const retained = await retainedFile(
      first,
      async (id) => {
        deleted.push(id);
      },
      'workspace',
    );
    await retained.lease.release();
    await first.dispose();
    expect(deleted).toStrictEqual([]);
  });
  it('separates lifecycles even when foreground owners use the same label', async () => {
    await openFirst('same-label');
    await openSecond('same-label');
    const retained = await retainedFile(first, async () => {});
    let firstSettled = false;
    const closing = first.dispose().then(() => {
      firstSettled = true;
    });
    try {
      expect(first.captureProviderFiles().retainedFiles).toBe(1);
      expect(second.captureProviderFiles().retainedFiles).toBe(0);
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
    const firstFile = await retainedFile(first, async (id) => {
      a.push(id);
    });
    const secondFile = await retainedFile(second, async (id) => {
      b.push(id);
    });
    await firstFile.lease.release();
    await secondFile.lease.release();
    await first.dispose();
    expect(a).toStrictEqual(['owner-file']);
    expect(b).toStrictEqual([]);
    await second.dispose();
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
    expect(second.getProvider()).toBeDefined();
    await expect(second.dispose()).resolves.toBeUndefined();
  });
  it('does not expose ambient runtime identity through its public factory', async () => {
    const factory = await import('../index.js');
    expect(Object.keys(factory)).not.toContain('enterRuntimeScope');
  });
});
