/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createAgent } from '../index.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  access,
  mkdtemp,
  writeFile,
  unlink,
  readFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProviderFilePolicy } from '@vybestack/llxprt-code-providers/providerFilePolicy.js';

describe('preferred Agent acquisition release', () => {
  const credentials = useOwnedCredentials();

  it.each(['fulfilled', 'undefined', 'error'])(
    'releases the actual acquired image prefix when preferred broker selection rejects with %s cleanup',
    async (mode) => {
      const directory = await mkdtemp(
        join(tmpdir(), 'preferred-broker-prefix-'),
      );
      const file = join(directory, 'owned-image');
      await writeFile(file, 'owned image resource');
      let releases = 0;
      const cleanupFailure =
        mode === 'undefined'
          ? undefined
          : new Error('preferred image cleanup failed');
      try {
        const [outcome] = await Promise.allSettled([
          createAgent({
            credentialAuthority: credentials().authority,
            provider: 'openai',
            model: 'unacquired-model',
            workingDir: directory,
            disposeGitHubBroker: async () => {
              throw new Error('No broker acquired');
            },
            imageOperation: {
              ownership: 'agent',
              run: async () => {
                throw new Error('No image generation');
              },
              dispose: async () => {
                releases++;
                await unlink(file);
                if (mode !== 'fulfilled') throw cleanupFailure;
              },
            },
          }),
        ]);
        expect(outcome.status).toBe('rejected');
        if (outcome.status !== 'rejected')
          throw new Error('Unexpected preferred acquisition');
        const error: unknown = outcome.reason;
        expect(error instanceof AggregateError).toBe(mode !== 'fulfilled');
        const causes: unknown[] =
          error instanceof AggregateError ? error.errors : [error];
        const primary = causes[0];
        expect(primary).toBeInstanceOf(Error);
        if (!(primary instanceof Error))
          throw new Error('Missing preferred broker primary');
        expect(primary.message).toBe(
          'GitHub transport disposal requires an explicit broker',
        );
        expect(causes.slice(1)).toStrictEqual(
          mode === 'fulfilled' ? [] : [cleanupFailure],
        );
        await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(releases).toBe(1);
        expect(credentials().keySnapshot()).toStrictEqual([]);
        expect(credentials().snapshot()).toStrictEqual([]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it('releases the transferred image resource when createAgent validation rejects before host acquisition', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'preferred-validation-'));
    const file = join(directory, 'transferred-image-resource');
    await writeFile(file, 'actual transferred construction resource');
    let releases = 0;
    try {
      await expect(
        createAgent({
          credentialAuthority: credentials().authority,
          provider: 'openai',
          model: 'unacquired-model',
          workingDir: directory,
          sessionId: '   ',
          imageOperation: {
            ownership: 'agent',
            run: async () => {
              throw new Error('Validation must not execute image generation');
            },
            dispose: async () => {
              releases++;
              await unlink(file);
            },
          },
        }),
      ).rejects.toThrow('Invalid runtimeId');
      await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(releases).toBe(1);
      expect(credentials().keySnapshot()).toStrictEqual([]);
      expect(credentials().snapshot()).toStrictEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('releases acquired key transport before rejecting token acquisition', async () => {
    const primary = new Error('token transport unavailable');
    const authority = new (class extends CredentialAuthority {
      override createProviderKeyStorage(): ReturnType<
        CredentialAuthority['createProviderKeyStorage']
      > {
        return credentials().authority.createProviderKeyStorage();
      }
      override createTokenStore(): ReturnType<
        CredentialAuthority['createTokenStore']
      > {
        throw primary;
      }
    })();
    await expect(
      createAgent({
        credentialAuthority: authority,
        provider: 'openai',
        model: 'owner-model',
        workingDir: process.cwd(),
      }),
    ).rejects.toBe(primary);
    expect(credentials().keySnapshot()).toStrictEqual([1]);
    expect(credentials().snapshot()).toStrictEqual([]);
  });

  it('joins exactly one close of each acquired transport for concurrent facade disposal', async () => {
    const agent = await createAgent({
      credentialAuthority: credentials().authority,
      provider: 'openai',
      model: 'owner-model',
      workingDir: process.cwd(),
    });
    expect(credentials().keySnapshot()).toStrictEqual([0]);
    expect(credentials().snapshot()).toStrictEqual([0]);
    await Promise.all([agent.dispose(), agent.dispose(), agent.dispose()]);
    expect(credentials().keySnapshot()).toStrictEqual([1]);
    expect(credentials().snapshot()).toStrictEqual([1]);
    credentials().authority.createTokenStore();
    expect(await credentials().listProviders(1)).toStrictEqual([]);
  });

  it('closes scoped retention admission while allowing deletion remediation after disposal failure', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'preferred-file-remediation-'),
    );
    const remoteFile = join(directory, 'uploaded.txt');
    await writeFile(remoteFile, 'remote content');
    const agent = await createAgent({
      credentialAuthority: credentials().authority,
      provider: 'openai',
      model: 'owner-model',
      workingDir: directory,
    });
    let deletionAllowed = false;
    const input = {
      cacheKey: 'remote',
      fileId: 'remote',
      bytes: 14,
      identity: {
        provider: 'kimi',
        baseURL: 'https://provider.test/v1',
        credentialHash: 'owner',
      },
      policy: resolveProviderFilePolicy({
        configuredMode: 'session',
        configuredRetentionMs: 60_000,
        configuredDeletion: 'delete',
        providerFileReferences: true,
        zeroDataRetention: 'incompatible-while-retained',
        zeroDataRetentionRequired: false,
      }),
      deleteRemote: async (): Promise<void> => {
        if (!deletionAllowed) throw new Error('remote deletion unavailable');
        await unlink(remoteFile);
      },
    };
    try {
      const retained = await agent.retainProviderFile(input);
      await retained.lease.release();
      expect(agent.captureProviderFiles().retainedFiles).toBe(1);
      await expect(agent.dispose()).rejects.toThrow('cleanup');
      expect(await readFile(remoteFile, 'utf8')).toBe('remote content');
      expect(agent.captureProviderFiles().retainedFiles).toBe(1);
      await expect(agent.retainProviderFile(input)).rejects.toThrow('closed');
      deletionAllowed = true;
      expect((await agent.retryProviderFileDeletions()).failed).toBe(0);
      expect(agent.captureProviderFiles().retainedFiles).toBe(0);
      await expect(readFile(remoteFile)).rejects.toThrow('ENOENT');
      expect(credentials().keySnapshot()).toStrictEqual([1]);
      expect(credentials().snapshot()).toStrictEqual([1]);
    } finally {
      await agent.dispose().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
