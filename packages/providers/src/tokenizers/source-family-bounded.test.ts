/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #854 (review F9): official and legacy source-family estimation keeps
 * every string handed to a tokenizer bounded, with counts equal to the
 * whole-string route.
 */
import { afterAll, describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimePromptEstimateRequest } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import {
  countPromptTokens,
  PROJECTION_REVISION,
} from '../runtime/promptEnvelopeProjections.js';
import { Gpt56SourceProjection } from './gpt56-source-projection.js';
import { withGpt56DiskSources } from './gpt56-disk-tokenizer-factory.js';
import { getO200kBaseEncoder } from './o200kBaseCounter.js';
import { TiktokenRuntime } from './official/tiktokenRuntime.js';

const scratch = mkdtempSync(join(tmpdir(), 'source-family-bounded-'));
const baseFactory = createRuntimeTokenizerFactory();
const TOOLS_TEXT = '[{"type":"function"}]';
let sequence = 0;

/** About 700 KB of mixed text: many 64 KiB read blocks and many chunks. */
const LONG_TEXT = '雪 mixed text, 12345. "quoted" it\'s 😀\n'.repeat(18_000);

function sealed(messages: string): Gpt56SourceProjection {
  const directory = join(scratch, `case-${sequence++}`);
  mkdirSync(directory, { recursive: true });
  const messagesPath = join(directory, 'messages');
  const toolsPath = join(directory, 'tools');
  writeFileSync(messagesPath, messages);
  writeFileSync(toolsPath, TOOLS_TEXT);
  return new Gpt56SourceProjection({
    protocol: 'openai-chat',
    directory,
    segments: [
      { promptKey: 'messages', source: { path: messagesPath } },
      { promptKey: 'tools', source: { path: toolsPath } },
    ],
  });
}

function request(
  model: string,
  finalizedProjection: unknown,
  legacyEstimate: () => Promise<number>,
): RuntimePromptEstimateRequest {
  return {
    activeProvider: 'zai',
    canonicalModel: model,
    protocol: 'openai-chat',
    wireMethod: 'chat/completions/v1',
    finalizedProjection,
    projectionRevision: PROJECTION_REVISION,
    legacyEstimate,
  };
}

async function sourceCount(model: string, messages: string): Promise<number> {
  const projection = sealed(messages);
  try {
    const result = await withGpt56DiskSources(
      baseFactory,
      scratch,
    ).estimatePrompt(
      request(model, projection, () => Promise.reject(new Error('no'))),
    );
    return result.count;
  } finally {
    await projection.dispose();
  }
}

function arrayCount(model: string, messages: string): Promise<number> {
  const promptText = `{"messages":${messages},"tools":${TOOLS_TEXT}}`;
  return baseFactory
    .estimatePrompt(
      request(
        model,
        {
          kind: 'llxprt-provider-prompt-v3',
          protocol: 'openai-chat',
          promptText,
          promptSegments: [messages, TOOLS_TEXT],
        },
        () => Promise.resolve(countPromptTokens(promptText)),
      ),
    )
    .then((result) => result.count);
}

describe('official estimators hand the tokenizer bounded text (issue #854 F9)', () => {
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  for (const model of ['glm-5.2', 'minimax-m3', 'kimi-k3']) {
    it(`${model}: no tokenizer call sees a context-sized string, count equals whole`, async () => {
      const lengths: number[] = [];
      const original = TiktokenRuntime.prototype.countOrdinary;
      const spy = spyOn(
        TiktokenRuntime.prototype,
        'countOrdinary',
      ).mockImplementation(function (this: TiktokenRuntime, text: string) {
        lengths.push(text.length);
        return original.call(this, text);
      });
      let counted: number;
      try {
        counted = await sourceCount(model, LONG_TEXT);
      } finally {
        spy.mockRestore();
      }
      // The old route handed the tokenizer the whole segment in one call.
      expect(lengths.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(
        LONG_TEXT.length,
      );
      expect(Math.max(...lengths)).toBeLessThan(150_000);
      expect(Math.max(...lengths)).toBeLessThan(LONG_TEXT.length / 3);
      expect(lengths.length).toBeGreaterThanOrEqual(5);
      lengths.length = 0;
      const spy2 = spyOn(
        TiktokenRuntime.prototype,
        'countOrdinary',
      ).mockImplementation(function (this: TiktokenRuntime, text: string) {
        lengths.push(text.length);
        return original.call(this, text);
      });
      try {
        // Control: the whole-string array route trips the very same bound.
        const expected = await arrayCount(model, LONG_TEXT);
        expect(Math.max(...lengths)).toBeGreaterThanOrEqual(LONG_TEXT.length);
        expect(counted).toBe(expected);
      } finally {
        spy2.mockRestore();
      }
    });
  }
});

describe('legacy estimator streams the prompt (issue #854 F9)', () => {
  const near64KiB = 'a'.repeat(65_536 - 5);
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['plain long text', LONG_TEXT],
    [
      'special string straddling a read block',
      `${near64KiB}<|endoftext|> tail`,
    ],
    ['endofprompt special straddling', `${near64KiB}<|endofprompt|> tail`],
    ['near-miss special', `${near64KiB}<|endoftext| tail <|endofprompt|`],
    [
      'special in the middle of long text',
      `${LONG_TEXT}<|endoftext|>${LONG_TEXT}`,
    ],
  ];
  for (const [name, text] of cases) {
    it(`${name}: equals the whole-string estimate`, async () => {
      expect(await sourceCount('unregistered-model-x', text)).toBe(
        await arrayCount('unregistered-model-x', text),
      );
    });
  }

  it('special-token text takes the length/3 fallback exactly', async () => {
    const text = `${near64KiB}<|endoftext|> tail`;
    const length = `{"messages":${text},"tools":${TOOLS_TEXT}}`.length;
    expect(await sourceCount('unregistered-model-x', text)).toBe(
      Math.ceil(length / 3),
    );
  });

  it('encodes only bounded chunks that add up to the prompt', async () => {
    const encoder = await getO200kBaseEncoder();
    const lengths: number[] = [];
    const original = encoder.encode.bind(encoder);
    const spy = spyOn(encoder, 'encode').mockImplementation(((
      text: string,
      ...rest: [never?, never?]
    ) => {
      lengths.push(text.length);
      return original(text, ...rest);
    }) as typeof encoder.encode);
    let counted: number;
    try {
      counted = await sourceCount('unregistered-model-x', LONG_TEXT);
    } finally {
      spy.mockRestore();
    }
    const prompt = `{"messages":${LONG_TEXT},"tools":${TOOLS_TEXT}}`;
    // Every character reaches the bounded counter, none as one big string.
    expect(lengths.reduce((a, b) => a + b, 0)).toBe(prompt.length);
    expect(Math.max(...lengths)).toBeLessThan(100_000);
    expect(counted).toBe(await arrayCount('unregistered-model-x', LONG_TEXT));
  });
});
