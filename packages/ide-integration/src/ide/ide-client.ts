/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import { isSubpath } from '../utils/paths.js';
import { detectIde, IDE_DEFINITIONS, type IdeInfo } from './detect-ide.js';
import {
  ideContext,
  IdeContextNotificationSchema,
  IdeDiffAcceptedNotificationSchema,
  IdeDiffRejectedNotificationSchema,
  IdeDiffClosedNotificationSchema,
  CloseDiffResponseSchema,
  type DiffUpdateResult,
} from './ideContext.js';
import { getIdeProcessInfo } from './process-utils.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  EnvHttpProxyAgent,
  type RequestInit as UndiciRequestInit,
} from 'undici';
import { debugLogger } from '@vybestack/llxprt-code-telemetry/utils/debugLogger.js';

const logger = {
  debug: (...args: unknown[]) =>
    debugLogger.debug('[DEBUG] [IDEClient]', ...args),
  error: (...args: unknown[]) =>
    debugLogger.error('[ERROR] [IDEClient]', ...args),
};

type StdioConfig = {
  command: string;
  args: string[];
};

type ConnectionConfig = {
  port?: string;
  authToken?: string;
  stdio?: StdioConfig;
};

/**
 * Tri-state result for a connection attempt within {@link establishConnection}.
 *
 * - `'connected'`: the attempt succeeded and set Connected state.
 * - `'failed'`: the attempt genuinely failed (connect error, ping error,
 *   context timeout). The caller may try the next fallback.
 * - `'superseded'`: a newer connect/startNewAttempt displaced this attempt
 *   while it was in-flight. The caller MUST NOT touch any shared state
 *   (no setState) because the newer attempt owns the visible lifecycle.
 */
type EstablishConnectionResult = 'connected' | 'failed' | 'superseded';

export type IDEConnectionState = {
  status: IDEConnectionStatus;
  details?: string; // User-facing
};

export enum IDEConnectionStatus {
  Connected = 'connected',
  Disconnected = 'disconnected',
  Connecting = 'connecting',
}

function getRealPath(path: string): string {
  try {
    return fs.realpathSync(path);
  } catch {
    // Path doesn't exist; return original path.
    return path;
  }
}

/**
 * Cancellable timer with an explicit settle outcome. The promise resolves with
 * `'elapsed'` when the timer fires, or `'cancelled'` if it was cleared before
 * firing. Retaining the handle lets us clear it on early receipt, failure,
 * supersession, and disconnect — preventing timer leaks.
 */
interface CancellableTimer {
  promise: Promise<'elapsed' | 'cancelled'>;
  cancel: () => void;
}

function createCancellableTimer(ms: number): CancellableTimer {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  let cancelFn: () => void = () => {};
  const promise = new Promise<'elapsed' | 'cancelled'>((resolve) => {
    timerId = setTimeout(() => {
      timerId = undefined;
      resolve('elapsed');
    }, ms);
    cancelFn = () => {
      if (timerId !== undefined) {
        clearTimeout(timerId);
        timerId = undefined;
      }
      resolve('cancelled');
    };
  });
  return { promise, cancel: cancelFn };
}

/**
 * Deferred that resolves to `void` on context receipt. Owned per attempt.
 */
interface ReceiptDeferred {
  resolve: () => void;
  promise: Promise<void>;
}

function createReceiptDeferred(): ReceiptDeferred {
  let resolveFn: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  return { resolve: resolveFn, promise };
}

/**
 * Immutable per-connection-attempt ownership bundle. Each attempt captures its
 * own Client, transport, context receipt deferred, and cancellable timeout.
 * The monotonically increasing generation token (not Date.now alone) is
 * collision-free and lets handlers/continuations verify they belong to the
 * still-active attempt before mutating any shared state.
 */
class ConnectionAttempt {
  readonly generation: number;
  readonly client: Client;
  readonly receiptDeferred: ReceiptDeferred;
  transport: StreamableHTTPClientTransport | undefined;

  /**
   * Lazily created only after a successful ping, so a slow connect/ping does
   * not consume the post-ping receipt budget. Undefined before ping resolves.
   */
  receiptTimer: CancellableTimer | undefined;

  constructor(generation: number) {
    this.generation = generation;
    this.client = new Client({
      name: 'streamable-http-client',
      // Task(#3487): use the CLI version here.
      version: '1.0.0',
    });
    this.receiptDeferred = createReceiptDeferred();
  }

  /**
   * Starts the context-receipt timeout. Must be called only after a successful
   * ping so the receipt window measures the wait for the context notification,
   * not connect/ping latency. Safe to call once per attempt.
   */
  startReceiptTimer(): CancellableTimer {
    const timer = createCancellableTimer(IdeClient.CONTEXT_RECEIPT_TIMEOUT_MS);
    this.receiptTimer = timer;
    return timer;
  }

  /**
   * Cancels the receipt timer if one was started. A no-op when the timer was
   * never created (e.g. attempt superseded before ping resolved).
   */
  cancelReceiptTimer(): void {
    this.receiptTimer?.cancel();
  }

  /**
   * Closes only the resources owned by THIS attempt. Must not touch the
   * mutable `IdeClient.client` which may point to a different (newer) attempt.
   */
  async closeOwned(): Promise<void> {
    this.cancelReceiptTimer();
    try {
      await this.client.close();
    } catch (error) {
      logger.debug('Failed to close attempt client:', error);
    }
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (error) {
        logger.debug('Failed to close attempt transport:', error);
      }
    }
  }
}

/**
 * Manages the connection to and interaction with the IDE server.
 */
export class IdeClient {
  /**
   * Bounded timeout (ms) for waiting on initial IDE context receipt after a
   * successful ping. If the context notification does not arrive within this
   * window, the connection is considered failed (Disconnected).
   */
  static readonly CONTEXT_RECEIPT_TIMEOUT_MS = 5000;

  /**
   * Message shown when the IDE connection is lost unexpectedly (onerror /
   * onclose). Used in both handlers to avoid an inline duplicated string.
   */
  private static readonly CONNECTION_LOST_MESSAGE = `IDE connection error. The connection was lost unexpectedly. Please try reconnecting by running /ide enable`;

  private static instance: IdeClient | undefined;
  private client: Client | undefined = undefined;
  private state: IDEConnectionState = {
    status: IDEConnectionStatus.Disconnected,
    details:
      'IDE integration is currently disabled. To enable it, run /ide enable.',
  };
  private currentIde: IdeInfo | undefined;
  private ideProcessInfo: { pid: number; command: string } | undefined;
  private connectionConfig:
    | (ConnectionConfig & { workspacePath?: string; ideInfo?: IdeInfo })
    | undefined;
  private authToken: string | undefined;
  private diffResponses = new Map<string, (result: DiffUpdateResult) => void>();
  private statusListeners = new Set<(state: IDEConnectionState) => void>();
  private trustChangeListeners = new Set<(isTrusted: boolean) => void>();

  /**
   * Monotonically increasing generation counter for collision-free attempt
   * tokens. Never reused, so a stale handler's generation can never match a
   * newer attempt's generation.
   */
  private nextGeneration = 1;

  /**
   * Monotonically increasing lifecycle epoch. Every connect() and disconnect()
   * invocation claims a unique epoch synchronously at its very start — BEFORE
   * its first await — by writing `activeLifecycleEpoch = this.nextLifecycleEpoch++`
   * with no intervening await. After every await that can be superseded by a
   * newer connect()/disconnect(), the owning operation re-checks
   * `this.activeLifecycleEpoch === myEpoch` before mutating any shared state
   * (client, diff map, ideContext, connection status). This guarantees that a
   * stale operation resuming after a newer operation can never clobber the
   * newer operation's results, because its epoch no longer matches.
   */
  private nextLifecycleEpoch = 1;
  private activeLifecycleEpoch = 0;

  /**
   * The currently active connection attempt, or undefined when none is active.
   * Starting a fresh attempt supersedes (cancels and closes) the prior one.
   * All handlers and post-await continuations verify ownership against this
   * before mutating shared state.
   */
  private activeAttempt: ConnectionAttempt | undefined = undefined;

  private constructor() {}

  static async getInstance(): Promise<IdeClient> {
    if (!IdeClient.instance) {
      const client = new IdeClient();
      client.ideProcessInfo = await getIdeProcessInfo();
      client.connectionConfig = await client.getConnectionConfigFromFile();
      client.currentIde = detectIde(
        client.ideProcessInfo,
        client.connectionConfig?.ideInfo,
      );
      IdeClient.instance = client;
    }
    return IdeClient.instance;
  }

  static resetInstance(): void {
    IdeClient.instance = undefined as unknown as IdeClient;
  }

  addStatusChangeListener(listener: (state: IDEConnectionState) => void) {
    this.statusListeners.add(listener);
  }

  removeStatusChangeListener(listener: (state: IDEConnectionState) => void) {
    this.statusListeners.delete(listener);
  }

  addTrustChangeListener(listener: (isTrusted: boolean) => void) {
    this.trustChangeListeners.add(listener);
  }

  removeTrustChangeListener(listener: (isTrusted: boolean) => void) {
    this.trustChangeListeners.delete(listener);
  }

  async connect(): Promise<void> {
    if (!this.currentIde) {
      this.setState(
        IDEConnectionStatus.Disconnected,
        `IDE integration is not supported in your current environment. To use this feature, run LLxprt Code in one of these supported IDEs: ${Object.values(
          IDE_DEFINITIONS,
        )
          .map((ide) => ide.displayName)
          .join(', ')}`,
        false,
      );
      return;
    }

    // Claim lifecycle ownership SYNCHRONOUSLY, before the first await. This
    // ensures that a disconnect() (or a newer connect()) issued immediately
    // after `const p = connect();` — with no intervening await — invalidates
    // this invocation: after our first await resumes, the epoch will no longer
    // match and we abort without touching shared state.
    const myEpoch = this.claimLifecycleEpoch();

    // Supersede any prior in-flight attempt AFTER claiming ownership, so that
    // if a newer connect()/disconnect() starts while we await this close, our
    // post-await continuation detects the stale epoch and aborts.
    await this.supersedeActiveAttempt();
    if (!this.isLifecycleActive(myEpoch)) {
      return;
    }

    this.setState(IDEConnectionStatus.Connecting);

    this.connectionConfig = await this.getConnectionConfigFromFile();

    if (!this.isLifecycleActive(myEpoch)) {
      return;
    }

    this.authToken =
      this.connectionConfig?.authToken ??
      process.env['LLXPRT_CODE_IDE_AUTH_TOKEN'];

    const workspacePath =
      this.connectionConfig?.workspacePath ??
      process.env['LLXPRT_CODE_IDE_WORKSPACE_PATH'];

    const { isValid, error } = IdeClient.validateWorkspacePath(
      workspacePath,
      process.cwd(),
    );

    if (!isValid) {
      if (this.isLifecycleActive(myEpoch)) {
        this.setState(IDEConnectionStatus.Disconnected, error, true);
      }
      return;
    }

    const portFromFile = this.connectionConfig?.port;
    if (portFromFile) {
      const result = await this.establishConnection(portFromFile, myEpoch);
      if (result === 'connected' || result === 'superseded') {
        return;
      }
    }

    if (!this.isLifecycleActive(myEpoch)) {
      return;
    }

    const portFromEnv = this.getPortFromEnv();
    if (portFromEnv) {
      const result = await this.establishConnection(portFromEnv, myEpoch);
      if (result === 'connected' || result === 'superseded') {
        return;
      }
    }

    if (!this.isLifecycleActive(myEpoch)) {
      return;
    }

    this.setState(
      IDEConnectionStatus.Disconnected,
      `Failed to connect to IDE companion extension in ${this.currentIde.displayName}. Please ensure the extension is running. To install the extension, run /ide install.`,
      true,
    );
  }

  /**
   * A diff is accepted with any modifications if the user performs one of the
   * following actions:
   * - Clicks the checkbox icon in the IDE to accept
   * - Runs `command+shift+p` > "LLxprt Code: Accept Diff in IDE" to accept
   * - Selects "accept" in the CLI UI
   * - Saves the file via `ctrl/command+s`
   *
   * A diff is rejected if the user performs one of the following actions:
   * - Clicks the "x" icon in the IDE
   * - Runs "LLxprt Code: Close Diff in IDE"
   * - Selects "no" in the CLI UI
   * - Closes the file
   */
  async openDiff(
    filePath: string,
    newContent?: string,
  ): Promise<DiffUpdateResult> {
    return new Promise<DiffUpdateResult>((resolve, reject) => {
      this.diffResponses.set(filePath, resolve);
      logger.debug(`openDiff -> tools/call openDiff for ${filePath}`);
      this.client
        ?.callTool({
          name: `openDiff`,
          arguments: {
            filePath,
            newContent,
          },
        })
        .catch((err) => {
          logger.debug(`openDiff callTool for ${filePath} failed:`, err);
          reject(err);
        });
    });
  }

  async closeDiff(
    filePath: string,
    options?: { suppressNotification?: boolean },
  ): Promise<string | undefined> {
    try {
      logger.debug(`closeDiff -> tools/call closeDiff for ${filePath}`);
      const result = await this.client?.callTool({
        name: `closeDiff`,
        arguments: {
          filePath,
          suppressNotification: options?.suppressNotification,
        },
      });

      if (result) {
        const parsed = CloseDiffResponseSchema.parse(result);
        return parsed.content;
      }
    } catch (err) {
      logger.debug(`closeDiff callTool for ${filePath} failed:`, err);
    }
    return undefined;
  }

  // Closes the diff. Instead of waiting for a notification,
  // manually resolves the diff resolver as the desired outcome.
  async resolveDiffFromCli(filePath: string, outcome: 'accepted' | 'rejected') {
    const resolver = this.diffResponses.get(filePath);
    const content = await this.closeDiff(filePath, {
      // Suppress notification to avoid race where closing the diff rejects the
      // request.
      suppressNotification: true,
    });

    if (resolver) {
      if (outcome === 'accepted') {
        resolver({ status: 'accepted', content });
      } else {
        resolver({ status: 'rejected', content: undefined });
      }
      this.diffResponses.delete(filePath);
    }
  }

  async disconnect() {
    // Claim lifecycle ownership SYNCHRONOUSLY before any await. This makes a
    // reconnect that starts while we are awaiting closeDiff()/closeOwned()
    // claim a newer epoch, which we detect on resume so we never clobber the
    // newer connection's client/context/state.
    const myEpoch = this.claimLifecycleEpoch();

    const attempt = this.activeAttempt;
    this.activeAttempt = undefined;

    // Snapshot the disconnect-owned client and pending diff paths BEFORE the
    // first await. We must not iterate the live shared diffResponses Map or
    // dereference mutable this.client after an await, because a reconnect may
    // have installed a new client and/or added new diff entries. Calling
    // this.closeDiff() would dereference the (possibly new) this.client and
    // could send closeDiff for new-lifecycle diffs through the wrong client.
    const ownedClient = this.client;
    // Snapshot BOTH the filePath AND its resolver BEFORE the first await. We
    // must not iterate the live shared diffResponses Map after an await,
    // because a reconnect may install a new client and/or add new diff entries.
    // Capturing the resolver reference lets us settle it unconditionally (so
    // awaiters never hang) while identity-guarding map deletion so a newer
    // lifecycle's entry for the same path is never clobbered.
    const ownedDiffs: Array<{
      filePath: string;
      resolver: (result: DiffUpdateResult) => void;
    }> = [];
    if (
      this.state.status !== IDEConnectionStatus.Disconnected &&
      ownedClient !== undefined
    ) {
      for (const [filePath, resolver] of this.diffResponses) {
        ownedDiffs.push({ filePath, resolver });
      }
    }

    for (const { filePath } of ownedDiffs) {
      // After every await, check that this disconnect still owns the lifecycle
      // and that the owned client is still available. A reconnect that
      // completed during the prior closeDiff await claims a newer epoch; once
      // stale, stop issuing tool calls and do not mutate shared state/maps.
      // (ownedDiffs is only populated when ownedClient was defined, but
      // TypeScript cannot narrow across the loop boundary.)
      if (!this.isLifecycleActive(myEpoch) || ownedClient === undefined) {
        break;
      }
      try {
        await IdeClient.closeDiffViaClient(ownedClient, filePath);
      } catch (error) {
        logger.debug(`disconnect closeDiff for ${filePath} failed:`, error);
      }
    }

    // ALWAYS settle every captured resolver — unconditionally, outside the
    // isLifecycleActive guard. If a reconnect claimed a newer epoch mid-loop,
    // the loop broke but these old diff awaiters would otherwise hang forever
    // (closeDiffViaClient uses suppressNotification:true, so no IDE
    // notification will ever settle them). Settling a resolver twice is a
    // no-op, so this is safe even if a notification already settled it. Map
    // deletion is identity-guarded so a newer lifecycle's entry for the same
    // filePath is never clobbered.
    for (const { filePath, resolver } of ownedDiffs) {
      resolver({ status: 'rejected', content: undefined });
      if (this.diffResponses.get(filePath) === resolver) {
        this.diffResponses.delete(filePath);
      }
    }

    // The state transition and client clearing remain epoch-guarded: only the
    // active lifecycle operation may flip connection status or clear
    // this.client. A newer lifecycle may have reconnected; we must not
    // overwrite its state.
    if (this.isLifecycleActive(myEpoch)) {
      this.setState(
        IDEConnectionStatus.Disconnected,
        'IDE integration disabled. To enable it again, run /ide enable.',
      );
      this.client = undefined;
    }

    if (attempt) {
      await attempt.closeOwned();
    }
  }

  /**
   * Calls closeDiff directly on a specific client, bypassing the mutable
   * this.client reference. Used by disconnect cleanup so that a stale
   * disconnect never sends tool calls through a newer lifecycle's client.
   * Preserves the same tool arguments and logging conventions as closeDiff().
   */
  private static async closeDiffViaClient(
    client: Client,
    filePath: string,
  ): Promise<void> {
    logger.debug(`closeDiff -> tools/call closeDiff for ${filePath}`);
    const result = await client.callTool({
      name: 'closeDiff',
      arguments: {
        filePath,
        suppressNotification: true,
      },
    });
    try {
      CloseDiffResponseSchema.parse(result);
    } catch {
      // Result parsing is best-effort during cleanup.
    }
  }

  getCurrentIde(): IdeInfo | undefined {
    return this.currentIde;
  }

  getConnectionStatus(): IDEConnectionState {
    return this.state;
  }

  getDetectedIdeDisplayName(): string | undefined {
    return this.currentIde?.displayName;
  }

  /**
   * Check if diffing functionality is enabled for this IDE client.
   * Returns true when the client is connected and the IDE supports diff operations.
   */
  isDiffingEnabled(): boolean {
    return this.state.status === IDEConnectionStatus.Connected;
  }

  private setState(
    status: IDEConnectionStatus,
    details?: string,
    logToConsole = false,
  ) {
    const isAlreadyDisconnected =
      this.state.status === IDEConnectionStatus.Disconnected &&
      status === IDEConnectionStatus.Disconnected;

    // Only update details & log to console if the state wasn't already
    // disconnected, so that the first detail message is preserved.
    if (!isAlreadyDisconnected) {
      this.state = { status, details };
      for (const listener of this.statusListeners) {
        listener(this.state);
      }
      if (details) {
        if (logToConsole) {
          logger.error(details);
        } else {
          // We only want to log disconnect messages to debug
          // if they are not already being logged to the console.
          logger.debug(details);
        }
      }
    }

    if (status === IDEConnectionStatus.Disconnected) {
      ideContext.clearIdeContext();
    }
  }

  static validateWorkspacePath(
    ideWorkspacePath: string | undefined,
    cwd: string,
  ): { isValid: boolean; error?: string } {
    if (ideWorkspacePath === undefined) {
      return {
        isValid: false,
        error: `Failed to connect to IDE companion extension. Please ensure the extension is running. To install the extension, run /ide install.`,
      };
    }

    if (ideWorkspacePath === '') {
      return {
        isValid: false,
        error: `To use this feature, please open a workspace folder in your IDE and try again.`,
      };
    }

    const ideWorkspacePaths = ideWorkspacePath.split(path.delimiter);
    const realCwd = getRealPath(cwd);
    const isWithinWorkspace = ideWorkspacePaths.some((workspacePath) => {
      const idePath = getRealPath(workspacePath);
      return isSubpath(idePath, realCwd);
    });

    if (!isWithinWorkspace) {
      return {
        isValid: false,
        error: `Directory mismatch. LLxprt Code is running in a different location than the open workspace in the IDE. Please run the CLI from one of the following directories: ${ideWorkspacePaths.join(
          ', ',
        )}`,
      };
    }
    return { isValid: true };
  }

  private getPortFromEnv(): string | undefined {
    const port = process.env['LLXPRT_CODE_IDE_SERVER_PORT'];
    if (!port) {
      return undefined;
    }
    return port;
  }

  private async getConnectionConfigFromFile(): Promise<
    | (ConnectionConfig & { workspacePath?: string; ideInfo?: IdeInfo })
    | undefined
  > {
    if (!this.ideProcessInfo) {
      return {};
    }

    // Try new port file location (in subdirectory with port in filename)
    try {
      const portDir = path.join(os.tmpdir(), 'llxprt', 'ide');
      const files = await fs.promises.readdir(portDir);
      const prefix = `llxprt-ide-server-${this.ideProcessInfo.pid}-`;
      const portFile = files.find(
        (file) => file.startsWith(prefix) && file.endsWith('.json'),
      );

      if (portFile) {
        const portFilePath = path.join(portDir, portFile);
        const portFileContents = await fs.promises.readFile(
          portFilePath,
          'utf8',
        );
        const configData = JSON.parse(portFileContents);
        return {
          port: configData?.port?.toString(),
          workspacePath: configData?.workspacePath,
          authToken: configData?.authToken,
          ideInfo: configData?.ideInfo,
        };
      }
    } catch {
      // Port file in new location not found; try old location.
    }

    // For backwards compatibility, try old port file location
    try {
      const portFile = path.join(
        os.tmpdir(),
        `llxprt-ide-server-${this.ideProcessInfo.pid}.json`,
      );
      const portFileContents = await fs.promises.readFile(portFile, 'utf8');
      const configData = JSON.parse(portFileContents);
      return {
        port: configData?.port?.toString(),
        workspacePath: configData?.workspacePath,
        authToken: configData?.authToken,
        ideInfo: configData?.ideInfo,
      };
    } catch {
      // No port file found.
      return {};
    }
  }

  private createProxyAwareFetch() {
    // ignore proxy for '127.0.0.1' by default to allow connecting to the ide mcp server
    const existingNoProxy = process.env['NO_PROXY'] ?? '';
    const agent = new EnvHttpProxyAgent({
      noProxy: [existingNoProxy, '127.0.0.1'].filter(Boolean).join(','),
    });
    const undiciPromise = import('undici');
    // Suppress unhandled rejection if the promise is not awaited immediately.
    // If the import fails, the error will be thrown when awaiting undiciPromise below.
    undiciPromise.catch(() => {});
    return async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const { fetch: fetchFn } = await undiciPromise;
      const fetchOptions: RequestInit & { dispatcher?: unknown } = {
        ...init,
        dispatcher: agent,
      };
      const options = fetchOptions as unknown as UndiciRequestInit;
      const response = await fetchFn(url, options);
      // Convert undici headers to standard headers format
      const headers: Record<string, string> = {};
      response.headers.forEach((value: string, key: string) => {
        headers[key] = value;
      });
      return new Response(response.body as ReadableStream<unknown> | null, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };
  }

  /**
   * Registers the diff-related notification handlers (accepted, rejected,
   * and the backwards-compatible closed variant). Each resolves the diff
   * response callback for the given file path, if a pending resolver exists.
   */
  private registerDiffHandlers(
    client: Client,
    isStillActive: () => boolean,
  ): void {
    client.setNotificationHandler(
      IdeDiffAcceptedNotificationSchema,
      (notification) => {
        if (!isStillActive()) {
          return;
        }
        const { filePath, content } = notification.params;
        const resolver = this.diffResponses.get(filePath);
        if (resolver) {
          resolver({ status: 'accepted', content });
          this.diffResponses.delete(filePath);
        } else {
          logger.debug(`No resolver found for ${filePath}`);
        }
      },
    );

    client.setNotificationHandler(
      IdeDiffRejectedNotificationSchema,
      (notification) => {
        if (!isStillActive()) {
          return;
        }
        const { filePath } = notification.params;
        const resolver = this.diffResponses.get(filePath);
        if (resolver) {
          resolver({ status: 'rejected', content: undefined });
          this.diffResponses.delete(filePath);
        } else {
          logger.debug(`No resolver found for ${filePath}`);
        }
      },
    );

    // For backwards compatibility. Newer extension versions will only send
    // IdeDiffRejectedNotificationSchema.
    client.setNotificationHandler(
      IdeDiffClosedNotificationSchema,
      (notification) => {
        if (!isStillActive()) {
          return;
        }
        const { filePath } = notification.params;
        const resolver = this.diffResponses.get(filePath);
        if (resolver) {
          resolver({ status: 'rejected', content: undefined });
          this.diffResponses.delete(filePath);
        } else {
          logger.debug(`No resolver found for ${filePath}`);
        }
      },
    );
  }

  /**
   * Registers notification and lifecycle handlers on the attempt's own Client.
   * Every handler captures the attempt's generation token and first checks that
   * it is still the active attempt before mutating any shared state (ideContext,
   * connection state, or diff resolvers). Stale attempt events are ignored.
   */
  private registerClientHandlers(attempt: ConnectionAttempt) {
    const client = attempt.client;

    const isStillActive = () => this.activeAttempt === attempt;

    client.setNotificationHandler(
      IdeContextNotificationSchema,
      (notification) => {
        // Stale attempt events must be ignored and must not mutate ideContext
        // or current state/receipt.
        if (!isStillActive()) {
          return;
        }
        ideContext.setIdeContext(notification.params);
        // Acknowledge receipt before invoking external listeners so a throwing
        // listener cannot prevent establishConnection from recognizing that
        // context was received (which would cause a spurious timeout).
        attempt.receiptDeferred.resolve();
        const isTrusted = notification.params.workspaceState?.isTrusted;
        if (isTrusted !== undefined) {
          for (const listener of this.trustChangeListeners) {
            try {
              listener(isTrusted);
            } catch (error) {
              logger.debug('Trust change listener threw:', error);
            }
          }
        }
      },
    );
    client.onerror = (_error) => {
      if (!isStillActive()) {
        return;
      }
      this.setState(
        IDEConnectionStatus.Disconnected,
        IdeClient.CONNECTION_LOST_MESSAGE,
        true,
      );
    };
    client.onclose = () => {
      if (!isStillActive()) {
        return;
      }
      this.setState(
        IDEConnectionStatus.Disconnected,
        IdeClient.CONNECTION_LOST_MESSAGE,
        true,
      );
    };

    this.registerDiffHandlers(client, isStillActive);
  }

  private async establishConnection(
    port: string,
    epoch: number,
  ): Promise<EstablishConnectionResult> {
    const attempt = await this.startNewAttempt(epoch);
    if (attempt === undefined) {
      // A newer lifecycle operation superseded this one while it awaited the
      // prior attempt's close. Abort without touching shared state.
      return 'superseded';
    }
    try {
      // Register notification handlers (including the IdeContextNotificationSchema
      // handler that resolves THIS attempt's deferred) before Client.connect so
      // we never miss the initial context notification.
      this.registerClientHandlers(attempt);

      attempt.transport = new StreamableHTTPClientTransport(
        new URL(`http://${getIdeServerHost()}:${port}/mcp`),
        {
          fetch: this.createProxyAwareFetch(),
          requestInit: {
            headers: this.authToken
              ? { Authorization: `Bearer ${this.authToken}` }
              : {},
          },
        },
      );
      await attempt.client.connect(attempt.transport);

      // Post-await continuation must verify the attempt is still active before
      // proceeding; a superseding attempt may have started during the await.
      if (!this.isAttemptActive(attempt)) {
        await attempt.closeOwned();
        return 'superseded';
      }

      // Issue a standard MCP ping after initialization. The companion server
      // intercepts this ping to synchronously deliver the initial IDE context
      // notification before the ping response is sent. If the server cannot
      // deliver context, the ping fails (JSON-RPC error) and we disconnect.
      await attempt.client.ping();

      // Post-await continuation must verify the attempt is still active.
      if (!this.isAttemptActive(attempt)) {
        await attempt.closeOwned();
        return 'superseded';
      }

      // Ping success alone is NOT acknowledgment — only the real notification
      // handler resolving the deferred proves the context was received. Await
      // the context receipt with a bounded, cancellable timeout. The timer is
      // started only now (after ping resolved) so slow connect/ping latency
      // does not consume the receipt budget. If no context arrives (including
      // a new client against a default-ping-only server), connect must end
      // Disconnected.
      const receiptTimer = attempt.startReceiptTimer();
      const receiptResult = await Promise.race([
        attempt.receiptDeferred.promise.then(() => 'received' as const),
        receiptTimer.promise,
      ]);

      // Clear the timer on early receipt (it may have been resolved by the
      // notification before the timer elapsed).
      receiptTimer.cancel();

      if (!this.isAttemptActive(attempt)) {
        await attempt.closeOwned();
        return 'superseded';
      }

      if (receiptResult !== 'received') {
        throw new Error(
          'Timed out waiting for initial IDE context notification',
        );
      }

      this.setState(IDEConnectionStatus.Connected);
      return 'connected';
    } catch {
      // Connection failed or context was not received. If this attempt is
      // still active, invalidate it and close owned resources. If a newer
      // attempt has already superseded it, close resources but report
      // 'superseded' so the caller does not overwrite the newer attempt's
      // state.
      const wasActive = this.activeAttempt === attempt;
      if (wasActive) {
        this.activeAttempt = undefined;
        ideContext.clearIdeContext();
      }
      await attempt.closeOwned();

      if (!wasActive || !this.isLifecycleActive(epoch)) {
        return 'superseded';
      }
      return 'failed';
    }
  }

  /**
   * Starts a new connection attempt with a fresh monotonic generation token.
   * The prior active attempt (if any) is superseded — awaited, not
   * fire-and-forget — so installation only proceeds for the still-owning
   * lifecycle operation. This prevents an older connect() that resumes after a
   * newer connect() from installing itself and claiming ownership.
   *
   * Returns `undefined` if the owning operation was superseded while awaiting
   * the prior attempt's close, signalling the caller to abort.
   */
  private async startNewAttempt(
    epoch: number,
  ): Promise<ConnectionAttempt | undefined> {
    // AWAIT supersession rather than fire-and-forget. This serializes the
    // prior close before installation and lets a superseding operation win.
    await this.supersedeActiveAttempt();

    // If a newer connect()/disconnect() started while we awaited the prior
    // close, this operation no longer owns the lifecycle and must not install.
    if (!this.isLifecycleActive(epoch)) {
      return undefined;
    }

    const generation = this.nextGeneration++;
    const attempt = new ConnectionAttempt(generation);
    this.activeAttempt = attempt;
    this.client = attempt.client;
    ideContext.clearIdeContext();
    return attempt;
  }

  /**
   * Supersedes (cancels and closes) the currently active attempt, if any.
   * The prior attempt's generation is invalidated so its handlers/continuations
   * become no-ops, and its owned Client/transport/timer are closed.
   */
  private async supersedeActiveAttempt(): Promise<void> {
    const prior = this.activeAttempt;
    if (prior === undefined) {
      return;
    }
    this.activeAttempt = undefined;
    this.client = undefined;
    ideContext.clearIdeContext();
    await prior.closeOwned();
  }

  private isAttemptActive(attempt: ConnectionAttempt): boolean {
    return this.activeAttempt === attempt;
  }

  /**
   * Claims the next lifecycle epoch synchronously (no await between reading
   * and writing), returning the claimed value. Both connect() and disconnect()
   * call this as their very first action so a competing operation issued
   * immediately afterward is guaranteed a newer epoch.
   */
  private claimLifecycleEpoch(): number {
    const epoch = this.nextLifecycleEpoch;
    this.nextLifecycleEpoch += 1;
    this.activeLifecycleEpoch = epoch;
    return epoch;
  }

  private isLifecycleActive(epoch: number): boolean {
    return this.activeLifecycleEpoch === epoch;
  }
}

function getIdeServerHost() {
  const isInContainer =
    fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
  return isInContainer ? 'host.docker.internal' : '127.0.0.1';
}
