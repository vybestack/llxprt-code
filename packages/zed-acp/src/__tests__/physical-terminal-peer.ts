/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import * as acp from '@agentclientprotocol/sdk';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

interface PeerProcess {
  readonly child: ChildProcess;
  readonly exited: Promise<acp.WaitForTerminalExitResponse>;
  readonly budget: number;
  output: string;
  truncated: boolean;
  released: number;
  killed: number;
}

export class PhysicalTerminalPeer {
  readonly connection: acp.AgentSideConnection;
  private readonly client: acp.ClientSideConnection;
  private readonly terminals = new Map<string, PeerProcess>();
  private serial = 0;
  private acquisitionGate: ReturnType<typeof deferred<void>> | undefined;
  private acquired = deferred<void>();
  private closeClient!: () => void;
  private closeAgent!: () => void;
  private closing: Promise<void> | undefined;
  failKill = false;
  failRelease = false;

  constructor() {
    let clientInput!: ReadableStreamDefaultController<Uint8Array>;
    let agentInput!: ReadableStreamDefaultController<Uint8Array>;
    const clientReadable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        clientInput = controller;
      },
    });
    const agentReadable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        agentInput = controller;
      },
    });
    const toClient = new WritableStream<Uint8Array>({
      write: (chunk) => clientInput.enqueue(chunk),
    });
    const toAgent = new WritableStream<Uint8Array>({
      write: (chunk) => agentInput.enqueue(chunk),
    });
    this.closeClient = () => clientInput.close();
    this.closeAgent = () => agentInput.close();
    this.client = new acp.ClientSideConnection(
      () => ({
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
        sessionUpdate: async () => {},
        createTerminal: (request) => this.create(request),
        terminalOutput: async ({ terminalId }) => {
          const terminal = this.require(terminalId);
          return { output: terminal.output, truncated: terminal.truncated };
        },
        waitForTerminalExit: ({ terminalId }) =>
          this.require(terminalId).exited,
        killTerminal: async ({ terminalId }) => {
          const terminal = this.require(terminalId);
          terminal.killed++;
          await this.stop(terminal);
          if (this.failKill)
            throw new acp.RequestError(
              -32001,
              'physical peer kill response failed',
              { phase: 'kill' },
            );
          return {};
        },
        releaseTerminal: async ({ terminalId }) => {
          const terminal = this.require(terminalId);
          terminal.released++;
          await this.stop(terminal);
          if (this.failRelease)
            throw new acp.RequestError(
              -32002,
              'physical peer release response failed',
              { phase: 'release' },
            );
          return {};
        },
      }),
      acp.ndJsonStream(toAgent, clientReadable),
    );
    this.connection = new acp.AgentSideConnection(
      () => ({
        initialize: async () => ({
          protocolVersion: acp.PROTOCOL_VERSION,
          agentCapabilities: {},
        }),
        authenticate: async () => ({}),
        newSession: async () => ({ sessionId: 'physical-terminal-peer' }),
        prompt: async () => ({ stopReason: 'end_turn' }),
        cancel: async () => {},
      }),
      acp.ndJsonStream(toClient, agentReadable),
    );
  }

  async initialize(): Promise<void> {
    await this.client.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { terminal: true },
    });
  }

  holdAcquisition(): void {
    this.acquisitionGate = deferred<void>();
    this.acquired = deferred<void>();
  }
  whenAcquired(): Promise<void> {
    return this.acquired.promise;
  }
  releaseAcquisition(): void {
    this.acquisitionGate?.resolve();
  }
  snapshots(): Array<{
    id: string;
    pid: number | undefined;
    released: number;
    killed: number;
    exited: boolean;
  }> {
    return [...this.terminals].map(([id, terminal]) => ({
      id,
      pid: terminal.child.pid,
      released: terminal.released,
      killed: terminal.killed,
      exited:
        terminal.child.exitCode !== null || terminal.child.signalCode !== null,
    }));
  }

  private async create(
    request: acp.CreateTerminalRequest,
  ): Promise<acp.CreateTerminalResponse> {
    const child = spawn(request.command, request.args ?? [], {
      cwd: request.cwd ?? undefined,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = new Promise<acp.WaitForTerminalExitResponse>(
      (resolve, reject) => {
        child.once('close', (exitCode, signal) =>
          resolve({ exitCode, signal }),
        );
        child.once('error', reject);
      },
    );
    void exited.catch(() => undefined);
    const terminal: PeerProcess = {
      child,
      exited,
      budget: request.outputByteLimit ?? 1024 * 1024,
      output: '',
      truncated: false,
      released: 0,
      killed: 0,
    };
    const id = String(++this.serial);
    this.terminals.set(id, terminal);
    const append = (chunk: Buffer): void => {
      const bytes = Buffer.from(terminal.output + chunk.toString('utf8'));
      if (bytes.byteLength > terminal.budget) terminal.truncated = true;
      terminal.output = bytes
        .subarray(Math.max(0, bytes.byteLength - terminal.budget))
        .toString('utf8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    await once(child, 'spawn');
    this.acquired.resolve();
    await this.acquisitionGate?.promise;
    return { terminalId: id };
  }

  private require(id: string): PeerProcess {
    const terminal = this.terminals.get(id);
    if (terminal === undefined)
      throw new Error(`Unknown physical terminal ${id}`);
    return terminal;
  }

  private async stop(terminal: PeerProcess): Promise<void> {
    if (terminal.child.exitCode !== null || terminal.child.signalCode !== null)
      return;
    if (process.platform === 'win32') {
      const command = spawn('taskkill', [
        '/F',
        '/T',
        '/PID',
        String(terminal.child.pid),
      ]);
      const [status] = await once(command, 'exit');
      if (status !== 0) throw new Error(`taskkill failed: ${String(status)}`);
    } else if (terminal.child.pid !== undefined) {
      try {
        process.kill(-terminal.child.pid, 'SIGKILL');
      } catch (error) {
        if (
          !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
        )
          throw error;
      }
    }
    await terminal.exited;
  }

  dispose(): Promise<void> {
    this.closing ??= this.close();
    return this.closing;
  }

  private async close(): Promise<void> {
    this.releaseAcquisition();
    const failures: unknown[] = [];
    for (const terminal of this.terminals.values()) {
      try {
        await this.stop(terminal);
      } catch (error) {
        failures.push(error);
      }
    }
    for (const close of [this.closeClient, this.closeAgent]) {
      try {
        close();
      } catch (error) {
        failures.push(error);
      }
    }
    await Promise.all([this.client.closed, this.connection.closed]);
    if (failures.length > 0)
      throw new AggregateError(failures, 'Physical ACP peer cleanup failed');
  }
}
