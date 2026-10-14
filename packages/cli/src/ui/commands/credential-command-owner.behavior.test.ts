/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ToolKeyStorage,
  type ApiKeyUpdateResult,
} from '@vybestack/llxprt-code-core';
import {
  ProviderKeyStorage,
  SecureStore,
  type KeyringAdapter,
} from '@vybestack/llxprt-code-storage';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import type { RuntimeApi } from '../contexts/RuntimeContext.js';
import { createBaseurlCommand } from './baseurlCommand.js';
import {
  bindBaseurlCommandOperations,
  bindLogoutCommandOperations,
} from './credentialCommandHost.js';
import { createKeyCommand } from './keyCommand.js';
import { createKeyfileCommand } from './keyfileCommand.js';
import { createLogoutCommand } from './logoutCommand.js';
import { createToolkeyCommand } from './toolkeyCommand.js';
import { createToolkeyfileCommand } from './toolkeyfileCommand.js';
import type { SlashCommand } from './types.js';

function unusedRuntimeApi(): RuntimeApi {
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        throw new Error(`Runtime API read through ${String(property)}`);
      },
    },
  ) as RuntimeApi;
}

async function registered(
  name: string,
  owners: Partial<ReturnType<typeof createUnconfiguredBuiltinOwners>>,
): Promise<SlashCommand> {
  const registry = await CommandService.create(
    [
      new BuiltinCommandLoader(
        { ...createUnconfiguredBuiltinOwners(), ...owners },
        null,
      ),
    ],
    new AbortController().signal,
  );
  const command = registry.getCommands().find((item) => item.name === name);
  if (!command?.action) throw new Error(`/${name} is unavailable`);
  return command;
}

function memoryKeyring(): KeyringAdapter {
  const store = new Map<string, string>();
  return {
    getPassword: async (service, account) =>
      store.get(`${service}:${account}`) ?? null,
    setPassword: async (service, account, password) => {
      store.set(`${service}:${account}`, password);
    },
    deletePassword: async (service, account) =>
      store.delete(`${service}:${account}`),
    findCredentials: async (service) =>
      [...store.entries()]
        .filter(([key]) => key.startsWith(`${service}:`))
        .map(([key, password]) => ({
          account: key.slice(service.length + 1),
          password,
        })),
  };
}

describe('registered credential command ownership', () => {
  const owner = useCommandOwners();

  it('applies /baseurl to the registered Agent despite a decoy invocation Agent', async () => {
    const left = await owner('baseurl-left');
    const right = await owner('baseurl-right');
    const command = await registered('baseurl', {
      baseurlCommand: createBaseurlCommand(
        bindBaseurlCommandOperations(unusedRuntimeApi(), left),
      ),
    });

    const result = await command.action!(
      createMockCommandContext({ services: { agent: right } }),
      ' https://left.example.test/v1 ',
    );

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content:
        "Base URL set to 'https://left.example.test/v1' for provider 'fake'",
    });
    const cleared = await command.action!(
      createMockCommandContext({ services: { agent: right } }),
      '',
    );
    expect(cleared).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: "Base URL cleared for provider 'fake'",
    });
  }, 30000);

  it('keeps /baseurl on the surviving owner after a peer is disposed', async () => {
    const left = await owner('baseurl-retired');
    const right = await owner('baseurl-surviving');
    const rightCommand = await registered('baseurl', {
      baseurlCommand: createBaseurlCommand(
        bindBaseurlCommandOperations(unusedRuntimeApi(), right),
      ),
    });
    await left.dispose();

    expect(
      await rightCommand.action!(createMockCommandContext(), 'https://b.test'),
    ).toMatchObject({ messageType: 'info' });
    expect(await right.generate('still serving')).toContain('reply');
  }, 30000);

  it('validates and logs out of /logout providers through the registered Agent', async () => {
    const left = await owner('logout-left');
    const right = await owner('logout-right');
    const command = await registered('logout', {
      logoutCommand: createLogoutCommand(
        bindLogoutCommandOperations(
          left,
          createMockCommandContext().oauthControl,
        ),
      ),
    });
    const decoy = createMockCommandContext({ services: { agent: right } });

    const unknown = await command.action!(decoy, 'not-a-provider');
    expect(unknown).toMatchObject({
      messageType: 'error',
      content: expect.stringContaining('Unknown provider: not-a-provider.'),
    });
    expect(await command.action!(decoy, '')).toMatchObject({
      messageType: 'error',
      content: expect.stringContaining('Please specify a provider'),
    });
    const providers = left.listProviders().map((provider) => provider.name);
    expect(providers.length).toBeGreaterThan(0);
    const supported = providers[0];
    expect(await command.action!(decoy, supported)).toMatchObject({
      messageType: 'info',
      content: expect.stringContaining(supported),
    });
  }, 30000);

  it('keeps each registry key owner separate for /key save and /key load', async () => {
    const [leftDir, rightDir] = await Promise.all([
      mkdtemp(join(tmpdir(), 'credential-owner-left-')),
      mkdtemp(join(tmpdir(), 'credential-owner-right-')),
    ]);
    try {
      const storage = (dir: string): ProviderKeyStorage =>
        new ProviderKeyStorage({
          secureStore: new SecureStore('llxprt-code-provider-keys', {
            keyringLoader: async () => memoryKeyring(),
            fallbackDir: dir,
            fallbackPolicy: 'allow',
          }),
        });
      const leftStorage = storage(leftDir);
      const rightStorage = storage(rightDir);
      const applied: Array<{ owner: string; key: string | null }> = [];
      const ephemeral: Array<{ owner: string; key: string; value: unknown }> =
        [];
      const keyCommand = (
        label: string,
        keys: ProviderKeyStorage,
      ): SlashCommand =>
        createKeyCommand({
          providerKeys: () => keys,
          listKeyCompletionNames: () => keys.listKeys(),
          invalidateKeyCompletion: () => undefined,
          isInteractive: () => true,
          activeProviderName: () => label,
          updateActiveProviderApiKey: async (
            key,
          ): Promise<ApiKeyUpdateResult> => {
            applied.push({ owner: label, key });
            return { changed: true, providerName: label, message: 'ok' };
          },
          setEphemeralSetting: (key, value) =>
            ephemeral.push({ owner: label, key, value }),
          schedulePaymentModeCheck: () => undefined,
        });
      const left = await registered('key', {
        keyCommand: keyCommand('left', leftStorage),
      });
      await registered('key', {
        keyCommand: keyCommand('right', rightStorage),
      });
      const decoy = createMockCommandContext();

      expect(
        await left.action!(decoy, 'save work sk-left-secret'),
      ).toMatchObject({
        messageType: 'info',
      });
      expect(await leftStorage.getKey('work')).toBe('sk-left-secret');
      expect(await rightStorage.getKey('work')).toBeNull();
      expect(await left.action!(decoy, 'load work')).toMatchObject({
        content: "Loaded key 'work' — active for this session",
      });
      expect(applied).toStrictEqual([{ owner: 'left', key: 'sk-left-secret' }]);
      expect(ephemeral).toStrictEqual([
        { owner: 'left', key: 'auth-key-name', value: 'work' },
        { owner: 'left', key: 'auth-key', value: undefined },
        { owner: 'left', key: 'auth-keyfile', value: undefined },
      ]);
    } finally {
      await Promise.all([
        rm(leftDir, { recursive: true, force: true }),
        rm(rightDir, { recursive: true, force: true }),
      ]);
    }
  });

  it('records /keyfile effects on the registered owner only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'credential-owner-keyfile-'));
    try {
      const keyfile = join(dir, 'provider.key');
      await writeFile(keyfile, 'sk-from-file\n');
      const calls: string[] = [];
      const command = await registered('keyfile', {
        keyfileCommand: createKeyfileCommand({
          activeProviderName: () => 'fake',
          updateActiveProviderApiKey: async (key) => {
            calls.push(`key:${key}`);
            return { changed: true, providerName: 'fake', message: 'ok' };
          },
          setEphemeralSetting: (key, value) => {
            calls.push(`set:${key}:${String(value)}`);
          },
          rememberProviderKeyfile: (provider, path) => {
            calls.push(`remember:${provider}:${path}`);
          },
          forgetProviderKeyfile: (provider) => {
            calls.push(`forget:${provider}`);
          },
          schedulePaymentModeCheck: () => undefined,
        }),
      });
      const decoy = createMockCommandContext();

      expect(await command.action!(decoy, keyfile)).toMatchObject({
        messageType: 'info',
        content: `API key loaded from ${keyfile} for provider 'fake'`,
      });
      expect(await command.action!(decoy, 'none')).toMatchObject({
        content: "Cleared keyfile and API key for provider 'fake'",
      });
      expect(calls).toStrictEqual([
        'key:sk-from-file',
        `set:auth-keyfile:${keyfile}`,
        'set:auth-key:undefined',
        `remember:fake:${keyfile}`,
        'key:null',
        'set:auth-keyfile:undefined',
        'forget:fake',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps each registry tool-key owner separate for /toolkey and /toolkeyfile', async () => {
    const [leftDir, rightDir] = await Promise.all([
      mkdtemp(join(tmpdir(), 'toolkey-owner-left-')),
      mkdtemp(join(tmpdir(), 'toolkey-owner-right-')),
    ]);
    try {
      const storage = (dir: string): ToolKeyStorage =>
        new ToolKeyStorage({
          toolsDir: join(dir, 'tools'),
          keyringLoader: async () => memoryKeyring(),
          machineSecretLoader: async () => null,
        });
      const leftStorage = storage(leftDir);
      const rightStorage = storage(rightDir);
      const toolkey = await registered('toolkey', {
        toolkeyCommand: createToolkeyCommand(leftStorage),
      });
      const toolkeyfile = await registered('toolkeyfile', {
        toolkeyfileCommand: createToolkeyfileCommand(leftStorage),
      });
      const keyfile = join(leftDir, 'exa.key');
      await writeFile(keyfile, 'exa-from-file\n');
      const decoy = createMockCommandContext();

      expect(await toolkey.action!(decoy, 'exa sk-left-secret')).toMatchObject({
        messageType: 'info',
        content: expect.stringContaining("API key set for 'Exa Search'"),
      });
      expect(await leftStorage.getKey('exa')).toBe('sk-left-secret');
      expect(await rightStorage.getKey('exa')).toBeNull();

      expect(await toolkeyfile.action!(decoy, `exa ${keyfile}`)).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: `Keyfile set for 'Exa Search': ${keyfile}`,
      });
      expect(await leftStorage.getKeyfilePath('exa')).toBe(keyfile);
      expect(await rightStorage.getKeyfilePath('exa')).toBeNull();

      expect(await toolkeyfile.action!(decoy, 'exa none')).toMatchObject({
        content: "Cleared keyfile for 'Exa Search'",
      });
      expect(await leftStorage.getKeyfilePath('exa')).toBeNull();
      expect(await toolkey.action!(decoy, 'exa none')).toMatchObject({
        content: "Cleared API key for 'Exa Search'",
      });
      expect(await leftStorage.getKey('exa')).toBeNull();
    } finally {
      await Promise.all([
        rm(leftDir, { recursive: true, force: true }),
        rm(rightDir, { recursive: true, force: true }),
      ]);
    }
  });
});
