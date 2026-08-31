/**
 * @license
 * Copyright 2026 Vybestack LLC
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

/**
 * Resumed-session chain behavior for issue #3160 Codex statefulness.
 *
 * A Codex parent id belongs to the WebSocket connection that produced it, so a
 * marker restored from a session recording is dead. `finalizeReplay` strips it,
 * and the first turn of a resumed session therefore starts a fresh chain: no
 * previous_response_id, full history, and `responsesStored: true` on its own
 * completion so the next turn chains again.
 *
 * The first test drives the REAL recording -> replay -> provider path so it
 * fails if the replay-side strip is reverted. The remaining tests pin the
 * provider-side rules that the strip depends on.
 */

import { blockTextOrEmpty } from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { replaySession } from '@vybestack/llxprt-code-core';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  SocketHarness,
  completingScript,
  drain as drainHarness,
  userTextsOf,
} from '../openAIResponsesWebSocketTransport.test-helpers.js';
import { createCodexResponsesWebSocketTransport } from '../openAIResponsesWebSocketTransport.js';
import { executeOpenAIResponsesRequest } from '../openAIResponsesExecutor.js';
import {
  CODEX_BASE_URL,
  TEST_RUNTIME_ID,
  buildDeps,
  buildOptions,
  metadataOf,
} from '../codexStateful.test-helpers.js';

const PROJECT_HASH = 'issue3160projecthash';

/**
 * Extracts the text of every assistant item in a Responses `input` array.
 * `userTextsOf` covers the human turns; this covers the AI turns, so a
 * "full history was sent" assertion can name every entry rather than only
 * the human ones.
 */
function partText(part: unknown): string {
  if (typeof part !== 'object' || part === null) return '';
  const text = (part as { text?: unknown }).text;
  return text === undefined || text === null ? '' : String(text);
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(partText).join('');
}

function assistantTextsOf(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new Error('Expected a Responses "input" array');
  }
  const texts: string[] = [];
  for (const item of input as Array<
    { role?: string; content?: unknown } | null | undefined
  >) {
    if (item?.role !== 'assistant') continue;
    const text = contentText(item.content);
    if (text !== '') texts.push(text);
  }
  return texts;
}

function recordLine(seq: number, type: string, payload: unknown): string {
  return JSON.stringify({
    v: 1,
    seq,
    ts: '2026-08-21T00:00:00.000Z',
    type,
    payload,
  });
}

function sentRequestOf(serialized: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(serialized);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Expected a serialized Responses request');
  }
  return parsed as Record<string, unknown>;
}

describe('OpenAIResponsesProvider Codex resumed chain @issue:3160', () => {
  let tempDir: string;

  beforeEach(async () => {
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: TEST_RUNTIME_ID,
      }),
    );
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-resumed-chain-'));
  });

  afterEach(async () => {
    clearActiveProviderRuntimeContext();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Writes a session recording whose AI turn carries a stored Codex parent,
   * replays it the way `--continue` does, and hands the replayed history
   * straight to the provider. Reverting the strip in `finalizeReplay` makes the
   * replayed marker survive and this test sends the dead parent.
   */
  it('sends no previous_response_id for a history replayed from a session recording', async () => {
    const filePath = path.join(tempDir, 'session.jsonl');
    await fs.writeFile(
      filePath,
      [
        recordLine(1, 'session_start', {
          sessionId: 'resumed-session-0001',
          projectHash: PROJECT_HASH,
          workspaceDirs: [tempDir],
          provider: 'openai-responses',
          model: 'gpt-5.6-sol',
          startTime: '2026-08-21T00:00:00.000Z',
        }),
        recordLine(2, 'content', {
          content: {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'q1' }],
          },
        }),
        recordLine(3, 'content', {
          content: {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'a1' }],
            metadata: {
              id: 'resp_from_previous_process',
              responsesStored: true,
              providerBaseURL: CODEX_BASE_URL,
            },
          },
        }),
        recordLine(4, 'content', {
          content: {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'q2' }],
          },
        }),
      ].join('\n') + '\n',
      'utf-8',
    );

    const replayed = await replaySession(filePath, PROJECT_HASH);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.history).toHaveLength(3);

    const harness = new SocketHarness([completingScript('ok')]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    try {
      await drainHarness(
        executeOpenAIResponsesRequest(
          buildOptions(replayed.history),
          buildDeps({ getWebSocketTransport: () => transport }),
        ),
      );

      const sent = sentRequestOf(harness.sockets[0].sent[0]);
      expect(sent['previous_response_id']).toBeUndefined();
      // The whole transcript is re-seeded: both human turns AND the AI turn
      // that used to be the parent.
      expect(userTextsOf(sent['input'])).toStrictEqual(['q1', 'q2']);
      expect(assistantTextsOf(sent['input'])).toContain('a1');
    } finally {
      transport.close();
    }
  });

  it('still chains from a marker that was never persisted and replayed', async () => {
    // The control for the test above: the provider's parent scan is unchanged,
    // so the same history WITH the marker still produces a chained request.
    // Without this, the test above could pass for a trivial reason.
    const contents: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'q1' }] },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'a1' }],
        metadata: {
          id: 'resp_live',
          responsesStored: true,
          providerBaseURL: CODEX_BASE_URL,
        },
      },
      { speaker: 'human', blocks: [{ type: 'text', text: 'q2' }] },
    ];
    const harness = new SocketHarness([completingScript('ok')]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    try {
      await drainHarness(
        executeOpenAIResponsesRequest(
          buildOptions(contents),
          buildDeps({ getWebSocketTransport: () => transport }),
        ),
      );

      const sent = sentRequestOf(harness.sockets[0].sent[0]);
      expect(sent['previous_response_id']).toBe('resp_live');
      expect(userTextsOf(sent['input'])).toStrictEqual(['q2']);
    } finally {
      transport.close();
    }
  });

  it('re-establishes the chain on the next turn of the same connection', async () => {
    const resumedContents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'resumed question' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'old answer' }],
        metadata: { id: 'resp_dead', providerBaseURL: CODEX_BASE_URL },
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'resumed follow-up' }],
      },
    ];
    // ONE harness and ONE transport for both turns: a Codex parent is scoped to
    // the connection, so turn 2 must chain on the socket turn 1 established.
    const harness = new SocketHarness([completingScript('resumed answer')]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    try {
      const resumedMessages = await drainHarness(
        executeOpenAIResponsesRequest(
          buildOptions(resumedContents),
          buildDeps({ getWebSocketTransport: () => transport }),
        ),
      );

      const resumedMeta = metadataOf(resumedMessages);
      expect(resumedMeta).toBeDefined();
      expect(resumedMeta!.responsesStored).toBe(true);
      const parentId = resumedMeta!.id;
      // Guard the comparison below: two undefined ids would satisfy toBe().
      expect(typeof parentId).toBe('string');
      expect(parentId).not.toBe('');

      const firstSent = sentRequestOf(harness.sockets[0].sent[0]);
      expect(firstSent['previous_response_id']).toBeUndefined();
      expect(userTextsOf(firstSent['input'])).toStrictEqual([
        'resumed question',
        'resumed follow-up',
      ]);

      const resumedAnswer = resumedMessages
        .flatMap((message) => message.blocks)
        .map((block) => (blockTextOrEmpty(block)))
        .join('');
      const turn2Contents: IContent[] = [
        ...resumedContents,
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: resumedAnswer }],
          metadata: { ...resumedMeta!, providerBaseURL: CODEX_BASE_URL },
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'turn 2 question' }],
        },
      ];

      await drainHarness(
        executeOpenAIResponsesRequest(
          buildOptions(turn2Contents),
          buildDeps({ getWebSocketTransport: () => transport }),
        ),
      );

      // Same socket, second frame.
      expect(harness.sockets).toHaveLength(1);
      const secondSent = sentRequestOf(harness.sockets[0].sent[1]);
      expect(secondSent['previous_response_id']).toBe(parentId);
      expect(userTextsOf(secondSent['input'])).toStrictEqual([
        'turn 2 question',
      ]);
    } finally {
      transport.close();
    }
  });
});
