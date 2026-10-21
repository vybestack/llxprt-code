/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let outDir = '';
let socketRoot = '';
beforeEach(async () => {
  outDir = await mkdtemp(path.join(os.tmpdir(), 'tmux-input-diagnostics-'));
  socketRoot = await mkdtemp(
    path.join(
      process.platform === 'win32' ? os.tmpdir() : '/tmp',
      'llxprt-td-',
    ),
  );
  const socketPath = path.join(
    await realpath(socketRoot),
    'llxprt-tmux-harness-XXXXXX',
    'tmux.sock',
  );
  const limit = process.platform === 'darwin' ? 104 : 108;
  if (process.platform !== 'win32' && Buffer.byteLength(socketPath) >= limit) {
    throw new Error(`Fixture socket path exceeds ${limit - 1} bytes`);
  }
});
afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
  await rm(socketRoot, { recursive: true, force: true });
});

function records(text: string): Array<Record<string, unknown>> {
  return text
    .trim()
    .split('\n')
    .map((line) => {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Expected an input diagnostic record');
      }
      return Object.fromEntries(Object.entries(value));
    });
}

async function submit(
  diagnostics: boolean,
  fail: boolean,
  pasteMode = 'on',
): Promise<{ status: number | null; diagnostics: string }> {
  const scriptPath = path.join(outDir, 'script.json');
  await writeFile(
    scriptPath,
    JSON.stringify({
      inputDiagnostics: diagnostics,
      tmux: { initialWaitMs: 0 },
      startCommand: [
        process.execPath,
        path.resolve('scripts/tests/fixtures/tmux-input-recorder.ts'),
        path.join(outDir, 'received.bin'),
        pasteMode,
      ],
      steps: [
        {
          type: 'waitFor',
          scope: 'screen',
          contains: 'FIXTURE_READY',
          timeoutMs: 5000,
        },
        {
          type: 'line',
          text: 'echo private-credential-value',
          submitKeys: ['Enter'],
          postTypeMs: 200,
        },
        {
          type: 'waitFor',
          scope: 'screen',
          contains: fail ? 'NEVER_EMITTED' : 'NATIVE_INPUT_RECEIVED',
          timeoutMs: fail ? 80 : 5000,
        },
        { type: 'key', key: 'C-d' },
        { type: 'waitForExit', timeoutMs: 5000 },
      ],
    }),
  );
  const result = spawnSync(
    'node',
    ['scripts/tmux-harness.ts', '--script', scriptPath, '--out-dir', outDir],
    {
      env: { ...process.env, TMPDIR: socketRoot },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    },
  );
  if (result.error) throw result.error;
  return {
    status: result.status,
    diagnostics: `harness exit=${result.status} signal=${result.signal}
${result.stderr}
${result.stdout}`.replaceAll('private-credential-value', '[redacted]'),
  };
}

describe('tmux harness input diagnostics over native terminal input', () => {
  it('records literal delivery and one real carriage return without persisting command contents', async () => {
    const result = await submit(true, false);
    expect(result.status, result.diagnostics).toBe(0);
    expect((await readFile(path.join(outDir, 'received.bin'))).toString()).toBe(
      'echo private-credential-value\r\u0004',
    );
    const text = await readFile(
      path.join(outDir, 'input-diagnostics.jsonl'),
      'utf8',
    );
    expect(text).not.toContain('private-credential-value');
    const trace = records(text);
    const lineTrace = trace.filter((row) => row['stepIndex'] === 1);
    expect(lineTrace.map((row) => row['phase'])).toEqual([
      'before-step',
      'before-type',
      'after-type',
      'before-key',
      'after-key',
      'after-step',
    ]);
    const beforeEnter = lineTrace.find((row) => row['phase'] === 'before-key');
    expect(beforeEnter?.['key']).toBe('Enter');
    expect(beforeEnter?.['shellPromptVisible']).toBe(true);
    const native = records(
      await readFile(path.join(outDir, 'received.bin.tmux.json'), 'utf8'),
    )[0];
    expect(native?.['bracket_paste_flag']).toMatch(/^1?$/);
    expect(native).toMatchObject({
      pane_in_mode: '0',
      pane_active: '1',
      buffer_size: '',
    });
    expect(beforeEnter?.['tmux']).toMatchObject({
      bracket_paste_flag:
        native?.['bracket_paste_flag'] === ''
          ? null
          : native?.['bracket_paste_flag'],
      pane_in_mode: '0',
      pane_active: '1',
      buffer_size: null,
    });
    expect(
      lineTrace.filter((row) => row['phase'] === 'before-key'),
    ).toHaveLength(1);
  }, 20000);

  it('preserves disabled and unavailable native format values without treating zero as unknown', async () => {
    const result = await submit(true, false, 'off');
    expect(result.status, result.diagnostics).toBe(0);
    const native = records(
      await readFile(path.join(outDir, 'received.bin.tmux.json'), 'utf8'),
    )[0];
    expect(native?.['bracket_paste_flag']).toMatch(/^0?$/);
    expect(native).toMatchObject({
      pane_in_mode: '0',
      pane_active: '1',
      buffer_size: '',
    });
    const trace = records(
      await readFile(path.join(outDir, 'input-diagnostics.jsonl'), 'utf8'),
    );
    const beforeEnter = trace.find(
      (row) => row['stepIndex'] === 1 && row['phase'] === 'before-key',
    );
    expect(beforeEnter?.['tmux']).toMatchObject({
      bracket_paste_flag:
        native?.['bracket_paste_flag'] === ''
          ? null
          : native?.['bracket_paste_flag'],
      pane_in_mode: '0',
      pane_active: '1',
      buffer_size: null,
    });
    expect((await readFile(path.join(outDir, 'received.bin'))).toString()).toBe(
      'echo private-credential-value\r\u0004',
    );
  }, 20000);

  it('preserves the original wait failure and captures terminal state without resubmitting', async () => {
    const result = await submit(true, true);
    expect(result.status, result.diagnostics).toBe(1);
    const text = await readFile(
      path.join(outDir, 'input-diagnostics.jsonl'),
      'utf8',
    );
    const trace = records(text);
    expect(trace.at(-1)).toMatchObject({ phase: 'failure', stepIndex: 2 });
    expect(trace.filter((row) => row['phase'] === 'before-key')).toHaveLength(
      1,
    );
    expect((await readFile(path.join(outDir, 'received.bin'))).toString()).toBe(
      'echo private-credential-value\r',
    );
    const failure = await readFile(path.join(outDir, 'error.json'), 'utf8');
    expect(failure).toContain('NEVER_EMITTED');
    expect(failure).toContain('Timed out');
  }, 20000);

  it('leaves uninstrumented scenarios without a diagnostic file', async () => {
    const result = await submit(false, false);
    expect(result.status, result.diagnostics).toBe(0);
    await expect(
      readFile(path.join(outDir, 'input-diagnostics.jsonl')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readFile(path.join(outDir, 'received.bin'))).toString()).toBe(
      'echo private-credential-value\r\u0004',
    );
  }, 20000);
});
