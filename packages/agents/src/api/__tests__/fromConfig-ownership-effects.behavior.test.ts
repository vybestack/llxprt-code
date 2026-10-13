/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ProviderFileLifecycle,
  type ProviderFileDeletion,
  type ProviderFileLease,
  type ProviderFileScope,
} from '@vybestack/llxprt-code-providers/providerFilePolicy.js';
import { fromConfig } from '../fromConfig.js';
import {
  buildFactoryLessConfig,
  type BuiltFactoryLessConfig,
} from './helpers/buildCliStyleConfig.js';
import { makeToken } from './helpers/provider-auth-fixtures.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

async function retainFile(
  owner: ProviderFileLifecycle,
  directory: string,
  fileId: string,
  scopeId: string,
  deletion: ProviderFileDeletion = 'delete',
  scope: ProviderFileScope = 'session',
): Promise<ProviderFileLease> {
  await writeFile(join(directory, fileId), 'provider file');
  const retained = await owner.retain({
    cacheKey: fileId,
    fileId,
    bytes: 13,
    identity: {
      provider: 'fake',
      baseURL: 'http://127.0.0.1',
      credentialHash: 'ownership-effects',
    },
    policy: {
      mode: 'enabled',
      scope,
      retentionMs: 60_000,
      deletion,
      zeroDataRetention: 'incompatible-while-retained',
    },
    scopeId,
    deleteRemote: (id) => rm(join(directory, id)),
  });
  return retained.lease;
}

describe('fromConfig ownership effects', () => {
  const credentials = useOwnedCredentials();
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function fixture(): Promise<BuiltFactoryLessConfig> {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'from-config-ownership-effects-')),
    );
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      {
        workingDir: directory,
        sessionId: 'caller-config-scope',
        folderTrust: true,
        mcpEnabled: false,
        skillsSupport: false,
        recording: { enabled: false },
        telemetry: { enabled: false },
        settings: { jitContextEnabled: false },
      },
    );
    cleanups.push(built.cleanup);
    return built;
  }

  it('keeps a caller token transport usable after disposing its owned OAuth facade', async () => {
    const built = await fixture();
    const store = credentials().authority.createTokenStore();
    const agent = await fromConfig({
      ...built,
      credentialAuthority: credentials().authority,
      tokenStore: store,
    });
    cleanups.push(() => agent.dispose());
    await store.saveToken('fake', makeToken('caller-owned'));
    expect(await store.listProviders()).toContain('fake');

    await agent.dispose();

    expect(credentials().snapshot()).toStrictEqual([0]);
    await store.removeToken('fake');
    expect(await store.listProviders()).not.toContain('fake');
    await store.saveToken('fake', makeToken('after-disposal'));
    expect(await store.getToken('fake')).toMatchObject({
      access_token: 'after-disposal',
    });
  });

  it('deletes owned files in both session scopes without deleting retained or caller-scope files', async () => {
    const built = await fixture();
    const directory = join(built.config.getTargetDir(), 'provider-files');
    await mkdir(directory);
    const owner = new ProviderFileLifecycle({ maxFiles: 10, maxBytes: 1024 });
    const agent = await fromConfig({
      ...built,
      credentialAuthority: credentials().authority,
      sessionId: 'adopted-runtime-scope',
      providerFileLifecycle: owner,
    });
    cleanups.push(() => agent.dispose());
    expect(agent.getRuntimeId()).not.toBe(built.config.getSessionId());
    for (const [fileId, scopeId] of [
      ['owned-runtime', agent.getRuntimeId()],
      ['owned-config', built.config.getSessionId()],
    ]) {
      await (await retainFile(owner, directory, fileId, scopeId)).release();
      await (
        await retainFile(
          owner,
          directory,
          `${fileId}-retained`,
          scopeId,
          'retain',
        )
      ).release();
    }
    await (
      await retainFile(owner, directory, 'caller-file', 'another-caller-scope')
    ).release();
    await (
      await retainFile(
        owner,
        directory,
        'workspace-file',
        agent.getRuntimeId(),
        'delete',
        'workspace',
      )
    ).release();
    expect(owner.snapshot().retainedFiles).toBe(6);

    await agent.dispose();

    expect((await readdir(directory)).sort()).toStrictEqual([
      'caller-file',
      'owned-config-retained',
      'owned-runtime-retained',
      'workspace-file',
    ]);
    expect(owner.retainsScope('session', agent.getRuntimeId())).toBe(false);
    expect(owner.retainsScope('session', built.config.getSessionId())).toBe(
      false,
    );
    expect(owner.retainsScope('session', 'another-caller-scope')).toBe(true);
    expect(owner.retainsScope('workspace', agent.getRuntimeId())).toBe(true);
    expect(owner.snapshot().retainedFiles).toBe(2);
    expect(built.config.getSessionId()).toBe('caller-config-scope');
  });

  it('joins concurrent disposal while a real file lease delays exactly-once owned token closure', async () => {
    const built = await fixture();
    const owner = new ProviderFileLifecycle({ maxFiles: 10, maxBytes: 1024 });
    const agent = await fromConfig({
      ...built,
      credentialAuthority: credentials().authority,
      sessionId: 'concurrent-adoption-scope',
      providerFileLifecycle: owner,
    });
    cleanups.push(() => agent.dispose());
    const lease = await retainFile(
      owner,
      built.config.getTargetDir(),
      'held-file',
      agent.getRuntimeId(),
    );
    cleanups.push(() => lease.release());
    await credentials().saveToken(0, 'fake', makeToken('owned'));
    let settled = 0;
    const disposals = Array.from({ length: 3 }, () =>
      agent.dispose().then(() => {
        settled += 1;
      }),
    );
    const deadline = Date.now() + 5_000;
    while (owner.snapshot().pendingDeletions === 0 && Date.now() < deadline) {
      await delay(10);
    }
    expect(owner.snapshot().pendingDeletions).toBe(1);

    expect(settled).toBe(0);
    expect(credentials().snapshot()).toStrictEqual([0]);
    expect(await credentials().listProviders(0)).toContain('fake');
    await expect(agent.generate('after closed admission')).rejects.toThrow(
      'Agent is closed',
    );

    await lease.release();
    await Promise.all(disposals);
    await agent.dispose();

    expect(settled).toBe(3);
    expect(owner.snapshot().retainedFiles).toBe(0);
    expect(await readdir(built.config.getTargetDir())).not.toContain(
      'held-file',
    );
    expect(credentials().snapshot()).toStrictEqual([1]);
  });
});
