/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { blockTextOrEmpty } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { resumeSession } from './resumeSession.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionTransitionService } from './SessionTransitionService.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import { type IContent } from '../services/history/IContent.js';

const PROJECT_HASH = 'stateful-native-project';
const CODEX_PROVIDER_BASE_URL = 'https://chatgpt.com/backend-api/codex';

function textOf(content: IContent): string {
  const block = content.blocks[0];
  return blockTextOrEmpty(block);
}

describe('journal resume stateful-chain stripping @issue:3160', () => {
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

  async function recordRows(
    rows: readonly IContent[],
    summary?: IContent,
  ): Promise<string> {
    const sessionId = crypto.randomUUID();
    const recorder = JournalRecordingService.create({
      sessionId,
      projectHash: PROJECT_HASH,
      chatsDir,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    try {
      const session = await recorder.session();
      for (let index = 0; index < rows.length; index++) {
        await session.append([rows[index]]);
        if (index === 2)
          await recorder.createCheckpoint('bounded-' + sessionId);
      }
      if (summary !== undefined) {
        const version = session.store.published;
        if (version === undefined) throw new Error('Missing seeded journal');
        await session.store.commit([
          {
            kind: 'compress',
            summary: encodeContentRow(summary, { owner: 0 }),
            retainFromLabel: version.nextLabel,
            expectedReplaced: rows.length,
          },
        ]);
      }
      await recorder.flush();
      return sessionId;
    } finally {
      await recorder.dispose();
    }
  }

  async function checkpointResume(
    sessionId: string,
  ): ReturnType<SessionTransitionService['forkFromCheckpoint']> {
    const targets = await SessionDiscovery.listContinueTargets(
      chatsDir,
      PROJECT_HASH,
    );
    const target = targets.find(
      (target) =>
        target.kind === 'checkpoint' &&
        target.checkpointName === 'bounded-' + sessionId,
    );
    if (target?.kind !== 'checkpoint')
      throw new Error('Missing native checkpoint');
    return new SessionTransitionService().forkFromCheckpoint(
      target,
      chatsDir,
      PROJECT_HASH,
      'test',
      'test',
      [],
    );
  }

  async function restoredRows(
    sessionId: string,
    checkpoint = false,
  ): Promise<{ history: IContent[] }> {
    const resumed = checkpoint
      ? await checkpointResume(sessionId)
      : await resumeSession({
          continueRef: sessionId,
          projectHash: PROJECT_HASH,
          chatsDir,
          currentProvider: 'test',
          currentModel: 'test',
          workspaceDirs: [],
        });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error(resumed.error);
    try {
      return { history: await Array.fromAsync(resumed.boot.streamRows()) };
    } finally {
      await resumed.boot.close();
      await resumed.recording.dispose();
    }
  }

  it('strips responsesStored from a replayed AI entry while keeping id, providerBaseURL and model', async () => {
    const lines: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'the question' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'the answer' }],
        metadata: {
          id: 'resp_1',
          responsesStored: true,
          providerBaseURL: CODEX_PROVIDER_BASE_URL,
          model: 'gpt-5.6-sol',
        },
      },
    ];
    const filePath = await recordRows(lines);

    const result = await restoredRows(filePath);

    expect(result.history).toHaveLength(2);
    const ai = result.history[1];
    expect(ai.speaker).toBe('ai');
    expect(ai.metadata?.responsesStored).toBeUndefined();
    expect(ai.metadata?.id).toBe('resp_1');
    expect(ai.metadata?.providerBaseURL).toBe(CODEX_PROVIDER_BASE_URL);
    expect(ai.metadata?.model).toBe('gpt-5.6-sol');
  });

  it('replays an AI entry without responsesStored unchanged', async () => {
    const lines: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'plain answer' }],
        metadata: { id: 'resp_2', model: 'gpt-5.6-sol' },
      },
    ];
    const filePath = await recordRows(lines);

    const result = await restoredRows(filePath);

    expect(result.history).toHaveLength(1);
    const ai = result.history[0];
    expect('responsesStored' in (ai.metadata ?? {})).toBe(false);
    expect(ai.metadata?.id).toBe('resp_2');
    expect(ai.metadata?.model).toBe('gpt-5.6-sol');
  });

  it('leaves an explicit responsesStored: false in place', async () => {
    const lines: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'not stored' }],
        metadata: { id: 'resp_false', responsesStored: false },
      },
    ];
    const filePath = await recordRows(lines);

    const result = await restoredRows(filePath);

    // Only `true` marks a chainable parent, so `false` is not a stale marker and
    // is left exactly as recorded rather than being rewritten.
    expect(result.history[0].metadata?.responsesStored).toBe(false);
    expect(result.history[0].metadata?.id).toBe('resp_false');
  });

  it('replays a tool entry carrying responsesStored unchanged', async () => {
    const lines: IContent[] = [
      {
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
      },
    ];
    const filePath = await recordRows(lines);

    const result = await restoredRows(filePath);

    expect(result.history[0].speaker).toBe('tool');
    expect(result.history[0].metadata?.responsesStored).toBe(true);
  });

  it('returns an empty history for a recording with no content events', async () => {
    const filePath = await recordRows([]);

    const result = await restoredRows(filePath);

    expect(result.history).toStrictEqual([]);
  });

  it('replays a human entry carrying responsesStored unchanged', async () => {
    const lines: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'the question' }],
        metadata: { responsesStored: true },
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'the answer' }],
      },
    ];
    const filePath = await recordRows(lines);

    const result = await restoredRows(filePath);

    expect(result.history).toHaveLength(2);
    const human = result.history[0];
    expect(human.speaker).toBe('human');
    expect(human.metadata?.responsesStored).toBe(true);
  });

  it('does not materialize a metadata object on an entry that had none', async () => {
    const lines: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'the question' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'the answer' }],
      },
    ];
    const filePath = await recordRows(lines);

    const result = await restoredRows(filePath);

    expect(result.history).toHaveLength(2);
    expect('metadata' in result.history[1]).toBe(false);
  });

  it('strips the marker from every AI entry and preserves history ordering and length', async () => {
    const lines: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'q1' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'a1' }],
        metadata: {
          id: 'resp_a1',
          responsesStored: true,
          providerBaseURL: CODEX_PROVIDER_BASE_URL,
        },
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'q2' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'a2' }],
        metadata: {
          id: 'resp_a2',
          responsesStored: true,
          providerBaseURL: CODEX_PROVIDER_BASE_URL,
        },
      },
    ];
    const filePath = await recordRows(lines);

    const result = await restoredRows(filePath);

    expect(result.history).toHaveLength(4);
    expect(result.history.map(textOf)).toStrictEqual(['q1', 'a1', 'q2', 'a2']);
    expect(result.history[1].metadata?.responsesStored).toBeUndefined();
    expect(result.history[1].metadata?.id).toBe('resp_a1');
    expect(result.history[3].metadata?.responsesStored).toBeUndefined();
    expect(result.history[3].metadata?.id).toBe('resp_a2');
  });

  it('checkpoint resume strips the marker identically', async () => {
    const lines: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'q1' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'a1' }],
        metadata: {
          id: 'resp_bounded',
          responsesStored: true,
          providerBaseURL: CODEX_PROVIDER_BASE_URL,
        },
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'q2' }],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'q3' }],
      },
    ];
    const filePath = await recordRows(lines);

    const result = await restoredRows(filePath, true);

    expect(result.history).toHaveLength(3);
    expect(result.history.map(textOf)).toStrictEqual(['q1', 'a1', 'q2']);
    expect(result.history[1].metadata?.responsesStored).toBeUndefined();
    expect(result.history[1].metadata?.id).toBe('resp_bounded');
  });

  it('strips the marker from a compressed summary while keeping isSummary intact', async () => {
    const filePath = await recordRows(
      [
        { speaker: 'human', blocks: [{ type: 'text', text: 'q1' }] },
        { speaker: 'ai', blocks: [{ type: 'text', text: 'a1' }] },
      ],
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
    );

    const result = await restoredRows(filePath);

    expect(result.history).toHaveLength(1);
    expect(textOf(result.history[0])).toBe('compressed summary');
    expect(result.history[0].metadata?.responsesStored).toBeUndefined();
    expect(result.history[0].metadata?.isSummary).toBe(true);
    expect(result.history[0].metadata?.id).toBe('resp_summary');
  });
});
