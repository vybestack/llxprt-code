/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { fromConfig } from '../fromConfig.js';
import { assembleAgentActivationBootstrap } from '../providerSwitchAssembly.js';
import type {
  FromConfigOptions,
  ProviderActivationIntent,
} from '../config-types.js';
import {
  buildCliStyleConfig,
  buildFactoryLessConfig,
  type BuiltCliConfig,
  type BuiltFactoryLessConfig,
} from './helpers/buildCliStyleConfig.js';
import { MemoryTokenStore } from './helpers/provider-auth-fixtures.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

const intent: ProviderActivationIntent = {
  provider: 'fake',
  model: 'fake-model',
  authMode: 'none',
};

describe('fromConfig admission before resource effects', () => {
  const credentials = useOwnedCredentials();
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function fixture(
    initialized = false,
  ): Promise<BuiltCliConfig | BuiltFactoryLessConfig> {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'from-config-admission-')),
    );
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const overrides = {
      workingDir: directory,
      folderTrust: true,
      mcpEnabled: false,
      skillsSupport: false,
      recording: { enabled: false },
      telemetry: { enabled: false },
      settings: { jitContextEnabled: false },
    };
    const built = initialized
      ? await buildCliStyleConfig('plain-text.jsonl', overrides)
      : await buildFactoryLessConfig('plain-text.jsonl', {}, overrides);
    cleanups.push(built.cleanup);
    return built;
  }

  async function rejectWithoutAcquisition(
    options: FromConfigOptions,
  ): Promise<unknown> {
    const home = process.env.LLXPRT_CONFIG_HOME;
    if (home === undefined) throw new Error('Missing fixture config home');
    const before = (await readdir(home, { recursive: true })).sort();
    const workspaceBefore = (
      await readdir(options.config.getTargetDir(), { recursive: true })
    ).sort();
    const transports = credentials().snapshot();
    const outcome = await fromConfig({
      ...options,
      credentialAuthority: credentials().authority,
    }).then(
      async (agent) => {
        await agent.dispose();
        return undefined;
      },
      (error: unknown) => error,
    );
    const after = await readdir(home, { recursive: true });
    const workspaceAfter = await readdir(options.config.getTargetDir(), {
      recursive: true,
    });
    expect([
      ...after.filter((entry) => !before.includes(entry)),
      ...before.filter((entry) => !after.includes(entry)),
    ]).toStrictEqual([]);
    expect([
      ...workspaceAfter.filter((entry) => !workspaceBefore.includes(entry)),
      ...workspaceBefore.filter((entry) => !workspaceAfter.includes(entry)),
    ]).toStrictEqual([]);
    expect(credentials().snapshot().length - transports.length).toBe(0);
    return outcome;
  }

  it('rejects a borrowed settings owner from another store before workspace or media creation', async () => {
    const built = await fixture();
    await expect(
      rejectWithoutAcquisition({
        ...built,
        settingsService: new SettingsService(),
      }),
    ).resolves.toMatchObject({ message: expect.stringMatching(/settings/i) });
  });

  it('rejects borrowed OAuth on another bus before provider acquisition', async () => {
    const built = await fixture();
    const other = await fixture();
    const oauth = new OAuthManager(new MemoryTokenStore(), undefined, {
      config: built.config,
      messageBus: other.messageBus,
    });
    cleanups.push(() => oauth.dispose());
    await expect(
      rejectWithoutAcquisition({ ...built, oauthManager: oauth }),
    ).resolves.toMatchObject({
      message: expect.stringMatching(/OAuth.*message bus/i),
    });
    expect(oauth.runtimeMessageBus).toBe(other.messageBus);
  });

  it('adopts the policy owner bus when no explicit bus is supplied', async () => {
    const built = await fixture();
    const oauth = new OAuthManager(new MemoryTokenStore(), undefined, {
      messageBus: built.messageBus,
    });
    cleanups.push(() => oauth.dispose());
    const agent = await fromConfig({
      ...built,
      messageBus: undefined,
      oauthManager: oauth,
      credentialAuthority: credentials().authority,
    });
    cleanups.push(() => agent.dispose());
    expect(agent.getMessageBus()).toBe(built.messageBus);
    expect(oauth.runtimeMessageBus).toBe(built.messageBus);
  });

  it('accepts an unbound borrowed OAuth manager without replacing its binding', async () => {
    const built = await fixture();
    const oauth = new OAuthManager(new MemoryTokenStore());
    cleanups.push(() => oauth.dispose());
    const agent = await fromConfig({
      ...built,
      oauthManager: oauth,
      credentialAuthority: credentials().authority,
    });
    cleanups.push(() => agent.dispose());
    expect(agent.getMessageBus()).toBe(built.messageBus);
    expect(oauth.runtimeMessageBus).toBeUndefined();
  });

  it('retains borrowed OAuth when adoption must create its own bus', async () => {
    const built = await fixture();
    const oauth = new OAuthManager(new MemoryTokenStore(), undefined, {
      messageBus: built.messageBus,
    });
    cleanups.push(() => oauth.dispose());
    const agent = await fromConfig({
      config: built.config,
      settingsService: built.settingsService,
      oauthManager: oauth,
      credentialAuthority: credentials().authority,
    });
    cleanups.push(() => agent.dispose());
    expect(agent.getMessageBus()).not.toBe(built.messageBus);
    expect(oauth.runtimeMessageBus).toBe(built.messageBus);
  });
  it('rejects an MCP handoff on another bus before media or provider acquisition', async () => {
    const built = await fixture(true);
    const other = await fixture();
    await expect(
      rejectWithoutAcquisition({ ...built, messageBus: other.messageBus }),
    ).resolves.toMatchObject({
      message: expect.stringMatching(/message\s*bus/i),
    });
  });

  it('rejects an MCP handoff for another Config before media or provider acquisition', async () => {
    const built = await fixture(true);
    const other = await fixture();
    if (!('mcpRuntime' in built))
      throw new Error('Missing initialized MCP fixture');
    await expect(
      rejectWithoutAcquisition({ ...other, mcpRuntime: built.mcpRuntime }),
    ).resolves.toMatchObject({ message: expect.stringMatching(/Config/i) });
  });

  it('already rejects a borrowed client for another Config without acquisition', async () => {
    const built = await fixture(true);
    const other = await fixture();
    await expect(
      rejectWithoutAcquisition({ ...built, config: other.config }),
    ).resolves.toMatchObject({ message: expect.stringMatching(/Config/i) });
  });

  it('already rejects a borrowed client for another manager without acquisition', async () => {
    const built = await fixture(true);
    const other = await fixture(true);
    await expect(
      rejectWithoutAcquisition({
        ...built,
        providerManager: other.providerManager,
      }),
    ).resolves.toMatchObject({ message: expect.stringMatching(/manager/i) });
  });

  for (const mismatch of ['settings', 'config', 'manager', 'intent', 'bus']) {
    it(`rejects preflight ${mismatch} identity before transferring or acquiring resources`, async () => {
      const built = await buildCliStyleConfig('plain-text.jsonl');
      cleanups.push(built.cleanup);
      const other = await fixture(true);
      const operation = await assembleAgentActivationBootstrap(
        built.config,
        built.settingsService,
        built.providerManager,
        built.runtime.oauthManager,
        () => 'agent',
        built.agentClient,
        built.mcpRuntime,
        undefined,
        undefined,
        built.settingsOwner,
        'borrowed',
        undefined,
        undefined,
        undefined,
        undefined,
        built.runtime.providerFileLifecycle,
        built.messageBus,
      );
      cleanups.push(() => Promise.resolve(operation.dispose()));
      const result = await operation.preflight(intent);
      if (result.token === undefined)
        throw new Error('Missing preflight receipt');
      await expect(
        rejectWithoutAcquisition({
          settingsService:
            mismatch === 'settings'
              ? other.settingsService
              : built.settingsService,
          config: mismatch === 'config' ? other.config : built.config,
          providerManager:
            mismatch === 'manager'
              ? other.providerManager
              : built.providerManager,
          messageBus: mismatch === 'bus' ? other.messageBus : built.messageBus,
          mcpRuntime: built.mcpRuntime,
          activation:
            mismatch === 'intent' ? { ...intent, model: 'other' } : intent,
          activationPreflight: { operation, token: result.token },
        }),
      ).resolves.toMatchObject({
        message: expect.stringMatching(
          mismatch === 'settings' ? /settings/i : /preflight/i,
        ),
      });
    });
  }
});
