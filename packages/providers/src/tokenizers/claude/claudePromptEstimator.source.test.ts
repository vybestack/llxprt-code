/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 E5: the calibrated Claude family estimates a sealed disk prompt
 * (estimator-form segment files) exactly as it estimates the whole-body
 * projection of the same request, without joining the prompt into one string.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  RuntimePromptEstimateRequest,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { createRuntimeTokenizerFactory } from '../../composition/runtimeTokenizerFactory.js';
import {
  PROJECTION_REVISION,
  projectAnthropicPromptEnvelope,
} from '../../runtime/promptEnvelopeProjections.js';
import { projectBodyFromSegments } from '../../runtime/__tests__/support/promptBodySegments.js';
import { withGpt56DiskSources } from '../gpt56-disk-tokenizer-factory.js';
import { SourceFamilyInput } from '../source-family-input.js';

const MODEL = 'claude-opus-5';
const scratch = mkdtempSync(join(tmpdir(), 'claude-source-'));
const baseFactory = createRuntimeTokenizerFactory();

function png(width: number, height: number): string {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
}

/** 3-byte and 4-byte characters so 64 KiB read blocks end inside a character. */
const BLOCK_STRADDLING_TEXT = `${'雪 mixed text. '.repeat(9000)}😀 tail\n\n  end`;

const BODIES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  [
    'block-straddling multibyte text',
    {
      model: MODEL,
      system: 'Be brief.',
      messages: [{ role: 'user', content: BLOCK_STRADDLING_TEXT }],
    },
  ],
  [
    'a system block array, tools and images of several sizes',
    {
      model: MODEL,
      system: [
        {
          type: 'text',
          text: 'Describe images.',
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: png(1586, 991),
              },
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: png(32, 32),
              },
            },
          ],
        },
      ],
      tools: [{ name: 'read_file', input_schema: { type: 'object' } }],
    },
  ],
  [
    'a raw system string with escapes and a data URI',
    {
      model: MODEL,
      system: `a "q" \\ \n\t 雪 data:image/png;base64,${png(40, 41)} end`,
      messages: [{ role: 'user', content: 'hi' }],
    },
  ],
  ['no messages', { model: MODEL, messages: [] }],
];

function request(finalizedProjection: unknown): RuntimePromptEstimateRequest {
  return {
    activeProvider: 'anthropic',
    canonicalModel: MODEL,
    protocol: 'anthropic-messages',
    wireMethod: 'messages/v1',
    finalizedProjection,
    projectionRevision: PROJECTION_REVISION,
    legacyEstimate: () =>
      Promise.reject(new Error('source route must not use the array legacy')),
  };
}

describe('calibrated Claude estimate over sealed segments (issue #854 E5)', () => {
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  for (const [name, body] of BODIES) {
    it(`${name} equals the whole-body count`, async () => {
      const projection = await projectBodyFromSegments(
        'anthropic-messages',
        body,
        MODEL,
      );
      try {
        const expected = await baseFactory.estimatePrompt(
          request(projectAnthropicPromptEnvelope(body).finalizedProjection),
        );
        const actual = await withGpt56DiskSources(
          baseFactory,
          scratch,
        ).estimatePrompt(request(projection));
        expect(actual).toStrictEqual(expected);
        expect(actual.method).toBe('calibrated');
      } finally {
        await projection.dispose();
      }
    });
  }

  it('hands the family the sealed segments, never prompt text', async () => {
    const [, body] = BODIES[0];
    const projection = await projectBodyFromSegments(
      'anthropic-messages',
      body,
      MODEL,
    );
    const seen: unknown[] = [];
    const trapFactory: RuntimeTokenizerFactory = {
      ...baseFactory,
      estimatePrompt: (req) => {
        seen.push(req.finalizedProjection);
        return baseFactory.estimatePrompt(req);
      },
    };
    try {
      await withGpt56DiskSources(trapFactory, scratch).estimatePrompt(
        request(projection),
      );
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBeInstanceOf(SourceFamilyInput);
    } finally {
      await projection.dispose();
    }
  });

  it('refuses a source projection of another protocol', async () => {
    const projection = await projectBodyFromSegments(
      'openai-chat',
      { model: MODEL, messages: [{ role: 'user', content: 'hi' }] },
      MODEL,
    );
    try {
      await expect(
        withGpt56DiskSources(baseFactory, scratch).estimatePrompt(
          request(projection),
        ),
      ).rejects.toThrow('projection-unavailable');
    } finally {
      await projection.dispose();
    }
  });
  describe('large-source parity', () => {
    it('estimates 2 MiB of mixed text exactly', async () => {
      const unit =
        'snow 雪 grin 😀 quote " slash \\ line\n code(x) { return 42; }\n';
      const text = unit.repeat(Math.ceil((2 * 1024 * 1024) / unit.length));
      const body = {
        model: MODEL,
        messages: [{ role: 'user', content: text }],
      };
      const projection = await projectBodyFromSegments(
        'anthropic-messages',
        body,
        MODEL,
      );
      try {
        const factory = withGpt56DiskSources(baseFactory, scratch);
        const started = performance.now();
        const actual = await factory.estimatePrompt(request(projection));
        const elapsed = performance.now() - started;
        const expected = await baseFactory.estimatePrompt(
          request(projectAnthropicPromptEnvelope(body).finalizedProjection),
        );
        expect(actual).toStrictEqual(expected);
        process.stdout.write(
          JSON.stringify({ case: 'claude-source-2MiB', elapsed }) + '\n',
        );
      } finally {
        await projection.dispose();
      }
    }, 60000);
  });
});
