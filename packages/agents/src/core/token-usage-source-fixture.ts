/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { TokenCountFn } from './tokenUsageRequestShape.js';

export function independentSeed() {
  return z
    .object({ shape: z.record(z.unknown()), state: z.unknown() })
    .parse(
      JSON.parse(
        readFileSync(
          join(
            process.cwd(),
            'tmp/source-shape-disk-20261009-sol/seed-oracle.json',
          ),
          'utf8',
        ),
      ),
    );
}
export const shapeCases = [
  'stable',
  'changed',
  'anonymous',
  'fifo',
  'large',
  'schema',
  'empty',
] as const;
export type ShapeCase = (typeof shapeCases)[number];
export const fallbackCount: TokenCountFn = (text) => Math.ceil(text.length / 3);
export const sourceTextUnit =
  'Snow 雪 😀 quoted " slash \\ line\nnext sentence. ';

export function shapeRow(
  mode: ShapeCase,
  index: number,
  send: number,
): IContent {
  const large = mode === 'large' && index === 31;
  const repeats = large
    ? Math.ceil((10 * 1024 * 1024 + 1) / sourceTextUnit.length)
    : 3;
  const text = `${index}:` + sourceTextUnit.repeat(repeats);
  const id =
    mode === 'changed' && send === 1 && index === 0
      ? 'replacement'
      : `row-${index}`;
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks:
      mode === 'empty'
        ? []
        : [
            { type: 'text', text },
            { type: 'text', text: `tail ${index}` },
          ],
    metadata: {
      ...(mode === 'anonymous' || mode === 'empty' ? {} : { id }),
      synthetic: index % 7 === 0,
    },
  };
}
export function shapePending(send: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `Pending normalized text ${send} 雪 😀` }],
    metadata: { id: `pending-${send}`, synthetic: true },
  };
}
export function shapeHead(mode: ShapeCase, send: number) {
  return {
    instructionsText: `System 雪 😀 ${mode === 'changed' ? send : 0}\u0000tail`,
    tools: [
      {
        z: true,
        parameters: {
          description:
            mode === 'schema' ? sourceTextUnit.repeat(24000) : 'small',
          shared: { b: 2, a: 1 },
        },
        name: 'sample',
      },
    ],
  };
}
export function shapeCapacity(mode: ShapeCase): number {
  return mode === 'fifo' ? 8 : 128;
}
export function seedTool(): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'prior-call',
        toolName: 'prior',
        result: 'previous result',
      },
    ],
  };
}
export function shapeState(memory: {
  measurementCount: number;
  sentCallIdCount: number;
  get: (key: string) => unknown;
}) {
  const keys = [
    'blocks:tr:prior-call',
    ...Array.from({ length: 64 }, (_, index) => `row-${index}:2`),
    'replacement:2',
    'pending-0:1',
    'pending-1:1',
  ];
  return {
    measurementCount: memory.measurementCount,
    sentCallIdCount: memory.sentCallIdCount,
    entries: keys.map((key) => [key, memory.get(key) ?? null]),
  };
}
