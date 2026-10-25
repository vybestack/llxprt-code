/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import {
  IdeClient,
  IDEConnectionStatus,
} from '@vybestack/llxprt-code-ide-integration';
import {
  setup,
  client,
  cleanup,
  deferred,
  installIdeCleanup,
} from './helpers/ide-lifecycle-companion.js';
import { createAgent, toConfigParameters } from '@vybestack/llxprt-code-agents';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { fromConfig } from '../fromConfig.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { WorkspaceIdeOwner } from '@vybestack/llxprt-code-core/services/workspace-ide-owner.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { assembleIdeControl } from '../control/ideControl.js';

async function domainFixture(initialize = true): Promise<{
  owner: WorkspaceIdeOwner;
  domain: ReturnType<typeof assembleIdeControl>;
  trust: WorkspaceTrustLifecycle;
  transport: IdeClient;
}> {
  const config = new Config({
    sessionId: 'ide-domain',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    model: 'offline',
    debugMode: false,
  });
  const trust = new WorkspaceTrustLifecycle({ localTrust: true });
  const transport = await client();
  const owner = new WorkspaceIdeOwner(
    config,
    trust,
    trust,
    async () => transport,
  );
  const domain = assembleIdeControl(trust, owner, () => ({}));
  cleanup.push(
    () => config.dispose(),
    () => trust.dispose(),
    () => owner.dispose(),
  );
  if (initialize) await owner.initialize();
  return { owner, domain, trust, transport };
}

function createSeededSettings(config: Config): SettingsService {
  const settingsService = new SettingsService();
  for (const [name, value] of Object.entries(config.getInitialSettings()))
    settingsService.set(name, value);
  return settingsService;
}

const diffOutcomes: Array<'accepted' | 'rejected'> = ['accepted', 'rejected'];

describe('Independent IDE transport lifetime', () => {
  installIdeCleanup();
  it('reads owner availability separately from connection status without using the public getter', async (): Promise<void> => {
    await setup();
    const { owner, domain } = await domainFixture(false);
    try {
      expect(domain.readConnection()).toStrictEqual({
        available: false,
        diffingEnabled: false,
      });
      expect(domain.readContext()).toBeUndefined();
      expect(domain.readWorkspaceTrust()).toBeUndefined();
      await owner.initialize();
      expect(domain.readConnection()).toMatchObject({
        available: true,
        status: IDEConnectionStatus.Disconnected,
        diffingEnabled: false,
      });
      const states: Array<string | undefined> = [];
      const unsubscribe = domain.subscribeConnection((connection) => {
        states.push(connection.status);
        expect(domain.readConnection()).toStrictEqual(connection);
      });
      await domain.setIdeClientConnected();
      const connected = domain.readConnection();
      expect(connected.status).toBe(IDEConnectionStatus.Connected);
      expect(connected.diffingEnabled).toBe(true);
      expect(connected.currentIde?.displayName).toBe(
        connected.detectedIdeDisplayName,
      );
      await domain.setIdeClientDisconnected();
      expect(states).toStrictEqual(['connecting', 'connected', 'disconnected']);
      expect(domain.readConnection().details).toContain('disabled');
      unsubscribe();
      unsubscribe();
      await domain.setIdeClientConnected();
      expect(states).toHaveLength(3);
    } finally {
      domain.closeAdmission();
    }
  });

  it('delivers file context through subscriptions installed before owner acquisition', async (): Promise<void> => {
    const host = await setup();
    const { owner, domain } = await domainFixture(false);
    const observed = deferred();
    const stop = domain.subscribeContext((context) => {
      if (context?.workspaceState?.openFiles?.length === 1) observed.resolve();
    });
    await owner.initialize();
    await domain.setIdeClientConnected();
    await host.updateContext(0, {
      workspaceState: {
        openFiles: [
          {
            path: '/workspace/edit.ts',
            timestamp: 42,
            isActive: true,
            selectedText: 'edit',
            cursor: { line: 3, character: 5 },
          },
        ],
      },
    });
    await observed.promise;
    expect(domain.readContext()?.workspaceState?.openFiles).toStrictEqual([
      {
        path: '/workspace/edit.ts',
        timestamp: 42,
        isActive: true,
        selectedText: 'edit',
        cursor: { line: 3, character: 5 },
      },
    ]);
    stop();
  });

  it('cancels and joins a held domain connection before owned transport retirement completes', async (): Promise<void> => {
    const host = await setup(true);
    const { owner, domain, transport } = await domainFixture();
    let finished = false;
    const connecting = domain.setIdeClientConnected().then(() => {
      finished = true;
    });
    await host.pingEntered.promise;
    await owner.dispose();
    expect(finished).toBe(true);
    await connecting;
    expect(transport.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Disconnected,
    );
    await host.sessions[0].streamClosed.promise;
    await expect(domain.setIdeClientConnected()).rejects.toThrow('disposed');
    expect(() => domain.subscribeContext(() => undefined)).toThrow('disposed');
  });

  it('keeps raw IDE trust unknown while effective folder trust falls back and releases context subscriptions', async (): Promise<void> => {
    const host = await setup();
    const { owner, domain } = await domainFixture();
    await domain.setIdeClientConnected();
    const contexts: Array<boolean | undefined> = [];
    const trusts: Array<boolean | undefined> = [];
    const observed = deferred();
    const rejected = deferred();
    const stopContext = domain.subscribeContext((context) => {
      contexts.push(context?.workspaceState?.isTrusted);
      expect(domain.readContext()).toStrictEqual(context);
      if (contexts.length === 1) rejected.resolve();
      if (contexts.length === 2) observed.resolve();
    });
    const stopTrust = domain.subscribeWorkspaceTrust((trusted) =>
      trusts.push(trusted),
    );
    await host.updateTrust(0, false);
    await rejected.promise;
    await host.updateTrust(0, undefined);
    await observed.promise;
    await domain.whenTrustTransitionSettled();
    expect(contexts).toStrictEqual([false, undefined]);
    expect(trusts).toStrictEqual([false, undefined]);
    expect(domain.readWorkspaceTrust()).toBeUndefined();
    expect(domain.isTrustedFolder()).toBe(true);
    stopContext();
    stopContext();
    stopTrust();
    await owner.dispose();
    expect(contexts).toHaveLength(2);
    expect(trusts).toHaveLength(2);
    expect(() => domain.readConnection()).toThrow('disposed');
  });

  it.each(diffOutcomes)(
    'awaits the owner diff command before reporting %s to its caller',
    async (outcome: 'accepted' | 'rejected'): Promise<void> => {
      const host = await setup(false, true);
      const { domain, transport } = await domainFixture();
      await domain.setIdeClientConnected();
      const opened = transport.openDiff('/domain-diff.txt', 'replacement');
      await host.diffOpened.promise;
      const order: string[] = [];
      const resolving = domain
        .resolveDiff('/domain-diff.txt', outcome)
        .then(() => {
          order.push('confirmed');
        });
      await host.closeDiffEntered.promise;
      expect(order).toStrictEqual([]);
      host.releaseCloseDiff.resolve();
      await resolving;
      const result = await opened;
      expect(result.status).toBe(outcome);
      expect(result.content).toBe(
        outcome === 'accepted' ? 'peer remains usable' : undefined,
      );
      expect(order).toStrictEqual(['confirmed']);
    },
  );

  it('cancels held domain diff work and joins connection work when its owner retires', async (): Promise<void> => {
    const host = await setup(false, true);
    const { owner, domain, transport } = await domainFixture();
    await domain.setIdeClientConnected();
    const opened = transport.openDiff('/held-domain.txt', 'replacement');
    await host.diffOpened.promise;
    const resolving = domain.resolveDiff('/held-domain.txt', 'accepted');
    await host.closeDiffEntered.promise;
    await owner.dispose();
    await resolving;
    expect(await opened).toStrictEqual({
      status: 'rejected',
      content: undefined,
    });
    await expect(domain.resolveDiff('/late.txt', 'accepted')).rejects.toThrow(
      'disposed',
    );
    await owner.dispose();
  });

  it.each([false, true])(
    'keeps public facade IDE transports independent on shared Config with reverse retirement %s',
    async (reverse: boolean): Promise<void> => {
      const host = await setup();
      const config = new Config(
        toConfigParameters({
          provider: '',
          model: '',
          workingDir: process.cwd(),
          sessionId: 'physical-shared-config',
          folderTrust: true,
          ide: { mode: true },
          mcpEnabled: false,
          skillsSupport: false,
          telemetry: { enabled: false },
          recording: { enabled: false },
        }),
      );
      cleanup.push(() => config.dispose());
      const authority = new CredentialAuthority();
      const first = await fromConfig(
        config,
        createSeededSettings(config),
        {},
        authority,
      );
      cleanup.push(() => first.dispose());
      const second = await fromConfig(
        config,
        createSeededSettings(config),
        {},
        authority,
      );
      cleanup.push(() => second.dispose());
      await first.ide.setIdeClientConnected();
      expect(second.ide.readConnection().status).toBe(
        IDEConnectionStatus.Disconnected,
      );
      await second.ide.setIdeClientConnected();
      expect(host.sessions).toHaveLength(2);
      expect(first.ide.readContext()?.workspaceState?.isTrusted).not.toBe(
        second.ide.readContext()?.workspaceState?.isTrusted,
      );
      expect(first.ide.isTrustedFolder()).toBe(host.sessions[0].trusted);
      expect(second.ide.isTrustedFolder()).toBe(host.sessions[1].trusted);
      const retiring = reverse ? second : first;
      const surviving = reverse ? first : second;
      await retiring.dispose();
      await host.sessions[reverse ? 1 : 0].streamClosed.promise;
      expect(surviving.ide.readConnection().status).toBe(
        IDEConnectionStatus.Connected,
      );
      await surviving.ide.resolveDiff('/public-peer.txt', 'accepted');
      expect(host.sessions[reverse ? 0 : 1].closedDiffs).toContain(
        '/public-peer.txt',
      );
      expect(surviving.ide.isTrustedFolder()).toBe(
        host.sessions[reverse ? 0 : 1].trusted,
      );
    },
  );

  it.each([false, true])(
    'keeps explicitly borrowed IDE and trust usable after both public facade retirement orders %s',
    async (reverse: boolean): Promise<void> => {
      const host = await setup();
      const config = new Config(
        toConfigParameters({
          provider: '',
          model: '',
          workingDir: process.cwd(),
          folderTrust: false,
          mcpEnabled: false,
          skillsSupport: false,
          telemetry: { enabled: false },
          recording: { enabled: false },
        }),
      );
      const trust = new WorkspaceTrustLifecycle({ localTrust: false });
      const lease = await client();
      await lease.connect();
      const ide = new WorkspaceIdeOwner(
        config,
        trust,
        trust,
        async () => lease,
        true,
      );
      await ide.initialize();
      cleanup.push(
        () => config.dispose(),
        () => trust.dispose(),
        () => ide.dispose(),
      );
      const agentConfig = {
        provider: '',
        model: '',
        workingDir: process.cwd(),
        folderTrust: false,
        mcpEnabled: false,
        skillsSupport: false,
        telemetry: { enabled: false },
        recording: { enabled: false },
        trustPort: trust,
        idePort: ide,
      };
      const first = await createAgent(agentConfig);
      const second = await createAgent(agentConfig);
      cleanup.push(
        () => first.dispose(),
        () => second.dispose(),
      );
      const firstEvents: Array<boolean | undefined> = [];
      const secondEvents: Array<boolean | undefined> = [];
      const firstContexts: Array<boolean | undefined> = [];
      const secondContexts: Array<boolean | undefined> = [];
      const firstConnections: Array<string | undefined> = [];
      const secondConnections: Array<string | undefined> = [];
      first.ide.subscribeWorkspaceTrust((value) => firstEvents.push(value));
      second.ide.subscribeWorkspaceTrust((value) => secondEvents.push(value));
      first.ide.subscribeContext((value) =>
        firstContexts.push(value?.workspaceState?.isTrusted),
      );
      second.ide.subscribeContext((value) =>
        secondContexts.push(value?.workspaceState?.isTrusted),
      );
      first.ide.subscribeConnection((value) =>
        firstConnections.push(value.status),
      );
      second.ide.subscribeConnection((value) =>
        secondConnections.push(value.status),
      );
      await (reverse ? second : first).dispose();
      expect(await lease.closeDiff('/borrowed-peer.txt')).toContain('usable');
      const observed = deferred();
      const surviving = reverse ? first : second;
      const stop = surviving.ide.subscribeContext(() => observed.resolve());
      await host.updateTrust(0, false);
      await observed.promise;
      stop();
      expect(reverse ? firstEvents : secondEvents).toStrictEqual([false]);
      expect(reverse ? secondEvents : firstEvents).toStrictEqual([]);
      expect(reverse ? firstContexts : secondContexts).toStrictEqual([false]);
      expect(reverse ? secondContexts : firstContexts).toStrictEqual([]);
      await surviving.ide.setIdeClientDisconnected();
      await surviving.ide.setIdeClientConnected();
      expect(reverse ? firstConnections : secondConnections).toStrictEqual([
        'disconnected',
        'connecting',
        'connected',
      ]);
      expect(reverse ? secondConnections : firstConnections).toStrictEqual([]);
      await (reverse ? first : second).dispose();
      expect(lease.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Connected,
      );
      await trust.setIdeTrustLive(undefined);
      await trust.setTrustedFolderLive(true);
      expect(trust.isTrustedFolder()).toBe(true);
      await ide.dispose();
      await host.sessions[0].streamClosed.promise;
      expect(lease.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Disconnected,
      );
    },
  );

  it('joins physical acquired IDE cleanup when public adoption fails after workspace initialization', async (): Promise<void> => {
    const host = await setup();
    const lease = await client();
    await lease.connect();
    const acquire = vi
      .spyOn(IdeClient, 'create')
      .mockImplementationOnce(async () => lease);
    const failure = new Error('public adoption interrupted');
    try {
      await expect(
        createAgent({
          provider: '',
          model: '',
          workingDir: process.cwd(),
          mcpEnabled: false,
          skillsSupport: false,
          telemetry: { enabled: false },
          recording: { enabled: false },
          tokenizerFactory: {
            prepareTokenizer: () => {
              throw failure;
            },
            getTokenizer: () => undefined,
            estimatePrompt: () => {
              throw failure;
            },
          },
        }),
      ).rejects.toThrow('public adoption interrupted');
      await host.sessions[0].streamClosed.promise;
      expect(lease.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Disconnected,
      );
    } finally {
      acquire.mockRestore();
    }
  });

  it('publishes unknown IDE trust so the owning workspace can restore its local fallback', async (): Promise<void> => {
    const host = await setup();
    const instance = await client();
    await instance.connect();
    const observed = deferred();
    instance.addTrustChangeListener((trusted) => {
      if (trusted === undefined) observed.resolve();
    });
    await host.updateTrust(0, undefined);
    await observed.promise;
    expect(instance.getWorkspaceTrust()).toBeUndefined();
    expect(instance.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );
  });

  it('rejects disconnected diff admission rather than creating an unresolved waiter', async (): Promise<void> => {
    await setup();
    const instance = await client();
    await expect(
      instance.openDiff('/not-connected.txt', 'replacement'),
    ).rejects.toThrow('connected');
  });

  it.each([false, true])(
    'keeps peer trust and physical transport usable with reverse retirement %s',
    async (reverse: boolean): Promise<void> => {
      const host = await setup();
      const first = await client();
      const second = await client();
      expect(first).not.toBe(second);
      await first.connect();
      await second.connect();
      expect(first.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Connected,
      );
      expect(second.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Connected,
      );
      expect(first.getWorkspaceTrust()).not.toBe(second.getWorkspaceTrust());
      const declaration = new Config({
        sessionId: 'shared-label',
        targetDir: process.cwd(),
        cwd: process.cwd(),
        model: 'offline',
        debugMode: false,
      });
      const firstTrust = new WorkspaceTrustLifecycle({ localTrust: false });
      const secondTrust = new WorkspaceTrustLifecycle({ localTrust: false });
      const firstRoot = new WorkspaceIdeOwner(
        declaration,
        firstTrust,
        firstTrust,
        async (): Promise<IdeClient> => first,
      );
      const secondRoot = new WorkspaceIdeOwner(
        declaration,
        secondTrust,
        secondTrust,
        async (): Promise<IdeClient> => second,
      );
      cleanup.push(
        () => declaration.dispose(),
        () => firstTrust.dispose(),
        () => secondTrust.dispose(),
        () => secondRoot.dispose(),
        () => firstRoot.dispose(),
      );
      await Promise.all([firstRoot.initialize(), secondRoot.initialize()]);
      expect(firstTrust.isTrustedFolder()).not.toBe(
        secondTrust.isTrustedFolder(),
      );
      const retiring = reverse ? secondRoot : firstRoot;
      const retiredClient = reverse ? second : first;
      const survivingClient = reverse ? first : second;
      const borrowedTrust = reverse ? secondTrust : firstTrust;
      await retiring.dispose();
      await host.sessions[reverse ? 1 : 0].streamClosed.promise;
      expect(retiredClient.getWorkspaceTrust()).toBeUndefined();
      expect(survivingClient.getWorkspaceTrust()).toBe(
        host.sessions[reverse ? 0 : 1].trusted,
      );
      expect(await survivingClient.closeDiff('/peer.txt')).toContain('usable');
      await borrowedTrust.setIdeTrustLive(undefined);
      expect(borrowedTrust.isTrustedFolder()).toBe(false);
      await borrowedTrust.setTrustedFolderLive(true);
      expect(borrowedTrust.isTrustedFolder()).toBe(true);
    },
  );

  it('physically retires the owned transport despite failures releasing every trust listener', async (): Promise<void> => {
    const host = await setup();
    const trust = new WorkspaceTrustLifecycle({ localTrust: true });
    const subscribe = trust.subscribeTrustChange.bind(trust);
    const failure = new Error('Listener release failed');
    const release = vi
      .spyOn(trust, 'subscribeTrustChange')
      .mockImplementation((listener) => {
        const unsubscribe = subscribe(listener);
        return () => {
          unsubscribe();
          throw failure;
        };
      });
    cleanup.push(() => trust.dispose());
    const agent = await createAgent({
      provider: '',
      model: '',
      workingDir: process.cwd(),
      ide: { mode: true },
      mcpEnabled: false,
      skillsSupport: false,
      telemetry: { enabled: false },
      recording: { enabled: false },
      trustPort: trust,
    });
    cleanup.push(async () => {
      await agent.dispose().catch(() => undefined);
    });
    await agent.ide.setIdeClientConnected();
    expect(agent.ide.readConnection().status).toBe(
      IDEConnectionStatus.Connected,
    );
    try {
      await expect(agent.dispose()).rejects.toBeInstanceOf(Error);
      await host.sessions[0].streamClosed.promise;
      expect(host.sessions[0].closed).toBe(true);
      expect(() => agent.memory.getMemory()).toThrow('disposed');
      await trust.setIdeTrustLive(undefined);
      await trust.setTrustedFolderLive(false);
      expect(trust.isTrustedFolder()).toBe(false);
    } finally {
      release.mockRestore();
    }
  });

  it('cancels the owned connection before joining initialization blocked on trust settlement', async (): Promise<void> => {
    const host = await setup();
    const instance = await client();
    await instance.connect();
    const declaration = new Config({
      sessionId: 'blocked-trust',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      model: 'offline',
      debugMode: false,
    });
    const trust = new WorkspaceTrustLifecycle({ localTrust: false });
    const entered = deferred();
    const cancelled = deferred();
    instance.addStatusChangeListener((state) => {
      if (state.status === IDEConnectionStatus.Disconnected)
        cancelled.resolve();
    });
    const unsubscribe = trust.subscribeTrustTransition(
      async (): Promise<void> => {
        entered.resolve();
        await cancelled.promise;
      },
    );
    const owner = new WorkspaceIdeOwner(
      declaration,
      trust,
      trust,
      async (): Promise<IdeClient> => instance,
    );
    cleanup.push(
      () => declaration.dispose(),
      () => trust.dispose(),
      () => owner.dispose(),
      async (): Promise<void> => {
        cancelled.resolve();
      },
    );
    const initializing = owner.initialize().then(
      () => undefined,
      (error: unknown) => error,
    );
    await entered.promise;
    await owner.dispose();
    await host.sessions[0].streamClosed.promise;
    expect(await initializing).toBeInstanceOf(Error);
    expect(instance.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Disconnected,
    );
    unsubscribe();
    await trust.setIdeTrustLive(undefined);
    await trust.setTrustedFolderLive(false);
    expect(trust.isTrustedFolder()).toBe(false);
  });

  it('cancels a pending ping and joins connect before retirement completes', async (): Promise<void> => {
    const host = await setup(true);
    const instance = await client();
    let connectFinished = false;
    const connecting = instance.connect().then(() => {
      connectFinished = true;
    });
    await host.pingEntered.promise;
    await instance.disconnect();
    expect(connectFinished).toBe(true);
    await connecting;
    await host.sessions[0].streamClosed.promise;
    expect(instance.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Disconnected,
    );
  });

  it('cancels diff settlement without waiting for an unresponsive closeDiff reply', async (): Promise<void> => {
    const host = await setup(false, true);
    const instance = await client();
    await instance.connect();
    const diff = instance.openDiff('/pending.txt', 'replacement');
    await host.diffOpened.promise;
    await instance.disconnect();
    expect((await diff).status).toBe('rejected');
    await host.sessions[0].streamClosed.promise;
    expect(instance.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Disconnected,
    );
  });
});
