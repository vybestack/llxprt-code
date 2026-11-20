/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mock } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const mode = process.argv[2];
const controller = new AbortController();
const realOpen = fs.openSync;
const realClose = fs.closeSync;
const realRead = fs.readSync;
let opened = 0;
const handles = new Set<number>();
const allHandles = new Set<number>();
await mock.module('node:fs', () => ({
  ...fs,
  openSync(path: fs.PathLike, flags: string | number): number {
    const fd = realOpen(path, flags);
    allHandles.add(fd);
    if (String(path).endsWith('costs.jsonl')) {
      opened++;
      handles.add(fd);
    }
    return fd;
  },
  closeSync(fd: number): void {
    realClose(fd);
    handles.delete(fd);
    allHandles.delete(fd);
  },
  readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
  ): number {
    if (handles.has(fd)) {
      if (mode.endsWith('io')) throw new Error('media read interrupted');
      controller.abort(new Error('media cancellation'));
    }
    return realRead(fd, buffer, offset, length, position);
  },
}));
const root = fs.mkdtempSync(join(tmpdir(), 'media-reader-fault-'));
const directory = join(root, 'owned');
const workspaceDirectory = join(root, 'workspace');
fs.mkdirSync(directory);
fs.mkdirSync(workspaceDirectory);
const path = join(directory, 'costs.jsonl');
const input = join(directory, 'input');
fs.writeFileSync(input, '[{"role":"user","content":"before media failure"}]');
fs.writeFileSync(path, '{"cost":1844}\n');
const { Gpt56SourceProjection } = await import('./gpt56-source-projection.js');
const owner = new Gpt56SourceProjection({
  protocol: 'openai-responses',
  directory,
  segments: [{ promptKey: 'input', source: { path: input } }],
  imageCosts: { source: { path }, provider: 'openai', model: 'gpt-5.6' },
});
let rejected = false;
try {
  if (mode.startsWith('adapter')) {
    const { estimateGpt56PromptFromSources } = await import(
      './gpt56-source-prompt-estimator.js'
    );
    const pending = estimateGpt56PromptFromSources(
      {
        activeProvider: 'openai',
        canonicalModel: 'gpt-5.6',
        protocol: 'openai-responses',
        wireMethod: 'responses/v1',
        finalizedProjection: owner,
        projectionRevision: 4,
        legacyEstimate: () => Promise.reject(new Error('No fallback')),
      },
      { workspaceDirectory, signal: controller.signal },
    );
    const disposed = owner.dispose();
    try {
      await pending;
    } finally {
      await disposed;
    }
  } else {
    const lease = owner.acquire();
    try {
      await lease.countImageTokens(
        { provider: 'openai', model: 'gpt-5.6' },
        controller.signal,
      );
    } finally {
      await lease();
    }
  }
} catch {
  rejected = true;
} finally {
  await owner.dispose();
}
fs.writeFileSync(
  process.argv[3],
  JSON.stringify({
    rejected,
    opened,
    remaining: allHandles.size,
    disposed: !fs.existsSync(directory),
    workspaceEmpty: fs.readdirSync(workspaceDirectory).length === 0,
  }),
);
fs.rmSync(root, { recursive: true, force: true });
