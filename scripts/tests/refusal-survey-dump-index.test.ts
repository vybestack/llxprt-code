/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readDumpIndex } from '../lib/refusal-survey-dump-index.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('refusal survey dump index', () => {
  it('merges request and response halves sharing a base id', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refusal-dump-index-'));
    dirs.push(root);
    const dumps = path.join(root, 'dumps');
    fs.mkdirSync(dumps);
    fs.writeFileSync(
      path.join(dumps, 'request-123-request.json'),
      JSON.stringify({
        dump_base_id: 'request-123',
        promptId: 'prompt-1',
        request: {
          body: {
            messages: [{ role: 'user', content: 'restricted operation' }],
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(dumps, 'request-123-response.json'),
      JSON.stringify({
        dump_base_id: 'request-123',
        outcome: 'refusal',
        response: { finish_reason: 'refusal' },
      }),
    );

    const index = readDumpIndex(root, () => {});

    expect(index.get('request-123')).toMatchObject({
      promptId: 'prompt-1',
      outcome: 'refusal',
      requestTerms: ['restricted', 'operation'],
    });
  });
});
