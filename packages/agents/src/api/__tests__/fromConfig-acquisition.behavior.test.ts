/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { TokenStore } from '@vybestack/llxprt-code-auth';
import { fromConfig } from '../fromConfig.js';
import { buildFactoryLessConfig } from './helpers/buildCliStyleConfig.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

function fileAdmittedCredentials(
  authority: CredentialAuthority,
  directory: string,
  released: string[],
): CredentialAuthority {
  return new (class extends CredentialAuthority {
    override createProviderKeyStorage(): ReturnType<
      CredentialAuthority['createProviderKeyStorage']
    > {
      readFileSync(join(directory, 'keys'));
      const storage = authority.createProviderKeyStorage();
      const close = storage.close.bind(storage);
      storage.close = (): void => {
        released.push('keys');
        close();
        readFileSync(join(directory, 'key-close'));
      };
      return storage;
    }
    override createTokenStore(): TokenStore {
      readFileSync(join(directory, 'tokens'));
      const store = authority.createTokenStore();
      process.env.LLXPRT_CONFIG_HOME = readFileSync(
        join(directory, 'config-home'),
        'utf8',
      );
      return store;
    }
  })();
}

describe('fromConfig acquired-prefix rollback', () => {
  const credentials = useOwnedCredentials();
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function fixture() {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'adoption-acquisition-')),
    );
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    for (const name of ['keys', 'tokens', 'key-close'])
      await writeFile(join(directory, name), 'admitted');
    await writeFile(
      join(directory, 'config-home'),
      process.env.LLXPRT_CONFIG_HOME ?? directory,
    );
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      {
        workingDir: directory,
        sessionId: 'acquisition-caller',
        folderTrust: true,
        mcpEnabled: false,
        skillsSupport: false,
        recording: { enabled: false },
        telemetry: { enabled: false },
        settings: { jitContextEnabled: false },
      },
    );
    cleanups.push(built.cleanup);
    const released: string[] = [];
    const authority = fileAdmittedCredentials(
      credentials().authority,
      directory,
      released,
    );
    const listeners = () =>
      built.settingsService
        .eventNames()
        .reduce(
          (total, event) => total + built.settingsService.listenerCount(event),
          0,
        );
    return { built, authority, directory, listeners, released };
  }

  it.each(['keys', 'tokens'])(
    'releases only the acquired prefix when credential %s admission fails on disk',
    async (stage) => {
      const { built, authority, directory, listeners, released } =
        await fixture();
      const before = listeners();
      const files = new ProviderFileLifecycle({ maxFiles: 2, maxBytes: 1024 });
      const uploaded = join(directory, 'prefix-file');
      await writeFile(uploaded, 'prefix');
      const retained = await files.retain({
        cacheKey: uploaded,
        fileId: 'prefix-file',
        bytes: 6,
        identity: {
          provider: 'fake',
          baseURL: 'http://127.0.0.1',
          credentialHash: 'prefix',
        },
        policy: {
          mode: 'enabled',
          scope: 'session',
          retentionMs: 60_000,
          deletion: 'delete',
          zeroDataRetention: 'incompatible-while-retained',
        },
        scopeId: built.config.getSessionId(),
        deleteRemote: () => rm(uploaded),
      });
      await retained.lease.release();
      await rm(join(directory, stage));
      await expect(
        fromConfig({
          ...built,
          settingsOwner: undefined,
          credentialAuthority: authority,
          providerFileLifecycle: files,
        }),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      expect(files.snapshot().retainedFiles).toBe(0);
      expect(listeners() - before).toBe(0);
      expect(released.length).toBe(stage === 'keys' ? 0 : 1);
      expect(credentials().snapshot()).toStrictEqual([]);
      built.settingsOwner.writeUserParameter('after-failure', 11);
      expect(built.settingsService.get('after-failure')).toBe(11);
    },
  );

  it('preserves a multi-leaf external acquisition failure without reporting its leaves again as cleanup failures', async () => {
    const { built, authority, directory, released } = await fixture();
    const external = new (class extends CredentialAuthority {
      override createProviderKeyStorage(): ReturnType<
        CredentialAuthority['createProviderKeyStorage']
      > {
        return authority.createProviderKeyStorage();
      }
      override createTokenStore(): TokenStore {
        const failures: unknown[] = [];
        for (const file of [
          'missing-token-source',
          'missing-token-authorization',
        ]) {
          try {
            readFileSync(join(directory, file));
          } catch (error) {
            failures.push(error);
          }
        }
        throw new AggregateError(
          failures,
          'Credential source admission failed',
        );
      }
    })();
    const error: unknown = await fromConfig({
      ...built,
      settingsOwner: undefined,
      credentialAuthority: external,
    }).catch((failure: unknown) => failure);
    if (!(error instanceof AggregateError))
      throw new Error('Expected external credential acquisition failure');
    expect(error.errors).toHaveLength(2);
    expect(error.errors[0]).toMatchObject({
      code: 'ENOENT',
      path: join(directory, 'missing-token-source'),
    });
    expect(error.errors[1]).toMatchObject({
      code: 'ENOENT',
      path: join(directory, 'missing-token-authorization'),
    });
    expect(released).toStrictEqual(['keys']);
    expect(credentials().snapshot()).toStrictEqual([]);
  });

  it('releases the acquired token transport when OAuth construction rejects external host configuration', async () => {
    const { built, authority, directory, listeners, released } =
      await fixture();
    const before = listeners();
    const home = process.env.LLXPRT_CONFIG_HOME;
    await writeFile(join(directory, 'config-home'), 'relative-config-home');
    try {
      await expect(
        fromConfig({
          ...built,
          settingsOwner: undefined,
          credentialAuthority: authority,
        }),
      ).rejects.toThrow('LLXPRT_CONFIG_HOME');
    } finally {
      if (home === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = home;
    }
    expect(credentials().snapshot()).toStrictEqual([1]);
    expect(released).toStrictEqual(['keys']);
    expect(listeners() - before).toBe(0);
    expect(await credentials().listProviders(0)).toStrictEqual([]);
  });

  it('keeps the actual acquisition error first and joins an independent key release failure', async () => {
    const { built, authority, directory, listeners, released } =
      await fixture();
    const before = listeners();
    await rm(join(directory, 'tokens'));
    await rm(join(directory, 'key-close'));
    const error = await fromConfig({
      ...built,
      settingsOwner: undefined,
      credentialAuthority: authority,
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError))
      throw new Error('Missing joined acquisition failure');
    expect(error.errors).toHaveLength(2);
    expect(error.errors[0]).toMatchObject({
      code: 'ENOENT',
      path: join(directory, 'tokens'),
    });
    expect(error.errors[1]).toMatchObject({
      code: 'ENOENT',
      path: join(directory, 'key-close'),
    });
    expect(released.length).toBe(1);
    expect(listeners() - before).toBe(0);
    expect(credentials().snapshot()).toStrictEqual([]);
  });

  it('releases credentials and settings after real provider registration cannot read its responses file', async () => {
    const { built, authority, directory, listeners, released } =
      await fixture();
    const before = listeners();
    const previous = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = join(
      directory,
      'missing-responses.jsonl',
    );
    try {
      await expect(
        fromConfig({
          ...built,
          settingsOwner: undefined,
          credentialAuthority: authority,
        }),
      ).rejects.toThrow('missing-responses');
    } finally {
      if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previous;
    }
    expect(released.length).toBe(1);
    expect(credentials().snapshot()).toStrictEqual([1]);
    expect(listeners() - before).toBe(0);
  });
});
