/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { Config, WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProxyTokenStore } from '@vybestack/llxprt-code-auth/proxy/proxy-token-store.js';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentProfilePreflight } from '../profile-preflight.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
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

  for (const stage of ['memory', 'native']) {
    it(`joins accepted ${stage} acquisition before repeated disposal releases credentials`, async () => {
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
      const create = SessionClientOwner.create;
      const refresh = WorkspaceMemoryOwner.prototype.refresh;
      let native: SessionClientOwner | undefined;
      const interception =
        stage === 'native'
          ? spyOn(SessionClientOwner, 'create').mockImplementation(
              async (...args) => {
                native = await create(...args);
                entered.resolve();
                await release.promise;
                return native;
              },
            )
          : spyOn(WorkspaceMemoryOwner.prototype, 'refresh').mockImplementation(
              async function (this: WorkspaceMemoryOwner) {
                const result = await refresh.call(this);
                entered.resolve();
                await release.promise;
                return result;
              },
            );
      const assertClosed = (): void => {
        expect(() => preflight.captureSettings()).toThrow('disposed');
      };
      const preparation = preflight.prepareConfiguredWorkspace(
        config,
        () => {},
      );
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
        const nativeRead = native?.conversation.getHistory;
        expect(
          stage === 'native'
            ? nativeRead
            : preflight.captureSettings.bind(preflight),
        ).toThrow('disposed');
      } finally {
        release.resolve();
        interception.mockRestore();
        await result;
        await preflight.dispose();
        await native?.dispose();
        await config.dispose();
      }
    });
  }

  it('preserves acquisition error identity and borrowed settings after failed preparation', async () => {
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
    const failure = new Error('native acquisition failed');
    const create = SessionClientOwner.create;
    const interception = spyOn(SessionClientOwner, 'create').mockImplementation(
      async (...args) => {
        const native = await create(...args);
        await native.dispose();
        throw failure;
      },
    );
    try {
      await expect(
        preflight.prepareConfiguredWorkspace(config, () => {}, owner),
      ).rejects.toBe(failure);
      await preflight.dispose();
      owner.writeUserParameter('survives', 'borrowed');
      expect(owner.readNamedParameter('survives')).toBe('borrowed');
      expect(credentials().snapshot()).toStrictEqual([1]);
      expect(credentials().keySnapshot()).toStrictEqual([1]);
    } finally {
      interception.mockRestore();
      await preflight.dispose();
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
