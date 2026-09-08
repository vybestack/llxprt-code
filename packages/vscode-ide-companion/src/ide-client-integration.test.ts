/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
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
import type { Express, NextFunction, Request, Response } from 'express';

const companionFile = fileURLToPath(import.meta.url);
// companionFile: packages/vscode-ide-companion/src/<this file>
const srcDir = path.dirname(companionFile);
const companionDir = path.dirname(srcDir);
const packagesDir = path.dirname(companionDir);
const repositoryRoot = path.dirname(packagesDir);
const readmePath = path.join(repositoryRoot, 'README.md');
const originalEnvironment = new Map<string, string | undefined>();

function setTestEnvironment(variable: string, value: string): void {
  if (!originalEnvironment.has(variable)) {
    originalEnvironment.set(variable, process.env[variable]);
  }
  process.env[variable] = value;
}

function restoreTestEnvironment(): void {
  for (const [variable, value] of originalEnvironment) {
    if (value === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = value;
    }
  }
  originalEnvironment.clear();
}

type DeliverInitialContext = (
  sessionId: string,
  delivery: unknown,
  options: { authoritative: boolean },
) => Promise<boolean>;

function observeGetStreamDelivery(
  deliver: DeliverInitialContext,
  resolve: () => void,
  reject: (reason: Error) => void,
): DeliverInitialContext {
  return async (sessionId, delivery, options) => {
    try {
      const delivered = await deliver(sessionId, delivery, options);
      if (!options.authoritative) {
        if (delivered) {
          resolve();
        } else {
          reject(
            new Error(
              'Non-authoritative deliverInitialContext returned false: the GET SSE stream never carried initial context',
            ),
          );
        }
      }
      return delivered;
    } catch (error) {
      if (!options.authoritative) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  };
}

function captureUntrustedContext(
  next: IdeContext | undefined,
  unsubscribe: () => void,
  resolve: (context: IdeContext) => void,
): void {
  if (next?.workspaceState?.isTrusted === false) {
    unsubscribe();
    resolve(next);
  }
}

async function rebindReleasedPort(
  port: number,
  trackedServers: http.Server[],
): Promise<http.Server> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const candidate = http.createServer();
    const result = await new Promise<'listening' | NodeJS.ErrnoException>(
      (resolve) => {
        candidate.once('listening', () => resolve('listening'));
        candidate.once('error', (error: NodeJS.ErrnoException) =>
          resolve(error),
        );
        candidate.listen(port, '127.0.0.1');
      },
    );
    if (result === 'listening') {
      trackedServers.push(candidate);
      return candidate;
    }
    await new Promise<void>((resolve) => candidate.close(() => resolve()));
    if (result.code !== 'EADDRINUSE') {
      throw result;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Port ${port} was not released by ideServer.stop() within 5000ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function configureBareMcpApp(
  app: Express,
  server: McpServer,
  authToken: string,
  randomUUID: () => string,
): Map<string, StreamableHTTPServerTransport> {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${authToken}`) {
      res.status(401).send('Unauthorized');
      return;
    }
    next();
  });

  const transports = new Map<string, StreamableHTTPServerTransport>();
  app.post('/mcp', (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const existing = sessionId ? transports.get(sessionId) : undefined;
    if (existing) {
      existing.handleRequest(req, res, req.body).catch(() => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'error' });
        }
      });
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => {
        transports.set(id, transport);
      },
    });
    void server.connect(transport).catch(() => undefined);
    transport.handleRequest(req, res, req.body).catch(() => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'error' });
      }
    });
  });
  return transports;
}

function serverPort(server: http.Server): number {
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

function waitForContextReceipt(received: () => boolean): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 5000);
    const check = (): void => {
      if (received()) {
        clearTimeout(timeout);
        resolve(true);
      } else {
        setTimeout(check, 100);
      }
    };
    setTimeout(check, 100);
  });
}

await vi.mock('vscode', () => {
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
        setTestEnvironment(variable, value);
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

/**
 * Asserts that a private method a test synchronizes on still exists. Without
 * this, renaming the method would leave the test installing a wrapper that is
 * never invoked — silently reverting the test to its former flaky behaviour
 * instead of failing loudly.
 */
/**
 * Upper bound for server-side GET SSE stream establishment. Generous relative
 * to the local loopback round-trip it gates, since its only job is to convert
 * an indefinite hang into a descriptive failure.
 *
 * The owning test declares a per-test timeout strictly greater than this, so
 * this bound is reached first and reports the specific broken assumption. If
 * the framework timeout were the lower of the two it would abort first with a
 * generic "Test timed out" message and hide the root cause.
 */
const GET_STREAM_TIMEOUT_MS = 10_000;

/**
 * Per-test timeout for the case that awaits GET stream establishment. Kept
 * above GET_STREAM_TIMEOUT_MS so the descriptive error always wins.
 */
const GET_STREAM_TEST_TIMEOUT_MS = 15_000;

/**
 * Rejects with `message` if `promise` has not settled within `timeoutMs`. The
 * timer is always cleared so a resolved promise cannot keep the event loop (or
 * the worker) alive after the test finishes.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function requireMethod<T>(method: T | undefined, name: string): T {
  if (typeof method !== 'function') {
    throw new Error(
      `${name} not found: the synchronization signal this test depends on is no longer valid`,
    );
  }
  return method as T;
}

async function buildConnectedStack(): Promise<{
  ideClient: IdeClient;
  ideServer: IDEServer;
  diffManager: DiffManager;
  context: vscode.ExtensionContext;
}> {
  setTestEnvironment('TERM_PROGRAM', 'vscode');
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
    // Restore workspace trust: a test that flips this to false to make a
    // broadcast payload observably distinct must not leak the value into
    // subsequent tests, which assert isTrusted === true.
    Object.defineProperty(vscode.workspace, 'isTrusted', {
      configurable: true,
      value: true,
    });
    restoreTestEnvironment();
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

  it(
    'reflects incremental context updates after the initial sync',
    async () => {
      const stack = await buildConnectedStack();
      ideClient = stack.ideClient;
      ideServer = stack.ideServer;
      diffManager = stack.diffManager;
      context = stack.context;

      // The client opens a standalone GET SSE stream asynchronously after
      // notifications/initialized (fire-and-forget _startOrAuthSse in the SDK).
      // broadcastIdeContextUpdate delivers via this standalone GET stream; if
      // the stream hasn't arrived at the server yet the notification is silently
      // dropped. We must wait for the GET stream to be established on the server
      // side before broadcasting.
      //
      // We detect this by spying on the server's non-authoritative
      // deliverInitialContext call, which runs on the GET path. Waiting for it
      // to COMPLETE (rather than merely for the GET handler to be entered) is
      // what makes this robust: completion means the server already pushed the
      // initial ide/contextUpdate down the standalone stream, which is
      // observable proof the stream is live and can carry a later broadcast.
      // Note handleSessionRequest itself cannot be awaited here — it stays
      // pending for the lifetime of the SSE response.
      const serverHolder = stack.ideServer as unknown as {
        deliverInitialContext: (
          sessionId: string,
          delivery: unknown,
          options: { authoritative: boolean },
        ) => Promise<boolean>;
      };
      const realDeliverInitialContext = requireMethod(
        serverHolder.deliverInitialContext,
        'IDEServer.deliverInitialContext',
      ).bind(stack.ideServer);
      let getStreamResolve!: () => void;
      let getStreamReject!: (reason: Error) => void;
      const getStreamEstablished = new Promise<void>((resolve, reject) => {
        getStreamResolve = resolve;
        getStreamReject = reject;
      });
      serverHolder.deliverInitialContext = observeGetStreamDelivery(
        realDeliverInitialContext,
        getStreamResolve,
        getStreamReject,
      );

      try {
        await ideClient.connect();
        // Drain the synchronous initial value first.
        expect(ideContext.getIdeContext()).toBeDefined();

        // Wait for the standalone GET SSE stream to arrive at the server.
        // Bounded so that if the server stops taking the non-authoritative GET
        // path entirely, this fails with a message naming the broken
        // synchronization assumption instead of stalling until the suite
        // timeout reports an anonymous hang.
        await withTimeout(
          getStreamEstablished,
          GET_STREAM_TIMEOUT_MS,
          `GET SSE stream was not established within ${GET_STREAM_TIMEOUT_MS}ms: deliverInitialContext was never called with authoritative: false`,
        );
      } finally {
        // Drop the instance override so the prototype implementation is in
        // effect again, even if connect() or the wait above throws.
        delete (serverHolder as Partial<typeof serverHolder>)
          .deliverInitialContext;
      }

      // Make the broadcast payload observably DIFFERENT from the initial
      // context. Without this, the assertion would also be satisfied by a
      // late-arriving initial notification racing in on the GET stream, so the
      // test could pass even if broadcastIdeContextUpdate were broken.
      //
      // OpenFilesManager.state reads vscode.workspace.isTrusted live on every
      // access, so flipping it here is reflected in the next broadcast without
      // depending on editor event watchers (which this suite's vscode mock
      // stubs out as no-op disposables).
      Object.defineProperty(vscode.workspace, 'isTrusted', {
        configurable: true,
        value: false,
      });

      const secondUpdate = new Promise<IdeContext>((resolve) => {
        const unsubscribe = ideContext.subscribeToIdeContext((next) => {
          captureUntrustedContext(next, unsubscribe, resolve);
        });
      });
      stack.ideServer.broadcastIdeContextUpdate();

      const updated = await secondUpdate;
      // The incremental update must carry the NEW trust state, proving this
      // broadcast was delivered rather than a replayed initial context, and it
      // must still carry the active README file.
      expect(updated).toMatchObject({
        workspaceState: {
          isTrusted: false,
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
    },
    GET_STREAM_TEST_TIMEOUT_MS,
  );

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

  it('server.stop resolves promptly while a client is still connected and stops listening', async () => {
    const stack = await buildConnectedStack();
    ideClient = stack.ideClient;
    ideServer = stack.ideServer;
    diffManager = stack.diffManager;
    context = stack.context;

    await ideClient.connect();
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );

    // Capture the allocated port BEFORE stop() clears the server field.
    const port = Number(process.env['LLXPRT_CODE_IDE_SERVER_PORT']);
    expect(Number.isFinite(port)).toBe(true);
    expect(port).toBeGreaterThan(0);

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

    // Assert EXTERNAL behavior: after stop(), a fresh server can bind the
    // same loopback port — the strongest proof that no listener remains.
    // ECONNREFUSED/ECONNRESET probes are not proof (ECONNRESET can occur
    // while a server is still listening). A successful bind of a fresh
    // server is deterministic: it can only succeed when the port is free.
    // Retry boundedly because the OS may take a few ms to release the
    // socket after server.close() resolves (EADDRINUSE during that window
    // is a transient OS condition, not a test failure).
    const boundServer = await rebindReleasedPort(port, externalHttpServers);
    // Deterministic closure/cleanup of the rebind probe.
    await new Promise<void>((resolve) => boundServer.close(() => resolve()));
    externalHttpServers.splice(externalHttpServers.indexOf(boundServer), 1);

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
    setTestEnvironment('TERM_PROGRAM', 'vscode');
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
    const bareTransports = configureBareMcpApp(
      app,
      bareMcpServer,
      authToken,
      randomUUID,
    );

    const bareServer = http.createServer(app);
    await new Promise<void>((resolve) =>
      bareServer.listen(0, '127.0.0.1', resolve),
    );
    externalHttpServers.push(bareServer);
    const barePort = serverPort(bareServer);

    // Make IdeClient connect to the bare server via env (no port file).
    setTestEnvironment('LLXPRT_CODE_IDE_SERVER_PORT', String(barePort));
    setTestEnvironment('LLXPRT_CODE_IDE_AUTH_TOKEN', authToken);
    setTestEnvironment('LLXPRT_CODE_IDE_WORKSPACE_PATH', repositoryRoot);

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
    const result = await waitForContextReceipt(() => receivedContext);

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
