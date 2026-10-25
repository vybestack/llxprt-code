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
import { StandardFileSystemService } from '@vybestack/llxprt-code-core/services/fileSystemService.js';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { WorkspaceLspOwner } from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import { resolveProviderFilePolicy } from '@vybestack/llxprt-code-providers/providerFilePolicy.js';

function flattenFailures(failure: unknown): string[] {
  if (failure instanceof AggregateError)
    return failure.errors.flatMap(flattenFailures);
  return [failure instanceof Error ? failure.message : String(failure)];
}

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

  async function expectTransferredOwnerReleasedOnValidation(
    run: (directory: string) => {
      readonly config: Parameters<typeof createAgent>[0];
      readonly expectReleased: () => void;
    },
  ): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'preferred-owner-'));
    try {
      const { config, expectReleased } = run(directory);
      await expect(createAgent(config)).rejects.toThrow('Invalid runtimeId');
      expectReleased();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  it('disposes a transferred filesystem owner when createAgent validation rejects', async () => {
    await expectTransferredOwnerReleasedOnValidation((directory) => {
      const filesystem = new WorkspaceFilesystemOwner({
        targetDir: directory,
        isTrusted: () => true,
      });
      return {
        config: {
          credentialAuthority: credentials().authority,
          provider: 'openai',
          model: 'unacquired-model',
          workingDir: directory,
          sessionId: '   ',
          filesystemOwner: filesystem,
          filesystemOwnership: 'agent',
        },
        expectReleased: () =>
          expect(() => filesystem.paths.directories()).toThrow('disposed'),
      };
    });
  });

  it('disposes a transferred LSP owner when createAgent validation rejects', async () => {
    await expectTransferredOwnerReleasedOnValidation((directory) => {
      const lsp = new WorkspaceLspOwner({ servers: [] }, directory, () => true);
      return {
        config: {
          credentialAuthority: credentials().authority,
          provider: 'openai',
          model: 'unacquired-model',
          workingDir: directory,
          sessionId: '   ',
          lspOwner: lsp,
          lspOwnership: 'agent',
        },
        expectReleased: () =>
          expect(() => lsp.diagnostics.getLspConfig()).toThrow('stopped'),
      };
    });
  });

  it('disposes a transferred memory owner when createAgent validation rejects', async () => {
    await expectTransferredOwnerReleasedOnValidation((directory) => {
      const filesystem = new WorkspaceFilesystemOwner({
        targetDir: directory,
        isTrusted: () => true,
      });
      const memory = new WorkspaceMemoryOwner({
        globalMemoryDir: join(directory, 'global-memory'),
        workingDirectory: directory,
        jitEnabled: false,
        debugMode: false,
        loadIncludes: false,
        filtering: { respectGitIgnore: true, respectLlxprtIgnore: true },
        maxDirectories: 100,
        filenames: ['LLXPRT.md'],
        importFormat: 'tree',
        paths: filesystem.paths,
        ignore: filesystem.ignore,
        scans: filesystem.scans,
        isTrusted: () => true,
        extensions: () => [],
      });
      return {
        config: {
          credentialAuthority: credentials().authority,
          provider: 'openai',
          model: 'unacquired-model',
          workingDir: directory,
          sessionId: '   ',
          memoryOwner: { owner: memory, ownership: 'agent' },
        },
        expectReleased: () => {
          expect(() => memory.operations.snapshot()).toThrow('disposed');
          void filesystem.dispose();
        },
      };
    });
  });

  it('reports a failing transferred filesystem owner release once when activation rejects after MCP took it over', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'preferred-owner-report-'));
    let releases = 0;
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => true,
      fileSystem: {
        service: new StandardFileSystemService(),
        ownership: 'workspace',
        release: async () => {
          releases++;
          throw new Error('PROBE_FILESYSTEM_FAILURE');
        },
      },
    });
    try {
      const failure: unknown = await createAgent({
        credentialAuthority: credentials().authority,
        provider: 'openai',
        model: 'unacquired-model',
        workingDir: directory,
        harness: { includeProcessCwd: false },
        activation: {
          provider: 'nonexistent-probe-provider',
          providerSwitchPolicy: 'strict',
        },
        filesystemOwner: filesystem,
        filesystemOwnership: 'agent',
      }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(AggregateError);
      const leaves = flattenFailures(failure);
      expect(leaves[0]).toContain('nonexistent-probe-provider');
      expect(leaves.slice(1)).toStrictEqual(['PROBE_FILESYSTEM_FAILURE']);
      expect(releases).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  const HOST_CREDENTIAL_ERROR =
    'Capability transport requires LLXPRT_CREDENTIAL_SOCKET';

  // A capability descriptor without its socket is a real host input that
  // makes HostCredentialOwner throw; the environment is restored afterwards.
  async function withUnusableHostCredentialEnvironment(
    run: () => Promise<void>,
  ): Promise<void> {
    const previousFd = process.env.LLXPRT_CAPABILITY_FD;
    const previousSocket = process.env.LLXPRT_CREDENTIAL_SOCKET;
    process.env.LLXPRT_CAPABILITY_FD = 'invalid-host-descriptor';
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    try {
      await run();
    } finally {
      if (previousFd === undefined) delete process.env.LLXPRT_CAPABILITY_FD;
      else process.env.LLXPRT_CAPABILITY_FD = previousFd;
      if (previousSocket === undefined)
        delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      else process.env.LLXPRT_CREDENTIAL_SOCKET = previousSocket;
    }
  }

  it('releases the transferred image resource when host credential acquisition rejects', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'preferred-host-credential-'),
    );
    const file = join(directory, 'transferred-image-resource');
    await writeFile(file, 'actual transferred construction resource');
    let releases = 0;
    try {
      await withUnusableHostCredentialEnvironment(async () => {
        await expect(
          createAgent({
            provider: 'openai',
            model: 'unacquired-model',
            workingDir: directory,
            imageOperation: {
              ownership: 'agent',
              run: async () => {
                throw new Error('Credential failure must not run images');
              },
              dispose: async () => {
                releases++;
                await unlink(file);
              },
            },
          }),
        ).rejects.toThrow(HOST_CREDENTIAL_ERROR);
      });
      await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(releases).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('aggregates image cleanup failure behind the host credential acquisition error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'preferred-host-cleanup-'));
    const cleanupFailure = new Error('image cleanup failed');
    let releases = 0;
    try {
      let rejection: unknown;
      await withUnusableHostCredentialEnvironment(async () => {
        rejection = await createAgent({
          provider: 'openai',
          model: 'unacquired-model',
          workingDir: directory,
          imageOperation: {
            ownership: 'agent',
            run: async () => {
              throw new Error('Credential failure must not run images');
            },
            dispose: async () => {
              releases++;
              throw cleanupFailure;
            },
          },
        }).then(
          () => undefined,
          (error: unknown) => error,
        );
      });
      expect(rejection).toBeInstanceOf(AggregateError);
      if (!(rejection instanceof AggregateError))
        throw new Error('Missing aggregated rejection');
      expect(rejection.errors[0]).toBeInstanceOf(Error);
      expect((rejection.errors[0] as Error).message).toBe(
        HOST_CREDENTIAL_ERROR,
      );
      expect(rejection.errors.slice(1)).toStrictEqual([cleanupFailure]);
      expect(releases).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('disposes the transferred GitHub broker transport when host credential acquisition rejects', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'preferred-host-github-'));
    let disposals = 0;
    try {
      await withUnusableHostCredentialEnvironment(async () => {
        await expect(
          createAgent({
            provider: 'openai',
            model: 'unacquired-model',
            workingDir: directory,
            githubBrokerClient: {
              runOperation: async () => {
                throw new Error('Credential failure must not run GitHub');
              },
            },
            disposeGitHubBroker: async () => {
              disposals++;
            },
          }),
        ).rejects.toThrow(HOST_CREDENTIAL_ERROR);
      });
      expect(disposals).toBe(1);
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
