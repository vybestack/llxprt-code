/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShellJobManager } from './shellJobManager.js';
import { deadline, processGone } from './shell-terminal-test-helper.js';

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function untilGone(pid: number): Promise<void> {
  await deadline(
    (async () => {
      while (!processGone(pid)) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    })(),
  );
}

it.skipIf(process.platform === 'win32')(
  'disposal joins a TERM-ignoring same-group child after command exit',
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shell-descendant-'));
    const heartbeat = join(dir, 'heartbeat');
    const manager = new ShellJobManager({
      baseDir: join(dir, 'logs'),
      maxBackgroundJobs: 1,
    });
    const server = createServer();
    let socket: Socket | undefined;
    let childPid: number | undefined;
    let leaderPid: number | undefined;
    try {
      const connected = new Promise<Socket>((resolve) =>
        server.once('connection', resolve),
      );
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('Missing fixture port');
      const childCode = `
      process.on('SIGTERM', () => {});
      const socket = require('node:net').connect(${address.port}, '127.0.0.1');
      const beat = () => require('node:fs').appendFileSync(${JSON.stringify(heartbeat)}, 'beat\\n');
      socket.on('connect', () => { beat(); socket.write(process.pid + ' ' + process.ppid + '\\n'); });
      let buffer = '';
      socket.on('data', data => {
        buffer += data.toString();
        while (buffer.includes('\\n')) {
          const end = buffer.indexOf('\\n');
          const command = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (command === 'beat') { beat(); socket.write('beat\\n'); }
          if (command === 'exit-leader') process.send('exit-leader');
          if (command === 'stop') process.kill(process.pid, 'SIGKILL');
        }
      });
      socket.on('close', () => process.exit(0));
    `;
      const leaderCode = `
      const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      child.on('message', () => process.exit(0));
      child.on('exit', () => process.exit(0));
    `;
      const completed = new Promise<void>((resolve) =>
        manager.onJobCompleted(() => resolve()),
      );
      const job = manager.launch({
        command: `exec node -e ${quote(leaderCode)}`,
        cwd: dir,
      });
      if (job.pid === undefined) throw new Error('Missing supervisor PID');
      socket = await deadline(connected);
      const [ready] = await deadline(once(socket, 'data'));
      [childPid, leaderPid] = String(ready).trim().split(' ').map(Number);
      const group = spawnSync('ps', ['-o', 'pgid=', '-p', String(childPid)], {
        encoding: 'utf8',
      });
      expect(group.status).toBe(0);
      expect(Number(group.stdout.trim())).toBe(job.pid);
      socket.write('exit-leader\n');
      await deadline(completed);
      expect(manager.get(job.id)?.exitCode).toBe(0);
      await untilGone(leaderPid);
      await deadline(manager.dispose());
      const before = readFileSync(heartbeat, 'utf8');
      let acknowledged = false;
      if (!socket.destroyed) {
        const response = Promise.race([
          once(socket, 'data').then(() => {
            acknowledged = true;
          }),
          once(socket, 'close').then(() => undefined),
        ]);
        socket.write('beat\n');
        await deadline(response);
      }
      expect({
        absent: processGone(childPid),
        acknowledged,
        advanced: before !== readFileSync(heartbeat, 'utf8'),
      }).toStrictEqual({ absent: true, acknowledged: false, advanced: false });
    } finally {
      if (socket !== undefined && !socket.destroyed) {
        const closed = once(socket, 'close');
        socket.write('stop\n');
        await deadline(closed);
      }
      if (childPid !== undefined) await untilGone(childPid);
      if (leaderPid !== undefined) await untilGone(leaderPid);
      socket?.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await deadline(manager.dispose());
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30000,
);
