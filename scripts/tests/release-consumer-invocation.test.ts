/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { invokeConsumer } from './release-consumer-invocation.ts';

const probe = fileURLToPath(
  new URL('./issue-2603-windows-probe.ts', import.meta.url),
);

function probeRequest(): string {
  return (
    'LLXPRT_PROBE_B64=' +
    Buffer.from(
      JSON.stringify({ stdin: true, stderr: 'probe stderr', exit: 17 }),
    ).toString('base64url')
  );
}

describe('release consumer invocation', () => {
  it.each(['', 'without trailing newline', 'first line\n雪\nlast line\n'])(
    'delivers stdin through EOF and captures real probe argv, stderr and status: %j',
    async (input) => {
      const args = [probeRequest(), 'space value', 'amp&pipe|caret^bang!', '雪'];
      const result = await invokeConsumer(process.execPath, [probe, ...args], {
        env: process.env,
        input,
        timeout: 5000,
      });
      expect(result.status).toBe(17);
      expect(result.stderr).toBe('probe stderr');
      const line = result.stdout.trim();
      expect(line.startsWith('LLXPRT_PROBE:')).toBe(true);
      expect(JSON.parse(line.slice('LLXPRT_PROBE:'.length))).toMatchObject({
        argv: [process.execPath, probe, ...args],
        stdin: input,
        bunVersion: process.versions.bun,
      });
    },
  );

  it('gives a new consumer its own timeout budget after the synchronous loop has been idle', async () => {
    const warmup = spawnSync(process.execPath, ['-e', ''], {
      timeout: 5000,
    });
    expect(warmup.status).toBe(0);
    // Bun 1.3.14 on Windows caches spawnSync's loop clock; only the main loop
    // runs during this gap, which deliberately exceeds the next child's budget.
    await Bun.sleep(1500);
    const result = await invokeConsumer(process.execPath, [probe, probeRequest()], {
      env: process.env,
      input: 'after idle',
      timeout: 1000,
    });
    expect(result.status).toBe(17);
    expect(result.stdout).toContain('"stdin":"after idle"');
  }, 10_000);

  it('reports spawn failures instead of returning a consumer status', async () => {
    await expect(
      invokeConsumer('llxprt-missing-consumer-executable', [], {
        env: process.env,
        input: '',
        timeout: 1000,
      }),
    ).rejects.toThrow(/ENOENT/);
  });

  it('terminates a consumer that never exits instead of reporting success', async () => {
    await expect(
      invokeConsumer(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        env: process.env,
        input: '',
        timeout: 200,
      }),
    ).rejects.toThrow(/timed out/);
  });
});
