/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Deterministic, realistic mixed text for the repeated-turn workload: prose,
 * identifiers, numbers and code-like lines, so the tokenizer and the heap see
 * varied content rather than one repeated phrase. Each (seed, size) pair
 * always yields the same text, and different seeds yield different text, so a
 * retained row is a distinct allocation of about `size` bytes.
 */

const WORDS = [
  'session',
  'journal',
  'history',
  'request',
  'context',
  'segment',
  'compress',
  'reader',
  'stream',
  'provider',
  'tool',
  'result',
  'message',
  'window',
  'budget',
  'token',
  'cache',
  'checkpoint',
  'snapshot',
  'record',
  'update',
  'analysis',
  'because',
  'however',
  'therefore',
  'the',
  'a',
  'of',
  'and',
  'to',
  'in',
  'with',
  'for',
  'on',
  'is',
  'was',
  'should',
  'would',
  'could',
  'after',
  'before',
  'between',
  'across',
  'without',
  'during',
  'each',
  'every',
  'several',
  'remaining',
  'previous',
  'current',
  'pending',
  'complete',
  'failed',
  'retry',
  'timeout',
  'latency',
  'throughput',
  'memory',
  'allocation',
  'release',
  'owner',
  'reference',
  'identity',
  'version',
  'schema',
  'migration',
  'index',
  'offset',
  'length',
  'buffer',
  'chunk',
  'frame',
  'queue',
  'worker',
  'thread',
  'process',
  'handler',
  'listener',
  'registry',
  'resolver',
  'parser',
  'encoder',
  'decoder',
  'validator',
  'iterator',
  'generator',
  'adapter',
  'factory',
  'service',
  'client',
  'server',
  'endpoint',
  'payload',
  'header',
  'status',
  'error',
  'warning',
  'notice',
  'summary',
  'detail',
  'question',
  'answer',
  'example',
  'option',
  'setting',
  'default',
  'limit',
  'threshold',
  'ratio',
  'average',
  'maximum',
  'minimum',
];

const CODE_LINES = [
  'const rows = await history.snapshot({ pending, signal });',
  'for await (const row of reader) { total += row.blocks.length; }',
  'if (budget.remaining < threshold) return compress(segment);',
  'export function resolve(id: string): Entry | undefined { return table.get(id); }',
  "logger.debug('flush', { offset, length, status: 'ok' });",
  'await Promise.all(tasks.map((task) => task.run(context)));',
];

/** mulberry32: small seeded generator, enough for reproducible filler text. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

function sentence(random: () => number): string {
  const length = 6 + Math.floor(random() * 12);
  const words = Array.from({ length }, () => pick(random, WORDS));
  return words.join(' ');
}

/** Returns `size` characters (ASCII, so also `size` bytes) of mixed text. */
export function mixedText(seed: number, size: number): string {
  const random = seededRandom(seed);
  const parts: string[] = [];
  let length = 0;
  while (length < size) {
    const roll = random();
    let piece: string;
    if (roll < 0.7) piece = `${sentence(random)}. `;
    else if (roll < 0.85) piece = `\n${pick(random, CODE_LINES)}\n`;
    else if (roll < 0.95)
      piece = `id=${Math.floor(random() * 1e9).toString(16)} n=${Math.floor(random() * 100000)} `;
    else piece = `\n\n`;
    parts.push(piece);
    length += piece.length;
  }
  return parts.join('').slice(0, size);
}
