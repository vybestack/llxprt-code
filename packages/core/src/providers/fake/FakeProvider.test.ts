/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FakeProvider } from './FakeProvider.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('FakeProvider', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'fake-provider-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('replays chunks in order across turns', async () => {
    const filePath = join(tempDir, 'responses.jsonl');
    writeFileSync(
      filePath,
      [
        JSON.stringify({
          chunks: [
            { speaker: 'ai', blocks: [{ type: 'text', text: 'hello' }] },
            { speaker: 'ai', blocks: [{ type: 'text', text: ' world' }] },
          ],
        }),
        JSON.stringify({
          chunks: [{ speaker: 'ai', blocks: [{ type: 'text', text: 'bye' }] }],
        }),
      ].join('\n'),
      'utf-8',
    );

    const provider = new FakeProvider(filePath);

    const firstTurn: string[] = [];
    for await (const chunk of provider.generateChatCompletion([])) {
      const text = chunk.blocks.find((b) => b.type === 'text');
      if (text && 'text' in text) firstTurn.push(text.text);
    }

    const secondTurn: string[] = [];
    for await (const chunk of provider.generateChatCompletion([])) {
      const text = chunk.blocks.find((b) => b.type === 'text');
      if (text && 'text' in text) secondTurn.push(text.text);
    }

    expect(firstTurn.join('')).toBe('hello world');
    expect(secondTurn.join('')).toBe('bye');
  });

  it('substitutes {{CWD}} placeholders recursively', async () => {
    const filePath = join(tempDir, 'responses.jsonl');
    writeFileSync(
      filePath,
      JSON.stringify({
        chunks: [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: '1',
                name: 'run',
                parameters: {
                  cwd: '{{CWD}}',
                  nested: { arr: ['{{CWD}}/a'] },
                },
              },
            ],
          },
        ],
      }),
      'utf-8',
    );

    const provider = new FakeProvider(filePath, '/tmp/work');
    const chunks: unknown[] = [];
    for await (const chunk of provider.generateChatCompletion([])) {
      chunks.push(chunk);
    }

    const json = JSON.stringify(chunks[0]);
    expect(json).toContain('/tmp/work');
    expect(json).toContain('/tmp/work/a');
  });

  it('throws when responses are exhausted', async () => {
    const filePath = join(tempDir, 'responses.jsonl');
    writeFileSync(
      filePath,
      JSON.stringify({
        chunks: [{ speaker: 'ai', blocks: [{ type: 'text', text: 'one' }] }],
      }),
      'utf-8',
    );

    const provider = new FakeProvider(filePath);

    // consume first turn
    for await (const _chunk of provider.generateChatCompletion([])) {
      // noop
    }

    await expect(async () => {
      for await (const _chunk of provider.generateChatCompletion([])) {
        // noop
      }
    }).rejects.toThrow(/no more canned responses/);
  });

  it('returns fake auth token and model metadata', async () => {
    const filePath = join(tempDir, 'responses.jsonl');
    writeFileSync(
      filePath,
      JSON.stringify({
        chunks: [{ speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] }],
      }),
      'utf-8',
    );

    const provider = new FakeProvider(filePath);

    expect(await provider.getAuthToken()).toBe('fake-auth-token');
    expect(provider.getDefaultModel()).toBe('fake-model');
    expect(provider.getCurrentModel()).toBe('fake-model');
    expect(provider.getServerTools()).toStrictEqual([]);

    await expect(provider.invokeServerTool()).rejects.toThrow(
      /does not support server tools/,
    );

    const models = await provider.getModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('fake-model');
  });

  it('supports legacy method/response fixture lines', async () => {
    const filePath = join(tempDir, 'legacy.responses.jsonl');
    writeFileSync(
      filePath,
      JSON.stringify({
        method: 'generateContentStream',
        response: [
          {
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [{ text: 'legacy fixture output' }],
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 3,
              candidatesTokenCount: 5,
              totalTokenCount: 8,
            },
          },
        ],
      }),
      'utf-8',
    );

    const provider = new FakeProvider(filePath);

    const chunks: unknown[] = [];
    for await (const chunk of provider.generateChatCompletion([])) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    const first = chunks[0] as {
      speaker: string;
      blocks: Array<{ type: string; text?: string }>;
      metadata?: { stopReason?: string; usage?: { totalTokens?: number } };
    };
    expect(first.speaker).toBe('ai');
    expect(first.blocks[0]).toMatchObject({
      type: 'text',
      text: 'legacy fixture output',
    });
    expect(first.metadata?.stopReason).toBe('stop');
    expect(first.metadata?.usage?.totalTokens).toBe(8);
  });

  it('preserves stopReason for metadata-only legacy candidates', async () => {
    const filePath = join(tempDir, 'legacy-stop-only.responses.jsonl');
    writeFileSync(
      filePath,
      JSON.stringify({
        method: 'generateContentStream',
        response: {
          candidates: [
            {
              finishReason: 'STOP',
            },
          ],
        },
      }),
      'utf-8',
    );

    const provider = new FakeProvider(filePath);

    const chunks: unknown[] = [];
    for await (const chunk of provider.generateChatCompletion([])) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    const first = chunks[0] as {
      blocks: unknown[];
      metadata?: { stopReason?: string };
    };
    expect(first.blocks).toStrictEqual([]);
    expect(first.metadata?.stopReason).toBe('stop');
  });

  it('throws on invalid legacy response payloads', () => {
    const filePath = join(tempDir, 'legacy-invalid.responses.jsonl');
    writeFileSync(
      filePath,
      JSON.stringify({
        method: 'generateContentStream',
        response: true,
      }),
      'utf-8',
    );

    expect(() => new FakeProvider(filePath)).toThrow(
      /invalid legacy fixture line/i,
    );
  });
});
