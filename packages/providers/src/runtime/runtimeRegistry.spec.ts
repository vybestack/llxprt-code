import { createProviderConfigFixture } from './__tests__/provider-config-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { beginCliRuntimeRegistration } from './cliForegroundRuntime.js';
import { resolveProviderFilePolicy } from '../providerFilePolicy.js';
import { cleanupOwnedProviderFiles } from './ownedProviderFiles.js';

function foreground(runtimeId: string) {
  const settingsService = new SettingsService();
  const { config: config } = createProviderConfigFixture({
    sessionId: runtimeId,
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'test-model',
    settingsService,
  });
  const registration = beginCliRuntimeRegistration(settingsService, config, {
    runtimeId,
  });
  return { config, registration };
}

function retainedFile(
  owner: ReturnType<typeof foreground>,
  deleteRemote: (fileId: string) => Promise<void>,
  mode: 'session' | 'workspace' = 'session',
) {
  return owner.registration.providerFileLifecycle.retain({
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
      configuredRetentionMs: 60_000,
      configuredDeletion: mode === 'session' ? 'delete' : 'retain',
      providerFileReferences: true,
      zeroDataRetention: 'incompatible-while-retained',
      zeroDataRetentionRequired: false,
    }),
    scopeId: mode === 'session' ? owner.registration.runtimeId : '/workspace/a',
    deleteRemote,
  });
}

describe('foreground provider-file ownership', () => {
  it('refuses disposal while a session file is retained', async () => {
    const owner = foreground('retained-owner');
    const retained = await retainedFile(owner, async () => undefined);
    try {
      expect(() => owner.registration.dispose()).toThrow(
        'provider-file lifecycle',
      );
      expect(
        owner.registration.providerFileLifecycle.retainsScope(
          'session',
          owner.registration.runtimeId,
        ),
      ).toBe(true);
    } finally {
      await retained.lease.release();
      await owner.registration.providerFileLifecycle.cleanupScope(
        'session',
        owner.registration.runtimeId,
      );
      owner.registration.dispose();
      await owner.config.dispose();
    }
  });

  it('awaits session file deletion on the owning lifecycle before disposal', async () => {
    const owner = foreground('deleting-owner');
    const deleted: string[] = [];
    const retained = await retainedFile(owner, async (fileId) => {
      await Promise.resolve();
      deleted.push(fileId);
    });
    try {
      await retained.lease.release();
      const result =
        await owner.registration.providerFileLifecycle.cleanupScope(
          'session',
          owner.registration.runtimeId,
        );
      expect(result.failed).toBe(0);
      expect(deleted).toStrictEqual(['owner-file']);
      expect(() => owner.registration.dispose()).not.toThrow();
    } finally {
      await owner.config.dispose();
    }
  });

  it('keeps a failed file on its exact owner and retries deletion without touching a same-label sibling', async () => {
    const owner = foreground('failed-owner');
    const sibling = foreground('failed-owner');
    let unavailable = true;
    const deleted: string[] = [];
    const retained = await retainedFile(owner, async (fileId) => {
      if (unavailable) throw new Error('provider deletion unavailable');
      deleted.push(fileId);
    });
    try {
      await retained.lease.release();
      const result =
        await owner.registration.providerFileLifecycle.cleanupScope(
          'session',
          owner.registration.runtimeId,
        );
      expect(result.failed).toBe(1);
      expect(
        owner.registration.providerFileLifecycle.snapshot().deletionFailures,
      ).toStrictEqual(
        expect.arrayContaining([
          expect.objectContaining({ fileId: 'owner-file' }),
        ]),
      );
      expect(() => owner.registration.dispose()).toThrow(
        'provider-file lifecycle',
      );
      unavailable = false;
      const retried =
        await owner.registration.providerFileLifecycle.cleanupScope(
          'session',
          owner.registration.runtimeId,
        );
      expect(retried.failed).toBe(0);
      expect(deleted).toStrictEqual(['owner-file']);
      owner.registration.dispose();
      expect(sibling.registration.config).toBe(sibling.config);
    } finally {
      sibling.registration.dispose();
      await owner.config.dispose();
      await sibling.config.dispose();
    }
  });

  it('waits for the last lease before finishing deferred deletion', async () => {
    const owner = foreground('deferred-owner');
    const deleted: string[] = [];
    const retained = await retainedFile(owner, async (fileId) => {
      deleted.push(fileId);
    });
    try {
      const cleanup =
        await owner.registration.providerFileLifecycle.cleanupScope(
          'session',
          owner.registration.runtimeId,
        );
      expect(cleanup.deferred).toBe(1);
      await retained.lease.release();
      await owner.registration.providerFileLifecycle.waitForScopeCleanup(
        'session',
        owner.registration.runtimeId,
      );
      expect(deleted).toStrictEqual(['owner-file']);
      owner.registration.dispose();
    } finally {
      await owner.config.dispose();
    }
  });

  it('does not delete retained workspace files when the session ends', async () => {
    const owner = foreground('workspace-owner');
    const deleted: string[] = [];
    const retained = await retainedFile(
      owner,
      async (fileId) => {
        deleted.push(fileId);
      },
      'workspace',
    );
    try {
      await retained.lease.release();
      await owner.registration.providerFileLifecycle.cleanupScope(
        'session',
        owner.registration.runtimeId,
      );
      owner.registration.dispose();
      expect(deleted).toStrictEqual([]);
    } finally {
      await owner.config.dispose();
    }
  });

  it('separates lifecycles even when foreground owners use the same label', async () => {
    const first = foreground('same-label');
    const second = foreground('same-label');
    const retained = await retainedFile(first, async () => undefined);
    try {
      expect(first.registration.providerFileLifecycle).not.toBe(
        second.registration.providerFileLifecycle,
      );
      expect(
        second.registration.providerFileLifecycle.snapshot().retainedFiles,
      ).toBe(0);
      expect(() => second.registration.dispose()).not.toThrow();
      expect(() => first.registration.dispose()).toThrow(
        'provider-file lifecycle',
      );
    } finally {
      await retained.lease.release();
      await first.registration.providerFileLifecycle.cleanupScope(
        'session',
        first.registration.runtimeId,
      );
      first.registration.dispose();
      await first.config.dispose();
      await second.config.dispose();
    }
  });
  it('cleans only the requested Config lifecycle for two equal-label owners', async () => {
    const first = foreground('shared-file-label');
    const second = foreground('shared-file-label');
    const firstDeleted: string[] = [];
    const secondDeleted: string[] = [];
    const firstFile = await retainedFile(first, async (id) => {
      firstDeleted.push(id);
    });
    const secondFile = await retainedFile(second, async (id) => {
      secondDeleted.push(id);
    });
    try {
      await firstFile.lease.release();
      await secondFile.lease.release();
      await cleanupOwnedProviderFiles(
        first.registration.providerFileLifecycle,
        'shared-file-label',
      );
      expect(firstDeleted).toStrictEqual(['owner-file']);
      expect(secondDeleted).toStrictEqual([]);
      await cleanupOwnedProviderFiles(
        second.registration.providerFileLifecycle,
        'shared-file-label',
      );
      expect(secondDeleted).toStrictEqual(['owner-file']);
    } finally {
      await first.config.dispose();
      await second.config.dispose();
    }
  });

  it('rejects cleanup when a caller supplies no provider-file owner', async () => {
    const { config: config } = createProviderConfigFixture({
      sessionId: 'ownerless-file',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'test-model',
      settingsService: new SettingsService(),
    });
    try {
      await expect(
        Reflect.apply(cleanupOwnedProviderFiles, undefined, [
          undefined,
          'ownerless-file',
        ]),
      ).rejects.toThrow('cleanupScope');
    } finally {
      await config.dispose();
    }
  });

  it('disposed foreground authority cannot be used again while its same-label sibling remains owned', async () => {
    const owner = foreground('disposed-owner');
    const sibling = foreground('disposed-owner');
    try {
      owner.registration.dispose();
      expect(owner.registration.config).toBeUndefined();
      expect(() => owner.registration.adopt(owner.config)).toThrow('disposed');
      expect(sibling.registration.config).toBe(sibling.config);
    } finally {
      sibling.registration.dispose();
      await owner.config.dispose();
      await sibling.config.dispose();
    }
  });

  it('does not expose ambient runtime identity through its public factory', async () => {
    const factory = await import('./runtimeContextFactory.js');
    expect(Object.keys(factory)).not.toContain('enterRuntimeScope');
  });
});
