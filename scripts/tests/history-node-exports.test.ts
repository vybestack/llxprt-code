/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
// Runs against built output, so it belongs to the scripts shard, which builds
// the workspaces before it runs (the package shards resolve TypeScript source).
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const exports: ReadonlyArray<readonly [string, string]> = [
  ['services/history/detachedHistoryJournal.js', 'DetachedHistoryJournal'],
  ['services/history/compression-span-index.js', 'CompressionSpanIndex'],
  ['services/history/historyMutationOwnership.js', 'trackMutationOwners'],
  ['services/history/historyBatchContracts.js', 'validateHistoryEntry'],
  ['storage/history-media-index.js', 'HistoryMediaIndex'],
  ['storage/media-reference-lifecycle.js', 'collectMediaReferences'],
];

function importUnderNode(
  program: string,
  probe: Record<string, string>,
): number | null {
  const result = spawnSync('node', ['--input-type=module', '-e', program], {
    cwd: root,
    env: { ...process.env, ...probe },
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0) throw result.error ?? new Error(result.stderr);
  return result.status;
}

describe('public history runtime exports', () => {
  it.each(exports)(
    'loads %s and its %s API under default Node conditions',
    (path, name) => {
      expect(
        importUnderNode(
          `
import assert from 'node:assert/strict';
const api = await import(process.env.PROBE_SPECIFIER);
assert.equal(typeof api[process.env.PROBE_EXPORT], 'function');
`,
          {
            PROBE_SPECIFIER: '@vybestack/llxprt-code-core/' + path,
            PROBE_EXPORT: name,
          },
        ),
      ).toBe(0);
    },
  );

  it.each([
    '@vybestack/llxprt-code-agents',
    '@vybestack/llxprt-code-zed-acp',
    './packages/cli/dist/src/cli.js',
  ])('loads the production %s module without Bun test APIs', (specifier) => {
    expect(
      importUnderNode('await import(process.env.PROBE_SPECIFIER);', {
        PROBE_SPECIFIER: specifier,
      }),
    ).toBe(0);
  });
});
