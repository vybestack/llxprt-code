/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  IdeClient,
  IDEConnectionStatus,
  ideContext,
  type IdeContext,
} from '@vybestack/llxprt-code-ide-integration';
import { DiffContentProvider, DiffManager } from './diff-manager.js';
import { IDEServer } from './ide-server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { IdeContextNotificationSchema } from './ide-schemas.js';
import * as path from 'node:path';
import * as http from 'node:http';
import { fileURLToPath } from 'node:url';

const companionFile = fileURLToPath(import.meta.url);
// companionFile: packages/vscode-ide-companion/src/<this file>
const srcDir = path.dirname(companionFile);
const companionDir = path.dirname(srcDir);
const packagesDir = path.dirname(companionDir);
const repositoryRoot = path.dirname(packagesDir);
const readmePath = path.join(repositoryRoot, 'README.md');

vi.mock('vscode', () => {
  class TestEventEmitter<T> {
    private readonly listeners = new Set<(event: T) => unknown>();

    readonly event = (listener: (event: T) => unknown) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };

    fire(event: T): void {
      for (const listener of this.listeners) {
        listener(event);
      }
    }

    dispose(): void {
      this.listeners.clear();
    }
  }

  const createUri = (scheme: string, filePath: string, query = '') => ({
    scheme,
    fsPath: filePath,
    path: filePath,
    query,
    toString: () => `${scheme}:${filePath}${query === '' ? '' : `?${query}`}`,
  });
  const disposable = () => ({ dispose: () => undefined });

  return {
    EventEmitter: TestEventEmitter,
    Uri: {
      file: (filePath: string) => createUri('file', filePath),
      from: ({
        scheme,
        path: filePath,
        query,
      }: {
        scheme: string;
        path: string;
        query?: string;
      }) => createUri(scheme, filePath, query),
      parse: (value: string) => createUri('file', value),
    },
    window: {
      activeTextEditor: undefined,
      onDidChangeActiveTextEditor: disposable,
      onDidChangeTextEditorSelection: disposable,
      tabGroups: { all: [], close: () => Promise.resolve(true) },
    },
    workspace: {
      fs: { stat: () => Promise.resolve({}) },
      isTrusted: true,
      workspaceFolders: undefined,
      onDidCloseTextDocument: disposable,
      onDidDeleteFiles: disposable,
      onDidGrantWorkspaceTrust: disposable,
      onDidRenameFiles: disposable,
      openTextDocument: () => Promise.resolve({ getText: () => '' }),
    },
    commands: {
      executeCommand: () => Promise.resolve(undefined),
    },
  };
});

const IDE_ENVIRONMENT_VARIABLES = [
  'LLXPRT_CODE_IDE_SERVER_PORT',
  'LLXPRT_CODE_IDE_WORKSPACE_PATH',
  'LLXPRT_CODE_IDE_AUTH_TOKEN',
] as const;

function seedActiveEditor(): void {
  const selection = {
    active: { line: 0, character: 11 },
    anchor: { line: 0, character: 0 },
  };
  Object.defineProperty(vscode.window, 'activeTextEditor', {
    configurable: true,
    value: {
      document: {
        uri: vscode.Uri.file(readmePath),
        getText: () => 'LLxprt Code',
      },
      selection,
      selections: [selection],
    },
  });
  Object.defineProperty(vscode.workspace, 'workspaceFolders', {
    configurable: true,
    value: [{ uri: vscode.Uri.file(repositoryRoot) }],
  });
}

function createExtensionContext(): vscode.ExtensionContext {
  const environmentVariables = new Set<string>();
  return {
    subscriptions: [],
    environmentVariableCollection: {
      replace: (variable: string, value: string) => {
        environmentVariables.add(variable);
        vi.stubEnv(variable, value);
      },
      clear: () => {
        for (const variable of environmentVariables) {
          delete process.env[variable];
        }
        environmentVariables.clear();
      },
    },
  } as unknown as vscode.ExtensionContext;
}

async function buildConnectedStack(): Promise<{
  ideClient: IdeClient;
  ideServer: IDEServer;
  diffManager: DiffManager;
  context: vscode.ExtensionContext;
}> {
  vi.stubEnv('TERM_PROGRAM', 'vscode');
  seedActiveEditor();
  const context = createExtensionContext();
  const diffManager = new DiffManager(
    () => undefined,
    new DiffContentProvider(),
  );
  const ideServer = new IDEServer(() => undefined, diffManager);
  await ideServer.start(context);
  const ideClient = await IdeClient.getInstance();
  return { ideClient, ideServer, diffManager, context };
}

describe('IdeClient with the VS Code companion server', () => {
  let ideClient: IdeClient | undefined;
  let ideServer: IDEServer | undefined;
  let diffManager: DiffManager | undefined;
  let context: vscode.ExtensionContext | undefined;
  let externalHttpServers: http.Server[] = [];
  // Raw MCP clients/transports created directly by tests (not via IdeClient).
  // These must be closed in afterEach so sessions/timers do not leak.
  let rawClients: Client[] = [];
  let rawClientTransports: StreamableHTTPClientTransport[] = [];

  afterEach(async () => {
    // Close raw clients first (sends delete/close to their sessions) before
    // tearing down the shared IDEServer.
    for (const client of rawClients) {
      try {
        await client.close();
      } catch {
        // Best-effort teardown.
      }
    }
    rawClients = [];
    for (const transport of rawClientTransports) {
      try {
        await transport.close();
      } catch {
        // Best-effort teardown.
      }
    }
    rawClientTransports = [];
    if (ideClient !== undefined) {
      await ideClient.disconnect();
    }
    if (ideServer !== undefined) {
      await ideServer.stop();
    }
    for (const srv of externalHttpServers) {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
    externalHttpServers = [];
    diffManager?.dispose();
    for (const subscription of context?.subscriptions ?? []) {
      subscription.dispose();
    }
    ideContext.clearIdeContext();
    IdeClient.resetInstance();
    for (const variable of IDE_ENVIRONMENT_VARIABLES) {
      delete process.env[variable];
    }
    Object.defineProperty(vscode.window, 'activeTextEditor', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      configurable: true,
      value: undefined,
    });
    vi.unstubAllEnvs();
  });

  it('stores initial editor context before connect resolves (no polling)', async () => {
    const stack = await buildConnectedStack();
    ideClient = stack.ideClient;
    ideServer = stack.ideServer;
    diffManager = stack.diffManager;
    context = stack.context;

    await ideClient.connect();

    // Assert synchronously-immediately after connect resolves, with NO wait.
    const receivedContext = ideContext.getIdeContext();
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );
    expect(receivedContext).toMatchObject({
      workspaceState: {
        isTrusted: true,
        openFiles: [
          {
            path: readmePath,
            isActive: true,
            selectedText: 'LLxprt Code',
            cursor: { line: 1, character: 12 },
          },
        ],
      },
    });
  });

  it('reflects incremental context updates after the initial sync', async () => {
    const stack = await buildConnectedStack();
    ideClient = stack.ideClient;
    ideServer = stack.ideServer;
    diffManager = stack.diffManager;
    context = stack.context;

    await ideClient.connect();
    // Drain the synchronous initial value first.
    expect(ideContext.getIdeContext()).toBeDefined();

    const secondUpdate = new Promise<IdeContext>((resolve) => {
      const unsubscribe = ideContext.subscribeToIdeContext((next) => {
        if (next !== undefined) {
          unsubscribe();
          resolve(next);
        }
      });
    });
    stack.ideServer.broadcastIdeContextUpdate();

    const updated = await secondUpdate;
    // broadcastIdeContextUpdate re-sends openFilesManager.state (the same
    // workspaceState shape seeded by seedActiveEditor), so the incremental
    // update must carry the active README file.
    expect(updated).toMatchObject({
      workspaceState: {
        isTrusted: true,
        openFiles: [
          {
            path: readmePath,
            isActive: true,
            selectedText: 'LLxprt Code',
            cursor: { line: 1, character: 12 },
          },
        ],
      },
    });
  });

  it('disconnect closes the MCP client and session transport resources', async () => {
    const stack = await buildConnectedStack();
    ideClient = stack.ideClient;
    ideServer = stack.ideServer;
    diffManager = stack.diffManager;
    context = stack.context;

    await ideClient.connect();
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );

    await ideClient.disconnect();
    // Client is visibly disconnected after disconnect resolves.
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Disconnected,
    );

    await ideServer.stop();
    ideServer = undefined;
    ideClient = undefined;
  });

  it('server.stop resolves promptly while a client is still connected and closes the endpoint', async () => {
    const stack = await buildConnectedStack();
    ideClient = stack.ideClient;
    ideServer = stack.ideServer;
    diffManager = stack.diffManager;
    context = stack.context;

    await ideClient.connect();
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );

    // Capture the port before stop clears the env.
    const port = process.env['LLXPRT_CODE_IDE_SERVER_PORT'] ?? 'unknown';

    // Stop the server FIRST while the client is still connected. This must
    // resolve within a bounded time — proving active SSE streams and keep-alive
    // timers are torn down rather than lingering for the 60-second interval.
    const stopResult = await Promise.race([
      ideServer.stop().then(() => 'stopped'),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve('timeout'), 5000),
      ),
    ]);
    expect(stopResult).toBe('stopped');

    // The former endpoint no longer accepts connections.
    const endpointCheck = await new Promise<string>((resolve) => {
      const req = http.request(
        `http://127.0.0.1:${port}/mcp`,
        { method: 'POST' },
        (res) => {
          res.destroy();
          resolve(`responded-${res.statusCode}`);
        },
      );
      req.on('error', () => resolve('rejected'));
      req.end();
    });
    expect(endpointCheck).toBe('rejected');

    // The client can still be disconnected without hanging.
    await ideClient.disconnect();
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Disconnected,
    );

    // Prevent afterEach from double-stopping.
    ideServer = undefined;
    ideClient = undefined;
  });

  it('ends Disconnected when a default-ping server completes initialize/ping but never sends ide/contextUpdate', async () => {
    // Core regression guard for issue #2650: a genuine MCP server that
    // completes initialize and ping but NEVER delivers ide/contextUpdate must
    // NOT cause a false Connected state. The client must end Disconnected.
    // The test timeout must exceed the client's internal context-receipt
    // timeout (5s) so the Disconnected result is observable.
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    seedActiveEditor();

    // Create a bare MCP server (no ping interception, no ide/contextUpdate).
    const bareMcpServer = new McpServer(
      { name: 'bare-ping-only-server', version: '1.0.0' },
      { capabilities: { logging: {} } },
    );
    const express = (await import('express')).default;
    const { randomUUID } = await import('node:crypto');
    const authToken = 'bare-test-token';

    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use((req, res, next) => {
      const authHeader = req.headers['authorization'];
      if (!authHeader || authHeader !== `Bearer ${authToken}`) {
        res.status(401).send('Unauthorized');
        return;
      }
      next();
    });

    const bareTransports = new Map<string, StreamableHTTPServerTransport>();
    app.post('/mcp', (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      const existing = sessionId ? bareTransports.get(sessionId) : undefined;
      if (existing) {
        existing.handleRequest(req, res, req.body).catch(() => {
          if (!res.headersSent) {
            res.status(500).json({ error: 'error' });
          }
        });
        return;
      }
      const transport: StreamableHTTPServerTransport =
        new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            bareTransports.set(id, transport);
          },
        });
      void bareMcpServer.connect(transport).catch(() => {
        // Best-effort: a bare server connect failure must not produce an
        // unhandled rejection that fails the test process.
      });
      transport.handleRequest(req, res, req.body).catch(() => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'error' });
        }
      });
    });

    const bareServer = http.createServer(app);
    await new Promise<void>((resolve) =>
      bareServer.listen(0, '127.0.0.1', resolve),
    );
    externalHttpServers.push(bareServer);
    const bareAddress = bareServer.address();
    const barePort =
      typeof bareAddress === 'object' && bareAddress ? bareAddress.port : 0;

    // Make IdeClient connect to the bare server via env (no port file).
    vi.stubEnv('LLXPRT_CODE_IDE_SERVER_PORT', String(barePort));
    vi.stubEnv('LLXPRT_CODE_IDE_AUTH_TOKEN', authToken);
    vi.stubEnv('LLXPRT_CODE_IDE_WORKSPACE_PATH', repositoryRoot);

    IdeClient.resetInstance();
    ideClient = await IdeClient.getInstance();
    await ideClient.connect();

    // The client must be Disconnected — the bare server completes initialize
    // and ping but never sends ide/contextUpdate, so the client's context
    // receipt deferred must time out.
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Disconnected,
    );
    expect(ideContext.getIdeContext()).toBeUndefined();

    // Best-effort close of bare server-side transports so their SSE/timers
    // cannot leak even if an assertion above were to fail.
    for (const transport of bareTransports.values()) {
      try {
        await transport.close();
      } catch {
        // Best-effort teardown.
      }
    }
    bareTransports.clear();

    ideClient = undefined;
  }, 10000);

  it('delivers initial context to a client that opens a GET stream without a custom ping', async () => {
    // Regression guard for the GET fallback: a standard MCP client opens a GET
    // SSE stream automatically after the `notifications/initialized` message.
    // The server should push initial context on that stream even if the client
    // does not send a custom application ping.
    const stack = await buildConnectedStack();
    ideServer = stack.ideServer;
    context = stack.context;
    diffManager = stack.diffManager;
    seedActiveEditor();

    const port = process.env['LLXPRT_CODE_IDE_SERVER_PORT']!;
    const authToken = process.env['LLXPRT_CODE_IDE_AUTH_TOKEN']!;

    // Use a real MCP Client that connects normally. The SDK transport
    // automatically opens a GET SSE stream after notifications/initialized.
    const client = new Client({
      name: 'get-stream-client',
      version: '1.0.0',
    });
    // Register immediately so afterEach cleans up on failure.
    rawClients.push(client);
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${authToken}` },
        },
      },
    );
    // Register immediately so afterEach cleans up on failure.
    rawClientTransports.push(transport);

    // Register a notification handler for ide/contextUpdate BEFORE connecting.
    let receivedContext = false;
    let contextUpdateCount = 0;
    client.setNotificationHandler(IdeContextNotificationSchema, () => {
      receivedContext = true;
      contextUpdateCount++;
    });

    await client.connect(transport);

    // The client opens a GET stream automatically after initialized. The
    // server should push initial context on it within a bounded time.
    const result = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000);
      const check = () => {
        if (receivedContext) {
          clearTimeout(timeout);
          resolve(true);
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(check, 100);
    });

    // Close explicitly here (idempotent in the SDK); afterEach will also
    // attempt a best-effort close.
    try {
      await client.close();
    } catch {
      // ignore
    }

    expect(result).toBe(true);
    // Exactly one client-visible ide/contextUpdate notification was delivered.
    expect(contextUpdateCount).toBe(1);
  });

  it('supports a second client connecting while a first client remains active (per-session server)', async () => {
    // Regression guard for issue #2650: the server used to share a single
    // McpServer across every session transport. A McpServer can only be
    // connected to one transport at a time, so a second client's initialize
    // established TCP but the server-side connect() never resolved, hanging
    // until the client's ~60s timeout. This test connects two real MCP
    // Clients to one real IDEServer and asserts both initialize, the second
    // can ping, and closing the second does not break the first.
    const stack = await buildConnectedStack();
    ideServer = stack.ideServer;
    context = stack.context;
    diffManager = stack.diffManager;
    seedActiveEditor();

    const port = process.env['LLXPRT_CODE_IDE_SERVER_PORT']!;
    const authToken = process.env['LLXPRT_CODE_IDE_AUTH_TOKEN']!;

    // --- Client A: connect and keep active. ---
    const clientA = new Client({
      name: 'two-client-A',
      version: '1.0.0',
    });
    const transportA = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${authToken}` },
        },
      },
    );
    let clientAReceivedContext = false;
    clientA.setNotificationHandler(IdeContextNotificationSchema, () => {
      clientAReceivedContext = true;
    });
    rawClients.push(clientA);
    rawClientTransports.push(transportA);
    await clientA.connect(transportA);
    await clientA.ping();
    expect(clientAReceivedContext).toBe(true);

    // --- Client B: connect while A is still active. Race with a short
    //     timeout so a hung shared-server connect fails the test fast. ---
    const clientB = new Client({
      name: 'two-client-B',
      version: '1.0.0',
    });
    const transportB = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${authToken}` },
        },
      },
    );
    let clientBReceivedContext = false;
    clientB.setNotificationHandler(IdeContextNotificationSchema, () => {
      clientBReceivedContext = true;
    });
    rawClients.push(clientB);
    rawClientTransports.push(transportB);

    const connectOutcome = await Promise.race([
      clientB.connect(transportB).then(() => 'connected'),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve('timeout'), 5000),
      ),
    ]);
    expect(connectOutcome).toBe('connected');

    // A ping is the authoritative initial-context synchronization point.
    await clientB.ping();
    expect(clientBReceivedContext).toBe(true);

    // Close only client B. A must remain usable.
    try {
      await clientB.close();
    } catch {
      // Best-effort.
    }
    // Remove B from raw cleanup (already closed) so afterEach does not
    // double-close a closed transport.
    rawClients = rawClients.filter((c) => c !== clientB);
    rawClientTransports = rawClientTransports.filter((t) => t !== transportB);

    // A must still be able to ping — closing B must not have torn down the
    // shared protocol that A depends on.
    await clientA.ping();
    expect(clientAReceivedContext).toBe(true);
  }, 10000);
});
