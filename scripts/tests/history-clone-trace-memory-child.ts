/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import { readFileSync } from 'node:fs';
import { withSuffixFixture } from '../../packages/core/src/services/history/history-suffix-test-helpers.js';

async function settleHeap(): Promise<NodeJS.MemoryUsage> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gcAndSweep();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gcAndSweep();
  return { ...process.memoryUsage(), heapUsed: heapSize() };
}

async function* cachedTrap(
  source: AsyncIterable<object>,
): AsyncGenerator<object, void, unknown> {
  const rows = await Array.fromAsync(source);
  yield* rows;
}

const pin = readFileSync(
  new URL('../../.bun-version', import.meta.url),
  'utf8',
).trim();
if (Bun.version !== pin)
  throw new Error(`Expected Bun ${pin}; got ${Bun.version}`);
const size = Number(process.argv[2]);
const query = process.argv[3];
const trap = process.argv[4] === 'trap';
if (
  !Number.isSafeInteger(size) ||
  size < 1 ||
  (query !== 'clone' && query !== 'trace')
) {
  throw new Error('Expected positive row count and clone/trace query');
}
await withSuffixFixture(32, async (service) => {
  for await (const row of service.clone()) void row;
  for await (const entry of service.getChronologyTrace()) void entry;
});
await withSuffixFixture(
  size,
  async (service, ownership) => {
    const before = await settleHeap();
    const source =
      query === 'clone' ? service.clone() : service.getChronologyTrace();
    const iterator = (trap ? cachedTrap(source) : source)[
      Symbol.asyncIterator
    ]();
    try {
      const first = await iterator.next();
      if (first.done) throw new Error('Missing row');
      const held = await settleHeap();
      process.stdout.write(
        JSON.stringify({
          size,
          query,
          trap,
          heap: held.heapUsed - before.heapUsed,
          external: held.external - before.external,
        }) + '\n',
      );
    } finally {
      await iterator.return();
    }
    if (ownership.snapshot().liveRows !== 0)
      throw new Error('Unreleased iterator owner');
  },
  2048,
);
