/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode';
import { IdeContextNotificationSchema } from './ide-schemas.js';
import { z } from 'zod';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { PingRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { type Server as HTTPServer } from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import type { DiffManager } from './diff-manager.js';
import { OpenFilesManager } from './open-files-manager.js';

class CORSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CORSError';
  }
}

const MCP_SESSION_ID_HEADER = 'mcp-session-id';
const IDE_SERVER_PORT_ENV_VAR = 'LLXPRT_CODE_IDE_SERVER_PORT';
const IDE_WORKSPACE_PATH_ENV_VAR = 'LLXPRT_CODE_IDE_WORKSPACE_PATH';
const IDE_AUTH_TOKEN_ENV_VAR = 'LLXPRT_CODE_IDE_AUTH_TOKEN';

/**
 * Tracks the initial `ide/contextUpdate` delivery for each session atomically.
 *
 * - `pending`: a delivery attempt is in-flight (shared boolean promise).
 * - `delivered`: the initial context notification was confirmed sent via the
 *   authoritative ping-associated path.
 * - `undefined`: no delivery has been attempted yet for this session.
 *
 * The in-flight promise (`Promise<boolean>`) ensures concurrent ping/GET
 * delivery attempts share a single send with compatible boolean result
 * semantics. A failed attempt clears only its own in-flight entry so it
 * remains retryable.
 */
interface SessionDeliveryEntry {
  status: 'pending' | 'delivered';
  inFlight?: Promise<boolean>;
}
type SessionContextDelivery = Map<string, SessionDeliveryEntry>;

interface WritePortAndWorkspaceArgs {
  context: vscode.ExtensionContext;
  port: number;
  portFile: string | undefined;
  authToken: string;
  log: (message: string) => void;
}

async function writePortAndWorkspace({
  context,
  port,
  portFile,
  authToken,
  log,
}: WritePortAndWorkspaceArgs): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const workspacePath =
    workspaceFolders !== undefined && workspaceFolders.length > 0
      ? workspaceFolders.map((folder) => folder.uri.fsPath).join(path.delimiter)
      : '';

  context.environmentVariableCollection.replace(
    IDE_SERVER_PORT_ENV_VAR,
    port.toString(),
  );
  context.environmentVariableCollection.replace(
    IDE_WORKSPACE_PATH_ENV_VAR,
    workspacePath,
  );
  context.environmentVariableCollection.replace(
    IDE_AUTH_TOKEN_ENV_VAR,
    authToken,
  );

  const content = JSON.stringify({
    port,
    workspacePath,
    authToken,
  });

  if (!portFile) {
    log('Missing portFile, cannot write port and workspace info.');
    return;
  }

  log(`Writing port file to: ${portFile}`);

  try {
    await fs.writeFile(portFile, content).then(() => fs.chmod(portFile, 0o600));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Failed to write port to file: ${message}`);
  }
}

async function sendIdeContextUpdateNotification(
  transport: StreamableHTTPServerTransport,
  log: (message: string) => void,
  openFilesManager: OpenFilesManager,
  relatedRequestId?: string | number,
): Promise<boolean> {
  const ideContext = openFilesManager.state;

  try {
    const notification = IdeContextNotificationSchema.parse({
      jsonrpc: '2.0',
      method: 'ide/contextUpdate',
      params: ideContext,
    });

    await transport.send(
      notification,
      relatedRequestId === undefined ? undefined : { relatedRequestId },
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Failed to send ide/contextUpdate notification: ${message}`);
    return false;
  }
}

export class IDEServer {
  /**
   * Maximum time (ms) to wait for a single transport's close() to resolve
   * during shutdown. The SDK's close() can hang when an active SSE GET stream
   * is still open, so we bound it to prevent server.stop() from deadlocking.
   */
  static readonly TRANSPORT_CLOSE_TIMEOUT_MS = 2000;

  private server: HTTPServer | undefined;
  private context: vscode.ExtensionContext | undefined;
  private log: (message: string) => void;
  private portFile: string | undefined;
  private port: number | undefined;
  private authToken: string | undefined;
  private transports: Map<string, StreamableHTTPServerTransport> = new Map();
  private openFilesManager: OpenFilesManager | undefined;
  diffManager: DiffManager;

  constructor(log: (message: string) => void, diffManager: DiffManager) {
    this.log = log;
    this.diffManager = diffManager;
  }

  start(context: vscode.ExtensionContext): Promise<void> {
    return new Promise((resolve, reject) => {
      this.context = context;
      this.authToken = randomUUID();
      const sessionContextDelivery: SessionContextDelivery = new Map();
      const app = express();
      app.use(express.json({ limit: '10mb' }));

      this.registerCors(app);
      this.registerHostValidation(app);
      this.registerAuthorization(app);

      this.openFilesManager = new OpenFilesManager(context);
      this.registerIdeChangeSubscriptions(context);
      this.registerMcpRoutes(app, sessionContextDelivery);
      this.registerErrorHandler(app);
      this.startHttpServer(app, context, resolve, reject);
    });
  }

  private registerCors(app: Express) {
    app.use(
      cors({
        origin: (origin, callback) => {
          // Only allow non-browser requests with no origin.
          if (!origin) {
            return callback(null, true);
          }
          return callback(
            new CORSError('Request denied by CORS policy.'),
            false,
          );
        },
      }),
    );
  }

  private registerHostValidation(app: Express) {
    app.use((req, res, next) => {
      const host = req.headers.host ?? '';
      const allowedHosts = [`localhost:${this.port}`, `127.0.0.1:${this.port}`];
      if (!allowedHosts.includes(host)) {
        res.status(403).json({ error: 'Invalid Host header' });
        return;
      }
      next();
    });
  }

  private registerAuthorization(app: Express) {
    app.use((req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        this.log('Missing Authorization header. Rejecting request.');
        res.status(401).send('Unauthorized');
        return;
      }
      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer') {
        this.log('Malformed Authorization header. Rejecting request.');
        res.status(401).send('Unauthorized');
        return;
      }
      const token = parts[1];
      if (token !== this.authToken) {
        this.log('Invalid auth token provided. Rejecting request.');
        res.status(401).send('Unauthorized');
        return;
      }
      next();
    });
  }

  /**
   * Synchronizes the initial IDE context with a client-initiated `ping`
   * request that arrives after MCP initialization.
   *
   * The client issues a standard `ping` immediately after `initialize`. We
   * intercept it here: if the session has not yet received its initial
   * `ide/contextUpdate`, we send the notification (awaited, associated with
   * the ping's request id so it is delivered in the same response stream)
   * before letting the ping response go out. This guarantees the context is
   * stored on the client before `connect()` resolves, without sending custom
   * notifications during the `initialize` handshake (which would violate MCP
   * lifecycle ordering).
   *
   * If the initial delivery fails (missing transport, send returns false, or
   * send throws), the session entry is cleared so a later ping can retry, and
   * we throw an error so the ping response is a JSON-RPC error — the client
   * MUST NOT treat a successful ping as context-receipt acknowledgment.
   */
  private registerPingSynchronization(
    mcpServer: McpServer,
    sessionContextDelivery: SessionContextDelivery,
  ) {
    mcpServer.server.setRequestHandler(PingRequestSchema, (_request, extra) =>
      this.deliverInitialContextOnPing(
        extra.sessionId,
        extra.requestId,
        sessionContextDelivery,
      ),
    );
  }

  private async deliverInitialContextOnPing(
    sessionId: string | undefined,
    requestId: string | number,
    sessionContextDelivery: SessionContextDelivery,
  ): Promise<Record<string, never>> {
    if (sessionId === undefined) {
      throw new Error('Cannot deliver initial IDE context: missing session id');
    }

    // Ping delivery is authoritative: a successful ping-associated send marks
    // the session delivered. A false/rejection must propagate as a JSON-RPC
    // error so the client does not treat a successful ping as context-receipt
    // acknowledgment.
    const delivered = await this.deliverInitialContext(
      sessionId,
      sessionContextDelivery,
      { relatedRequestId: requestId, authoritative: true },
    );
    if (!delivered) {
      throw new Error('Failed to deliver initial IDE context notification');
    }
    return {};
  }

  /**
   * Atomically delivers the initial context for a session through a single
   * typed boolean delivery state machine. Concurrent calls (e.g. overlapping
   * ping and GET) share the exact same `Promise<boolean>`. The boolean result
   * is compatible across both paths: true means sent, false means failed and
   * retryable.
   *
   * `authoritative`: when true (ping path), a successful send permanently marks
   * the session delivered — REGARDLESS of which caller created the shared
   * in-flight promise. The authoritative caller upgrades the session to
   * delivered AFTER awaiting the shared promise, rather than relying on the
   * promise closure, so that a non-authoritative GET creating the in-flight
   * promise cannot leave a concurrently-awaiting ping with a permanently
   * pending session on success. When false (standalone GET path), a successful
   * send does NOT permanently mark delivered, because the SDK standalone GET
   * send may resolve despite the notification not actually reaching the client
   * on an active response stream. This leaves the session retryable by a later
   * ping.
   *
   * On false/rejection, the in-flight promise clears only its own entry so the
   * session remains retryable without losing a concurrent caller's result.
   */
  private async deliverInitialContext(
    sessionId: string,
    sessionContextDelivery: SessionContextDelivery,
    options: { relatedRequestId?: string | number; authoritative: boolean },
  ): Promise<boolean> {
    const { relatedRequestId, authoritative } = options;
    const entry = sessionContextDelivery.get(sessionId);
    if (entry?.status === 'delivered') {
      return true;
    }

    const transport = this.transports.get(sessionId);
    if (transport === undefined || this.openFilesManager === undefined) {
      return false;
    }

    if (entry?.inFlight) {
      // Concurrent callers share the exact boolean promise — no casting. The
      // shared promise only manages the in-flight lifecycle (clearing its own
      // entry on completion); authoritative upgrading is applied by the
      // caller after awaiting.
      const delivered = await entry.inFlight;
      // An authoritative caller upgrades the session to delivered after a
      // successful shared send, even if a non-authoritative caller created the
      // promise. This closes the race where GET creates the in-flight promise
      // (capturing authoritative=false) and a concurrent ping awaits it.
      if (delivered && authoritative) {
        sessionContextDelivery.set(sessionId, { status: 'delivered' });
      }
      return delivered;
    }

    // Create the in-flight boolean promise and register it BEFORE awaiting so
    // concurrent callers share it. The closure only manages the in-flight
    // lifecycle; it does NOT capture `authoritative`, so the creating caller's
    // authority cannot leak into (or be absent from) concurrent awaiters.
    const inFlight = sendIdeContextUpdateNotification(
      transport,
      this.log.bind(this),
      this.openFilesManager,
      relatedRequestId,
    )
      .then((delivered) => {
        if (!delivered) {
          // Clear only THIS in-flight attempt so it remains retryable.
          const current = sessionContextDelivery.get(sessionId);
          if (current?.inFlight === inFlight) {
            sessionContextDelivery.delete(sessionId);
          }
        }
        return delivered;
      })
      .catch(() => {
        // Clear only THIS in-flight attempt so it remains retryable.
        const current = sessionContextDelivery.get(sessionId);
        if (current?.inFlight === inFlight) {
          sessionContextDelivery.delete(sessionId);
        }
        return false;
      });

    sessionContextDelivery.set(sessionId, { status: 'pending', inFlight });
    const delivered = await inFlight;

    if (delivered) {
      if (authoritative) {
        // The authoritative creating caller upgrades the session to delivered
        // on a successful send.
        sessionContextDelivery.set(sessionId, { status: 'delivered' });
      } else {
        // Non-authoritative success: leave as pending (retryable) and clear
        // the resolved in-flight promise so a later ping creates a FRESH send
        // rather than awaiting this already-resolved one. This matters because
        // the SDK standalone GET send may resolve true without the
        // notification actually reaching the client; a later ping must be able
        // to attempt a real authoritative send.
        const current = sessionContextDelivery.get(sessionId);
        if (current?.inFlight === inFlight) {
          sessionContextDelivery.set(sessionId, { status: 'pending' });
        }
      }
    }
    return delivered;
  }

  private registerIdeChangeSubscriptions(context: vscode.ExtensionContext) {
    const onDidChangeSubscription = this.openFilesManager!.onDidChange(() => {
      this.broadcastIdeContextUpdate();
    });
    context.subscriptions.push(onDidChangeSubscription);
    const onDidChangeDiffSubscription = this.diffManager.onDidChange(
      (notification) => {
        for (const transport of this.transports.values()) {
          void transport.send(notification).catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            this.log(`Failed to broadcast diff notification: ${message}`);
          });
        }
      },
    );
    context.subscriptions.push(onDidChangeDiffSubscription);
  }

  private registerMcpRoutes(
    app: Express,
    sessionContextDelivery: SessionContextDelivery,
  ) {
    app.post('/mcp', (req: Request, res: Response, next: NextFunction) => {
      this.handleMcpPostRequest(req, res, sessionContextDelivery).catch(next);
    });

    app.get('/mcp', (req: Request, res: Response, next: NextFunction) => {
      this.handleSessionRequest(req, res, sessionContextDelivery).catch(next);
    });
  }

  private async handleMcpPostRequest(
    req: Request,
    res: Response,
    sessionContextDelivery: SessionContextDelivery,
  ) {
    const sessionId = req.headers[MCP_SESSION_ID_HEADER] as string | undefined;
    const transport = this.resolvePostTransport(
      req,
      res,
      sessionId,
      sessionContextDelivery,
    );
    if (transport === undefined) {
      return;
    }

    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.log(`Error handling MCP request: ${errorMessage}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0' as const,
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
    // Initial context delivery is handled exclusively by the ping
    // synchronization handler, which associates the notification with the
    // ping request id so it is delivered in the same response stream
    // before the client's connect() resolves. Sending it here (after the
    // initialize response) is unreliable because the notification would be
    // routed to a standalone SSE stream that the client has not opened yet.
  }

  private resolvePostTransport(
    req: Request,
    res: Response,
    sessionId: string | undefined,
    sessionContextDelivery: SessionContextDelivery,
  ): StreamableHTTPServerTransport | undefined {
    const transportForSession =
      sessionId === undefined ? undefined : this.transports.get(sessionId);
    if (transportForSession !== undefined) {
      return transportForSession;
    }
    if (isInitializeRequest(req.body)) {
      return this.createSessionTransport(sessionContextDelivery);
    }

    this.log(
      'Bad Request: No valid session ID provided for non-initialize request.',
    );
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message:
          'Bad Request: No valid session ID provided for non-initialize request.',
      },
      id: null,
    });
    return undefined;
  }

  private createSessionTransport(
    sessionContextDelivery: SessionContextDelivery,
  ): StreamableHTTPServerTransport {
    const mcpServer = createMcpServer(this.diffManager, this.log);
    this.registerPingSynchronization(mcpServer, sessionContextDelivery);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        this.log(`New session initialized: ${newSessionId}`);
        this.transports.set(newSessionId, transport);
        sessionContextDelivery.set(newSessionId, { status: 'pending' });
      },
    });

    this.configureKeepAlive(transport, sessionContextDelivery);
    void mcpServer.connect(transport).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Error connecting MCP server to transport: ${message}`);
    });
    return transport;
  }

  private configureKeepAlive(
    transport: StreamableHTTPServerTransport,
    sessionContextDelivery: SessionContextDelivery,
  ) {
    let missedPings = 0;
    const keepAlive = setInterval(() => {
      const sessionId = transport.sessionId ?? 'unknown';
      transport
        .send({ jsonrpc: '2.0', method: 'ping' })
        .then(() => {
          missedPings = 0;
        })
        .catch((error: Error) => {
          missedPings++;
          this.log(
            `Failed to send keep-alive ping for session ${sessionId}. Missed pings: ${missedPings}. Error: ${error.message}`,
          );
          if (missedPings >= 3) {
            this.log(
              `Session ${sessionId} missed ${missedPings} pings. Closing connection and cleaning up interval.`,
            );
            clearInterval(keepAlive);
          }
        });
    }, 60000); // 60 sec

    transport.onclose = () => {
      clearInterval(keepAlive);
      if (transport.sessionId) {
        this.log(`Session closed: ${transport.sessionId}`);
        sessionContextDelivery.delete(transport.sessionId);
        this.transports.delete(transport.sessionId);
      }
    };
  }

  private async handleSessionRequest(
    req: Request,
    res: Response,
    sessionContextDelivery: SessionContextDelivery,
  ) {
    const sessionId = req.headers[MCP_SESSION_ID_HEADER] as string | undefined;
    const transport = sessionId ? this.transports.get(sessionId) : undefined;
    if (!sessionId || !transport) {
      this.log('Invalid or missing session ID');
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    // Start the GET request handling WITHOUT awaiting first. The SDK's
    // handleGetRequest sets up the standalone SSE stream mapping
    // synchronously before returning the Response, so by the time this
    // call yields, the mapping is active. We then send the initial context
    // while the GET SSE stream is live, and finally await the request
    // lifecycle.
    const handlePromise = transport.handleRequest(req, res);

    try {
      // Deliver initial context on the standalone SSE stream (no
      // relatedRequestId). The GET mapping is active because handleGetRequest
      // set it up synchronously before this point.
      //
      // GET delivery is non-authoritative: the SDK standalone GET send may
      // resolve despite the notification not actually reaching the client on
      // an active response stream. We share the same typed boolean delivery
      // state machine as the ping path so concurrent ping/GET overlap shares
      // the exact boolean promise without incompatible result semantics.
      await this.deliverInitialContext(sessionId, sessionContextDelivery, {
        authoritative: false,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.log(`Error delivering initial context on GET: ${errorMessage}`);
    }

    try {
      await handlePromise;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.log(`Error handling session request: ${errorMessage}`);
      if (!res.headersSent) {
        res.status(400).send('Bad Request');
      }
    }
  }

  private registerErrorHandler(app: Express) {
    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      this.log(`Error processing request: ${err.message}`);
      this.log(`Stack trace: ${err.stack}`);
      if (err instanceof CORSError) {
        res.status(403).json({ error: 'Request denied by CORS policy.' });
      } else {
        next(err);
      }
    });
  }

  private startHttpServer(
    app: Express,
    context: vscode.ExtensionContext,
    resolve: () => void,
    reject: (reason?: unknown) => void,
  ) {
    this.server = app.listen(0, '127.0.0.1', () => {
      void this.writeInitialPortFile(context, resolve, reject);
    });

    this.server.on('close', () => {
      this.log('IDE server connection closed.');
    });

    this.server.on('error', (error) => {
      this.log(`IDE server error: ${error.message}`);
    });
  }

  private async writeInitialPortFile(
    context: vscode.ExtensionContext,
    resolve: () => void,
    reject: (reason?: unknown) => void,
  ) {
    try {
      const address = (this.server as HTTPServer).address();
      if (address !== null && typeof address !== 'string') {
        this.port = address.port;
        this.log(`IDE server listening on http://127.0.0.1:${this.port}`);
        await this.createPortFile();
        await writePortAndWorkspace({
          context,
          port: this.port,
          portFile: this.portFile,
          authToken: this.authToken ?? '',
          log: this.log,
        });
      }
      resolve();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async createPortFile() {
    try {
      const portDir = path.join(os.tmpdir(), 'llxprt', 'ide');
      await fs.mkdir(portDir, { recursive: true });
      this.portFile = path.join(
        portDir,
        `llxprt-ide-server-${process.ppid}-${this.port}.json`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`Failed to create IDE port file: ${message}`);
    }
  }

  broadcastIdeContextUpdate() {
    if (!this.openFilesManager) {
      return;
    }
    for (const transport of this.transports.values()) {
      void sendIdeContextUpdateNotification(
        transport,
        this.log.bind(this),
        this.openFilesManager,
      );
    }
  }

  async syncEnvVars(): Promise<void> {
    if (
      this.context !== undefined &&
      this.server !== undefined &&
      this.port !== undefined &&
      this.authToken !== undefined
    ) {
      await writePortAndWorkspace({
        context: this.context,
        port: this.port,
        portFile: this.portFile,
        authToken: this.authToken,
        log: this.log,
      });
      this.broadcastIdeContextUpdate();
    }
  }

  async stop(): Promise<void> {
    // Close and clear all tracked session transports first so their
    // keep-alive timers and session state are released promptly rather than
    // lingering for the 60-second keep-alive interval.
    await this.closeAllTransports();

    if (this.server) {
      const server = this.server;
      this.server = undefined;
      await new Promise<void>((resolve, reject) => {
        server.close((err?: Error) => {
          if (err) {
            this.log(`Error shutting down IDE server: ${err.message}`);
            reject(err);
            return;
          }
          this.log(`IDE server shut down`);
          resolve();
        });
        server.closeAllConnections();
      });
    }

    if (this.context !== undefined) {
      this.context.environmentVariableCollection.clear();
    }
    if (this.portFile !== undefined) {
      try {
        await fs.unlink(this.portFile);
      } catch {
        // File may not exist; cleanup is best-effort.
      }
    }
  }

  private async closeAllTransports(): Promise<void> {
    const transports = [...this.transports.values()];
    // Close all transports first; each transport's onclose handler removes
    // itself from the map and clears its keep-alive interval. We do not
    // clear the map before closing so onclose can find entries robustly.
    //
    // Each close is guarded by a bounded timeout: the SDK's close() can hang
    // when an active SSE GET stream is still open (the stream handler's
    // internal promise may not resolve until the client disconnects). We must
    // not let a single stuck transport block server shutdown indefinitely.
    await Promise.all(
      transports.map(async (transport) => {
        try {
          await Promise.race([
            transport.close(),
            new Promise<void>((resolve) =>
              setTimeout(resolve, IDEServer.TRANSPORT_CLOSE_TIMEOUT_MS),
            ),
          ]);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.log(`Error closing session transport: ${message}`);
        }
      }),
    );
    // Ensure the map is empty even if an onclose handler was missing.
    this.transports.clear();
  }
}

const createMcpServer = (
  diffManager: DiffManager,
  log: (message: string) => void,
) => {
  const server = new McpServer(
    {
      name: 'llxprt-code-companion-mcp-server',
      version: '1.0.0',
    },
    { capabilities: { logging: {} } },
  );
  server.registerTool(
    'openDiff',
    {
      description:
        '(IDE Tool) Open a diff view to create or modify a file. Returns a notification once the diff has been accepted or rejected.',
      inputSchema: z.object({
        filePath: z.string(),
        // Task(chrstn): determine if this should be required or not.
        newContent: z.string().optional(),
      }).shape,
    },
    async ({
      filePath,
      newContent,
    }: {
      filePath: string;
      newContent?: string;
    }) => {
      log(`openDiff tool invoked for filePath=${filePath}`);
      await diffManager.showDiff(filePath, newContent ?? '');
      return {
        content: [
          {
            type: 'text',
            text: `Showing diff for ${filePath}`,
          },
        ],
      };
    },
  );
  server.registerTool(
    'closeDiff',
    {
      description: '(IDE Tool) Close an open diff view for a specific file.',
      inputSchema: z.object({
        filePath: z.string(),
        suppressNotification: z.boolean().optional(),
      }).shape,
    },
    async ({
      filePath,
      suppressNotification,
    }: {
      filePath: string;
      suppressNotification?: boolean;
    }) => {
      log(
        `closeDiff tool invoked for filePath=${filePath}, suppressNotification=${suppressNotification}`,
      );
      const content = await diffManager.closeDiff(
        filePath,
        suppressNotification,
      );
      const response = { content: content ?? undefined };
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response),
          },
        ],
      };
    },
  );
  return server;
};
