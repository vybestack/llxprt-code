/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { automock } from '../../../test-utils/src/automock.js';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { IdeClient, IDEConnectionStatus } from './ide-client.js';
import { ideContext, IdeContextNotificationSchema } from './ideContext.js';
import * as fs from 'node:fs';
import { getIdeProcessInfo } from './process-utils.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { detectIde, IDE_DEFINITIONS } from './detect-ide.js';
import * as os from 'node:os';

const realProcessUtilsModule = { ...(await import('./process-utils.js')) };
const realIndexModule = {
  ...(await import('@modelcontextprotocol/sdk/client/index.js')),
};
const realStreamableHttpModule = {
  ...(await import('@modelcontextprotocol/sdk/client/streamableHttp.js')),
};
const realDetectIdeModule = { ...(await import('./detect-ide.js')) };
const realNodeOsModule = { ...(await import('node:os')) };

const actual = { ...(await import('node:fs')) };
const readdirMock = vi.fn();
void vi.mock('node:fs', () => ({
  ...(actual as object),
  promises: {
    readFile: vi.fn(),
    readdir: readdirMock,
  },
  realpathSync: (p: string) => p,
  existsSync: () => false,
}));
void vi.mock('./process-utils.js', () => automock(realProcessUtilsModule));
void vi.mock('@modelcontextprotocol/sdk/client/index.js', () =>
  automock(realIndexModule),
);
void vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () =>
  automock(realStreamableHttpModule),
);
void vi.mock('./detect-ide.js', () => automock(realDetectIdeModule));
void vi.mock('node:os', () => automock(realNodeOsModule));

/**
 * A controllable fake MCP Client that lets tests drive connect/ping and fire
 * notification/onclose/onerror events on demand. This tests lifecycle
 * concurrency behavior (stale attempt isolation, supersession) rather than
 * verifying private method calls.
 */
interface FakeClientController {
  client: Client;
  // The client.callTool mock, exposed so tests can configure/track tool calls
  // without re-casting the Client-typed property.
  callTool: typeof readdirMock;
  contextHandler:
    | ((notification: { params: Record<string, unknown> }) => void)
    | undefined;
  /** Resolve the client.connect() promise. */
  resolveConnect: () => void;
  /** Reject the client.connect() promise. */
  rejectConnect: (error: Error) => void;
  /** Resolve the client.ping() promise. */
  resolvePing: () => void;
  /** Reject the client.ping() promise. */
  rejectPing: (error: Error) => void;
  /** Fire the ide/contextUpdate notification handler. */
  fireContextNotification: (params?: Record<string, unknown>) => void;
  /** Fire the client.onclose handler. */
  fireClose: () => void;
  /** Fire the client.onerror handler. */
  fireError: (error?: unknown) => void;
}

function createFakeClient(): FakeClientController {
  let connectResolve!: () => void;
  let connectReject!: (error: Error) => void;
  let pingResolve!: () => void;
  let pingReject!: (error: Error) => void;
  let contextHandler:
    | ((notification: { params: Record<string, unknown> }) => void)
    | undefined;

  const connectPromise = new Promise<void>((resolve, reject) => {
    connectResolve = resolve;
    connectReject = reject;
  });
  const pingPromise = new Promise<void>((resolve, reject) => {
    pingResolve = resolve;
    pingReject = reject;
  });

  const callTool = vi.fn();
  const client = {
    connect: vi.fn().mockReturnValue(connectPromise),
    ping: vi.fn().mockReturnValue(pingPromise),
    close: vi.fn().mockResolvedValue(undefined),
    setNotificationHandler: vi.fn((schema, handler) => {
      if (schema === IdeContextNotificationSchema) {
        contextHandler = handler as typeof contextHandler;
      }
    }),
    callTool,
    set onerror(handler: (error: unknown) => void) {
      (client as unknown as { _onerror: unknown })._onerror = handler;
    },
    get onerror() {
      return (client as unknown as { _onerror: unknown })._onerror as (
        error: unknown,
      ) => void;
    },
    set onclose(handler: () => void) {
      (client as unknown as { _onclose: unknown })._onclose = handler;
    },
    get onclose() {
      return (client as unknown as { _onclose: unknown })
        ._onclose as () => void;
    },
  } as unknown as Client;

  return {
    client,
    callTool,
    get contextHandler() {
      return contextHandler;
    },
    resolveConnect: () => connectResolve(),
    rejectConnect: (error: Error) => connectReject(error),
    resolvePing: () => pingResolve(),
    rejectPing: (error: Error) => pingReject(error),
    fireContextNotification: (params: Record<string, unknown> = {}) => {
      contextHandler?.({ params });
    },
    fireClose: () => {
      const handler = (client as unknown as { _onclose?: () => void })._onclose;
      handler?.();
    },
    fireError: (error: unknown = new Error('test error')) => {
      const handler = (client as unknown as { _onerror?: (e: unknown) => void })
        ._onerror;
      handler?.(error);
    },
  };
}

/**
 * Yields control to the event loop for a short macrotask interval. This lets
 * all pending microtasks and timer callbacks drain, which is necessary because
 * IdeClient.connect() has multiple async gaps (config file reads, supersede
 * awaits, establishConnection awaits). Single-microtask yields are insufficient
 * to let a connect() invocation progress through all its awaits.
 */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createBlockingCloseDiffHandler(
  firstCloseDiffGate: Promise<unknown>,
): (request: { readonly name?: string } | undefined) => Promise<unknown> {
  let closeDiffCallCount = 0;
  return (request) => {
    if (request?.name === 'closeDiff') {
      closeDiffCallCount++;
      if (closeDiffCallCount === 1) {
        return firstCloseDiffGate;
      }
    }
    return Promise.resolve({
      content: [{ type: 'text', text: 'closed' }],
    });
  };
}

function createRejectingFirstCloseDiffHandler(): {
  readonly handle: (
    request: { readonly name?: string } | undefined,
  ) => Promise<unknown>;
  readonly callCount: () => number;
} {
  let closeDiffCallCount = 0;
  return {
    handle: (request) => {
      if (request?.name === 'closeDiff') {
        closeDiffCallCount++;
        if (closeDiffCallCount === 1) {
          return Promise.reject(new Error('closeDiff exploded'));
        }
      }
      return Promise.resolve({
        content: [{ type: 'text', text: 'closed' }],
      });
    },
    callCount: () => closeDiffCallCount,
  };
}

describe('IdeClient connection lifecycle isolation', () => {
  let transportMock: { close: ReturnType<typeof vi.fn> };
  let ideClient: IdeClient;

  /**
   * All fake clients created by the mocked Client constructor, in creation
   * order. The last element is always the most recent — the one the active
   * attempt is using.
   */
  let createdFakes: FakeClientController[];

  beforeEach(async () => {
    (IdeClient as unknown as { instance: IdeClient | undefined }).instance =
      undefined;
    process.env['LLXPRT_CODE_IDE_WORKSPACE_PATH'] = '/test/workspace';
    delete process.env['LLXPRT_CODE_IDE_SERVER_PORT'];
    delete process.env['LLXPRT_CODE_IDE_AUTH_TOKEN'];

    vi.spyOn(process, 'cwd').mockReturnValue('/test/workspace/sub-dir');
    (detectIde as Mock<typeof detectIde>).mockReturnValue(
      IDE_DEFINITIONS.vscode,
    );
    (getIdeProcessInfo as Mock<typeof getIdeProcessInfo>).mockResolvedValue({
      pid: 12345,
      command: 'test-ide',
    });
    (os.tmpdir as Mock<typeof os.tmpdir>).mockReturnValue('/tmp');

    createdFakes = [];
    (
      Client as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementation(() => {
      const controller = createFakeClient();
      createdFakes.push(controller);
      return controller.client;
    });

    transportMock = { close: vi.fn().mockResolvedValue(undefined) };
    (
      StreamableHTTPClientTransport as unknown as Mock<
        (...args: never[]) => unknown
      >
    ).mockReturnValue(
      transportMock as unknown as StreamableHTTPClientTransport,
    );

    (
      fs.promises.readFile as Mock<typeof fs.promises.readFile>
    ).mockResolvedValue(JSON.stringify({ port: '8080' }));
    readdirMock.mockResolvedValue([]);

    ideClient = await IdeClient.getInstance();
    ideContext.clearIdeContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ideContext.clearIdeContext();
  });

  /**
   * Drives the most recently created fake client through a full successful
   * handshake: resolve connect, resolve ping, fire context notification.
   * Call after flushing async to ensure the attempt has created its client.
   */
  async function driveSuccess(
    fake: FakeClientController,
    params: Record<string, unknown> = { workspaceState: { isTrusted: true } },
  ): Promise<void> {
    fake.resolveConnect();
    await flushAsync();
    fake.resolvePing();
    await flushAsync();
    fake.fireContextNotification(params);
    await flushAsync();
  }

  it('superseded attempt A context notification does not satisfy attempt B', async () => {
    // Start attempt A and let it fully create its client (register handlers).
    const connectA = ideClient.connect();
    await flushAsync();

    // Attempt A must have created exactly one fake client.
    expect(createdFakes).toHaveLength(1);
    const fakeA = createdFakes[0];

    // Drive A through connect + ping so it reaches the context-receipt wait.
    // But do NOT fire the context notification yet.
    fakeA.resolveConnect();
    await flushAsync();
    fakeA.resolvePing();
    await flushAsync();

    // Start attempt B which supersedes A.
    const connectB = ideClient.connect();
    await flushAsync();

    // B must have created its own fake client.
    expect(createdFakes).toHaveLength(2);
    const fakeB = createdFakes[1];

    // Drive B to success.
    await driveSuccess(fakeB);
    await connectB;

    // Fire A's stale context notification — must be ignored (A was superseded).
    fakeA.fireContextNotification({
      workspaceState: { isTrusted: false },
      openFiles: [{ path: '/stale-from-A.js' }],
    });

    // Resolve A's pending connect promise so it can settle.
    // (A was already past connect, so this is a no-op in practice, but
    // ensures no dangling promise.)
    await connectA;

    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );
    // B's context is visible, not A's.
    expect(ideContext.getIdeContext()?.workspaceState?.isTrusted).toBe(true);
  });

  it('stale attempt A onclose does not disconnect attempt B', async () => {
    const connectA = ideClient.connect();
    await flushAsync();
    const fakeA = createdFakes[0];
    fakeA.resolveConnect();
    await flushAsync();
    fakeA.resolvePing();
    await flushAsync();

    const connectB = ideClient.connect();
    await flushAsync();
    const fakeB = createdFakes[1];
    await driveSuccess(fakeB);
    await connectB;

    // A is now stale. Firing A's onclose must NOT disconnect B.
    fakeA.fireClose();

    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );

    await connectA;
  });

  it('stale attempt A onerror does not disconnect attempt B', async () => {
    const connectA = ideClient.connect();
    await flushAsync();
    const fakeA = createdFakes[0];
    fakeA.resolveConnect();
    await flushAsync();
    fakeA.resolvePing();
    await flushAsync();

    const connectB = ideClient.connect();
    await flushAsync();
    const fakeB = createdFakes[1];
    await driveSuccess(fakeB);
    await connectB;

    // A is stale. Firing A's onerror must NOT disconnect B.
    fakeA.fireError(new Error('stale A error'));

    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );

    await connectA;
  });

  it('disconnect during connect settles promptly and does not hang', async () => {
    const connectPromise = ideClient.connect();
    await flushAsync();
    expect(createdFakes).toHaveLength(1);
    const fake = createdFakes[0];

    // Disconnect while connect is in-flight (after connect, before ping).
    fake.resolveConnect();
    await flushAsync();

    const disconnectPromise = ideClient.disconnect();

    // Disconnect must settle promptly.
    await expect(disconnectPromise).resolves.toBeUndefined();

    // Allow the in-flight connect to settle without hanging.
    fake.resolvePing();
    await expect(connectPromise).resolves.toBeUndefined();

    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Disconnected,
    );
  });

  it('reconnect after disconnect establishes a fresh connection', async () => {
    // First connect.
    const connect1 = ideClient.connect();
    await flushAsync();
    expect(createdFakes).toHaveLength(1);
    const fake1 = createdFakes[0];
    await driveSuccess(fake1);

    await connect1;
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );

    await ideClient.disconnect();
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Disconnected,
    );

    // Second connect (reconnect) creates a fresh fake client.
    const connect2 = ideClient.connect();
    await flushAsync();
    expect(createdFakes).toHaveLength(2);
    const fake2 = createdFakes[1];
    await driveSuccess(fake2);

    await connect2;
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );
  });

  it('failed attempt whose ping rejects leaves no visible context (no supersession needed)', async () => {
    const connectPromise = ideClient.connect();
    await flushAsync();
    expect(createdFakes).toHaveLength(1);
    const fake = createdFakes[0];
    fake.resolveConnect();
    await flushAsync();
    fake.rejectPing(new Error('ping failed'));

    await connectPromise;

    expect(ideContext.getIdeContext()).toBeUndefined();
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Disconnected,
    );
  });

  it('immediate connect then disconnect with no intervening flush ends Disconnected and no late attempt connects', async () => {
    // The critical interleaving for finding #1: connect() must claim lifecycle
    // ownership synchronously (before its first await) so that a disconnect
    // issued immediately after — without any flush — invalidates it. The older
    // connect must NOT resume and claim a newer generation afterward.
    const connectPromise = ideClient.connect();

    // Disconnect immediately, with NO flush in between. disconnect must
    // invalidate the in-flight connect's ownership before connect resumes.
    await ideClient.disconnect();

    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Disconnected,
    );

    // Now allow the in-flight connect to settle. It must not have installed an
    // attempt (no fake client created) and must not become Connected.
    await flushAsync();

    expect(createdFakes).toHaveLength(0);

    // Even if a late fake were somehow created, driving it to success must not
    // flip the state to Connected.
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Disconnected,
    );

    // Settle the connect promise without hanging.
    await expect(connectPromise).resolves.toBeUndefined();
  });

  it('overlapping connect calls with delayed prior-attempt close: latest invocation wins', async () => {
    // Establish an initial connected attempt whose close is deliberately
    // delayed so that a subsequent connect() invocation stalls inside its
    // supersede await. This reproduces finding #2: an older connect invocation
    // must not resume after a newer one and claim newest ownership.
    const connect1 = ideClient.connect();
    await flushAsync();
    expect(createdFakes).toHaveLength(1);
    const fake1 = createdFakes[0];
    await driveSuccess(fake1);
    await connect1;
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );

    // Make fake1's close (invoked during supersession) block on a deferred so
    // the older connect's supersede await cannot complete promptly.
    let resolveClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    fake1.client.close = vi
      .fn()
      .mockReturnValue(closeGate) as unknown as typeof fake1.client.close;

    // Start connect A. It will await supersedeActiveAttempt() which now blocks
    // on fake1.close(). A has claimed its lifecycle epoch but cannot proceed
    // past this await.
    const connectA = ideClient.connect();
    await flushAsync();

    // While A is blocked superseding fake1, start connect B. B claims a newer
    // lifecycle epoch and must be able to proceed to a successful connection,
    // winning the lifecycle regardless of when A resumes.
    const connectB = ideClient.connect();
    await flushAsync();
    await flushAsync();

    // B is the latest invocation. It must have created its own fake client
    // (fake1 is index 0; B's is index 1). A is still blocked and has NOT
    // created a client.
    expect(createdFakes).toHaveLength(2);
    const fakeB = createdFakes[1];

    // Release the delayed close so A can eventually resume.
    resolveClose();
    await flushAsync();

    // Drive B to success — B is the latest invocation and must own the
    // lifecycle regardless of when A resumes.
    await driveSuccess(fakeB);
    await connectB;

    // Allow A to settle fully. A must abort (its epoch was superseded by B)
    // without creating a client or clobbering B's connection.
    await connectA;

    // A must not have created an additional client beyond fake1 and fakeB.
    expect(createdFakes).toHaveLength(2);
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );
    // The visible context must be B's, not A's.
    expect(ideContext.getIdeContext()?.workspaceState?.isTrusted).toBe(true);
  });

  it('reconnect while disconnect is blocked in closeDiff is not clobbered by the stale disconnect', async () => {
    // Finding #3: disconnect() awaits closeDiff() for pending diffs and then
    // unconditionally clears shared diff/client/context/state. A reconnect that
    // starts and completes during that await must survive the stale
    // disconnect's post-await mutations.
    const connect1 = ideClient.connect();
    await flushAsync();
    expect(createdFakes).toHaveLength(1);
    const fake1 = createdFakes[0];
    await driveSuccess(fake1);
    await connect1;
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );

    // Open a diff so disconnect has a pending closeDiff to await, and make that
    // closeDiff (client.callTool) block on a deferred so disconnect stalls
    // AFTER issuing closeDiff but BEFORE its post-await clear/setState.
    let resolveCloseDiff!: (value: unknown) => void;
    const closeDiffGate = new Promise<unknown>((resolve) => {
      resolveCloseDiff = resolve;
    });
    fake1.client.callTool = vi
      .fn()
      .mockReturnValue(
        closeDiffGate,
      ) as unknown as typeof fake1.client.callTool;
    // openDiff registers a pending resolver keyed by filePath.
    void ideClient.openDiff('/test/workspace/file.ts', 'new');

    // Start disconnect; it will stall awaiting closeDiff for the pending diff.
    const disconnectPromise = ideClient.disconnect();
    await flushAsync();

    // While disconnect is stalled in closeDiff, reconnect. This new connection
    // must win and must NOT be cleared by the still-pending stale disconnect.
    const connect2 = ideClient.connect();
    await flushAsync();
    expect(createdFakes.length).toBeGreaterThanOrEqual(2);
    const fake2 = createdFakes[createdFakes.length - 1];
    // Restore normal callTool behavior for the new client so driveSuccess works.
    fake2.client.callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'closed' }],
    }) as unknown as typeof fake2.client.callTool;
    await driveSuccess(fake2);
    await connect2;
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );

    // Now release the stale disconnect's blocked closeDiff. It must not clobber
    // the fresh connection: state must remain Connected and the active context
    // must be the reconnect's.
    resolveCloseDiff({ content: [{ type: 'text', text: 'closed' }] });
    await disconnectPromise;
    await flushAsync();

    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );
    expect(ideContext.getIdeContext()?.workspaceState?.isTrusted).toBe(true);
  });

  it('throwing trust change listener does not prevent context receipt and connection success', async () => {
    // Register a trust change listener that throws. The initial context
    // notification carries workspaceState.isTrusted, which invokes trust
    // listeners before the receipt deferred is resolved. If a listener throws,
    // receipt acknowledgment must still happen so establishConnection does not
    // time out and report initial context missing despite having received it.
    const throwingListener = vi.fn(() => {
      throw new Error('trust listener exploded');
    });
    ideClient.addTrustChangeListener(throwingListener);

    const connectPromise = ideClient.connect();
    await flushAsync();
    expect(createdFakes).toHaveLength(1);
    const fake = createdFakes[0];

    await driveSuccess(fake, {
      workspaceState: { isTrusted: true },
    });
    await connectPromise;

    // The throwing listener must have been invoked.
    expect(throwingListener).toHaveBeenCalledWith(true);
    // The connection must still succeed despite the listener throwing.
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );
    // The context must have been received and stored.
    expect(ideContext.getIdeContext()?.workspaceState?.isTrusted).toBe(true);

    ideClient.removeTrustChangeListener(throwingListener);
  });

  it('stale disconnect with multiple old diffs does not closeDiff a new-lifecycle diff through the new client', async () => {
    // Blocking defect: disconnect() iterates the live shared diffResponses Map
    // and each closeDiff() dereferences mutable this.client. If disconnect
    // blocks closing an old diff, a reconnect installs a new client and opens
    // a new diff, then the stale disconnect resumes: it must NOT observe the
    // new map entry and send closeDiff(new) through the reconnected client.
    const connect1 = ideClient.connect();
    await flushAsync();
    expect(createdFakes).toHaveLength(1);
    const fake1 = createdFakes[0];
    await driveSuccess(fake1);
    await connect1;
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );

    // Open two old diffs so disconnect has two pending closeDiff calls to
    // iterate. Make the FIRST closeDiff block on a deferred so disconnect
    // stalls after issuing it but before subsequent cleanup.
    let resolveFirstCloseDiff!: (value: unknown) => void;
    const firstCloseDiffGate = new Promise<unknown>((resolve) => {
      resolveFirstCloseDiff = resolve;
    });
    fake1.client.callTool = vi
      .fn()
      .mockImplementation(
        createBlockingCloseDiffHandler(firstCloseDiffGate),
      ) as unknown as typeof fake1.client.callTool;

    // openDiff registers pending resolvers keyed by filePath.
    const diffA = ideClient.openDiff('/test/workspace/oldA.ts', 'newA');
    const diffB = ideClient.openDiff('/test/workspace/oldB.ts', 'newB');
    await flushAsync();

    // Start disconnect; it will stall awaiting the first closeDiff.
    const disconnectPromise = ideClient.disconnect();
    await flushAsync();

    // While disconnect is stalled, reconnect. This new connection wins the
    // lifecycle epoch.
    const connect2 = ideClient.connect();
    await flushAsync();
    expect(createdFakes.length).toBeGreaterThanOrEqual(2);
    const fake2 = createdFakes[createdFakes.length - 1];
    fake2.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'closed' }],
    });
    await driveSuccess(fake2);
    await connect2;
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );

    // Open a NEW diff on the fresh lifecycle AFTER reconnect. The stale
    // disconnect must never closeDiff this path.
    const newDiffPath = '/test/workspace/new.ts';
    const newDiff = ideClient.openDiff(newDiffPath, 'newContent');
    await flushAsync();

    // Track all closeDiff calls on fake2 (the new client). None should occur.
    const fake2CloseDiffCalls = () =>
      fake2.callTool.mock.calls.filter(
        (c: unknown[]) => (c[0] as { name?: string }).name === 'closeDiff',
      );

    // Now release the stale disconnect's blocked first closeDiff. The stale
    // disconnect resumes but must detect it is stale and stop: no further
    // closeDiff calls (neither oldB nor new) and no clearing of shared state.
    resolveFirstCloseDiff({
      content: [{ type: 'text', text: 'closed' }],
    });
    await disconnectPromise;
    await flushAsync();

    // The stale disconnect must not have sent closeDiff through the new client.
    expect(fake2CloseDiffCalls()).toHaveLength(0);

    // The new diff must remain pending/usable (still registered, not cleared).
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );

    // The new diff resolver must not have been settled/cleared by the stale
    // disconnect. We verify by ensuring it is still pending.
    const newDiffSettled = await Promise.race([
      newDiff.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
    ]);
    expect(newDiffSettled).toBe(false);

    // old diffs are settled as 'rejected' by the stale disconnect so their
    // awaiters never hang (closeDiffViaClient uses suppressNotification, so no
    // IDE notification would ever settle them). The stale disconnect must NOT
    // delete the new lifecycle's diff entry, but it unconditionally settles
    // its OWN captured resolvers.
    const diffAResult = await Promise.race([
      diffA.then(
        (r) => r as unknown,
        () => 'rejected-error' as const,
      ),
      new Promise<unknown>((resolve) =>
        setTimeout(() => resolve('unsettled'), 50),
      ),
    ]);
    expect(diffAResult).toStrictEqual({
      status: 'rejected',
      content: undefined,
    });

    // Suppress unhandled rejection warnings for unsettled promises in test.
    void diffA.catch(() => {});
    void diffB.catch(() => {});
    void newDiff.catch(() => {});
  });

  it('current disconnect tolerates a rejecting closeDiff and still completes cleanup', async () => {
    // Genuine OCR finding: if a disconnect-owned closeDiff call throws, the
    // sequential loop can abort cleanup and skip remaining disconnect-owned
    // diffs/resources/state cleanup. When the disconnect remains current, it
    // must continue cleanup and end Disconnected with resources closed.
    const connect1 = ideClient.connect();
    await flushAsync();
    expect(createdFakes).toHaveLength(1);
    const fake1 = createdFakes[0];
    await driveSuccess(fake1);
    await connect1;
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Connected,
    );

    // Open two diffs. Make the first closeDiff reject and the second resolve.
    const closeDiff = createRejectingFirstCloseDiffHandler();
    fake1.client.callTool = vi
      .fn()
      .mockImplementation(
        closeDiff.handle,
      ) as unknown as typeof fake1.client.callTool;

    void ideClient.openDiff('/test/workspace/first.ts', 'first');
    void ideClient.openDiff('/test/workspace/second.ts', 'second');
    await flushAsync();

    // Disconnect must not reject and must complete cleanup despite the
    // throwing closeDiff. Both closeDiff calls should have been attempted.
    await ideClient.disconnect();

    expect(closeDiff.callCount()).toBe(2);
    expect(ideClient.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Disconnected,
    );
  });
});
