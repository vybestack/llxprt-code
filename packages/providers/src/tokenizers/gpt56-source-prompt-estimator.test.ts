/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimePromptEstimateRequest } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import {
  estimateGpt56Prompt,
  GPT_56_ASSET_REVISION,
  GPT_56_ESTIMATOR_FAMILY,
  GPT_56_ESTIMATOR_VERSION,
} from './Gpt56O200kPromptEstimator.js';
import { Gpt56SourceProjection } from './gpt56-source-projection.js';
import { estimateGpt56PromptFromSources } from './gpt56-source-prompt-estimator.js';
import { diskAssets } from './o200k-disk-assets.js';

const twoRows =
  '[{"role":"user","content":"hello"},{"role":"user","content":"world"}]';
let root: string;
let workspace: string;
let owners: Gpt56SourceProjection[];

describe('GPT-5.6 source adapter', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gpt56-source-adapter-'));
    workspace = join(root, 'count-workspace');
    mkdirSync(workspace);
    owners = [];
  });
  afterEach(async () => {
    await Promise.all(owners.map((owner) => owner.dispose()));
    rmSync(root, { recursive: true, force: true });
  });
  testOptIn();
  testDescriptors();
  testImages();
  testFailures();
  testLarge();
});

function projection(
  text = twoRows,
  encoding: 'utf8' | 'utf16le' = 'utf8',
): Gpt56SourceProjection {
  const directory = mkdtempSync(join(root, 'owned-'));
  const path = join(directory, 'input');
  writeFileSync(path, text, encoding);
  const owner = new Gpt56SourceProjection({
    protocol: 'openai-responses',
    directory,
    segments: [{ promptKey: 'input', source: { path, encoding } }],
  });
  owners.push(owner);
  return owner;
}

function request(finalizedProjection: unknown): RuntimePromptEstimateRequest {
  return {
    activeProvider: 'codex-alias',
    canonicalModel: 'gpt-5.6-sol',
    protocol: 'openai-responses',
    wireMethod: 'responses/v1',
    finalizedProjection,
    projectionRevision: 4,
    legacyEstimate: () => Promise.reject(new Error('legacy is forbidden')),
  };
}

function estimate(owner: unknown, signal?: AbortSignal) {
  return estimateGpt56PromptFromSources(request(owner), {
    workspaceDirectory: workspace,
    signal,
  });
}

function largeProjection(size: number): Gpt56SourceProjection {
  const directory = mkdtempSync(join(root, 'owned-'));
  const path = join(directory, 'input');
  writeFileSync(path, '');
  for (let left = size; left > 0; left -= 65536) {
    appendFileSync(path, 'a'.repeat(Math.min(65536, left)));
  }
  const owner = new Gpt56SourceProjection({
    protocol: 'openai-responses',
    directory,
    segments: [{ promptKey: 'input', source: { path } }],
  });
  owners.push(owner);
  return owner;
}

function testOptIn(): void {
  describe('opt-in GPT-5.6 source estimation', () => {
    it('counts one whole prompt-key segment as 19, not the per-row sum of 21', async () => {
      const owner = projection();
      const actual = await estimate(owner);
      const existing = await estimateGpt56Prompt(
        request({
          kind: 'llxprt-provider-prompt-v3',
          protocol: 'openai-responses',
          promptText: twoRows,
          promptSegments: [twoRows],
        }),
      );
      expect(actual).toStrictEqual(existing);
      expect(actual).toStrictEqual({
        count: 19,
        method: 'exact',
        family: GPT_56_ESTIMATOR_FAMILY,
        estimatorVersion: GPT_56_ESTIMATOR_VERSION,
        assetRevision: GPT_56_ASSET_REVISION,
        projectionRevision: 4,
      });
      expect(actual.count).not.toBe(21);
      expect(JSON.stringify(owner)).not.toContain('hello');
      expect(JSON.stringify(actual)).not.toContain('hello');
    });

    it('requires opt-in and refuses a source projection in the existing string entry point', async () => {
      await expect(
        estimateGpt56Prompt(request(projection())),
      ).rejects.toMatchObject({
        code: 'tokenization-failed',
      });
    });

    it('refuses string or lookalike projections without reading or falling back', async () => {
      for (const invalid of [
        {
          kind: 'llxprt-provider-prompt-v3',
          protocol: 'openai-responses',
          promptText: 'secret',
        },
        Object.freeze({
          kind: 'llxprt-gpt56-source-prompt-v1',
          protocol: 'openai-responses',
          promptSegments: [],
        }),
      ]) {
        await expect(estimate(invalid)).rejects.toMatchObject({
          code: 'tokenization-failed',
        });
      }
      expect(readdirSync(workspace)).toStrictEqual([]);
    });
  });
}

function testDescriptors(): void {
  describe('source descriptors and encoding', () => {
    it('freezes segment descriptors independently of caller arrays and objects', async () => {
      const directory = mkdtempSync(join(root, 'owned-'));
      const path = join(directory, 'input');
      writeFileSync(path, twoRows);
      const source: { path: string; encoding: 'utf8' } = {
        path,
        encoding: 'utf8',
      };
      const segments: Array<{ promptKey: 'input'; source: typeof source }> = [
        { promptKey: 'input', source },
      ];
      const owner = new Gpt56SourceProjection({
        protocol: 'openai-responses',
        directory,
        segments,
      });
      owners.push(owner);
      source.path = join(directory, 'absent');
      segments.length = 0;
      expect(Object.isFrozen(owner)).toBe(true);
      expect(Object.isFrozen(owner.promptSegments)).toBe(true);
      expect(Object.isFrozen(owner.promptSegments[0])).toBe(true);
      expect(Object.isFrozen(owner.promptSegments[0].source)).toBe(true);
      expect((await estimate(owner)).count).toBe(19);
    });

    it('rejects duplicate prompt keys instead of accepting per-row segments', () => {
      const owner = projection();
      expect(
        () =>
          new Gpt56SourceProjection({
            protocol: owner.protocol,
            directory: join(owner.promptSegments[0].source.path, '..'),
            segments: [owner.promptSegments[0], owner.promptSegments[0]],
          }),
      ).toThrow('Duplicate prompt key');
    });

    it('rejects a protocol mismatch before counting', async () => {
      await expect(
        estimateGpt56PromptFromSources(
          { ...request(projection()), protocol: 'openai-chat' },
          {
            workspaceDirectory: workspace,
          },
        ),
      ).rejects.toMatchObject({ code: 'tokenization-failed' });
      expect(readdirSync(workspace)).toStrictEqual([]);
    });

    it('preserves JavaScript surrogate repair via an explicitly UTF-16 source', async () => {
      const text = `${'x'.repeat(32767)}\ud83d\ude42\ud800X\udc00\ufeff雪`;
      const actual = await estimate(projection(text, 'utf16le'));
      const expected = await estimateGpt56Prompt(
        request({
          kind: 'llxprt-provider-prompt-v3',
          protocol: 'openai-responses',
          promptText: text,
        }),
      );
      expect(actual).toStrictEqual(expected);
    }, 180000);
  });
}

function testImages(): void {
  describe('source segment and image parity', () => {
    it('counts each prompt key separately and adds each image cost with identical metadata', async () => {
      const directory = mkdtempSync(join(root, 'owned-'));
      const input = join(directory, 'input');
      const instructions = join(directory, 'instructions');
      writeFileSync(input, twoRows);
      writeFileSync(instructions, 'Keep <|endoftext|> ordinary.');
      const imageEntries = [{ dimensions: { width: 1586, height: 991 } }, {}];
      const costs = join(directory, 'image-costs.jsonl');
      writeFileSync(
        costs,
        `{"cost":1844,"dimensions":{"width":1586,"height":991}}
{"cost":1844}
`,
      );
      const owner = new Gpt56SourceProjection({
        protocol: 'openai-responses',
        directory,
        segments: [
          { promptKey: 'instructions', source: { path: instructions } },
          { promptKey: 'input', source: { path: input } },
        ],
        imageCosts: {
          source: { path: costs },
          provider: 'openai-responses',
          model: 'gpt-5.6',
        },
      });
      owners.push(owner);
      const actual = await estimate(owner);
      const expected = await estimateGpt56Prompt(
        request({
          kind: 'llxprt-provider-prompt-v3',
          protocol: 'openai-responses',
          promptText: 'unused',
          promptSegments: ['Keep <|endoftext|> ordinary.', twoRows],
          imageEntries,
        }),
      );
      const textOnly = await estimate(projection());
      expect(actual).toStrictEqual(expected);
      expect(actual.count).toBeGreaterThan(textOnly.count + 1844 * 2);
      expect(Object.isFrozen(owner.imageCosts)).toBe(true);
      expect(Object.isFrozen(owner.imageCosts?.source)).toBe(true);
    });

    it('supports multiple independent concurrent reads with equal results and no scratch retention', async () => {
      const owner = projection();
      const results = await Promise.all([
        estimate(owner),
        estimate(owner),
        estimate(owner),
      ]);
      expect(results.map((result) => result.count)).toStrictEqual([19, 19, 19]);
      expect(readdirSync(workspace)).toStrictEqual([]);
      expect(existsSync(owner.promptSegments[0].source.path)).toBe(true);
    });

    it('keeps the source owner live through estimation even if disposal starts immediately', async () => {
      const owner = projection('abcdefghijklmnopqrstuvwxyz'.repeat(20));
      const path = owner.promptSegments[0].source.path;
      const pending = estimate(owner);
      const disposed = owner.dispose();
      expect(existsSync(path)).toBe(true);
      expect((await pending).count).toBe(20);
      await disposed;
      expect(existsSync(path)).toBe(false);
      await expect(estimate(owner)).rejects.toMatchObject({
        code: 'tokenization-failed',
      });
    });
  });
}

function testFailures(): void {
  describe('source failures and cancellation', () => {
    it('releases a pre-aborted lease and exposes only typed scalar error metadata', async () => {
      const owner = projection();
      const controller = new AbortController();
      controller.abort(new Error('cancel-before-read'));
      await expect(estimate(owner, controller.signal)).rejects.toMatchObject({
        code: 'tokenization-failed',
        cause: controller.signal.reason,
      });
      await owner.dispose();
      expect(existsSync(owner.promptSegments[0].source.path)).toBe(false);
      expect(readdirSync(workspace)).toStrictEqual([]);
    });

    it.each([5, 1500])(
      'closes disk readers and releases the owner when cancelled after %i ms',
      async (delay) => {
        const owner = largeProjection(32 * 1024 * 1024);
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(new Error('cancel-disk-count')),
          delay,
        );
        const pending = estimate(owner, controller.signal);
        const disposed = owner.dispose();
        try {
          const error: unknown = await pending.then(
            () => {
              throw new Error('Expected cancellation to reject');
            },
            (reason: unknown) => reason,
          );
          expect(error).toMatchObject({
            code: 'tokenization-failed',
            cause: controller.signal.reason,
          });
          expect(controller.signal.aborted).toBe(true);
          await disposed;
          expect(existsSync(owner.promptSegments[0].source.path)).toBe(false);
          expect(readdirSync(workspace)).toStrictEqual([]);
        } finally {
          clearTimeout(timer);
        }
      },
      180000,
    );

    it('propagates missing-source I/O failure without leaking workspace or prompt content', async () => {
      const owner = projection();
      rmSync(owner.promptSegments[0].source.path);
      await expect(estimate(owner)).rejects.toMatchObject({
        code: 'tokenization-failed',
        cause: expect.objectContaining({ code: 'ENOENT' }),
      });
      await owner.dispose();
      expect(readdirSync(workspace)).toStrictEqual([]);
    });

    it('propagates workspace I/O failure and still releases the source owner', async () => {
      const owner = projection();
      const invalid = join(root, 'not-directory');
      writeFileSync(invalid, 'occupied');
      const pending = estimateGpt56PromptFromSources(request(owner), {
        workspaceDirectory: invalid,
      });
      const disposed = owner.dispose();
      await expect(pending).rejects.toMatchObject({
        code: 'tokenization-failed',
        cause: expect.objectContaining({ code: 'ENOTDIR' }),
      });
      await disposed;
      expect(existsSync(owner.promptSegments[0].source.path)).toBe(false);
    });
  });
}

function testLarge(): void {
  describe('large disk-only adapter evidence, not native parity', () => {
    it('derives the 8m+1 repeated-a recurrence from the complete pinned asset', async () => {
      const ranks = [...diskAssets().ranks.entries()]
        .filter(([bytes]) => /^a+$/.test(bytes))
        .map(([bytes, rank]) => ({ length: bytes.length, rank }))
        .sort((left, right) => left.length - right.length);
      expect(ranks).toStrictEqual([
        { length: 1, rank: 64 },
        { length: 2, rank: 3545 },
        { length: 3, rank: 55894 },
        { length: 4, rank: 45037 },
        { length: 8, rank: 117525 },
      ]);
      for (const size of [1, 9, 17, 65]) {
        expect((await estimate(largeProjection(size))).count).toBe(
          (size - 1) / 8 + 1,
        );
      }
    });
    it('counts a real >10 MiB single-piece segment and its disk-only append metamorphism', async () => {
      const size = 10 * 1024 * 1024 + 1;
      const owner = largeProjection(size);
      const path = owner.promptSegments[0].source.path;
      expect(statSync(path).size).toBeGreaterThan(10 * 1024 * 1024);
      const first = await estimate(owner);
      const independent = await estimate(owner);
      expect(size % 8).toBe(1);
      expect(first.count).toBe((size - 1) / 8 + 1);
      expect(independent).toStrictEqual(first);
      await owner.dispose();
      const extended = largeProjection(size + 8);
      const next = await estimate(extended);
      expect(next.count).toBe(first.count + 1);
      expect(next.method).toBe('exact');
      expect(readdirSync(workspace)).toStrictEqual([]);
    }, 600000);
  });
}
