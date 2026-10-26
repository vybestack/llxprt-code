/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';

describe('Realistic journal-backed sends', () => {
  for (const control of [false, true]) {
    it(`Codex WebSocket journal-backed 25000-row send ${control ? 'rejects whole-history buffering' : 'preserves bytes within the retained-memory bound'}`, async () => {
      const child = Bun.spawn(
        [
          process.execPath,
          `${import.meta.dir}/realistic-websocket-worker.ts`,
          ...(control ? ['--control'] : []),
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({
        exit,
        stderr: exit === 0 ? '' : stderr,
        diagnostics: exit === 0 ? '' : stdout,
      }).toStrictEqual({ exit: 0, stderr: '', diagnostics: '' });
      process.stdout.write(stdout);
      expect(stdout).toContain('"selectedRowCount":25000');
    }, 180000);
  }
});
