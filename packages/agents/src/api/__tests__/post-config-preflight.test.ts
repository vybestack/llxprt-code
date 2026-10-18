import * as assembly from '../providerSwitchAssembly.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { spyOn } from 'bun:test';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  SessionSettingsOwner,
  WorkspaceTrustLifecycle,
  WorkspaceFilesystemOwner,
  assembleWorkspaceMemory,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { prepareAgentPreflight } from '../profile-preflight.js';
import { AgentProfilePreflight } from '../profile-preflight.js';
import type { AgentActivationOperation } from '../activationPreflightState.js';

function transfer(operation: AgentProfilePreflight): AgentActivationOperation {
  let activation: AgentActivationOperation | undefined;
  operation.transferActivation((selected) => {
    activation = selected;
  });
  if (activation === undefined)
    throw new Error('Missing transferred activation');
  return activation;
}

describe('post-config preflight ownership', () => {
  const credentials = useOwnedCredentials();
  it('owns foreground workspace acquisition and leaves a same-label peer usable after retirement', async () => {
    const roots = await Promise.all(
      [0, 1].map(() => mkdtemp(join(tmpdir(), 'foreground-workspace-'))),
    );
    const operations: AgentProfilePreflight[] = [];
    const configs: Config[] = [];
    const agents: Array<
      Awaited<ReturnType<typeof AgentProfilePreflight.createForegroundAgent>>
    > = [];
    try {
      for (const [index, root] of roots.entries()) {
        const config = new Config({
          debugMode: false,
          sessionId: 'same-label',
          cwd: root,
          targetDir: root,
          model: 'test-model',
          provider: 'openai',
          mcpEnabled: false,
          skillsSupport: false,
          folderTrust: true,
        });
        configs.push(config);
        const operation = await prepareAgentPreflight(
          { runtimeId: 'same-label' },
          credentials().authority,
        );
        operations.push(operation);
        await writeFile(join(root, 'owner.txt'), `workspace-${index}`);
        await operation.prepareConfiguredWorkspace(config, () => {});
        const intent = { provider: 'openai', authMode: 'none' } as const;
        const result = await operation.preflight(intent);
        if (result.token === undefined)
          throw new Error('Missing accepted activation');
        agents.push(
          await AgentProfilePreflight.createForegroundAgent(
            operation,
            result.token,
            intent,
            {},
          ),
        );
      }
      expect(
        await agents[0].workspace.readTextFile(join(roots[0], 'owner.txt')),
      ).toBe('workspace-0');
      expect(
        await agents[1].workspace.readTextFile(join(roots[1], 'owner.txt')),
      ).toBe('workspace-1');
      expect(agents[0].workspace.getDirectories()).not.toContain(roots[1]);
      await agents[0].dispose();
      await expect(
        agents[0].workspace.readTextFile(join(roots[0], 'owner.txt')),
      ).rejects.toThrow('Workspace checkpoint facade is closed');
      expect(
        await agents[1].workspace.readTextFile(join(roots[1], 'owner.txt')),
      ).toBe('workspace-1');
      expect(await readFile(join(roots[0], 'owner.txt'), 'utf8')).toBe(
        'workspace-0',
      );
    } finally {
      for (const agent of agents) await agent.dispose();
      for (const operation of operations) await operation.dispose();
      for (const config of configs) await config.dispose();
      for (const root of roots)
        await rm(root, { recursive: true, force: true });
    }
  });
  async function withPreflight(
    borrowed: boolean,
    run: (
      operation: AgentProfilePreflight,
      prepare: (onManagerReady?: () => void) => Promise<void>,
      supplied: SessionSettingsOwner | undefined,
      stages: readonly string[],
    ) => Promise<void>,
  ): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), 'post-config-preflight-'));
    const settings = new SettingsService();
    const supplied = borrowed ? new SessionSettingsOwner(settings) : undefined;
    const operation = await prepareAgentPreflight(
      { runtimeId: 'post-config-preflight' },
      credentials().authority,
      settings,
    );
    const config = new Config({
      debugMode: false,
      sessionId: 'post-config',
      cwd: root,
      targetDir: root,
      model: 'test-model',
      provider: 'openai',
      mcpEnabled: false,
      skillsSupport: false,
    });
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: root,
      isTrusted: () => trust.isTrustedFolder(),
    });
    const memory = assembleWorkspaceMemory(config, filesystem, trust);
    const stages: string[] = [];
    const prepare = async (onManagerReady?: () => void): Promise<void> => {
      const readPolicy = config.getPolicyEngineConfig.bind(config);
      const policyObservation = spyOn(
        config,
        'getPolicyEngineConfig',
      ).mockImplementation(() => {
        stages.push('policy');
        return readPolicy();
      });
      const configure = ProviderManager.prototype.setConfig;
      const managerObservation = spyOn(
        ProviderManager.prototype,
        'setConfig',
      ).mockImplementation(function (this: ProviderManager, config) {
        configure.call(this, config);
        stages.push('manager');
        onManagerReady?.();
      });
      const assemble = assembly.assembleAgentActivationBootstrap;
      const activationObservation = spyOn(
        assembly,
        'assembleAgentActivationBootstrap',
      ).mockImplementation(async (...args) => {
        if (args[16] === undefined)
          throw new Error('Missing acquired file owner');
        expect(args[3]).not.toBeNull();
        stages.push('oauth', 'files');
        return assemble(...args);
      });
      try {
        await operation.preparePostConfiguration(
          config,
          filesystem,
          memory,
          trust,
          () => trust.dispose(),
          supplied,
        );
      } finally {
        policyObservation.mockRestore();
        managerObservation.mockRestore();
        activationObservation.mockRestore();
      }
    };
    try {
      await run(operation, prepare, supplied, stages);
    } finally {
      await operation.dispose();
      await supplied?.dispose();
      await memory.dispose();
      await filesystem.dispose();
      await trust.dispose();
      await config.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }

  for (const borrowed of [false, true]) {
    it(`constructs the foreground Agent privately from its accepted activation (borrowed ${borrowed})`, async () => {
      await withPreflight(borrowed, async (operation, prepare, supplied) => {
        await prepare();
        const intent = { provider: 'openai', authMode: 'none' } as const;
        const result = await operation.preflight(intent);
        if (result.token === undefined)
          throw new Error('Missing activation receipt');
        const activation = transfer(operation);
        const bus = activation.messageBus;
        if (bus === undefined)
          throw new Error('Missing activation message bus');
        const client = activation.sessionClient.getAgentClient();
        const agent = await AgentProfilePreflight.createForegroundAgent(
          operation,
          result.token,
          intent,
          {},
        );
        try {
          expect(agent.getMessageBus()).toBe(bus);
          expect(
            (await agent.getHistory()).length -
              (await client.getHistory()).length,
          ).toBe(0);
          expect(agent.getRuntimeId()).toBe('post-config');
          expect(agent.getProvider()).toBe('openai');
          expect(agent.getModel()).toBe('test-model');
          expect(agent.listTools().length).toBeGreaterThan(0);
          await expect(
            AgentProfilePreflight.createForegroundAgent(
              operation,
              result.token,
              intent,
              {},
            ),
          ).rejects.toThrow('already');
        } finally {
          await agent.dispose();
        }
        supplied?.writeUserParameter('context-limit', 8192);
        expect(supplied?.readNamedParameter('context-limit')).toBe(
          borrowed ? 8192 : undefined,
        );
      });
    });
  }

  it('initializes the transferred client from the applied profile without an extra activation', async () => {
    await withPreflight(false, async (operation, prepare) => {
      await prepare();
      await operation.captureProfileOperation().applySnapshot({
        version: 1,
        provider: 'openai',
        model: 'profile-selected-model',
        modelParams: { temperature: 0.37 },
        ephemeralSettings: {
          'context-limit': 4096,
          'auth-key': 'preflight-profile-key',
          'base-url': 'http://127.0.0.1:1/v1',
        },
      });
      const activation = transfer(operation);
      try {
        expect(
          activation.sessionClient.getAgentClient().getContentGeneratorConfig()
            ?.model,
        ).toBe('profile-selected-model');
        expect(operation.readNamedParameter('context-limit')).toBe(4096);
        await operation.finishPostConfiguration();
        expect(
          activation.sessionClient.getAgentClient().getContentGeneratorConfig()
            ?.model,
        ).toBe('profile-selected-model');
      } finally {
        await activation.dispose();
      }
    });
  });

  for (const borrowed of [false, true]) {
    it(`preserves transferred activation and settings disposition (borrowed ${borrowed})`, async () => {
      await withPreflight(borrowed, async (operation, prepare, supplied) => {
        await prepare();
        operation.writeUserParameter('stream-idle-timeout-ms', 1234);
        expect(operation.readNamedParameter('stream-idle-timeout-ms')).toBe(
          1234,
        );
        const result = await operation.preflight({
          provider: 'openai',
          authMode: 'none',
        });
        expect(result.switchError).toBeUndefined();
        const activation = transfer(operation);
        try {
          expect(activation.settingsOwnerOwnership).toBe(
            borrowed ? 'borrowed' : 'transferred',
          );
          expect(activation.messageBus).toBe(
            activation.oauthManager?.runtimeMessageBus,
          );
          await operation.finishPostConfiguration();
          await operation.dispose();
          const continued = await activation.preflight({
            provider: 'openai',
            authMode: 'none',
          });
          expect(continued.authFailed).toBe(false);
        } finally {
          await activation.dispose();
        }
        supplied?.writeUserParameter('context-limit', 8192);
        expect(supplied?.readNamedParameter('context-limit')).toBe(
          borrowed ? 8192 : undefined,
        );
        expect(() => operation.captureSettings()).toThrow('disposed');
      });
    });

    it(`closes untransferred activation without closing borrowed settings (borrowed ${borrowed})`, async () => {
      await withPreflight(borrowed, async (operation, prepare, supplied) => {
        await prepare();
        await operation.finishPostConfiguration();
        const result = await operation.preflight({ authMode: 'none' });
        expect(result.authFailed).toBe(true);
        expect(result.authError).toMatchObject({
          message: 'Activation bootstrap is disposed',
        });
        supplied?.writeUserParameter('context-limit', 4096);
        expect(supplied?.readNamedParameter('context-limit')).toBe(
          borrowed ? 4096 : undefined,
        );
      });
    });
  }

  it('publishes infrastructure in startup order and rejects duplicate preparation', async () => {
    await withPreflight(
      false,
      async (operation, prepare, _supplied, stages) => {
        expect(() => operation.captureSwitchOperation()).toThrow(
          'not prepared',
        );
        await prepare();
        expect(stages).toStrictEqual(['policy', 'manager', 'oauth', 'files']);
        expect(typeof operation.captureSwitchOperation()).toBe('function');
        expect(operation.captureProfileOperation()).toBeDefined();
        await expect(prepare()).rejects.toThrow('already prepared');
        const result = await operation.preflight({ authMode: 'none' });
        expect(result.authFailed).toBe(false);
      },
    );
  });

  it('returns activation failure and retains cleanup ownership', async () => {
    await withPreflight(true, async (operation, prepare, supplied) => {
      await prepare();
      const result = await operation.preflight({
        provider: 'missing-post-config-provider',
        authMode: 'auto',
        providerSwitchPolicy: 'strict',
      });
      expect(result.authFailed).toBe(true);
      await operation.finishPostConfiguration();
      supplied?.writeUserParameter('context-limit', 2048);
      expect(supplied?.readNamedParameter('context-limit')).toBe(2048);
    });
  });

  it('closes failed preparation while preserving borrowed settings', async () => {
    await withPreflight(true, async (operation, prepare, supplied, stages) => {
      const failure = new Error('Host manager publication failed');
      await expect(
        prepare(() => {
          throw failure;
        }),
      ).rejects.toThrow(failure);
      expect(stages).toStrictEqual(['policy', 'manager']);
      expect(() => operation.captureSettings()).toThrow('disposed');
      supplied?.writeUserParameter('context-limit', 1024);
      expect(supplied?.readNamedParameter('context-limit')).toBe(1024);
    });
  });
});
