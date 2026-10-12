/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShellJobManager, type ShellJob } from './shellJobManager.js';

type FixtureJob = ShellJob & {
  pid: number;
  supervisorPid: number;
  logPath: string;
};

// Hang guard only: passing runs never wait this long. It must exceed subprocess
// startup plus the manager's 2s log-cap poll on a CPU-starved CI runner.
const FIXTURE_DEADLINE_MS = 15000;

export async function deadline<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Shell fixture deadline exceeded')),
          FIXTURE_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Freezes the job's supervisor so its fixed SIGTERM-to-SIGKILL grace (200ms)
 * cannot expire while a test asserts on a still-live writer. Returns an
 * idempotent resume function.
 */
export function suspendSupervisor(job: { supervisorPid: number }): () => void {
  process.kill(job.supervisorPid, 'SIGSTOP');
  let resumed = false;
  return () => {
    if (resumed) return;
    resumed = true;
    process.kill(job.supervisorPid, 'SIGCONT');
  };
}

export function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'ESRCH') return true;
      if (error.code === 'EPERM') return false;
    }
    throw error;
  }
}

async function reap(pid: number): Promise<void> {
  const end = Date.now() + FIXTURE_DEADLINE_MS;
  while (!processGone(pid)) {
    if (Date.now() >= end)
      throw new Error(`Owned process ${pid} was not reaped`);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function awaitReadiness(server: Server, sockets: Socket[]): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once('connection', (socket) => {
      sockets.push(socket);
      socket.on('error', reject);
      let buffer = '';
      socket.on('data', (data) => {
        buffer += data.toString();
        if (buffer.includes('\n')) resolve(Number(buffer.trim()));
      });
    });
  });
}

function fixtureCode(port: number): string {
  return `
        let terms = 0;
        let sequence = 0;
        let writing = false;
        let awaitingTerm = false;
        process.on('SIGTERM', () => { terms++; if (awaitingTerm) { awaitingTerm = false; socket.write('term\\n'); } });
        const beat = () => require('node:fs').appendFileSync('heartbeat-' + process.pid, ++sequence + '\\n');
        const socket = require('node:net').connect(${port}, '127.0.0.1', () => {
          beat();
          socket.write(process.pid + '\\n');
        });
        let buffer = '';
        socket.on('data', data => {
          buffer += data.toString();
          while (buffer.includes('\\n')) {
            const end = buffer.indexOf('\\n');
            const command = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            if (command === 'term') {
              if (terms > 0) socket.write('term\\n');
              else awaitingTerm = true;
              continue;
            }
            if (command === 'crash-owner') {
              process.kill(process.ppid, 'SIGKILL');
              socket.write('owner-gone\\n');
              continue;
            }
            if (command === 'stop') process.kill(process.pid, 'SIGKILL');
            if (command === 'cap') {
              writing = true;
              process.stdout.write('x'.repeat(4096));
              socket.write('cap\\n');
            } else if (command === 'beat') {
              beat();
              socket.write(terms + '\\n');
            } else {
              process.exit(Number(command));
            }
          }
        });
        socket.on('close', () => process.exit(0));
        setInterval(() => {
          beat();
          if (writing) process.stdout.write('x'.repeat(128));
        }, 10);
      `;
}

function request(socket: Socket, command: string): Promise<string> {
  const response = new Promise<string>((resolve) => {
    let buffer = '';
    const onData = (data: Buffer): void => {
      buffer += data.toString();
      if (!buffer.includes('\n')) return;
      socket.off('data', onData);
      resolve(buffer.trim());
    };
    socket.on('data', onData);
  });
  socket.write(`${command}\n`);
  return deadline(response);
}

export async function withTerminalFixture(
  run: (
    manager: ShellJobManager,
    launch: () => Promise<FixtureJob>,
    exit: (code: number) => void,
    request: (
      command: 'cap' | 'beat' | 'term' | 'crash-owner',
    ) => Promise<string>,
  ) => Promise<AggregateError | void>,
  options?: { logMaxBytes: number },
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'shell-terminal-'));
  const manager = new ShellJobManager({
    baseDir: join(dir, 'logs'),
    maxBackgroundJobs: 1,
    ...options,
  });
  const server = createServer();
  const sockets: Socket[] = [];
  const pids: number[] = [];
  const failures: unknown[] = [];
  let expectedDisposalError: AggregateError | void = undefined;
  try {
    await listen(server);
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing fixture port');
    const launch = async (): Promise<FixtureJob> => {
      const ready = awaitReadiness(server, sockets);
      const job = manager.launch({
        command: `exec node -e ${quote(fixtureCode(address.port))}`,
        cwd: dir,
      });
      if (job.pid === undefined || job.pid <= 1)
        throw new Error('Missing owned PID');
      const readyPid = await deadline(ready);
      pids.push(readyPid);
      assertOwnedGroup(readyPid, job.pid);
      return {
        ...job,
        pid: readyPid,
        supervisorPid: job.pid,
        logPath: join(dir, 'logs', `${job.id}.log`),
      };
    };
    expectedDisposalError = await run(
      manager,
      launch,
      (code) =>
        sockets[sockets.length - 1].write(`${code}
`),
      (command) => request(sockets[sockets.length - 1], command),
    );
  } catch (error) {
    failures.push(error);
  } finally {
    await stopFixtures(sockets);
    for (const pid of pids) {
      try {
        await reap(pid);
      } catch (error) {
        failures.push(error);
      }
    }
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const disposed = await Promise.allSettled([deadline(manager.dispose())]);
    for (const outcome of disposed) {
      if (
        outcome.status === 'rejected' &&
        outcome.reason !== expectedDisposalError
      ) {
        failures.push(outcome.reason);
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'Shell fixture failed');
}

async function stopFixtures(sockets: Socket[]): Promise<void> {
  for (const socket of sockets) {
    if (!socket.destroyed) {
      const closed = once(socket, 'close');
      socket.write('stop\n');
      await deadline(closed);
    }
  }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function assertOwnedGroup(pid: number, pgid: number): void {
  const group = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
    encoding: 'utf8',
  });
  if (group.status !== 0 || Number(group.stdout.trim()) !== pgid)
    throw new Error('Fixture is not in the owned supervisor group');
}
