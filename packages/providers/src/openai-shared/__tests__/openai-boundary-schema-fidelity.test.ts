/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { activeRequestBodyCount } from '../../utils/requestScopedBody.js';
import { expectedBoundaryBody } from './openai-boundary-oracle.js';
import {
  optionsFor,
  providerFor,
  responseFor,
  textAt,
  tools,
  type BoundaryProvider,
} from './openai-boundary-fixtures.js';

type ToolMode = 'nonempty' | 'empty' | 'omitted';
function digest(wire: string): string {
  return createHash('sha256').update(wire).digest('hex');
}
async function captureBody(
  name: BoundaryProvider,
  rows: number,
  padding: number,
  mode: ToolMode,
): Promise<string> {
  let pulled = 0;
  let opens = 0;
  let closed = false;
  const contents: AsyncIterable<IContent> = {
    async *[Symbol.asyncIterator]() {
      opens += 1;
      try {
        for (let index = 0; index < rows; index += 1) {
          pulled += 1;
          yield {
            speaker: index % 2 === 0 ? 'human' : 'ai',
            blocks: [{ type: 'text', text: textAt(index, padding) }],
          };
        }
      } finally {
        closed = true;
      }
    },
  };
  let declarations = mode === 'nonempty' ? tools : undefined;
  if (mode === 'empty') declarations = [];
  const options = optionsFor(name, contents, declarations);
  const original = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      expect(String(input)).toBe(
        'https://boundary.invalid/v1/chat/completions',
      );
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer boundary-key',
      );
      if (init?.body == null) throw Error('Missing HTTP body');
      bodies.push(await new Response(init.body).text());
      return responseFor(name);
    },
    { preconnect: original.preconnect },
  );
  try {
    for await (const chunk of providerFor(name).generateChatCompletion(options))
      void chunk;
    expect({ pulled, opens, closed }).toStrictEqual({
      pulled: rows,
      opens: 1,
      closed: true,
    });
    expect(activeRequestBodyCount()).toBe(0);
    expect(bodies).toHaveLength(1);
    return bodies[0];
  } finally {
    globalThis.fetch = original;
  }
}
async function observeBody(
  name: BoundaryProvider,
  rows: number,
  padding: number,
  mode: ToolMode,
): Promise<{ actual: string; expected: string }> {
  const actual = await captureBody(name, rows, padding, mode);
  const expected = expectedBoundaryBody(
    name,
    rows,
    padding,
    mode === 'nonempty',
  );
  const evidence = process.env['BOUNDARY_EVIDENCE_DIR'];
  if (evidence !== undefined) {
    const label = `${name}-${rows}-${padding}-${mode}`;
    writeFileSync(join(evidence, `${label}-actual.json`), actual);
    writeFileSync(join(evidence, `${label}-expected.json`), expected);
    writeFileSync(
      join(evidence, `${label}-digest.json`),
      JSON.stringify({
        actual: digest(actual),
        expected: digest(expected),
        bytes: Buffer.byteLength(actual),
      }),
    );
  }
  return { actual, expected };
}
describe('OpenAI provider HTTP schema and complete body fidelity', () => {
  for (const name of ['openai', 'openai-vercel'] satisfies BoundaryProvider[]) {
    for (const [rows, padding] of [
      [512, 0],
      [8192, 0],
      [8192, 1200],
    ]) {
      for (const mode of [
        'nonempty',
        'empty',
        'omitted',
      ] satisfies ToolMode[]) {
        it(`${name} ${rows}/${padding} ${mode}`, async () => {
          const { actual, expected } = await observeBody(
            name,
            rows,
            padding,
            mode,
          );
          expect(actual).toBe(expected);
          expect(Buffer.byteLength(actual)).toBe(Buffer.byteLength(expected));
          expect(digest(actual)).toBe(digest(expected));
          const minimumBytes = padding > 0 ? 9 * 1024 * 1024 : 0;
          expect(Buffer.byteLength(actual)).toBeGreaterThan(minimumBytes);
        }, 180000);
      }
    }
  }
});
