/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import {
  Config,
  WorkspaceFilesystemOwner,
  WorkspaceMemoryOwner,
  WorkspaceTrustLifecycle,
  assembleWorkspaceMemory,
} from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProxyTokenStore } from '@vybestack/llxprt-code-auth/proxy/proxy-token-store.js';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentProfilePreflight } from '../profile-preflight.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {
    throw new Error('Uninitialized gate');
  };
  const promise = new Promise<void>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}

async function workspace(): Promise<Config> {
  const home = process.env.LLXPRT_CONFIG_HOME;
  if (home === undefined) throw new Error('Missing isolated config home');
  const directory = join(home, 'workspace');
  await mkdir(directory, { recursive: true });
  return new Config({
    sessionId: crypto.randomUUID(),
    cwd: directory,
    targetDir: directory,
    provider: 'openai',
    model: 'closure-test',
    debugMode: false,
    mcpEnabled: false,
    skillsSupport: false,
    enableHooks: false,
    telemetry: { enabled: false },
  });
}

describe('Preflight acquisition closure', () => {
  const credentials = useOwnedCredentials();

  it('joins accepted memory acquisition before repeated disposal releases credentials', async () => {
    const config = await workspace();
    const preflight = await AgentProfilePreflight.create(
      { runtimeId: config.getSessionId() },
      credentials().authority,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    const entered = deferred();
    const release = deferred();
    const refresh = WorkspaceMemoryOwner.prototype.refresh;
    const interception = spyOn(
      WorkspaceMemoryOwner.prototype,
      'refresh',
    ).mockImplementation(async function (this: WorkspaceMemoryOwner) {
      const result = await refresh.call(this);
      entered.resolve();
      await release.promise;
      return result;
    });
    const assertClosed = (): void => {
      expect(() => preflight.captureSettings()).toThrow('disposed');
    };
    const preparation = preflight.prepareConfiguredWorkspace(config, () => {});
    const result = preparation.then(
      () => null,
      (error: unknown) => error,
    );
    try {
      await entered.promise;
      await expect(
        preflight.prepareConfiguredWorkspace(config, () => {}),
      ).rejects.toThrow('already');
      let disposed = false;
      const closing = preflight.dispose();
      const repeated = preflight.dispose();
      void closing.then(() => {
        disposed = true;
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(disposed).toBe(false);
      expect(credentials().snapshot()).toStrictEqual([0]);
      expect(credentials().keySnapshot()).toStrictEqual([0]);
      assertClosed();
      release.resolve();
      expect(await result).toBeInstanceOf(Error);
      await Promise.all([closing, repeated]);
      await preflight.dispose();
      assertClosed();
      expect(credentials().snapshot()).toStrictEqual([1]);
      expect(credentials().keySnapshot()).toStrictEqual([1]);
      expect(preflight.captureSettings.bind(preflight)).toThrow('disposed');
    } finally {
      release.resolve();
      interception.mockRestore();
      await result;
      await preflight.dispose();
      await config.dispose();
    }
  });

  it('preserves the identity of a host failure and borrowed settings after failed preparation', async () => {
    const config = await workspace();
    const settings = new SettingsService();
    const owner = new SessionSettingsOwner(settings);
    const preflight = await AgentProfilePreflight.create(
      { runtimeId: config.getSessionId() },
      credentials().authority,
      settings,
      owner,
      undefined,
      undefined,
    );
    const failure = new Error('host preparation failed');
    try {
      await expect(
        preflight.prepareConfiguredWorkspace(
          config,
          () => {
            throw failure;
          },
          owner,
        ),
      ).rejects.toBe(failure);
      await preflight.dispose();
      owner.writeUserParameter('survives', 'borrowed');
      expect(owner.readNamedParameter('survives')).toBe('borrowed');
      expect(credentials().snapshot()).toStrictEqual([1]);
      expect(credentials().keySnapshot()).toStrictEqual([1]);
    } finally {
      await preflight.dispose();
      await owner.dispose();
      await config.dispose();
    }
  });

  async function openHostWorkspace(config: Config): Promise<{
    readonly trust: WorkspaceTrustLifecycle;
    readonly filesystem: WorkspaceFilesystemOwner;
    readonly memory: WorkspaceMemoryOwner;
  }> {
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: config.getTargetDir(),
      isTrusted: () => trust.isTrustedFolder(),
    });
    return {
      trust,
      filesystem,
      memory: assembleWorkspaceMemory(config, filesystem, trust),
    };
  }

  it('retains the original failure and borrowed settings when binding to the host memory fails after native client acquisition', async () => {
    const config = await workspace();
    const settings = new SettingsService();
    const owner = new SessionSettingsOwner(settings);
    const { trust, filesystem, memory } = await openHostWorkspace(config);
    await memory.dispose();
    const preflight = await AgentProfilePreflight.create(
      { runtimeId: config.getSessionId() },
      credentials().authority,
      settings,
      owner,
      undefined,
      undefined,
    );
    try {
      const error: unknown = await preflight
        .preparePostConfiguration(
          config,
          filesystem,
          memory,
          trust,
          () => trust.dispose(),
          owner,
        )
        .then(
          () => null,
          (failure: unknown) => failure,
        );
      expect(error).toBeInstanceOf(Error);
      expect(error instanceof Error ? error.message : '').toContain(
        'Workspace memory is disposed',
      );
      expect(() => preflight.captureSettings()).toThrow('disposed');
      owner.writeUserParameter('survives', 'borrowed');
      expect(owner.readNamedParameter('survives')).toBe('borrowed');
      expect(credentials().snapshot()).toStrictEqual([1]);
      expect(credentials().keySnapshot()).toStrictEqual([1]);
      await preflight.dispose();
      expect(credentials().snapshot()).toStrictEqual([1]);
      expect(credentials().keySnapshot()).toStrictEqual([1]);
    } finally {
      await preflight.dispose();
      await filesystem.dispose();
      await trust.dispose();
      await owner.dispose();
      await config.dispose();
    }
  });

  it('settles accepted preparation and joins repeated disposal queued from the settings owner during native binding', async () => {
    const config = await workspace();
    const settings = new SettingsService();
    const owner = new SessionSettingsOwner(settings);
    const { trust, filesystem, memory } = await openHostWorkspace(config);
    const preflight = await AgentProfilePreflight.create(
      { runtimeId: config.getSessionId() },
      credentials().authority,
      settings,
      owner,
      undefined,
      undefined,
    );
    const subscribe = owner.subscribeModelChanges.bind(owner);
    let queued: Array<Promise<void>> = [];
    let credentialsWhenQueued: readonly number[] = [];
    owner.subscribeModelChanges = (listener) => {
      if (queued.length === 0) {
        queued = [preflight.dispose(), preflight.dispose()];
        credentialsWhenQueued = credentials().snapshot();
      }
      return subscribe(listener);
    };
    try {
      const error: unknown = await preflight
        .preparePostConfiguration(
          config,
          filesystem,
          memory,
          trust,
          () => trust.dispose(),
          owner,
        )
        .then(
          () => null,
          (failure: unknown) => failure,
        );
      expect(queued).toHaveLength(2);
      expect(credentialsWhenQueued).toStrictEqual([0]);
      expect(error).toBeInstanceOf(Error);
      await Promise.all(queued);
      await preflight.dispose();
      expect(() => preflight.captureSettings()).toThrow('disposed');
      owner.writeUserParameter('survives', 'borrowed');
      expect(owner.readNamedParameter('survives')).toBe('borrowed');
      expect(credentials().snapshot()).toStrictEqual([1]);
      expect(credentials().keySnapshot()).toStrictEqual([1]);
    } finally {
      await preflight.dispose();
      await memory.dispose();
      await filesystem.dispose();
      await trust.dispose();
      await owner.dispose();
      await config.dispose();
    }
  });

  it('retains the primary error and independent credential cleanup failures without joining itself', async () => {
    const config = await workspace();
    const authority = credentials().authority;
    const acquireKeys = authority.createProviderKeyStorage.bind(authority);
    const acquireTokens = authority.createTokenStore.bind(authority);
    const primary = new Error('memory preparation failed');
    const keyFailure = new Error('key cleanup failed');
    const tokenFailure = new Error('token cleanup failed');
    const restoreClosures: Array<() => void> = [];
    const keys = spyOn(
      authority,
      'createProviderKeyStorage',
    ).mockImplementation(() => {
      const storage = acquireKeys();
      const close = storage.close.bind(storage);
      storage.close = (): void => {
        close();
        throw keyFailure;
      };
      return storage;
    });
    const tokens = spyOn(authority, 'createTokenStore').mockImplementation(
      () => {
        const storage = acquireTokens();
        if (!(storage instanceof ProxyTokenStore))
          throw new Error('Expected native credential transport');
        const client = storage.getClient();
        const close = client.close.bind(client);
        client.close = (): void => {
          close();
          throw tokenFailure;
        };
        restoreClosures.push(() => {
          client.close = close;
        });
        return storage;
      },
    );
    const preflight = await AgentProfilePreflight.create(
      { runtimeId: config.getSessionId() },
      authority,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    try {
      const error: unknown = await preflight
        .prepareConfiguredWorkspace(config, () => {
          throw primary;
        })
        .then(
          () => null,
          (failure: unknown) => failure,
        );
      const leaves = (failure: unknown): readonly unknown[] =>
        failure instanceof AggregateError
          ? failure.errors.flatMap(leaves)
          : [failure];
      expect(leaves(error)).toContain(primary);
      expect(leaves(error)).toContain(keyFailure);
      expect(leaves(error)).toContain(tokenFailure);
      expect(credentials().snapshot()).toStrictEqual([1]);
      expect(credentials().keySnapshot()).toStrictEqual([1]);
      await expect(preflight.dispose()).rejects.toBeInstanceOf(Error);
      expect(() => preflight.captureSettings()).toThrow('disposed');
    } finally {
      keys.mockRestore();
      tokens.mockRestore();
      for (const restore of restoreClosures) restore();
      await config.dispose();
    }
  });
});
