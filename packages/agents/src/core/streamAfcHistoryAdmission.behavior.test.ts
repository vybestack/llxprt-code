/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The automatic-function-calling history a provider streams is admitted at
 * the media seam, which replaces inline media with references the history can
 * own. These scenarios run a real Turn over a real ChatSession, HistoryService
 * and media store, with a provider that streams an AFC history holding an
 * inline image, and look at what reached history.
 */

import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_AGENT_ID, Turn } from './turn.js';
import { PNG_BASE64, within } from '../api/__tests__/helpers/stalling-agent.js';
import {
  createTimeoutLifecycleChat,
  type TimeoutLifecycleChat,
} from './__tests__/timeout-lifecycle-chat-fixture.js';

setDefaultTimeout(60_000);

const DEADLINE_MS = 20_000;

describe('provider AFC history in a streamed answer', () => {
  let directory = '';
  let setup: TimeoutLifecycleChat | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'stream-afc-admission-'));
  });

  afterEach(async () => {
    setup?.provider.releaseAll();
    await setup?.chat.clearHistory();
    await setup?.invocationOwner.dispose();
    setup = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  it('reaches history with its inline image admitted as a reference', async () => {
    const chat = createTimeoutLifecycleChat(
      directory,
      new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      }),
      { streamTimeoutPolicy: {} },
    );
    setup = chat;
    chat.provider.onAttempt = (attempt) => {
      attempt.emitContent({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'a single pixel' }],
        metadata: {
          providerMetadata: {
            automaticFunctionCallingHistory: [
              {
                speaker: 'human',
                blocks: [
                  { type: 'text', text: 'what is in this picture' },
                  {
                    type: 'media',
                    mimeType: 'image/png',
                    encoding: 'base64',
                    data: PNG_BASE64,
                  },
                ],
              },
            ],
          },
        },
      });
      attempt.finish();
    };

    const turn = new Turn(
      chat.chat,
      'prompt-1',
      DEFAULT_AGENT_ID,
      'timeout-lifecycle-provider',
      chat.execution,
    );
    await within(
      DEADLINE_MS,
      'turn with an AFC history',
      (async () => {
        for await (const _event of turn.run(
          [{ text: 'what is in this picture' }],
          new AbortController().signal,
        ));
      })(),
    );

    const media = chat.history
      .getAll()
      .flatMap((content) => content.blocks)
      .flatMap((block) => (block.type === 'media' ? [block.encoding] : []));
    expect(media).toStrictEqual(['reference']);
  });
});
