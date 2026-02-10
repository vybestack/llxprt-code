/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FakeProvider } from './FakeProvider.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IContent } from '../../services/history/IContent.js';

describe('FakeProvider', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `fake-provider-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeResponses(filename: string, ...turns: IContent[][]) {
    const lines = turns.map((chunks) => JSON.stringify({ chunks }));
    writeFileSync(join(tempDir, filename), lines.join('\n'));
    return join(tempDir, filename);
  }

  it('yields chunks from successive turns in order', async () => {
    const path = writeResponses(
      'basic.jsonl',
      [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_1',
              name: 'read_file',
              parameters: { file_path: '/tmp/test.txt' },
            },
          ],
        },
      ],
      [
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Done reading.' }],
        },
      ],
    );

    const provider = new FakeProvider(path);

    // First call
    const chunks1: IContent[] = [];
    for await (const chunk of provider.generateChatCompletion([])) {
      chunks1.push(chunk);
    }
    expect(chunks1).toHaveLength(1);
    expect(chunks1[0].blocks[0].type).toBe('tool_call');

    // Second call
    const chunks2: IContent[] = [];
    for await (const chunk of provider.generateChatCompletion([])) {
      chunks2.push(chunk);
    }
    expect(chunks2).toHaveLength(1);
    expect(chunks2[0].blocks[0].type).toBe('text');
  });

  it('throws when responses are exhausted', async () => {
    const path = writeResponses('single.jsonl', [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'hi' }] },
    ]);

    const provider = new FakeProvider(path);

    // First call succeeds
    const chunks: IContent[] = [];
    for await (const chunk of provider.generateChatCompletion([])) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);

    // Second call throws with a precise call index and available turn count
    const exhausted = provider.generateChatCompletion([]);
    await expect(async () => {
      for await (const _chunk of exhausted) {
        // drain
      }
    }).rejects.toThrow(
      'FakeProvider: no more canned responses (call #2, only 1 turn(s) available)',
    );
  });

  it('replaces {{CWD}} template with the provided cwd', async () => {
    const testDir = '/my/test/dir';
    const path = writeResponses('template.jsonl', [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_1',
            name: 'write_file',
            parameters: {
              file_path: '{{CWD}}/output.txt',
              content: 'hello',
            },
          },
        ],
      },
    ]);

    const provider = new FakeProvider(path, testDir);

    const chunks: IContent[] = [];
    for await (const chunk of provider.generateChatCompletion([])) {
      chunks.push(chunk);
    }

    const block = chunks[0].blocks[0];
    expect(block.type).toBe('tool_call');
    if (block.type === 'tool_call') {
      expect((block.parameters as { file_path: string }).file_path).toBe(
        '/my/test/dir/output.txt',
      );
    }
  });

  it('returns stub values for metadata methods', async () => {
    const path = writeResponses('meta.jsonl', [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'hi' }] },
    ]);

    const provider = new FakeProvider(path);

    expect(provider.name).toBe('fake');
    expect(provider.getDefaultModel()).toBe('fake-model');
    expect(provider.getCurrentModel()).toBe('fake-model');
    expect(provider.getServerTools()).toEqual([]);

    const models = await provider.getModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('fake-model');
    expect(models[0].provider).toBe('fake');
  });
});
