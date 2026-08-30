/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OCR finding 49 behavioral tests. A hand-edited or corrupt
 * `semantic_media_purge` event whose frontier points outside the replacement
 * history must be treated as malformed (skipped with a warning) instead of
 * surfacing an out-of-range frontier that downstream purge/breakpoint logic
 * would index into nonexistent history.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { replaySession } from './ReplayEngine.js';
import {
  assertReplayOk,
  PROJECT_HASH,
  writeJsonlFile,
} from './replay-test-helpers.js';
import type { IContent } from '../services/history/IContent.js';

function replayContent(): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'stable' }],
  };
}

function semanticMediaPurgeLine(
  seq: number,
  history: readonly IContent[],
  frontier: { readonly contentIndex: number; readonly blockIndex: number },
): string {
  return JSON.stringify({
    v: 2,
    seq,
    ts: new Date().toISOString(),
    type: 'semantic_media_purge',
    payload: { history, frontier },
  });
}

describe('ReplayEngine semantic_media_purge frontier bounds', () => {
  let directory = '';

  beforeEach(async () => {
    directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'replay-purge-bounds-'),
    );
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  function startLine(): string {
    return JSON.stringify({
      v: 1,
      seq: 1,
      ts: new Date().toISOString(),
      type: 'session_start',
      payload: {
        sessionId: 'purge-bounds-session',
        projectHash: PROJECT_HASH,
        workspaceDirs: ['/ws'],
        provider: 'anthropic',
        model: 'claude',
        startTime: new Date().toISOString(),
      },
    });
  }

  async function replay(...lines: string[]): Promise<{
    ok: boolean;
    history?: IContent[];
    semanticMediaPurgeFrontier?:
      | { readonly contentIndex: number; readonly blockIndex: number }
      | undefined;
    warnings?: string[];
  }> {
    const filePath = path.join(directory, 'session.jsonl');
    await writeJsonlFile(filePath, lines);
    const result = await replaySession(filePath, PROJECT_HASH);
    assertReplayOk(result);
    return {
      ok: result.ok,
      history: result.history,
      semanticMediaPurgeFrontier: result.semanticMediaPurgeFrontier,
      warnings: result.warnings,
    };
  }

  it('treats a semantic_media_purge frontier beyond the replacement history as malformed', async () => {
    const result = await replay(
      startLine(),
      semanticMediaPurgeLine(2, [replayContent()], {
        contentIndex: 5,
        blockIndex: 0,
      }),
    );

    expect(result.semanticMediaPurgeFrontier).toBeUndefined();
    expect(result.history).toEqual([]);
    expect(
      result.warnings?.some(
        (warning) =>
          warning.includes('semantic_media_purge') &&
          (warning.includes('out of bounds') || warning.includes('malformed')),
      ) === true,
    ).toBe(true);
    expect(result.warnings?.some((warning) => warning.includes('Line 2'))).toBe(
      true,
    );
  });

  it('treats a blockIndex past the end of the frontier content as malformed', async () => {
    const result = await replay(
      startLine(),
      semanticMediaPurgeLine(2, [replayContent()], {
        contentIndex: 0,
        blockIndex: 7,
      }),
    );

    expect(result.semanticMediaPurgeFrontier).toBeUndefined();
    expect(result.history).toEqual([]);
    expect(result.warnings?.some((warning) => warning.includes('Line 2'))).toBe(
      true,
    );
  });

  it.each([
    { contentIndex: -1, blockIndex: 0 },
    { contentIndex: 0, blockIndex: -1 },
  ])(
    'rejects a negative semantic purge frontier coordinate',
    async (frontier) => {
      const result = await replay(
        startLine(),
        JSON.stringify({
          v: 2,
          seq: 2,
          ts: new Date().toISOString(),
          type: 'semantic_media_purge',
          payload: {
            history: [replayContent()],
            frontier,
          },
        }),
      );

      expect({
        frontier: result.semanticMediaPurgeFrontier,
        history: result.history,
        warnedAtLine: result.warnings?.some((warning) =>
          warning.includes('Line 2'),
        ),
      }).toEqual({ frontier: undefined, history: [], warnedAtLine: true });
    },
  );

  it('accepts a frontier strictly inside the replacement history', async () => {
    const result = await replay(
      startLine(),
      semanticMediaPurgeLine(2, [replayContent()], {
        contentIndex: 0,
        blockIndex: 0,
      }),
    );

    expect(result.semanticMediaPurgeFrontier).toEqual({
      contentIndex: 0,
      blockIndex: 0,
    });
    expect(result.history).toEqual([replayContent()]);
    expect(result.warnings?.some((warning) => warning.includes('Line 2'))).toBe(
      false,
    );
  });

  it('accepts the origin frontier as the terminal position for empty replacement history', async () => {
    const result = await replay(
      startLine(),
      semanticMediaPurgeLine(2, [], { contentIndex: 0, blockIndex: 0 }),
    );

    expect(result.history).toEqual([]);
    expect(result.semanticMediaPurgeFrontier).toEqual({
      contentIndex: 0,
      blockIndex: 0,
    });
    expect(result.warnings?.some((warning) => warning.includes('Line 2'))).toBe(
      false,
    );
  });

  it('does not let a corrupt empty-history purge line poison accumulated history', async () => {
    const filePath = path.join(directory, 'mixed.jsonl');
    await writeJsonlFile(filePath, [
      startLine(),
      JSON.stringify({
        v: 1,
        seq: 2,
        ts: new Date().toISOString(),
        type: 'content',
        payload: { content: replayContent() },
      }),
      semanticMediaPurgeLine(3, [], { contentIndex: 1, blockIndex: 0 }),
      JSON.stringify({
        v: 1,
        seq: 4,
        ts: new Date().toISOString(),
        type: 'content',
        payload: {
          content: {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'after' }],
          },
        },
      }),
    ]);

    const result = await replaySession(filePath, PROJECT_HASH);
    assertReplayOk(result);

    expect(result.history.map((entry) => entry.blocks[0])).toEqual([
      { type: 'text', text: 'stable' },
      { type: 'text', text: 'after' },
    ]);
    expect(result.semanticMediaPurgeFrontier).toBeUndefined();
  });
});
