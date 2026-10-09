/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { initializeEvidenceLane } from '../lib/body-evidence-writer.js';

function rootForProcess(): string {
  const scratch = process.env.BODY_EVIDENCE_TEST_SCRATCH;
  if (!scratch) throw new Error('Declare evidence test scratch');
  const parent = mkdtempSync(join(scratch, 'process-'));
  const root = join(parent, 'evidence');
  initializeEvidenceLane(root);
  return root;
}

function worker(
  mode: string,
  root: string,
  label: string,
): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, 'body-evidence-process-helper.ts'),
      mode,
      root,
      label,
    ],
    {
      stdout: Bun.file(join(root, `${label}.stdout.log`)),
      stderr: Bun.file(join(root, `${label}.stderr.log`)),
    },
  );
}

async function waitForReady(root: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (existsSync(join(root, 'ready'))) return;
    await setTimeout(10);
  }
  throw new Error('Worker did not start its evidence stream');
}

describe('BODY evidence process lifecycle', () => {
  it('preserves JSONL records from concurrent processes', async () => {
    const root = rootForProcess();
    const workers = ['a', 'b', 'c'].map((label) =>
      worker('append', root, label),
    );
    const codes = await Promise.all(workers.map((child) => child.exited));
    writeFileSync(
      join(root, 'process-results.json'),
      JSON.stringify({ labels: ['a', 'b', 'c'], exits: codes }),
      { flag: 'wx' },
    );
    expect(codes).toEqual([0, 0, 0]);
    const lines = readFileSync(join(root, 'concurrent.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(lines).toHaveLength(12);
    const records: unknown[] = lines.map((line) => JSON.parse(line));
    expect(new Set(records.map((row) => JSON.stringify(row))).size).toBe(12);
    expect(
      readdirSync(root).filter((name) => name.endsWith('.body.gz')),
    ).toHaveLength(24);
  });

  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGKILL'];
  it.each(signals)('keeps incomplete evidence after %s', async (signal) => {
    const root = rootForProcess();
    const child = worker('interrupt', root, signal);
    await waitForReady(root);
    child.kill(signal);
    const exit = await child.exited;
    writeFileSync(
      join(root, 'process-result.json'),
      JSON.stringify({ attempt: signal, exit, signal, incomplete: true }),
      { flag: 'wx' },
    );
    expect(exit).not.toBe(0);
    const names = readdirSync(root).filter((name) =>
      name.endsWith('.receipt.json'),
    );
    expect(names).toHaveLength(1);
    const text = readFileSync(join(root, names[0]), 'utf8');
    expect(text).toContain('"incomplete":true');
    expect(text).not.toContain('"exit":0');
    expect(
      readdirSync(root).filter((name) => name.endsWith('.body.gz')),
    ).toHaveLength(0);
  });
});
