/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  PingRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  IdeClient,
  IDEConnectionStatus,
} from '@vybestack/llxprt-code-ide-integration';
import {
  fromConfig,
  toConfigParameters,
  McpRuntimeOwner,
} from '@vybestack/llxprt-code-agents';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  MCPOAuthTokenStorage,
  KeychainTokenStorage,
} from '@vybestack/llxprt-code-mcp';
import { openBrowserSecurely } from '@vybestack/llxprt-code-core';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { WorkspaceIdeOwner } from '@vybestack/llxprt-code-core/services/workspace-ide-owner.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

function createSessionSettingsFixture(config: Config): {
  settingsService: SettingsService;
  settingsOwner: SessionSettingsOwner;
} {
  const settingsService = new SettingsService();
  for (const [name, value] of Object.entries(config.getInitialSettings()))
    settingsService.set(name, value);
  const settingsOwner = new SessionSettingsOwner(settingsService);
  settingsOwner.initializeProviderSelection(
    config.getProvider(),
    config.getModel(),
  );
  cleanup.push(async () => {
    await settingsOwner.dispose();
  });
  return { settingsService, settingsOwner };
}

function createWorkspace(
  config: Config,
  trust: WorkspaceTrustLifecycle,
): Promise<McpRuntimeOwner> {
  return McpRuntimeOwner.create(
    {
      tokenStorage: new MCPOAuthTokenStorage(
        new KeychainTokenStorage('llxprt-cli-mcp-oauth'),
      ),
      openBrowser: openBrowserSecurely,
    },
    config,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'caller',
    undefined,
    'runtime',
    undefined,
    'runtime',
    undefined,
    undefined,
    'runtime',
    trust,
  );
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

interface Session {
  readonly transport: StreamableHTTPServerTransport;
  readonly server: Server;
  readonly trusted: boolean;
  readonly streamClosed: ReturnType<typeof deferred>;
}

async function companion(
  blockPing = false,
  blockCloseDiff = false,
): Promise<{
  port: number;
  sessions: Session[];
  pingEntered: ReturnType<typeof deferred>;
  releasePing: ReturnType<typeof deferred>;
  diffOpened: ReturnType<typeof deferred>;
  closeDiffEntered: ReturnType<typeof deferred>;
  releaseCloseDiff: ReturnType<typeof deferred>;
  updateTrust(index: number, trusted: boolean | undefined): Promise<void>;
  close(): Promise<void>;
}> {
  const sessions: Session[] = [];
  const byId = new Map<string, Session>();
  const pingEntered = deferred();
  const releasePing = deferred();
  const diffOpened = deferred();
  const closeDiffEntered = deferred();
  const releaseCloseDiff = deferred();
  const responses = new Set<ServerResponse>();
  const http = createServer((request, response) => {
    responses.add(response);
    response.once('close', () => responses.delete(response));
    const id = request.headers['mcp-session-id'];
    let session = typeof id === 'string' ? byId.get(id) : undefined;
    if (session === undefined && request.method === 'POST') {
      const server = new Server(
        { name: 'independent-ide-companion', version: '1.0.0' },
        { capabilities: { tools: {} } },
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (sessionId) => {
          byId.set(sessionId, owned);
        },
      });
      const owned: Session = {
        transport,
        server,
        trusted: sessions.length % 2 === 0,
        streamClosed: deferred(),
      };
      sessions.push(owned);
      session = owned;
      server.setRequestHandler(PingRequestSchema, async (_request, extra) => {
        pingEntered.resolve();
        if (blockPing) await releasePing.promise;
        await transport.send(
          {
            jsonrpc: '2.0',
            method: 'ide/contextUpdate',
            params: { workspaceState: { isTrusted: owned.trusted } },
          },
          { relatedRequestId: extra.requestId },
        );
        return {};
      });
      server.setRequestHandler(CallToolRequestSchema, async (call) => {
        if (call.params.name === 'openDiff') diffOpened.resolve();
        if (call.params.name === 'closeDiff') {
          closeDiffEntered.resolve();
          if (blockCloseDiff) await releaseCloseDiff.promise;
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ content: 'peer remains usable' }),
            },
          ],
        };
      });
      void server
        .connect(transport)
        .then(() => transport.handleRequest(request, response))
        .catch((error: unknown) =>
          response.destroy(
            error instanceof Error ? error : new Error(String(error)),
          ),
        );
      return;
    }
    if (session === undefined) {
      response.writeHead(404).end();
      return;
    }
    if (request.method === 'GET')
      request.socket.once('close', session.streamClosed.resolve);
    const active = session;
    void active.transport
      .handleRequest(request, response)
      .catch((error: unknown) =>
        response.destroy(
          error instanceof Error ? error : new Error(String(error)),
        ),
      );
    if (request.method === 'GET')
      setImmediate(() => {
        void active.transport
          .send({
            jsonrpc: '2.0',
            method: 'ide/contextUpdate',
            params: { workspaceState: { isTrusted: active.trusted } },
          })
          .catch((error: unknown) =>
            response.destroy(
              error instanceof Error ? error : new Error(String(error)),
            ),
          );
      });
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', resolve);
  });
  const address = http.address();
  if (address === null || typeof address === 'string')
    throw new Error('Companion did not bind a TCP port');
  return {
    port: address.port,
    sessions,
    pingEntered,
    releasePing,
    diffOpened,
    closeDiffEntered,
    releaseCloseDiff,
    updateTrust: (index, trusted): Promise<void> =>
      sessions[index].transport.send({
        jsonrpc: '2.0',
        method: 'ide/contextUpdate',
        params: { workspaceState: { isTrusted: trusted } },
      }),
    close: async (): Promise<void> => {
      releasePing.resolve();
      releaseCloseDiff.resolve();
      await Promise.all(sessions.map((session) => session.server.close()));
      for (const response of responses) response.destroy();
      const stopped = new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
      http.closeAllConnections();
      await stopped;
    },
  };
}

const environment = new Map<string, string | undefined>();
const cleanup: Array<() => Promise<void>> = [];
function setEnvironment(name: string, value: string): void {
  if (!environment.has(name)) environment.set(name, process.env[name]);
  process.env[name] = value;
}
async function setup(
  blockPing = false,
  blockCloseDiff = false,
): Promise<Awaited<ReturnType<typeof companion>>> {
  const host = await companion(blockPing, blockCloseDiff);
  cleanup.push(host.close);
  setEnvironment('TERM_PROGRAM', 'vscode');
  setEnvironment('LLXPRT_CODE_IDE_SERVER_PORT', String(host.port));
  setEnvironment('LLXPRT_CODE_IDE_WORKSPACE_PATH', process.cwd());
  return host;
}
async function client(): Promise<IdeClient> {
  const instance = await IdeClient.create();
  cleanup.push(() => instance.disconnect());
  return instance;
}
describe('Independent IDE transport lifetime', () => {
  afterEach(async (): Promise<void> => {
    for (const dispose of cleanup.reverse()) await dispose();
    cleanup.length = 0;
    for (const [name, value] of environment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    environment.clear();
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
      const first = await fromConfig({
        config,
        ...createSessionSettingsFixture(config),
      });
      cleanup.push(() => first.dispose());
      const second = await fromConfig({
        config,
        ...createSessionSettingsFixture(config),
      });
      cleanup.push(() => second.dispose());
      await first.ide.setIdeClientConnected();
      await second.ide.setIdeClientConnected();
      expect(first.ide.getIdeClient()).not.toBe(second.ide.getIdeClient());
      expect(
        first.ide.getIdeClient()?.getIdeContext()?.workspaceState?.isTrusted,
      ).not.toBe(
        second.ide.getIdeClient()?.getIdeContext()?.workspaceState?.isTrusted,
      );
      expect(first.ide.isTrustedFolder()).toBe(host.sessions[0].trusted);
      expect(second.ide.isTrustedFolder()).toBe(host.sessions[1].trusted);
      const retiring = reverse ? second : first;
      const surviving = reverse ? first : second;
      await retiring.dispose();
      await host.sessions[reverse ? 1 : 0].streamClosed.promise;
      const peer = surviving.ide.getIdeClient();
      if (peer === undefined)
        throw new Error('Surviving Agent lost its IDE client');
      expect(peer.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Connected,
      );
      expect(await peer.closeDiff('/public-peer.txt')).toContain('usable');
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
      const first = await fromConfig({
        config,
        ...createSessionSettingsFixture(config),
        trustPort: trust,
        idePort: ide,
      });
      const second = await fromConfig({
        config,
        ...createSessionSettingsFixture(config),
        trustPort: trust,
        idePort: ide,
      });
      cleanup.push(
        () => first.dispose(),
        () => second.dispose(),
      );
      await (reverse ? second : first).dispose();
      expect(await lease.closeDiff('/borrowed-peer.txt')).toContain('usable');
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
    const config = new Config(
      toConfigParameters({
        provider: '',
        model: '',
        workingDir: process.cwd(),
        mcpEnabled: false,
        skillsSupport: false,
        telemetry: { enabled: false },
        recording: { enabled: false },
      }),
    );
    cleanup.push(() => config.dispose());
    const acquire = vi
      .spyOn(IdeClient, 'create')
      .mockImplementationOnce(async () => lease);
    const failure = new Error('public adoption interrupted');
    try {
      await expect(
        fromConfig({
          config,
          ...createSessionSettingsFixture(config),
          prepareSessionTools: () => {
            throw failure;
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
    const config = new Config(
      toConfigParameters({
        provider: '',
        model: '',
        workingDir: process.cwd(),
        ide: { mode: true },
        mcpEnabled: false,
        skillsSupport: false,
        telemetry: { enabled: false },
        recording: { enabled: false },
      }),
    );
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
    cleanup.push(
      () => config.dispose(),
      () => trust.dispose(),
    );
    const workspace = await createWorkspace(config, trust);
    const agent = await fromConfig({
      mcpRuntime: workspace,
      mcpOwnership: 'agent',
      config,
      ...createSessionSettingsFixture(config),
      trustPort: trust,
    });
    cleanup.push(async () => {
      await agent.dispose().catch(() => undefined);
    });
    await agent.ide.setIdeClientConnected();
    const instance = agent.ide.getIdeClient();
    if (instance === undefined)
      throw new Error('Owned IDE client was not initialized');
    try {
      await expect(agent.dispose()).rejects.toBeInstanceOf(Error);
      expect(instance.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Disconnected,
      );
      await host.sessions[0].streamClosed.promise;
      expect(() => workspace.workspaceMemory.operations.snapshot()).toThrow(
        'disposed',
      );
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
