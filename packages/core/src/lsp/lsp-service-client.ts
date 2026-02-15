/* @plan:PLAN-20250212-LSP.P30 */
/* @requirement:REQ-ARCH-060, REQ-GRACE-020, REQ-GRACE-040 */
/* pseudocode: project-plans/issue438/pseudocode/P30-lsp-service-client-functional.md */

import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-jsonrpc/node.js';
import type { Diagnostic, LspConfig, ServerStatus } from './types.js';

const READY_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 3_000;
const SIGKILL_GRACE_MS = 2_000;

export function normalizeServerStatus(raw: unknown): ServerStatus {
  const obj = raw as Record<string, unknown>;
  const serverId = String(obj.serverId ?? '');
  const state = typeof obj.state === 'string' ? obj.state : undefined;
  const status = typeof obj.status === 'string' ? obj.status : undefined;
  const healthy =
    state === 'ok'
      ? true
      : state === 'broken' || state === 'starting'
        ? false
        : typeof obj.healthy === 'boolean'
          ? obj.healthy
          : false;

  return {
    serverId,
    healthy,
    detail: typeof obj.detail === 'string' ? obj.detail : (state ?? status),
    state: state as ServerStatus['state'],
    status,
  };
}

export class LspServiceClient {
  private alive = false;

  private disabledPermanently = false;

  private unavailableReason: string | undefined;

  private process: ChildProcessWithoutNullStreams | null = null;

  private connection: MessageConnection | null = null;

  constructor(
    private readonly config: LspConfig,
    private readonly workspaceRoot: string,
  ) {}

  async start(): Promise<void> {
    if (this.alive || this.disabledPermanently) {
      return;
    }

    if (this.config.servers.length > 0) {
      const firstServerCommand = this.config.servers[0]?.command;
      if (
        typeof firstServerCommand === 'string' &&
        firstServerCommand.length > 0 &&
        firstServerCommand.startsWith('/')
      ) {
        const executable = await this.pathIsExecutable(firstServerCommand);
        if (!executable) {
          this.disable(`Server command not executable: ${firstServerCommand}`);
          return;
        }
      }
    }

    const bunPath = await this.resolveBunPath();
    if (bunPath === null) {
      this.disable('Bun not found in PATH');
      return;
    }

    const lspEntry = join(this.workspaceRoot, 'packages/lsp/src/main.ts');
    if (!(await this.pathIsReadable(lspEntry))) {
      this.disable(`LSP service entry not found: ${lspEntry}`);
      return;
    }

    const child = spawn(bunPath, [lspEntry], {
      cwd: this.workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        LSP_BOOTSTRAP: JSON.stringify({
          workspaceRoot: this.workspaceRoot,
          config: this.config,
        }),
      },
    });

    this.process = child;

    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    this.connection = connection;

    child.once('error', (error) => {
      this.alive = false;
      this.unavailableReason = error.message;
      this.cleanupProcessState();
    });

    child.once('exit', (code, signal) => {
      this.alive = false;
      if (this.unavailableReason === undefined) {
        this.unavailableReason = `LSP service exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
      }
      this.cleanupProcessState();
    });

    connection.listen();

    try {
      await this.waitForReady(connection, child);
      this.alive = true;
      this.unavailableReason = undefined;
    } catch (error) {
      this.disable(
        error instanceof Error ? error.message : 'LSP service startup failed',
      );
      await this.shutdown();
    }
  }

  async checkFile(
    filePath: string,
    signal?: AbortSignal,
  ): Promise<Diagnostic[]> {
    if (!this.alive || this.connection === null) {
      return [];
    }

    if (signal?.aborted === true) {
      return [];
    }

    try {
      const request = this.connection.sendRequest('lsp/checkFile', {
        filePath,
      }) as Promise<Diagnostic[]>;
      if (signal === undefined) {
        return await request;
      }
      return await this.withAbortGuard(request, signal, []);
    } catch {
      return [];
    }
  }

  async getAllDiagnostics(): Promise<Record<string, Diagnostic[]>> {
    if (!this.alive || this.connection === null) {
      return {};
    }

    try {
      return (await this.connection.sendRequest('lsp/diagnostics')) as Record<
        string,
        Diagnostic[]
      >;
    } catch {
      return {};
    }
  }

  async status(): Promise<ServerStatus[]> {
    if (!this.alive || this.connection === null) {
      if (this.config.servers.length === 0) {
        return [];
      }

      return this.config.servers.map((server) => ({
        serverId: server.id,
        healthy: false,
        detail: this.unavailableReason ?? 'LSP service unavailable',
      }));
    }

    try {
      const rawStatuses = (await this.connection.sendRequest(
        'lsp/status',
      )) as unknown[];
      return rawStatuses.map(normalizeServerStatus);
    } catch {
      return [];
    }
  }

  isAlive(): boolean {
    return this.alive;
  }

  getUnavailableReason(): string | undefined {
    if (this.alive) {
      return undefined;
    }

    return this.unavailableReason;
  }

  async shutdown(): Promise<void> {
    const child = this.process;
    const connection = this.connection;

    if (child === null || connection === null) {
      this.cleanupProcessState();
      this.alive = false;
      return;
    }

    try {
      await this.withTimeout(
        connection.sendRequest('lsp/shutdown'),
        SHUTDOWN_TIMEOUT_MS,
        'LSP shutdown request timed out',
      );
    } catch {
      // best-effort shutdown
    }

    try {
      if (!child.killed) {
        child.kill('SIGTERM');
      }

      await Promise.race([
        once(child, 'exit'),
        new Promise<void>((resolve) => {
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
            resolve();
          }, SIGKILL_GRACE_MS);
        }),
      ]);
    } catch {
      // best-effort process termination
    }

    connection.dispose();
    this.cleanupProcessState();
    this.alive = false;
  }

  getMcpTransportStreams(): { readable: Readable; writable: Writable } | null {
    if (!this.alive || this.process === null) {
      return null;
    }

    const readable = this.process.stdio[3];
    const writable = this.process.stdio[4];
    if (readable === null || writable === null) {
      return null;
    }

    return {
      readable: readable as Readable,
      writable: writable as Writable,
    };
  }

  private async resolveBunPath(): Promise<string | null> {
    const which = spawn('which', ['bun'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const chunks: Buffer[] = [];
    which.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    let code: number | null;
    try {
      [code] = (await once(which, 'exit')) as [
        number | null,
        NodeJS.Signals | null,
      ];
    } catch {
      return null;
    }

    if (code !== 0) {
      return null;
    }

    const path = Buffer.concat(chunks).toString('utf8').trim();
    return path.length > 0 ? path : null;
  }

  private async pathIsExecutable(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async pathIsReadable(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath, fsConstants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  private waitForReady(
    connection: MessageConnection,
    child: ChildProcessWithoutNullStreams,
  ): Promise<void> {
    return this.withTimeout(
      new Promise<void>((resolve, reject) => {
        const disposer = connection.onNotification('lsp/ready', () => {
          disposer.dispose();
          resolve();
        });

        child.once('exit', () => {
          disposer.dispose();
          reject(new Error('LSP service exited before ready'));
        });

        child.once('error', (error) => {
          disposer.dispose();
          reject(error);
        });
      }),
      READY_TIMEOUT_MS,
      'Timed out waiting for lsp/ready',
    );
  }

  private async withAbortGuard<T>(
    promise: Promise<T>,
    signal: AbortSignal,
    fallback: T,
  ): Promise<T> {
    if (signal.aborted) {
      return fallback;
    }

    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            resolve(fallback);
          },
          { once: true },
        );
      }),
    ]);
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  }

  private disable(reason: string): void {
    this.disabledPermanently = true;
    this.alive = false;
    this.unavailableReason = reason;
  }

  private cleanupProcessState(): void {
    if (this.connection !== null) {
      this.connection.dispose();
    }

    this.connection = null;
    this.process = null;
  }
}
