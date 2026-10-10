/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Socket } from 'node:net';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { isBunRuntime } from '../utils/runtime.js';
import { SIGKILL_TIMEOUT_MS } from './shellProcessKill.js';
import { shellSupervisorSource } from './shellJobSupervisor.js';
import type { ProcessExitInfo, ShellProcessIdentity } from './shellJobTypes.js';

const messageSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('stopping') }),
  z.object({
    event: z.literal('result'),
    exitCode: z.number().nullable(),
    signal: z.string().nullable(),
  }),
  z.object({ event: z.literal('error'), message: z.string() }),
]);

export interface ShellJobGroup {
  readonly pid: number | undefined;
  readonly child: ShellProcessIdentity;
  readonly exited: Promise<ProcessExitInfo>;
  readonly drained: Promise<void>;
  stop(): void;
  onError(handler: (error: Error) => void): void;
  onOwnershipLost(handler: (error: Error) => void): void;
}

function groupIsAbsent(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return false;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error)) throw error;
    if (error.code === 'ESRCH') return true;
    if (error.code === 'EPERM') return false;
    throw error;
  }
}

async function observeGroupAbsence(pid: number): Promise<void> {
  const deadline = Date.now() + 4000;
  while (!groupIsAbsent(pid)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Cannot confirm shell process group ${pid} drained; ownership has ended, no further signals are safe`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

export interface BunSupervisorRuntime {
  spawn(
    args: string[],
    options: {
      detached: boolean;
      env: Record<string, string | undefined>;
      stdin: 'pipe';
      stdout: 'pipe';
      stderr: number;
    },
  ): ShellProcessIdentity & {
    readonly pid: number;
    readonly stdout: ReadableStream<Uint8Array>;
    readonly stdin: { end(): number | Promise<number> };
    readonly exited: Promise<number>;
    unref(): void;
  };
}

interface SupervisorTransport {
  pid: number | undefined;
  child: ShellProcessIdentity;
  output: Readable;
  exit: Promise<ProcessExitInfo>;
  stop(): Promise<void>;
}

async function* readChunks(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      yield chunk.value;
    }
  } finally {
    reader.releaseLock();
  }
}

function openTransport(
  source: string,
  env: Record<string, string | undefined>,
  logFd: number,
): SupervisorTransport {
  const args = ['--eval', source];
  if (isBunRuntime()) {
    const bunRuntime: BunSupervisorRuntime = createRequire(import.meta.url)(
      'bun',
    );
    const child = bunRuntime.spawn([process.execPath, ...args], {
      detached: true,
      env,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: logFd,
    });
    child.unref();
    return {
      pid: child.pid,
      child,
      output: Readable.from(readChunks(child.stdout)),
      exit: child.exited.then(() => ({
        exitCode: child.exitCode,
        signal: child.signalCode,
      })),
      stop: async () => {
        await child.stdin.end();
      },
    };
  }
  const child = spawn(process.execPath, args, {
    detached: true,
    env,
    stdio: ['pipe', 'pipe', logFd],
  });
  const exit = new Promise<ProcessExitInfo>((resolve, reject) => {
    child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
    child.once('error', reject);
  });
  child.unref();
  if (!(child.stdin instanceof Socket) || !(child.stdout instanceof Socket)) {
    throw new Error('Shell supervisor requires pipe-backed Node sockets');
  }
  child.stdin.unref();
  child.stdout.unref();
  child.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') child.emit('error', error);
  });
  return {
    pid: child.pid,
    child,
    output: child.stdout,
    exit,
    stop: async () => {
      child.stdin?.end();
    },
  };
}

export function spawnShellJobGroup(
  executable: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  logFd: number,
): ShellJobGroup {
  const transport = openTransport(
    shellSupervisorSource({
      executable,
      args,
      cwd,
      graceMs: SIGKILL_TIMEOUT_MS,
    }),
    env,
    logFd,
  );
  return new OwnedShellGroup(transport);
}

class OwnedShellGroup implements ShellJobGroup {
  readonly exited: Promise<ProcessExitInfo>;
  readonly drained: Promise<void>;
  private readonly errors: Error[] = [];
  private readonly errorHandlers: Array<(error: Error) => void> = [];
  private readonly lostHandlers: Array<(error: Error) => void> = [];
  private ownershipError: Error | undefined;
  private resolveResult!: (result: ProcessExitInfo) => void;
  private rejectDeadline!: (error: Error) => void;
  private stopping = false;
  private requested = false;
  private settled = false;
  private drainTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly transport: SupervisorTransport) {
    this.exited = new Promise((resolve) => {
      this.resolveResult = resolve;
    });
    const deadline = new Promise<never>((_, reject) => {
      this.rejectDeadline = reject;
    });
    const lines = createInterface({ input: transport.output });
    const protocolClosed = new Promise<void>((resolve) =>
      lines.once('close', resolve),
    );
    lines.on('line', (line) => this.receive(line));
    transport.output.on('error', (error) => {
      this.fail(error);
      this.lost(error);
      this.stop();
    });
    const observed = transport.exit.then(
      async (result) => {
        this.armDeadline();
        await protocolClosed;
        if (!this.stopping || result.signal !== 'SIGKILL') {
          this.lost(
            new Error(
              `Shell supervisor exited unexpectedly (${result.signal ?? result.exitCode})`,
            ),
          );
        }
        this.resolveResult(result);
        if (transport.pid !== undefined)
          await observeGroupAbsence(transport.pid);
      },
      (error: unknown) => {
        const failure =
          error instanceof Error ? error : new Error(String(error));
        this.fail(failure);
        this.lost(failure);
        throw failure;
      },
    );
    this.drained = Promise.race([observed, deadline]).finally(() => {
      this.settled = true;
      clearTimeout(this.drainTimer);
    });
  }

  get pid(): number | undefined {
    return this.transport.pid;
  }
  get child(): ShellProcessIdentity {
    return this.transport.child;
  }

  stop(): void {
    if (this.requested || this.settled) return;
    this.requested = true;
    this.armDeadline();
    void this.transport.stop().catch((error: unknown) => {
      const failure = new Error('Shell supervisor control failed', {
        cause: error,
      });
      this.fail(failure);
      this.lost(failure);
    });
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
    for (const error of this.errors) handler(error);
  }

  onOwnershipLost(handler: (error: Error) => void): void {
    this.lostHandlers.push(handler);
    if (this.ownershipError !== undefined) handler(this.ownershipError);
  }

  private armDeadline(): void {
    if (this.drainTimer !== undefined || this.settled) return;
    this.drainTimer = setTimeout(() => {
      const error = new Error(
        `Shell supervisor ${this.pid} did not confirm group drain before its deadline; logs retained`,
      );
      this.lost(error);
      this.fail(error);
      this.rejectDeadline(error);
    }, 4500);
    this.drainTimer.unref();
  }

  private fail(error: Error): void {
    this.errors.push(error);
    for (const handler of this.errorHandlers) handler(error);
  }

  private lost(error: Error): void {
    this.ownershipError = error;
    for (const handler of this.lostHandlers) handler(error);
  }

  private receive(line: string): void {
    let message: z.infer<typeof messageSchema>;
    try {
      message = messageSchema.parse(JSON.parse(line));
    } catch (error) {
      const failure = new Error('Invalid shell supervisor protocol', {
        cause: error,
      });
      this.fail(failure);
      this.lost(failure);
      this.stop();
      return;
    }
    if (message.event === 'stopping') {
      this.stopping = true;
      this.armDeadline();
    }
    if (message.event === 'result') this.resolveResult(message);
    if (message.event === 'error') this.fail(new Error(message.message));
  }
}
