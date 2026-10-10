/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import { setImmediate } from 'node:timers/promises';

export function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

export async function deadline<T>(
  operation: Promise<T>,
  boundary: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`Shell owner boundary timed out: ${boundary}`)),
          8000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function shellOwnerGate(): Promise<{
  url: string;
  entered(name: string): Promise<void>;
  release(name: string): void;
  connected(name: string): boolean;
  stop(): Promise<void>;
}> {
  const entries = new Map<
    string,
    {
      ready: ReturnType<typeof deferred<void>>;
      response?: ServerResponse;
      connected: boolean;
    }
  >();
  function entry(name: string): NonNullable<ReturnType<typeof entries.get>> {
    const existing = entries.get(name);
    if (existing) return existing;
    const created = { ready: deferred<void>(), connected: false };
    entries.set(name, created);
    return created;
  }
  const server = createServer((request, response) => {
    const current = entry((request.url ?? '').slice(1));
    current.response = response;
    current.connected = true;
    response.on('close', () => {
      current.connected = false;
    });
    current.ready.resolve();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Expected local HTTP gate address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    entered: (name) => deadline(entry(name).ready.promise, `${name} entered`),
    release: (name) => {
      const response = entry(name).response;
      if (!response) throw new Error(`Workload ${name} has not entered`);
      if (!response.destroyed) response.end('release');
    },
    connected: (name) => entry(name).connected,
    stop: async () => {
      for (const current of entries.values()) {
        if (current.response && !current.response.destroyed)
          current.response.end('stop');
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function awaitShellGroupAbsence(pgid: number): Promise<void> {
  const until = Date.now() + 8000;
  for (;;) {
    try {
      process.kill(-pgid, 0);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
        return;
      throw error;
    }
    if (Date.now() > until)
      throw new Error(`Shell group ${pgid} survived disposal`);
    await setImmediate();
  }
}
