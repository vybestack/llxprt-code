/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import net from 'node:net';

export async function waitForFixtureProcessExit(pid: number): Promise<void> {
  if (await waitUntilStopped(pid)) return;
  spawnSync('kill', ['-KILL', String(pid)]);
  if (await waitUntilStopped(pid)) return;
  throw new Error(`Proxy fixture process ${pid} did not exit`);
}

async function waitUntilStopped(pid: number): Promise<boolean> {
  const deadline = Date.now() + 2000;
  while (
    Date.now() < deadline &&
    spawnSync('kill', ['-0', String(pid)]).status === 0
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return spawnSync('kill', ['-0', String(pid)]).status !== 0;
}

export async function assertSeatbeltProxyPortAvailable(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(8877, '127.0.0.1', () => {
      server.close((error) => {
        server.removeListener('error', onError);
        if (error) reject(error);
        else resolve();
      });
    });
  });
}
