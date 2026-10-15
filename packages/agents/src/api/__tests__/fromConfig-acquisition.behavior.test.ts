import { CallerAgentRuntimeFactories } from './helpers/fixture-data.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { TokenStore } from '@vybestack/llxprt-code-auth';
import { fromConfig } from '../fromConfig.js';

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
  let directory: string;
  let builtFactorylessPreviousReplay: string | undefined;
  let builtFactorylessDirectory: string;
  let builtFactorylessConfig: Config;
  let builtFactorylessSettings: SettingsService;
  let builtFactorylessSettingsOwner: SessionSettingsOwner;
  let builtFactorylessPolicy: RuntimePolicyOwner;
  let builtFactorylessFactories: ReturnType<
    typeof createAgentRuntimeFactoryBindings
  >;
  let builtFactorylessClose: () => Promise<void>;
  let released: string[];
  let authority: ReturnType<typeof fileAdmittedCredentials>;
  let listeners: () => number;

  const credentials = useOwnedCredentials();
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function fixture() {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'adoption-acquisition-')),
    );
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    for (const name of ['keys', 'tokens', 'key-close'])
      await writeFile(join(directory, name), 'admitted');
    await writeFile(
      join(directory, 'config-home'),
      process.env.LLXPRT_CONFIG_HOME ?? directory,
    );

    builtFactorylessPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    builtFactorylessDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'factoryless-caller-')),
    );
    const builtFactorylessSupplied: CallerAgentRuntimeFactories = {};
    builtFactorylessConfig = new Config(
      toConfigParameters({
        ...{
          provider: 'fake',
          model: 'fake-model',
          workingDir: builtFactorylessDirectory,
        },
        ...{
          workingDir: directory,
          sessionId: 'acquisition-caller',
          folderTrust: true,
          mcpEnabled: false,
          skillsSupport: false,
          recording: { enabled: false },
          telemetry: { enabled: false },
          settings: { jitContextEnabled: false },
        },
      }),
    );
    builtFactorylessSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      builtFactorylessConfig.getInitialSettings(),
    ))
      builtFactorylessSettings.set(key, value);
    builtFactorylessSettingsOwner = new SessionSettingsOwner(
      builtFactorylessSettings,
    );
    builtFactorylessSettingsOwner.bindTelemetry(builtFactorylessConfig);
    builtFactorylessSettingsOwner.initializeProviderSelection(
      builtFactorylessConfig.getProvider(),
      builtFactorylessConfig.getModel(),
    );
    builtFactorylessPolicy = new RuntimePolicyOwner(builtFactorylessConfig);
    const builtFactorylessTask = builtFactorylessSupplied.taskToolRegistration;
    builtFactorylessFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...(builtFactorylessSupplied.agentClientFactory
        ? { agentClientFactory: builtFactorylessSupplied.agentClientFactory }
        : {}),
      ...(builtFactorylessTask
        ? { taskToolRegistration: () => builtFactorylessTask }
        : {}),
    };

    builtFactorylessClose = settleFactorylessRelease.bind(
      undefined,
      [
        () => builtFactorylessSettingsOwner.dispose(),
        () => builtFactorylessPolicy.dispose(),
        () => builtFactorylessConfig.dispose(),
        () => rm(builtFactorylessDirectory, { recursive: true, force: true }),
      ],
      builtFactorylessPreviousReplay,
    );

    cleanups.push(builtFactorylessClose);
    released = [];
    authority = fileAdmittedCredentials(
      credentials().authority,
      directory,
      released,
    );
    listeners = () =>
      builtFactorylessSettings
        .eventNames()
        .reduce(
          (total, event) =>
            total + builtFactorylessSettings.listenerCount(event),
          0,
        );
  }

  it.each(['keys', 'tokens'])(
    'releases only the acquired prefix when credential %s admission fails on disk',
    async (stage) => {
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
        scopeId: builtFactorylessConfig.getSessionId(),
        deleteRemote: () => rm(uploaded),
      });
      await retained.lease.release();
      await rm(join(directory, stage));
      await expect(
        fromConfig({
          config: builtFactorylessConfig,
          settingsService: builtFactorylessSettings,
          policyOwner: builtFactorylessPolicy,
          messageBus: builtFactorylessPolicy.session.messageBus,
          runtimeFactoryBindings: builtFactorylessFactories,
          settingsOwner: undefined,
          credentialAuthority: authority,
          providerFileLifecycle: files,
        }),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      expect(files.snapshot().retainedFiles).toBe(0);
      expect(listeners() - before).toBe(0);
      expect(released.length).toBe(stage === 'keys' ? 0 : 1);
      expect(credentials().snapshot()).toStrictEqual([]);
      builtFactorylessSettingsOwner.writeUserParameter('after-failure', 11);
      expect(builtFactorylessSettings.get('after-failure')).toBe(11);
    },
  );

  it('preserves a multi-leaf external acquisition failure without reporting its leaves again as cleanup failures', async () => {
    await fixture();
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
      config: builtFactorylessConfig,
      settingsService: builtFactorylessSettings,
      policyOwner: builtFactorylessPolicy,
      messageBus: builtFactorylessPolicy.session.messageBus,
      runtimeFactoryBindings: builtFactorylessFactories,
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
    await fixture();
    const before = listeners();
    const home = process.env.LLXPRT_CONFIG_HOME;
    await writeFile(join(directory, 'config-home'), 'relative-config-home');
    try {
      await expect(
        fromConfig({
          config: builtFactorylessConfig,
          settingsService: builtFactorylessSettings,
          policyOwner: builtFactorylessPolicy,
          messageBus: builtFactorylessPolicy.session.messageBus,
          runtimeFactoryBindings: builtFactorylessFactories,
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
    await fixture();
    const before = listeners();
    await rm(join(directory, 'tokens'));
    await rm(join(directory, 'key-close'));
    const error = await fromConfig({
      config: builtFactorylessConfig,
      settingsService: builtFactorylessSettings,
      policyOwner: builtFactorylessPolicy,
      messageBus: builtFactorylessPolicy.session.messageBus,
      runtimeFactoryBindings: builtFactorylessFactories,
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
          config: builtFactorylessConfig,
          settingsService: builtFactorylessSettings,
          policyOwner: builtFactorylessPolicy,
          messageBus: builtFactorylessPolicy.session.messageBus,
          runtimeFactoryBindings: builtFactorylessFactories,
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

async function settleFactorylessRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previous: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previous;
  }
}
