/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resume chain priming for Codex statefulness (#3160).
 *
 * A Codex parent id is scoped to the WebSocket connection that produced it,
 * so a `responsesStored` marker restored from a persisted session recording
 * points at a dead parent by construction. `replaySession` and
 * `replaySessionThroughSequence` must strip the marker from AI turns so a
 * resumed session starts a fresh chain instead of sending a dead parent.
 */

import { blockTextOrEmpty } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { replaySession, replaySessionThroughSequence } from './ReplayEngine.js';
import {
  assertReplayOk,
  PROJECT_HASH,
  sessionStartLine,
  contentLine,
  compressedLine,
  writeJsonlFile,
} from './replay-test-helpers.js';
import { type IContent } from '../services/history/IContent.js';

const CODEX_PROVIDER_BASE_URL = 'https://chatgpt.com/backend-api/codex';

function textOf(content: IContent): string {
  const block = content.blocks[0];
  return blockTextOrEmpty(block);
}

describe('ReplayEngine stateful-chain stripping @issue:3160', () => {
  let tempDir: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'replay-stateful-chain-'),
    );
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function replayFrom(lines: string[]): Promise<string> {
    const filePath = path.join(
      chatsDir,
      `session-${Math.random().toString(36).slice(2)}.jsonl`,
    );
    await writeJsonlFile(filePath, lines);
    return filePath;
  }

  it('strips responsesStored from a replayed AI entry while keeping id, providerBaseURL and model', async () => {
    const lines = [
      sessionStartLine(1),
      contentLine(2, {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'the question' }],
      }),
      contentLine(3, {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'the answer' }],
        metadata: {
          id: 'resp_1',
          responsesStored: true,
          providerBaseURL: CODEX_PROVIDER_BASE_URL,
          model: 'gpt-5.6-sol',
        },
      }),
    ];
    const filePath = await replayFrom(lines);

    const result = await replaySession(filePath, PROJECT_HASH);

    assertReplayOk(result);
    expect(result.history).toHaveLength(2);
    const ai = result.history[1];
    expect(ai.speaker).toBe('ai');
    expect(ai.metadata?.responsesStored).toBeUndefined();
    expect(ai.metadata?.id).toBe('resp_1');
    expect(ai.metadata?.providerBaseURL).toBe(CODEX_PROVIDER_BASE_URL);
    expect(ai.metadata?.model).toBe('gpt-5.6-sol');
  });

  it('replays an AI entry without responsesStored unchanged', async () => {
    const lines = [
      sessionStartLine(1),
      contentLine(2, {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'plain answer' }],
        metadata: { id: 'resp_2', model: 'gpt-5.6-sol' },
      }),
    ];
    const filePath = await replayFrom(lines);

    const result = await replaySession(filePath, PROJECT_HASH);

    assertReplayOk(result);
    expect(result.history).toHaveLength(1);
    const ai = result.history[0];
    expect('responsesStored' in (ai.metadata ?? {})).toBe(false);
    expect(ai.metadata?.id).toBe('resp_2');
    expect(ai.metadata?.model).toBe('gpt-5.6-sol');
  });

  it('leaves an explicit responsesStored: false in place', async () => {
    const lines = [
      sessionStartLine(1),
      contentLine(2, {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'not stored' }],
        metadata: { id: 'resp_false', responsesStored: false },
      }),
    ];
    const filePath = await replayFrom(lines);

    const result = await replaySession(filePath, PROJECT_HASH);

    assertReplayOk(result);
    // Only `true` marks a chainable parent, so `false` is not a stale marker and
    // is left exactly as recorded rather than being rewritten.
    expect(result.history[0].metadata?.responsesStored).toBe(false);
    expect(result.history[0].metadata?.id).toBe('resp_false');
  });

  it('replays a tool entry carrying responsesStored unchanged', async () => {
    const lines = [
      sessionStartLine(1),
      contentLine(2, {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_1',
            toolName: 'read_file',
            result: 'file contents',
          },
        ],
        metadata: { responsesStored: true },
      }),
    ];
    const filePath = await replayFrom(lines);

    const result = await replaySession(filePath, PROJECT_HASH);

    assertReplayOk(result);
    expect(result.history[0].speaker).toBe('tool');
    expect(result.history[0].metadata?.responsesStored).toBe(true);
  });

  it('returns an empty history for a recording with no content events', async () => {
    const filePath = await replayFrom([sessionStartLine(1)]);

    const result = await replaySession(filePath, PROJECT_HASH);

    assertReplayOk(result);
    expect(result.history).toStrictEqual([]);
  });

  it('replays a human entry carrying responsesStored unchanged', async () => {
    const lines = [
      sessionStartLine(1),
      contentLine(2, {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'the question' }],
        metadata: { responsesStored: true },
      }),
      contentLine(3, {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'the answer' }],
      }),
    ];
    const filePath = await replayFrom(lines);

    const result = await replaySession(filePath, PROJECT_HASH);

    assertReplayOk(result);
    expect(result.history).toHaveLength(2);
    const human = result.history[0];
    expect(human.speaker).toBe('human');
    expect(human.metadata?.responsesStored).toBe(true);
  });

  it('does not materialize a metadata object on an entry that had none', async () => {
    const lines = [
      sessionStartLine(1),
      contentLine(2, {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'the question' }],
      }),
      contentLine(3, {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'the answer' }],
      }),
    ];
    const filePath = await replayFrom(lines);

    const result = await replaySession(filePath, PROJECT_HASH);

    assertReplayOk(result);
    expect(result.history).toHaveLength(2);
    expect('metadata' in result.history[1]).toBe(false);
  });

  it('strips the marker from every AI entry and preserves history ordering and length', async () => {
    const lines = [
      sessionStartLine(1),
      contentLine(2, {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'q1' }],
      }),
      contentLine(3, {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'a1' }],
        metadata: {
          id: 'resp_a1',
          responsesStored: true,
          providerBaseURL: CODEX_PROVIDER_BASE_URL,
        },
      }),
      contentLine(4, {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'q2' }],
      }),
      contentLine(5, {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'a2' }],
        metadata: {
          id: 'resp_a2',
          responsesStored: true,
          providerBaseURL: CODEX_PROVIDER_BASE_URL,
        },
      }),
    ];
    const filePath = await replayFrom(lines);

    const result = await replaySession(filePath, PROJECT_HASH);

    assertReplayOk(result);
    expect(result.history).toHaveLength(4);
    expect(result.history.map(textOf)).toStrictEqual(['q1', 'a1', 'q2', 'a2']);
    expect(result.history[1].metadata?.responsesStored).toBeUndefined();
    expect(result.history[1].metadata?.id).toBe('resp_a1');
    expect(result.history[3].metadata?.responsesStored).toBeUndefined();
    expect(result.history[3].metadata?.id).toBe('resp_a2');
  });

  it('replaySessionThroughSequence strips the marker identically', async () => {
    const lines = [
      sessionStartLine(1),
      contentLine(2, {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'q1' }],
      }),
      contentLine(3, {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'a1' }],
        metadata: {
          id: 'resp_bounded',
          responsesStored: true,
          providerBaseURL: CODEX_PROVIDER_BASE_URL,
        },
      }),
      contentLine(4, {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'q2' }],
      }),
      contentLine(5, {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'q3' }],
      }),
    ];
    const filePath = await replayFrom(lines);

    const result = await replaySessionThroughSequence(
      filePath,
      PROJECT_HASH,
      4,
    );

    assertReplayOk(result);
    expect(result.history).toHaveLength(3);
    expect(result.history.map(textOf)).toStrictEqual(['q1', 'a1', 'q2']);
    expect(result.history[1].metadata?.responsesStored).toBeUndefined();
    expect(result.history[1].metadata?.id).toBe('resp_bounded');
  });

  it('strips the marker from a compressed summary while keeping isSummary intact', async () => {
    const lines = [
      sessionStartLine(1),
      contentLine(2, {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'q1' }],
      }),
      contentLine(3, { speaker: 'ai', blocks: [{ type: 'text', text: 'a1' }] }),
      compressedLine(
        4,
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'compressed summary' }],
          metadata: {
            id: 'resp_summary',
            responsesStored: true,
            isSummary: true,
            providerBaseURL: CODEX_PROVIDER_BASE_URL,
          },
        },
        2,
      ),
    ];
    const filePath = await replayFrom(lines);

    const result = await replaySession(filePath, PROJECT_HASH);

    assertReplayOk(result);
    expect(result.history).toHaveLength(1);
    expect(textOf(result.history[0])).toBe('compressed summary');
    expect(result.history[0].metadata?.responsesStored).toBeUndefined();
    expect(result.history[0].metadata?.isSummary).toBe(true);
    expect(result.history[0].metadata?.id).toBe('resp_summary');
  });
});
