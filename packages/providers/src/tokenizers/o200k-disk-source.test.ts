/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { get_encoding } from '@dqbd/tiktoken';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countO200kBaseTokensFromDiskSource } from './o200k-disk-source.js';
import { estimateGpt56Prompt } from './Gpt56O200kPromptEstimator.js';
import { differentialTexts, adverseTexts } from './o200k-disk-test-data.js';

const encoder = get_encoding('o200k_base');
let root: string;
let workspace: string;
function largeSource(): string {
  const path = join(root, 'source');
  writeFileSync(path, '');
  for (let index = 0; index < 512; index++)
    appendFileSync(path, 'a'.repeat(65536));
  return path;
}

async function countText(
  text: string,
  encoding: 'utf8' | 'utf16le' = 'utf8',
): Promise<number> {
  const path = join(root, 'source');
  writeFileSync(path, text, encoding);
  const result = await countO200kBaseTokensFromDiskSource(
    { path, encoding },
    { workspaceDirectory: workspace },
  );
  expect(readdirSync(workspace)).toStrictEqual([]);
  return result;
}

function ordinary(text: string): number {
  return encoder.encode_ordinary(text).length;
}

function testRows(): void {
  describe('cross-row boundaries', () => {
    it('counts the entire two-row JSON segment as 19 rather than 21', async () => {
      const rows = ['hello', 'world'].map((content) =>
        JSON.stringify({ role: 'user', content }),
      );
      const text = `[${rows.join(',')}]`;
      expect(ordinary(text)).toBe(19);
      expect(
        ['[', rows[0], ',', rows[1], ']'].reduce(
          (sum, part) => sum + ordinary(part),
          0,
        ),
      ).toBe(21);
      expect(await countText(text)).toBe(19);
    });
    it('counts 520 letters as 20 rather than the 128-byte split count of 34', async () => {
      const text = 'abcdefghijklmnopqrstuvwxyz'.repeat(20);
      const fragments = Array.from(
        { length: Math.ceil(text.length / 128) },
        (_, index) => text.slice(index * 128, (index + 1) * 128),
      );
      expect(ordinary(text)).toBe(20);
      expect(fragments.reduce((sum, part) => sum + ordinary(part), 0)).toBe(34);
      expect(await countText(text)).toBe(20);
    });
    it('preserves punctuation across 64 escaped CRLF rows', async () => {
      const rows = Array.from({ length: 64 }, (_, index) => ({
        role: 'user',
        content: `${index}: 雪🙂\r\n\\"\t\b\f`,
      }));
      const text = JSON.stringify(rows);
      expect(await countText(text)).toBe(ordinary(text));
    });
  });
}

function testDifferential(): void {
  describe('differential cases', () => {
    it('matches ordered alternatives, scripts, numbers, whitespace and ordinary special text', async () => {
      for (const text of adverseTexts()) {
        expect(await countText(text)).toBe(ordinary(text));
      }
    });
    it('matches deterministic randomized whole-string ordinary BPE', async () => {
      for (const text of differentialTexts(2048, 854)) {
        expect(await countText(text)).toBe(ordinary(text));
      }
    }, 180000);
    it('repairs isolated surrogates and preserves a pair spanning a disk read', async () => {
      const text = `${'x'.repeat(32767)}\ud83d\ude42\ud800X\udc00\ud800\ud800\udc00\ufeff雪`;
      expect(await countText(text, 'utf16le')).toBe(ordinary(text));
    }, 180000);
    it('preserves UTF-8 characters across every alignment of the fixed read buffer', async () => {
      for (let offset = 65531; offset < 65537; offset++) {
        const text = `${'alpha '.repeat(Math.floor(offset / 6))}${'x'.repeat(offset % 6)}🙂雪\r\n ABc'd`;
        expect(await countText(text)).toBe(ordinary(text));
      }
    }, 180000);
  });
}

function testFailures(): void {
  describe('failure cleanup', () => {
    it('cleans up on a pre-aborted request', async () => {
      const controller = new AbortController();
      controller.abort(new Error('cancel-before-open'));
      const path = join(root, 'source');
      writeFileSync(path, 'hello');
      await expect(
        countO200kBaseTokensFromDiskSource(
          { path },
          { workspaceDirectory: workspace, signal: controller.signal },
        ),
      ).rejects.toThrow('cancel-before-open');
      expect(readdirSync(workspace)).toStrictEqual([]);
    });
    it('cleans up when cancellation arrives during source processing', async () => {
      const path = largeSource();
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error('cancel-during-read')),
        5,
      );
      try {
        await expect(
          countO200kBaseTokensFromDiskSource(
            { path },
            { workspaceDirectory: workspace, signal: controller.signal },
          ),
        ).rejects.toThrow('cancel-during-read');
      } finally {
        clearTimeout(timer);
      }
      expect(readdirSync(workspace)).toStrictEqual([]);
    }, 180000);
    it('cleans up when a later cancellation interrupts counting', async () => {
      const path = largeSource();
      const later = new AbortController();
      const laterTimer = setTimeout(
        () => later.abort(new Error('cancel-later-work')),
        1500,
      );
      try {
        await expect(
          countO200kBaseTokensFromDiskSource(
            { path },
            { workspaceDirectory: workspace, signal: later.signal },
          ),
        ).rejects.toThrow('cancel-later-work');
      } finally {
        clearTimeout(laterTimer);
      }
      expect(readdirSync(workspace)).toStrictEqual([]);
    }, 180000);
    it('releases temporary workspace when the source does not exist', async () => {
      await expect(
        countO200kBaseTokensFromDiskSource(
          { path: join(root, 'absent') },
          { workspaceDirectory: workspace },
        ),
      ).rejects.toThrow('ENOENT');
      expect(readdirSync(workspace)).toStrictEqual([]);
    });
    it('propagates workspace filesystem errors without touching the source', async () => {
      const path = join(root, 'source');
      const invalidWorkspace = join(root, 'not-a-directory');
      writeFileSync(path, 'hello');
      writeFileSync(invalidWorkspace, 'occupied');
      await expect(
        countO200kBaseTokensFromDiskSource(
          { path },
          { workspaceDirectory: invalidWorkspace },
        ),
      ).rejects.toThrow('ENOTDIR');
      expect(ordinary(await Bun.file(path).text())).toBe(1);
    });
  });
}

function testIdentity(): void {
  describe('estimator identity', () => {
    it('agrees with the existing GPT-5.6 estimator without changing its identity', async () => {
      const segments = [
        JSON.stringify([
          { role: 'user', content: '雪🙂\r\n hello' },
          { role: 'user', content: 'world' },
        ]),
        'Keep contractions and <|endoftext|> ordinary.',
      ];
      const result = await estimateGpt56Prompt({
        activeProvider: 'openai',
        canonicalModel: 'gpt-5.6',
        protocol: 'openai-responses',
        wireMethod: 'responses/v1',
        finalizedProjection: {
          kind: 'llxprt-provider-prompt-v3',
          protocol: 'openai-responses',
          promptText: 'unused',
          promptSegments: segments,
        },
        projectionRevision: 4,
        legacyEstimate: () => Promise.reject(new Error('unreachable')),
      });
      let count = 0;
      for (const text of segments) count += await countText(text);
      expect(result).toStrictEqual({
        count,
        method: 'exact',
        family: 'openai-gpt-5.6',
        estimatorVersion: 'gpt-5.6-o200k-v2',
        assetRevision:
          'o200k_base:446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d:@dqbd/tiktoken@1.0.22',
        projectionRevision: 4,
      });
    });
  });
}

describe('disk source ordinary o200k_base count', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'o200k-disk-test-'));
    workspace = join(root, 'workspace');
    mkdirSync(workspace);
  });
  afterAll(() => {
    encoder.free();
    rmSync(root, { recursive: true, force: true });
  });

  testRows();
  testDifferential();
  testFailures();
  testIdentity();
});
