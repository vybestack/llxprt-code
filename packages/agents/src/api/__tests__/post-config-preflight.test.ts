import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';
import { createRecordingProvider } from './helpers/recording-provider.js';
import { AgentClient } from '../../core/client.js';
import { gate } from './helpers/async-child-disposal-join-fixture.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { spyOn } from 'bun:test';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
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
import {
  AgentActivationBootstrap,
  type AgentActivationOperation,
} from '../activationPreflightState.js';

function transfer(operation: AgentProfilePreflight): AgentActivationBootstrap {
  let activation: AgentActivationOperation | undefined;
  operation.transferActivation((selected) => {
    activation = selected;
  });
  if (!(activation instanceof AgentActivationBootstrap))
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
    contributions?: ProviderContributionRegistry,
  ): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), 'post-config-preflight-'));
    const settings = new SettingsService();
    const supplied = borrowed ? new SessionSettingsOwner(settings) : undefined;
    const operation = await prepareAgentPreflight(
      { runtimeId: 'post-config-preflight' },
      credentials().authority,
      settings,
      undefined,
      contributions,
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
    it(`joins accepted foreground acquisition before activation disposal completes (borrowed ${borrowed})`, async () => {
      await withPreflight(borrowed, async (operation, prepare, supplied) => {
        await prepare();
        const intent = { provider: 'openai', authMode: 'none' } as const;
        const result = await operation.preflight(intent);
        if (result.token === undefined)
          throw new Error('Missing activation receipt');
        const activation = transfer(operation);
        const entered = gate();
        const released = gate();
        const getHistory = AgentClient.prototype.getHistory;
        const held = spyOn(
          AgentClient.prototype,
          'getHistory',
        ).mockImplementation(async function (this: AgentClient) {
          const history = await getHistory.call(this);
          entered.release();
          await released.promise;
          return history;
        });
        const heldRead = activation.readHistory();
        void heldRead.catch(() => undefined);
        await entered.promise;
        held.mockRestore();
        const publication = AgentProfilePreflight.createForegroundAgent(
          operation,
          result.token,
          intent,
          {},
        );
        void publication.catch(() => undefined);
        let closed = false;
        const closing = Promise.resolve(activation.dispose()).then(() => {
          closed = true;
        });
        void closing.catch(() => undefined);
        try {
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(closed).toBe(false);
          released.release();
          await expect(publication).rejects.toMatchObject({
            name: 'AbortError',
          });
          await closing;
          supplied?.writeUserParameter('context-limit', 16384);
          expect(supplied?.readNamedParameter('context-limit')).toBe(
            borrowed ? 16384 : undefined,
          );
          await expect(activation.readHistory()).rejects.toThrow('disposed');
        } finally {
          released.release();
          held.mockRestore();
          await Promise.allSettled([heldRead, publication, closing]);
        }
      });
    });
  }

  it('denies foreground construction synchronously once its owning admission closes', async () => {
    await withPreflight(false, async (operation, prepare) => {
      await prepare();
      const intent = { provider: 'openai', authMode: 'none' } as const;
      const result = await operation.preflight(intent);
      if (result.token === undefined)
        throw new Error('Missing activation receipt');
      const activation = transfer(operation);
      activation.closeForegroundAdmission();
      let synchronousFailure: unknown;
      const create = AgentActivationBootstrap.prototype.createForeground;
      const observation = spyOn(
        AgentActivationBootstrap.prototype,
        'createForeground',
      ).mockImplementation(function (this: AgentActivationBootstrap, ...args) {
        try {
          return create.call(this, ...args);
        } catch (error) {
          synchronousFailure = error;
          throw error;
        }
      });
      try {
        await expect(
          AgentProfilePreflight.createForegroundAgent(
            operation,
            result.token,
            intent,
            {},
          ),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(synchronousFailure).toMatchObject({ name: 'AbortError' });
        expect(await activation.readHistory()).toStrictEqual([]);
      } finally {
        observation.mockRestore();
      }
    });
  });

  it('publishes the acquired session without distributing individual owners', async () => {
    await withPreflight(false, async (operation, prepare) => {
      await prepare();
      const intent = { provider: 'openai', authMode: 'none' } as const;
      const result = await operation.preflight(intent);
      if (result.token === undefined)
        throw new Error('Missing activation receipt');
      const activation = transfer(operation);
      const history = await activation.readHistory();
      const agent = await AgentProfilePreflight.createForegroundAgent(
        operation,
        result.token,
        intent,
        {},
      );
      try {
        expect(await agent.getHistory()).toStrictEqual(history);
        expect(agent.listTools().length).toBeGreaterThan(0);
        await expect(activation.readHistory()).rejects.toThrow('disposed');
      } finally {
        await agent.dispose();
      }
    });
  });

  it('joins an accepted history snapshot before transferring the foreground session', async () => {
    await withPreflight(false, async (operation, prepare) => {
      await prepare();
      const intent = { provider: 'openai', authMode: 'none' } as const;
      const result = await operation.preflight(intent);
      if (result.token === undefined)
        throw new Error('Missing activation receipt');
      const activation = transfer(operation);
      const entered = gate();
      const released = gate();
      const getHistory = AgentClient.prototype.getHistory;
      const observation = spyOn(
        AgentClient.prototype,
        'getHistory',
      ).mockImplementation(async function (this: AgentClient) {
        const history = await getHistory.call(this);
        entered.release();
        await released.promise;
        return history;
      });
      const history = activation.readHistory();
      await entered.promise;
      observation.mockRestore();
      let transferred = false;
      const pending = AgentProfilePreflight.createForegroundAgent(
        operation,
        result.token,
        intent,
        {},
      ).then((agent) => {
        transferred = true;
        return agent;
      });
      void pending.catch(() => undefined);
      const lateRead = activation.readHistory();
      void lateRead.catch(() => undefined);
      try {
        expect(transferred).toBe(false);
        released.release();
        await expect(lateRead).rejects.toThrow('disposed');
        const agent = await pending;
        try {
          expect(await agent.getHistory()).toStrictEqual(await history);
          expect(agent.listTools().length).toBeGreaterThan(0);
        } finally {
          await agent.dispose();
        }
      } finally {
        observation.mockRestore();
        released.release();
        await history;
        const agent = await pending;
        await agent.dispose();
      }
    });
  });

  async function holdFailingHistoryRead(
    activation: AgentActivationBootstrap,
    failure: Error,
  ) {
    const entered = gate();
    const released = gate();
    const observation = spyOn(
      AgentClient.prototype,
      'getHistory',
    ).mockImplementation(async () => {
      entered.release();
      await released.promise;
      throw failure;
    });
    const history = activation.readHistory();
    const seen = history.then(
      () => undefined,
      (error: unknown) => error,
    );
    await entered.promise;
    observation.mockRestore();
    return { seen, release: released.release };
  }

  it('waits for a public read that rejects for its caller before transferring the foreground session', async () => {
    await withPreflight(false, async (operation, prepare) => {
      await prepare();
      const intent = { provider: 'openai', authMode: 'none' } as const;
      const result = await operation.preflight(intent);
      if (result.token === undefined)
        throw new Error('Missing activation receipt');
      const activation = transfer(operation);
      const failure = new Error('history read failed for its caller');
      const held = await holdFailingHistoryRead(activation, failure);
      const pending = AgentProfilePreflight.createForegroundAgent(
        operation,
        result.token,
        intent,
        {},
      );
      const outcome = pending.then(
        (agent) => ({ agent }),
        (error: unknown) => ({ error }),
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      held.release();
      expect(await held.seen).toBe(failure);
      const published = await outcome;
      if ('error' in published) throw published.error;
      await published.agent.dispose();
    });
  });

  it('disposes after a public read that rejected for its caller without reporting that rejection', async () => {
    await withPreflight(false, async (operation, prepare) => {
      await prepare();
      const activation = transfer(operation);
      const failure = new Error('history read failed for its caller');
      const held = await holdFailingHistoryRead(activation, failure);
      let closed = false;
      const closing = Promise.resolve(activation.dispose()).then(() => {
        closed = true;
      });
      void closing.catch(() => undefined);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      held.release();
      expect(await held.seen).toBe(failure);
      await closing;
      expect(closed).toBe(true);
    });
  });

  it('keeps preflight history with the adopted session and closes captured reads on retirement', async () => {
    await withPreflight(false, async (operation, prepare) => {
      await prepare();
      const intent = { provider: 'openai', authMode: 'none' } as const;
      const result = await operation.preflight(intent);
      if (result.token === undefined)
        throw new Error('Missing activation receipt');
      const activation = transfer(operation);
      const history = await activation.readHistory();
      const agent = await AgentProfilePreflight.createForegroundAgent(
        operation,
        result.token,
        intent,
        {},
      );
      try {
        expect(await agent.getHistory()).toStrictEqual(history);
        expect(agent.listTools().length).toBeGreaterThan(0);
        await expect(activation.readHistory()).rejects.toThrow('disposed');
      } finally {
        await agent.dispose();
      }
    });
  });

  for (const borrowed of [false, true]) {
    it(`constructs the foreground Agent privately from its accepted activation (borrowed ${borrowed})`, async () => {
      await withPreflight(borrowed, async (operation, prepare, supplied) => {
        await prepare();
        const intent = { provider: 'openai', authMode: 'none' } as const;
        const result = await operation.preflight(intent);
        if (result.token === undefined)
          throw new Error('Missing activation receipt');
        const activation = transfer(operation);
        const history = await activation.readHistory();
        const agent = await AgentProfilePreflight.createForegroundAgent(
          operation,
          result.token,
          intent,
          {},
        );
        try {
          expect((await agent.getHistory()).length - history.length).toBe(0);
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
    const recording = createRecordingProvider({ alias: 'profile-recording' });
    await withPreflight(
      false,
      async (operation, prepare) => {
        await prepare();
        await operation.captureProfileOperation().applySnapshot({
          version: 1,
          provider: recording.alias,
          model: 'profile-selected-model',
          modelParams: { temperature: 0.37 },
          ephemeralSettings: { 'context-limit': 4096 },
        });
        const intent = { provider: recording.alias, authMode: 'none' } as const;
        const result = await operation.preflight(intent);
        if (result.token === undefined)
          throw new Error('Missing activation receipt');
        const activation = transfer(operation);
        try {
          expect(operation.readNamedParameter('context-limit')).toBe(4096);
          operation.writeUserParameter('context-limit', 1_000_000);
          await operation.finishPostConfiguration();
          const agent = await AgentProfilePreflight.createForegroundAgent(
            operation,
            result.token,
            intent,
            {},
          );
          try {
            await agent.chat('hello');
            expect(recording.requests[0].resolved.model).toBe(
              'profile-selected-model',
            );
          } finally {
            await agent.dispose();
          }
        } finally {
          await activation.dispose();
        }
      },
      recording.contributions,
    );
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
        expect(stages).toStrictEqual(['policy', 'manager']);
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
