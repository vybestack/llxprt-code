/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

describe('isolated wire hash sink ownership', () => {
  it.each(['close', 'disconnect'])(
    'releases the hash sink and inherited pipes after %s',
    async (mode) => {
      const child = spawn(
        process.execPath,
        [
          join(import.meta.dir, 'support/wire-hash-sink-worker.ts'),
          'openai-chat-plain',
        ],
        { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
      );
      const exited = new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          child.once('error', reject);
          child.once('message', () => resolve());
        });
        if (mode === 'close') child.send('close');
        else child.disconnect();
        const timeout = setTimeout(() => child.kill(), 5000);
        try {
          expect(await exited).toBe(0);
        } finally {
          clearTimeout(timeout);
        }
      } finally {
        child.kill();
        await exited;
      }
    },
  );
});
