/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { executeCompression } from '../compression-execution.js';
import { openClientOwner } from './helpers/client-owner-session.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

/**
 * The CLI's `/compress` command maps the Agent's compression result, and its
 * "chat has no history service" case reaches the session binding: the chat the
 * client owns must report a history service before any compression starts.
 * No public input makes a started chat lose its history service, so the
 * subject is the `SessionClientOwner` conversation over its real client, with
 * the chat's history-service read and its compression entry wrapped on the
 * instance (the second delegates to the real chat and only counts).
 */
describe('SessionClientOwner compressHistory without a chat history service', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  const credentials = useOwnedCredentials();

  it('rejects with the unavailable-chat error and never starts a compression', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'compression-missing-history-')),
    );
    const opened = await openClientOwner(
      credentials().authority,
      {
        provider: 'fake',
        model: 'fake-model',
        workingDir: directory,
        interactive: true,
        harness: { includeProcessCwd: false },
      },
      { provider: 'fake', model: 'fake-model' },
    );
    const session = opened.owner.createSessionControl(
      'facade',
      () => 'compression-missing-history-runtime',
      (operation) => operation(),
      () => {},
      () => {},
      () => 'fake',
      () => 'fake-model',
    );
    try {
      await opened.client.startChat();
      const chat = opened.client.getChat();
      let compressions = 0;
      const performCompression = chat.performCompression.bind(chat);
      chat.performCompression = (...args) => {
        compressions += 1;
        return performCompression(...args);
      };
      const getHistoryService = chat.getHistoryService;
      chat.getHistoryService = () => null;
      try {
        await expect(
          opened.owner.clients.conversationBinding.compressHistory(
            'missing-history',
            session,
            opened.owner.hookOperations,
          ),
        ).rejects.toThrow('Chat instance not available for compression.');
        expect(compressions).toBe(0);
      } finally {
        chat.getHistoryService = getHistoryService;
        chat.performCompression = performCompression;
      }
    } finally {
      await runCleanupSteps([
        () => session.dispose(),
        () => opened.close(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  }, 30000);
});

describe('executeCompression when preparation rejects', () => {
  it('propagates the rejection without reading token counts or compressing', async () => {
    let compressions = 0;
    let tokenReads = 0;
    let recencyReads = 0;

    await expect(
      executeCompression(
        'prepare-rejects',
        async () => {
          throw new Error('preparation failed');
        },
        async () => {
          compressions += 1;
          return PerformCompressionResult.COMPRESSED;
        },
        () => {
          tokenReads += 1;
          return 41;
        },
        () => {
          recencyReads += 1;
          return false;
        },
      ),
    ).rejects.toThrow('preparation failed');

    expect({ compressions, tokenReads, recencyReads }).toStrictEqual({
      compressions: 0,
      tokenReads: 0,
      recencyReads: 0,
    });
  });
});
