/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spyOn } from 'bun:test';
import * as fs from 'node:fs';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { serializeResponsesPromptEnvelope } from './responses-source-serializer.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

const fifo = process.argv[2];
const before = new Set(fs.readdirSync(getScratchRoot()));
const controller = new AbortController();
const reason = new Error('abort queued during a synchronous disk write');
setImmediate(() => {
  controller.abort(reason);
  fs.writeFileSync(fifo + '.aborted', 'abort fired');
  fs.writeSync(1, 'abort-fired\n');
});
const write = spyOn(fs, 'writeSync').mockImplementation((fd, buffer) => {
  write.mockRestore();
  fs.writeSync(1, 'write-blocked\n');
  fs.writeFileSync(fifo + '.blocked', 'write entered');
  const gate = fs.openSync(fifo, 'r');
  try {
    fs.readSync(gate, Buffer.alloc(1), 0, 1, null);
  } finally {
    fs.closeSync(gate);
  }
  const bytes = typeof buffer === 'string' ? Buffer.from(buffer) : buffer;
  return fs.writeSync(fd, bytes);
});
async function* contents(): AsyncIterable<IContent> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  yield {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'no body after abort' }],
  };
}
const pending = serializeResponsesPromptEnvelope({
  model: 'gpt-5.6',
  contents: contents(),
  signal: controller.signal,
  context: {
    includeReasoningInContext: false,
    mediaPdfEnabled: true,
    outputLimiterConfig: { getEphemeralSettings: () => ({}) },
    debug: (): void => {},
  },
});
const outcome = await pending.then(
  () => 'resolved',
  (error: unknown) => (error === reason ? 'aborted' : 'wrong error'),
);
const cleanup = await pending.cleanup;
fs.writeFileSync(
  fifo + '.result',
  JSON.stringify({
    outcome,
    cleanup,
    leaked: fs
      .readdirSync(getScratchRoot())
      .filter((name) => !before.has(name)),
  }),
);
