/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { mkdtemp, rm, realpath, writeFile } from 'node:fs/promises';
import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  Config,
  WorkspaceFilesystemOwner,
  WorkspaceTrustLifecycle,
  assembleWorkspaceMemory,
} from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  ProviderManager,
  ProviderFileLifecycle,
  resolveProviderFilePolicy,
} from '../../index.js';
import type { IProvider } from '../../IProvider.js';
import type { OAuthManager } from '../../auth/oauth-manager.js';
import { configureProviderTokenizer } from '../../composition/index.js';
import { buildProviderContributionRegistry } from '../../composition/runtimePlugins/index.js';

import type { Agent } from '../../../../agents/src/api/agent.js';
import {
  AgentProfilePreflight,
  prepareAgentPreflight,
} from '../../../../agents/src/api/profile-preflight.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
  preparePreferredProviderCompletion,
} from '../../../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../../../agents/src/api/adoption-release.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../../agents/src/core/subagent-cleanup.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';

class StubProvider implements IProvider {
  constructor(readonly name: string) {}
  async getModels(): Promise<never[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'p04-adopted-default';
  }
  async *generateChatCompletion(): AsyncIterableIterator<never> {
    // intentionally empty — never driven in these tests
  }
}

interface Root {
  readonly manager: ProviderManager;
  readonly config: Config;
  readonly files: ProviderFileLifecycle;
  readonly runtimeId: string;
  readonly activate: () => Promise<void>;
  readonly close: () => Promise<void>;
}

describe('runtime context providerManager adoption seam (P04 RED) @plan:PLAN-20260621-COREAPIREMED.P04 @requirement:REQ-005.2', () => {
  const credentials = useOwnedCredentials();
  const callerRetiring: Array<() => void | Promise<void>> = [];
  const openRoots: Root[] = [];
  const routeBRetiring: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await runCleanupSteps(openRoots.splice(0).map((root) => root.close));
    await runCleanupSteps(routeBRetiring.splice(0).reverse());
    await runCleanupSteps(callerRetiring.splice(0).reverse());
  });

  function buildCallerManager(): ProviderManager {
    const directory = mkdtempSync(join(tmpdir(), 'manager-caller-'));
    callerRetiring.push(() => rm(directory, { recursive: true, force: true }));
    const settings = new SettingsService();
    const config = new Config({
      sessionId: 'caller-manager',
      targetDir: directory,
      cwd: directory,
      model: 'caller-model',
      debugMode: false,
    });
    callerRetiring.push(() => config.dispose());
    const owner = new SessionSettingsOwner(settings);
    callerRetiring.push(() => owner.dispose());
    owner.bindTelemetry(config);
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      settings,
      config,
      undefined,
      credentials().authority,
      owner,
    );
    callerRetiring.push(() => manager.dispose());
    return manager;
  }

  async function openRoot(runtimeId: string, model: string): Promise<Root> {
    const closing: Array<() => void | Promise<void>> = [];
    const close = (): Promise<void> =>
      runCleanupSteps(closing.splice(0).reverse());
    try {
      const raw = await mkdtemp(join(tmpdir(), 'adopted-manager-'));
      closing.push(() => rm(raw, { recursive: true, force: true }));
      const directory = await realpath(raw);
      const config = new Config({
        sessionId: runtimeId,
        targetDir: directory,
        cwd: directory,
        model,
        debugMode: false,
      });
      closing.push(() => config.dispose());
      const release = new AcquisitionRelease();
      let complete = false;
      closing.push(() => (complete ? release.close() : release.rollback()));
      const settings = new SettingsService();
      const owner = new SessionSettingsOwner(settings);
      release.acquire('settings', () => owner.dispose());
      owner.bindTelemetry(config);
      const policy = new RuntimePolicyOwner(config);
      release.acquire('policy', () => policy.dispose());
      const files = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      release.acquire('files', () => releaseAdoptedFileScope(files, runtimeId));
      const manager = acquirePreferredProviderManager(
        config,
        settings,
        owner,
        files,
        runtimeId,
        credentials().authority,
        release,
      );
      const oauth: OAuthManager = acquirePreferredOAuth(
        undefined,
        policy.session.messageBus,
        config,
        settings,
        manager,
        runtimeId,
        undefined,
        credentials().authority,
        release,
        undefined,
      );
      complete = true;
      const root: Root = {
        manager,
        config,
        files,
        runtimeId,
        activate: () =>
          preparePreferredProviderCompletion(
            config,
            settings,
            owner,
            manager,
            oauth,
            runtimeId,
            configureProviderTokenizer(manager),
            undefined,
          ),
        close,
      };
      openRoots.push(root);
      return root;
    } catch (primary) {
      return cleanupAfterFailure(primary, close);
    }
  }

  async function openForegroundWithContributedProvider(
    provider: IProvider,
    model: string,
  ): Promise<Agent> {
    try {
      const raw = await mkdtemp(join(tmpdir(), 'adopted-route-b-'));
      routeBRetiring.push(() => rm(raw, { recursive: true, force: true }));
      const directory = await realpath(raw);
      const config = new Config({
        sessionId: 'p04-pm-adopted-activation',
        targetDir: directory,
        cwd: directory,
        model,
        debugMode: false,
      });
      routeBRetiring.push(() => config.dispose());
      const trust = new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      });
      routeBRetiring.push(() => trust.dispose());
      const filesystem = new WorkspaceFilesystemOwner({
        targetDir: config.getTargetDir(),
        isTrusted: () => trust.isTrustedFolder(),
      });
      routeBRetiring.push(() => filesystem.dispose());
      const memory = assembleWorkspaceMemory(config, filesystem, trust);
      routeBRetiring.push(() => memory.dispose());
      const providerId = `${provider.name}-provider`;
      const preflight = await prepareAgentPreflight(
        { runtimeId: 'p04-pm-adopted-activation' },
        credentials().authority,
        new SettingsService(),
        undefined,
        buildProviderContributionRegistry([
          {
            specifier: `memory:${providerId}`,
            manifest: {
              apiVersion: 1,
              id: providerId,
              providers: [
                {
                  providerId,
                  createProvider: () => provider,
                  builtinAliases: [
                    {
                      alias: provider.name,
                      config: {
                        baseProvider: providerId,
                        'requires-auth': false,
                      },
                    },
                  ],
                },
              ],
            },
          },
        ]),
      );
      routeBRetiring.push(() => preflight.dispose());
      await preflight.preparePostConfiguration(
        config,
        filesystem,
        memory,
        trust,
        () => trust.dispose(),
        undefined,
      );
      const intent = { provider: provider.name, model };
      const accepted = await preflight.preflight(intent);
      if (accepted.token === undefined)
        throw new Error('Preflight did not accept the activation');
      const agent = await AgentProfilePreflight.createForegroundAgent(
        preflight,
        accepted.token,
        intent,
        {},
      );
      routeBRetiring.push(() => agent.dispose());
      return agent;
    } catch (primary) {
      return cleanupAfterFailure(primary, () =>
        runCleanupSteps(routeBRetiring.splice(0).reverse()),
      );
    }
  }

  it('DEFAULT — omitting providerManager yields a fresh manager !== a caller-held pm', async () => {
    const runtimeIds = fc.tuple(
      fc
        .string({ minLength: 1, maxLength: 32 })
        .filter((s) => !s.includes('\0')),
      fc.stringMatching(/^[a-zA-Z0-9_-]{1,16}$/),
    );
    await fc.assert(
      fc.asyncProperty(runtimeIds, async ([idA, idB]) => {
        const callerHeld = buildCallerManager();
        const first = await openRoot(idA, 'p04-default-model');
        const second = await openRoot(idB, 'p04-default-model');
        try {
          callerHeld.registerProvider(new StubProvider('p04-caller-stub'));
          first.manager.registerProvider(new StubProvider('p04-first-stub'));
          second.manager.registerProvider(new StubProvider('p04-second-stub'));
          expect(first.manager.listProviders()).toContain('p04-first-stub');
          expect(second.manager.listProviders()).toContain('p04-second-stub');
          expect(callerHeld.listProviders()).toContain('p04-caller-stub');
          expect(first.manager.listProviders()).not.toContain(
            'p04-caller-stub',
          );
          expect(callerHeld.listProviders()).not.toContain('p04-first-stub');
          expect(first.manager.listProviders()).not.toContain(
            'p04-second-stub',
          );
          expect(second.manager.listProviders()).not.toContain(
            'p04-first-stub',
          );
          return true;
        } finally {
          await first.close();
          await second.close();
          await runCleanupSteps(callerRetiring.splice(0).reverse());
        }
      }),
      { examples: [[['p04-pm-default', 'p04-pm-default-peer']]] },
    );
  });

  it('ADOPTED ACTIVATION — after activate, the handle resolves the adopted manager and its provider state', async () => {
    const provider = new StubProvider('p04-adopted-stub');
    const agent = await openForegroundWithContributedProvider(
      provider,
      'p04-adopted-model',
    );

    expect(agent.listProviders().map((info) => info.name)).toContain(
      provider.name,
    );
    expect(agent.getProvider()).toBe(provider.name);
  });

  it('CLEANUP CONTRACT — onCleanup receives the adopted manager and cleanup disposes neither manager', async () => {
    const root = await openRoot('p04-pm-cleanup', 'p04-cleanup-model');
    const rawDirectory = await mkdtemp(join(tmpdir(), 'adopted-remote-'));
    callerRetiring.push(() =>
      rm(rawDirectory, { recursive: true, force: true }),
    );
    const remotePath = join(
      await realpath(rawDirectory),
      'adopted-remote-file',
    );
    await writeFile(remotePath, 'retained caller-owned provider file');
    const retained = await root.files.retain({
      cacheKey: 'cleanup-observation',
      fileId: remotePath,
      bytes: 35,
      identity: {
        provider: 'openai',
        baseURL: 'https://example.invalid',
        credentialHash: 'caller-credential',
      },
      policy: resolveProviderFilePolicy({
        configuredMode: 'session',
        configuredRetentionMs: 60000,
        configuredDeletion: 'delete',
        providerFileReferences: true,
        zeroDataRetention: 'incompatible-while-retained',
        zeroDataRetentionRequired: false,
      }),
      scopeId: root.runtimeId,
      deleteRemote: async (file) => {
        await rm(file);
      },
    });
    await retained.lease.release();

    try {
      await root.activate();
      expect(existsSync(remotePath)).toBe(true);
      await root.close();

      expect(existsSync(remotePath)).toBe(false);
    } finally {
      await root.close();
    }
  });
});
