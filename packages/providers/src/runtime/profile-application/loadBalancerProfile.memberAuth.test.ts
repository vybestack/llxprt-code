/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  ProfileManager,
  SettingsService,
  type AuthConfig,
} from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LoadBalancingProvider } from '../../LoadBalancingProvider.js';
import { ProviderManager } from '../../ProviderManager.js';
import type { GenerateChatOptions, IProvider } from '../../IProvider.js';
import { createProviderKeyStorage } from '../runtimeSettings.js';
import { resolveLoadBalancerSubProfile } from './loadBalancerProfile.js';
import { resolveMemberAuthentication } from '../../loadBalancing/memberAuthentication.js';

describe('resolveLoadBalancerSubProfile — member auth handling', () => {
  const tempDirs: string[] = [];

  async function makeTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-lb-auth-'));
    tempDirs.push(dir);
    return dir;
  }

  function silentLogger(): {
    debug: (messageFactory: () => string) => void;
    warn: (messageFactory: () => string) => void;
  } {
    return {
      debug: () => {},
      warn: () => {},
    };
  }

  function deps(
    profileManagerInstance: ProfileManager,
  ): Parameters<typeof resolveLoadBalancerSubProfile>[1] {
    return {
      lbName: 'lb-main',
      profileManagerInstance,
      lbLogger: silentLogger(),
    };
  }

  beforeEach(() => {
    if (process.env.LLXPRT_TEST_STORAGE_ISOLATED !== '1') {
      throw new Error(
        'loadBalancerProfile.memberAuth tests require isolated storage (preload guard)',
      );
    }
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) =>
        fs.rm(dir, { recursive: true, force: true }).catch(() => {}),
      ),
    );
    tempDirs.length = 0;
  });
  it('copies an OAuth auth intent and resolves NO plaintext authToken', async () => {
    const tempDir = await makeTempDir();
    const pm = new ProfileManager(path.join(tempDir, 'profiles'));
    await pm.saveProfile('member-oauth', {
      version: 1,
      type: 'standard',
      provider: 'anthropic',
      model: 'claude-sonnet',
      modelParams: {},
      ephemeralSettings: {},
      auth: { type: 'oauth', buckets: ['acct-a'] },
    });

    const resolved = await resolveLoadBalancerSubProfile(
      'member-oauth',
      deps(pm),
    );

    expect(resolved.auth).toStrictEqual({ type: 'oauth', buckets: ['acct-a'] });
    expect(resolved.authToken).toBeUndefined();
  });

  it.each(['auth-key', 'auth-key-name'])(
    'ignores stray %s when the member explicitly selects OAuth',
    async (key) => {
      const tempDir = await makeTempDir();
      const pm = new ProfileManager(path.join(tempDir, 'profiles'));
      await pm.saveProfile('member-oauth', {
        version: 1,
        provider: 'anthropic',
        model: 'claude-sonnet',
        modelParams: {},
        ephemeralSettings: { [key]: 'stray-credential' },
        auth: { type: 'oauth', buckets: ['acct-a'] },
      });
      const storage = createProviderKeyStorage();
      await storage.saveKey('stray-credential', 'stray-secret');
      try {
        const resolved = await resolveLoadBalancerSubProfile(
          'member-oauth',
          deps(pm),
        );
        expect(resolved.authToken).toStrictEqual(undefined);
        expect(resolved.authKeyName).toStrictEqual(undefined);
        expect(resolved.auth).toStrictEqual({
          type: 'oauth',
          buckets: ['acct-a'],
        });
      } finally {
        await storage.deleteKey('stray-credential');
      }
    },
  );

  it('retains an API-key name without reading secret material at registration', async () => {
    const tempDir = await makeTempDir();
    const pm = new ProfileManager(path.join(tempDir, 'profiles'));
    await pm.saveProfile('member-keyname', {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: { 'auth-key-name': 'not-yet-stored' },
      auth: { type: 'apikey' },
    });
    const resolved = await resolveLoadBalancerSubProfile(
      'member-keyname',
      deps(pm),
    );
    expect(resolved.authKeyName).toStrictEqual('not-yet-stored');
    expect(resolved.authToken).toStrictEqual(undefined);
    expect(resolved.auth).toStrictEqual({ type: 'apikey' });
  });

  const strategies: Array<'round-robin' | 'failover'> = [
    'round-robin',
    'failover',
  ];
  const rotationCases = strategies.flatMap((strategy) =>
    ['auth-key-name', 'auth-keyfile'].map((source) => ({ strategy, source })),
  );
  it.each(rotationCases)(
    '$strategy resolves and trims $source on every delegate attempt',
    async ({ strategy, source }) => {
      const tempDir = await makeTempDir();
      const pm = new ProfileManager(path.join(tempDir, 'profiles'));
      const keyName = `lb-rotation-${path.basename(tempDir)}`;
      const keyfile = path.join(tempDir, 'rotating.key');
      await fs.writeFile(keyfile, '  first-key  ');
      await pm.saveProfile('member-keyname', {
        version: 1,
        provider: 'key-probe',
        model: 'test-model',
        modelParams: {},
        ephemeralSettings: {
          [source]: source === 'auth-keyfile' ? keyfile : keyName,
          'base-url': 'https://key-probe.example.test',
        },
        auth: { type: 'apikey' },
      });
      const storage = createProviderKeyStorage();
      await storage.saveKey(keyName, '  first-key  ');
      try {
        const resolved = await resolveLoadBalancerSubProfile(
          'member-keyname',
          deps(pm),
        );
        const settings = new SettingsService();
        const config = createRuntimeConfigStub(settings);
        const runtime = {
          settingsService: settings,
          config,
          runtimeId: keyName,
        };
        const providerManager = new ProviderManager({
          settingsService: settings,
          config,
          runtime,
        });
        const delegate: IProvider = {
          name: 'key-probe',
          getModels: async () => [],
          getDefaultModel: () => 'test-model',
          async *generateChatCompletion(
            options: GenerateChatOptions | IContent[],
          ): AsyncGenerator<IContent> {
            if (Array.isArray(options))
              throw new Error('Expected delegate options');
            const token = options.resolved?.authToken;
            if (typeof token !== 'string')
              throw new Error('Expected resolved key');
            yield { speaker: 'ai', blocks: [{ type: 'text', text: token }] };
          },
        };
        providerManager.registerProvider(delegate);
        const lb = new LoadBalancingProvider(
          {
            profileName: 'lb-main',
            strategy,
            subProfiles: [resolved, { ...resolved, name: 'second-member' }],
          },
          providerManager,
        );
        const observed: IContent[] = [];
        for (const value of ['  first-key  ', '  rotated-key  ']) {
          await storage.saveKey(keyName, value);
          await fs.writeFile(keyfile, value);
          for await (const chunk of lb.generateChatCompletion({
            contents: [],
            settings,
            config,
            runtime,
          })) {
            observed.push(chunk);
          }
        }
        expect(observed).toStrictEqual([
          { speaker: 'ai', blocks: [{ type: 'text', text: 'first-key' }] },
          { speaker: 'ai', blocks: [{ type: 'text', text: 'rotated-key' }] },
        ]);
        expect(resolved.authToken).toStrictEqual(undefined);
      } finally {
        await storage.deleteKey(keyName);
      }
    },
  );

  it.each(['missing-key', 'invalid key name!'])(
    'falls back to the member keyfile when the named key is unavailable (%s)',
    async (authKeyName) => {
      const tempDir = await makeTempDir();
      const authKeyfile = path.join(tempDir, 'fallback.key');
      await fs.writeFile(authKeyfile, '  fallback-token  ');
      const member = {
        name: 'member',
        providerName: 'openai',
        model: 'm1',
        authKeyName,
        authKeyfile,
        ephemeralSettings: {},
        modelParams: {},
      };
      const resolved = await resolveMemberAuthentication(
        member,
        silentLogger(),
      );
      expect(resolved.authToken).toStrictEqual('fallback-token');
      const missing = await resolveMemberAuthentication(
        { ...member, authKeyfile: undefined },
        silentLogger(),
      );
      expect(missing.authToken).toStrictEqual(undefined);
    },
  );

  it('rejects non-plain auth records during registration', async () => {
    const auth = { type: 'oauth', buckets: ['account'] } satisfies AuthConfig;
    Object.setPrototypeOf(auth, { inherited: true });
    const member = await resolveLoadBalancerSubProfile('non-plain-auth', {
      lbName: 'lb-main',
      lbLogger: silentLogger(),
      profileManagerInstance: {
        loadProfile: async () => ({
          version: 1,
          provider: 'openai',
          model: 'm1',
          modelParams: {},
          ephemeralSettings: {},
          auth,
        }),
      },
    });
    expect(member.auth).toStrictEqual(undefined);
  });

  it('retains inline key precedence over a named key', async () => {
    const resolved = await resolveLoadBalancerSubProfile('inline-member', {
      lbName: 'lb-main',
      lbLogger: silentLogger(),
      profileManagerInstance: {
        loadProfile: async () => ({
          version: 1,
          provider: 'openai',
          model: 'm1',
          modelParams: {},
          ephemeralSettings: {
            'auth-key': 'inline-key',
            'auth-key-name': 'unused-name',
          },
        }),
      },
    });
    expect(resolved.authToken).toStrictEqual('inline-key');
    expect(resolved.authKeyName).toStrictEqual(undefined);
  });

  it('ignores a stray auth-keyfile when the member explicitly selects OAuth', async () => {
    const tempDir = await makeTempDir();
    const authKeyfile = path.join(tempDir, 'oauth.key');
    await fs.writeFile(authKeyfile, '  file-token  ');
    const resolved = await resolveLoadBalancerSubProfile(
      'oauth-keyfile-member',
      {
        lbName: 'lb-main',
        lbLogger: silentLogger(),
        profileManagerInstance: {
          loadProfile: async () => ({
            version: 1,
            provider: 'openai',
            model: 'm1',
            modelParams: {},
            auth: { type: 'oauth', buckets: ['account'] },
            ephemeralSettings: {
              'auth-key': 'stray-key',
              'auth-keyfile': authKeyfile,
            },
          }),
        },
      },
    );
    expect(resolved.authToken).toStrictEqual(undefined);
    expect(
      (await resolveMemberAuthentication(resolved, silentLogger())).authToken,
    ).toStrictEqual(undefined);
    expect(resolved.auth).toStrictEqual({
      type: 'oauth',
      buckets: ['account'],
    });
  });

  it('retains keyfile intent at registration and reads rotated content at use time', async () => {
    const tempDir = await makeTempDir();
    const pm = new ProfileManager(path.join(tempDir, 'profiles'));
    const keyfilePath = path.join(tempDir, 'member.key');
    await fs.writeFile(keyfilePath, ' file-token ', 'utf8');
    await pm.saveProfile('member-keyfile', {
      version: 1,
      type: 'standard',
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: { 'auth-keyfile': keyfilePath },
    });

    const resolved = await resolveLoadBalancerSubProfile(
      'member-keyfile',
      deps(pm),
    );

    expect(resolved.authToken).toStrictEqual(undefined);
    expect(resolved.authKeyfile).toStrictEqual(keyfilePath);
    const first = await resolveMemberAuthentication(resolved, silentLogger());
    await fs.writeFile(keyfilePath, '  rotated-token  ', 'utf8');
    const second = await resolveMemberAuthentication(resolved, silentLogger());
    expect([first.authToken, second.authToken]).toStrictEqual([
      'file-token',
      'rotated-token',
    ]);
    expect(resolved.authToken).toStrictEqual(undefined);
    await fs.unlink(keyfilePath);
    expect(
      (await resolveMemberAuthentication(resolved, silentLogger())).authToken,
    ).toStrictEqual(undefined);
  });

  it('leaves authToken and auth intent undefined when the member has no auth', async () => {
    const tempDir = await makeTempDir();
    const pm = new ProfileManager(path.join(tempDir, 'profiles'));
    await pm.saveProfile('member-plain', {
      version: 1,
      type: 'standard',
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    });

    const resolved = await resolveLoadBalancerSubProfile(
      'member-plain',
      deps(pm),
    );

    expect(resolved.authToken).toBeUndefined();
    expect(resolved.auth).toBeUndefined();
  });
});
