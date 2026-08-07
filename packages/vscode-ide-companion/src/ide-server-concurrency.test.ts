/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as vscode from 'vscode';
import { DiffContentProvider, DiffManager } from './diff-manager.js';
import { IDEServer } from './ide-server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {
  JSONRPCMessage,
  RequestId,
} from '@modelcontextprotocol/sdk/types.js';
import * as path from 'node:path';
import * as http from 'node:http';
import { fileURLToPath } from 'node:url';

const originalEnvValues = new Map<string, string | undefined>();

function setEnv(key: string, value: string | undefined): void {
  if (!originalEnvValues.has(key)) {
    originalEnvValues.set(key, process.env[key]);
  }
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function restoreEnv(): void {
  for (const [key, value] of originalEnvValues) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  originalEnvValues.clear();
}

const companionFile = fileURLToPath(import.meta.url);
const srcDir = path.dirname(companionFile);
const companionDir = path.dirname(srcDir);
const packagesDir = path.dirname(companionDir);
const repositoryRoot = path.dirname(packagesDir);
const readmePath = path.join(repositoryRoot, 'README.md');

void vi.mock('vscode', () => {
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

  const createUri = (scheme: string, filePath: string) => ({
    scheme,
    fsPath: filePath,
    path: filePath,
    toString: () => `${scheme}:${filePath}`,
  });
  const disposable = () => ({ dispose: () => undefined });

  return {
    EventEmitter: TestEventEmitter,
    Uri: {
      file: (filePath: string) => createUri('file', filePath),
      from: ({ scheme, path: filePath }: { scheme: string; path: string }) =>
        createUri(scheme, filePath),
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
        setEnv(variable, value);
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

const IDE_ENVIRONMENT_VARIABLES = [
  'LLXPRT_CODE_IDE_SERVER_PORT',
  'LLXPRT_CODE_IDE_WORKSPACE_PATH',
  'LLXPRT_CODE_IDE_AUTH_TOKEN',
] as const;

interface JsonRpcResponse {
  jsonrpc: string;
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
  sessionId?: string;
}

const NEWLINE = '\n';

/**
 * Parses a single SSE "data:" line into a JSON-RPC message, or undefined if
 * the line is not a data line or is malformed.
 */
function parseSseDataLine(line: string): JsonRpcResponse | undefined {
  if (!line.startsWith('data:')) {
    return undefined;
  }
  const jsonText = line.slice(5).trim();
  if (jsonText === '') {
    return undefined;
  }
  try {
    return JSON.parse(jsonText) as JsonRpcResponse;
  } catch {
    return undefined;
  }
}

/**
 * Parses a response body that may be either raw JSON or an SSE stream of
 * "event: message" / "data: {...}" lines. Extracts the JSON-RPC message and
 * pairs it with the mcp-session-id response header.
 */
function parseResponseBody(
  data: string,
  sessionIdHeader: string | string[] | undefined,
  expectedId?: string | number,
): JsonRpcResponse {
  const trimmed = data.trim();
  const result: JsonRpcResponse = { jsonrpc: '2.0', id: 0 };
  if (typeof sessionIdHeader === 'string') {
    result.sessionId = sessionIdHeader;
  }
  // Notifications (e.g. notifications/initialized) return an empty 202 body.
  if (trimmed === '') {
    return result;
  }
  if (trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
    const messages: JsonRpcResponse[] = [];
    for (const line of trimmed.split(NEWLINE)) {
      const parsed = parseSseDataLine(line);
      if (parsed !== undefined) {
        messages.push(parsed);
      }
    }
    if (messages.length > 0) {
      const match =
        expectedId !== undefined
          ? messages.find((m) => m.id === expectedId)
          : undefined;
      const chosen = match ?? messages[messages.length - 1];
      if (typeof sessionIdHeader === 'string') {
        chosen.sessionId = sessionIdHeader;
      }
      return chosen;
    }
    return result;
  }
  const parsed = JSON.parse(trimmed) as JsonRpcResponse;
  if (typeof sessionIdHeader === 'string') {
    parsed.sessionId = sessionIdHeader;
  }
  return parsed;
}

/**
 * Sends a raw JSON-RPC request over HTTP to the IDE server's /mcp endpoint and
 * returns the parsed response body and the mcp-session-id header. Used to
 * drive initialize/ping sequencing deterministically without the SDK client's
 * automatic GET-stream behavior interfering with the precise overlap under
 * test.
 */
function sendJsonRpc(
  port: number,
  authToken: string,
  body: { id?: string | number; [key: string]: unknown },
  sessionId?: string,
): Promise<JsonRpcResponse> {
  const expectedId = body.id;
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${authToken}`,
    };
    if (sessionId !== undefined) {
      headers['mcp-session-id'] = sessionId;
    }
    const payload = JSON.stringify(body);
    const req = http.request(
      `http://127.0.0.1:${port}/mcp`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer | string) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(
              parseResponseBody(
                data,
                res.headers['mcp-session-id'],
                expectedId,
              ),
            );
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Opens a GET SSE stream against /mcp for a session. Returns the underlying
 * request and a function to collect notification events from the stream. The
 * standalone GET triggers non-authoritative initial-context delivery on the
 * server.
 */
function openGetStream(
  port: number,
  authToken: string,
  sessionId: string,
): {
  close: () => void;
  notificationEvents: string[];
} {
  const notificationEvents: string[] = [];
  const req = http.request(
    `http://127.0.0.1:${port}/mcp`,
    {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${authToken}`,
        'mcp-session-id': sessionId,
      },
    },
    (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        if (chunk.includes('ide/contextUpdate')) {
          notificationEvents.push('ide/contextUpdate');
        }
      });
    },
  );
  req.on('error', () => {
    // Stream errors during teardown are expected; ignored.
  });
  req.end();
  return {
    close: () => req.destroy(),
    notificationEvents,
  };
}

/**
 * Wraps StreamableHTTPServerTransport.send so ide/contextUpdate notifications
 * are gated behind a controllable promise. This forces the GET's non-
 * authoritative send to remain in-flight while the authoritative ping arrives,
 * reproducing the concurrency race fixed in deliverInitialContext.
 */
function createGatedSendSpy(): {
  contextSendCount: () => number;
  gateRelease: () => void;
  waitForGateEntry: () => Promise<void>;
  restore: () => void;
} {
  const realSend = StreamableHTTPServerTransport.prototype.send;
  let contextSendCalls = 0;
  let gateEntered = false;
  let gateResolve!: () => void;
  const gateEnteredPromise = new Promise<void>((resolve) => {
    gateResolve = resolve;
  });
  let releaseGate!: () => void;
  const releaseGatePromise = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  const spy = vi
    .spyOn(StreamableHTTPServerTransport.prototype, 'send')
    .mockImplementation(function (
      this: unknown,
      notification: JSONRPCMessage,
      options?: { relatedRequestId?: RequestId },
    ) {
      if (
        'method' in notification &&
        notification.method === 'ide/contextUpdate'
      ) {
        contextSendCalls++;
        if (!gateEntered) {
          gateEntered = true;
          gateResolve();
        }
        return releaseGatePromise.then(() =>
          realSend.call(this, notification, options),
        );
      }
      return realSend.call(this, notification, options);
    });

  return {
    contextSendCount: () => contextSendCalls,
    gateRelease: () => releaseGate(),
    waitForGateEntry: () => gateEnteredPromise,
    restore: () => spy.mockRestore(),
  };
}

/**
 * The shape of IDEServer's private deliverInitialContext method. TypeScript's
 * `private` keyword is a compile-time constraint; at runtime the method is
 * accessible on the prototype. This interface provides a typed view for the
 * spy without weakening type safety elsewhere.
 */
interface DeliverInitialContextFn {
  (
    sessionId: string,
    sessionContextDelivery: unknown,
    options: {
      relatedRequestId?: string | number;
      authoritative: boolean;
    },
  ): Promise<boolean>;
}

interface DeliverInitialContextHolder {
  deliverInitialContext: DeliverInitialContextFn;
}

/**
 * Asserts that a private method a test synchronizes on still exists. Without
 * this, renaming the method would leave the test installing a wrapper that is
 * never invoked — silently reverting the test to its former flaky behaviour
 * instead of failing loudly.
 */
function requireMethod<T>(method: T | undefined, name: string): T {
  if (typeof method !== 'function') {
    throw new Error(
      `${name} not found: the synchronization signal this test depends on is no longer valid`,
    );
  }
  return method as T;
}

/**
 * Spies on the IDEServer's private deliverInitialContext method to detect when
 * the authoritative ping has demonstrably entered the server-side delivery
 * path. This replaces the unreliable setImmediate yields that were used to
 * "wait for the ping to arrive" — setImmediate only yields a couple of
 * macrotasks and does NOT wait for the HTTP round trip the ping requires.
 *
 * When deliverInitialContext is called with authoritative: true (the ping
 * path), the returned promise resolves. By the time the test awaits it, the
 * ping has already entered the method and found (and started awaiting) the
 * shared in-flight promise created by the GET — the exact overlap the test
 * intends to construct.
 *
 * The spy calls through to the real implementation so the actual delivery
 * logic runs unmodified.
 */
function createPingArrivalSpy(server: IDEServer): {
  waitForPingEntry: () => Promise<void>;
  restore: () => void;
} {
  let pingResolve!: () => void;
  const pingEnteredPromise = new Promise<void>((resolve) => {
    pingResolve = resolve;
  });

  const holder = server as unknown as DeliverInitialContextHolder;
  // Fail loudly if the method is renamed. Without this the spy would install a
  // wrapper that is never invoked, the gate would be released before the ping
  // arrived, and the test would silently revert to being flaky.
  const realDeliver = requireMethod(
    holder.deliverInitialContext,
    'IDEServer.deliverInitialContext',
  ).bind(server);

  holder.deliverInitialContext = (
    sessionId: string,
    sessionContextDelivery: unknown,
    options: {
      relatedRequestId?: string | number;
      authoritative: boolean;
    },
  ): Promise<boolean> => {
    if (options.authoritative) {
      pingResolve();
    }
    return realDeliver(sessionId, sessionContextDelivery, options);
  };

  return {
    waitForPingEntry: () => pingEnteredPromise,
    restore: () => {
      // Delete the instance override rather than assigning the bound function
      // back, so the prototype method is in effect again and the object shape
      // matches its pre-spy state.
      delete (holder as Partial<DeliverInitialContextHolder>)
        .deliverInitialContext;
    },
  };
}

describe('IDEServer initial-context delivery concurrency', () => {
  let ideServer: IDEServer | undefined;
  let diffManager: DiffManager | undefined;
  let context: vscode.ExtensionContext | undefined;

  beforeEach(() => {
    seedActiveEditor();
  });

  afterEach(async () => {
    try {
      if (ideServer !== undefined) {
        await ideServer.stop();
      }
    } finally {
      // Always restore mocks and tear down diffManager/subscriptions/env/vscode
      // state even if ideServer.stop() rejects, so no global prototype spy or
      // stubbed env leaks into subsequent tests.
      vi.restoreAllMocks();
      diffManager?.dispose();
      for (const subscription of context?.subscriptions ?? []) {
        subscription.dispose();
      }
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
      restoreEnv();
      ideServer = undefined;
    }
  });

  it('marks the session delivered when an authoritative ping awaits a GET-created in-flight send', async () => {
    // Regression for the concurrency bug: deliverInitialContext captured
    // `authoritative` in the closure that creates the shared in-flight
    // promise. If a non-authoritative GET created the promise and an
    // authoritative ping awaited it, successful completion left the session
    // pending forever. This test forces GET-first/ping-second overlap and
    // proves durable delivered state (no duplicate send on a subsequent ping).
    const gate = createGatedSendSpy();

    diffManager = new DiffManager(() => undefined, new DiffContentProvider());
    ideServer = new IDEServer(() => undefined, diffManager);
    context = createExtensionContext();
    await ideServer.start(context);

    const port = Number(process.env['LLXPRT_CODE_IDE_SERVER_PORT']);
    const authToken = process.env['LLXPRT_CODE_IDE_AUTH_TOKEN']!;

    // 1. Initialize to create a session.
    const initResponse = await sendJsonRpc(port, authToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'concurrency-test-client', version: '1.0.0' },
      },
    });
    const resolvedSessionId = initResponse.sessionId;
    expect(resolvedSessionId).toBeTruthy();

    // Send notifications/initialized to complete the handshake.
    await sendJsonRpc(
      port,
      authToken,
      {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      },
      resolvedSessionId,
    );

    // 2. Open the GET stream (non-authoritative). This creates the shared
    //    in-flight send promise. The gated spy holds it in-flight.
    const getStream = openGetStream(port, authToken, resolvedSessionId!);

    // Spy on the server-side deliverInitialContext to get a deterministic
    // signal when the authoritative ping enters the delivery path. Created
    // inside the try so the instance override is always removed by the
    // finally block, even if an assertion below throws.
    let pingSpy: ReturnType<typeof createPingArrivalSpy> | undefined;

    try {
      pingSpy = createPingArrivalSpy(ideServer);

      // Wait until the GET's send has entered the gate (in-flight promise
      // created by the non-authoritative path).
      await gate.waitForGateEntry();

      // 3. Issue the authoritative ping while the GET send is still in-flight.
      //    The ping must await the SAME shared in-flight promise created by GET.
      const pingPromise = sendJsonRpc(
        port,
        authToken,
        { jsonrpc: '2.0', id: 2, method: 'ping' },
        resolvedSessionId,
      );

      // Deterministically wait for the ping to reach the server and enter
      // deliverInitialContext with authoritative: true. By the time this
      // resolves, the ping has found the shared in-flight promise and is
      // awaiting it — the exact overlap this test intends to construct.
      // This replaces the unreliable setImmediate yields that only advanced
      // a couple of macrotasks (insufficient for an HTTP loopback round trip).
      await pingSpy.waitForPingEntry();

      // 4. Release the gate: the shared send completes successfully.
      gate.gateRelease();

      const pingResult = await pingPromise;
      // Ping must succeed (the shared send returned true), so no JSON-RPC error.
      expect(pingResult.error).toBeUndefined();
      expect(pingResult.result).toStrictEqual({});

      // Exactly one ide/contextUpdate send occurred (shared, not duplicated).
      expect(gate.contextSendCount()).toStrictEqual(1);

      // 5. A subsequent ping must NOT re-send: the session is durably delivered.
      const secondPing = await sendJsonRpc(
        port,
        authToken,
        { jsonrpc: '2.0', id: 3, method: 'ping' },
        resolvedSessionId,
      );
      expect(secondPing.error).toBeUndefined();
      // No additional context send — durable delivered state prevents a
      // duplicate notification.
      expect(gate.contextSendCount()).toStrictEqual(1);

      // The client-visible GET stream must have received exactly one
      // ide/contextUpdate notification, matching the internal send count.
      expect(getStream.notificationEvents).toStrictEqual(['ide/contextUpdate']);
    } finally {
      // Release the gate so no in-flight mocked send remains hanging, close
      // the raw GET request, and restore the global prototype spy explicitly
      // rather than relying solely on afterEach.
      gate.gateRelease();
      getStream.close();
      gate.restore();
      pingSpy?.restore();
    }
  }, 15000);
});
