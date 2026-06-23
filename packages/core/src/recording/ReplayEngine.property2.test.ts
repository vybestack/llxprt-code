/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { replaySession, readSessionHeader } from './ReplayEngine.js';
import {
  assertReplayOk,
  PROJECT_HASH,
  makeContent,
  sessionStartLine,
  contentLine,
  writeJsonlFile,
  createValidFile,
} from './replay-test-helpers.js';

describe('ReplayEngine @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
  let tempDir: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-test-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Property-Based Tests (continued)
  describe('Property-Based Tests @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 54: Malformed payload for any known event type is skipped without crash.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it.prop([
      fc.constantFrom(
        'content' as const,
        'compressed' as const,
        'rewind' as const,
        'provider_switch' as const,
        'session_event' as const,
        'directories_changed' as const,
      ),
    ])(
      'malformed payload for any known event type is skipped without crash @requirement:REQ-RPL-005',
      async (eventType) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-malformed-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const malformedEvent = JSON.stringify({
            v: 1,
            seq: 3,
            ts: new Date().toISOString(),
            type: eventType,
            payload: { randomGarbage: 'not-a-valid-payload' },
          });

          const lines = [
            sessionStartLine(1),
            contentLine(2, makeContent('before', 'human')),
            malformedEvent,
            contentLine(4, makeContent('after', 'ai')),
          ];
          const filePath = path.join(
            localChatsDir,
            `malformed-${eventType}.jsonl`,
          );
          await writeJsonlFile(filePath, lines);

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);

          // Valid content should still be present
          expect(result.history.length).toBeGreaterThanOrEqual(1);
          expect(result.warnings.length).toBeGreaterThanOrEqual(1);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 55: Rewind after compression with arbitrary post-compression count.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002d, REQ-RPL-003
     */
    it.prop([fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 15 })])(
      'rewind after compression: max(0, 1+postCount - rewindN) items @requirement:REQ-RPL-002d, REQ-RPL-003',
      async (postCount, rewindN) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-comp-rw-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            svc.recordContent(makeContent('pre', 'human'));
            svc.recordCompressed(makeContent('Summary', 'ai'), 1);
            for (let i = 0; i < postCount; i++) {
              svc.recordContent(makeContent(`post ${i}`, 'human'));
            }
            svc.recordRewind(rewindN);
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);
          // summary(1) + postCount, then rewind removes N
          const expectedLen = Math.max(0, 1 + postCount - rewindN);
          expect(result.history).toHaveLength(expectedLen);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 56: Provider switch always updates metadata to latest value.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-007
     */
    it.prop([
      fc.array(
        fc.record({
          provider: fc.constantFrom('anthropic', 'openai', 'google', 'azure'),
          model: fc.string({ minLength: 1, maxLength: 20 }),
        }),
        { minLength: 1, maxLength: 5 },
      ),
    ])(
      'provider switch always updates metadata to latest provider/model @requirement:REQ-RPL-007',
      async (switches) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-pswitch-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            svc.recordContent(makeContent('trigger', 'human'));
            for (const sw of switches) {
              svc.recordProviderSwitch(sw.provider, sw.model);
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);

          const lastSwitch = switches[switches.length - 1];
          expect(result.metadata.provider).toBe(lastSwitch.provider);
          expect(result.metadata.model).toBe(lastSwitch.model);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 57: directories_changed always updates metadata to latest value.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-007
     */
    it.prop([
      fc.array(
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), {
          minLength: 1,
          maxLength: 3,
        }),
        { minLength: 1, maxLength: 5 },
      ),
    ])(
      'directories_changed always updates metadata to latest directories @requirement:REQ-RPL-007',
      async (dirChanges) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-dirs-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            svc.recordContent(makeContent('trigger', 'human'));
            for (const dirs of dirChanges) {
              svc.recordDirectoriesChanged(dirs);
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);

          const lastDirs = dirChanges[dirChanges.length - 1];
          expect(result.metadata.workspaceDirs).toStrictEqual(lastDirs);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 58: session_event never appears in history regardless of count.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-008
     */
    it.prop([fc.integer({ min: 1, max: 10 }), fc.integer({ min: 1, max: 10 })])(
      'session_events never appear in history regardless of count @requirement:REQ-RPL-008',
      async (contentCount, eventCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-sevt-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            for (let i = 0; i < contentCount; i++) {
              svc.recordContent(makeContent(`msg ${i}`, 'human'));
              if (i < eventCount) {
                svc.recordSessionEvent('info', `event ${i}`);
              }
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);

          expect(result.history).toHaveLength(contentCount);
          expect(result.sessionEvents).toHaveLength(
            Math.min(contentCount, eventCount),
          );
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 59: BOM on first line never prevents replay for valid files.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it.prop([fc.integer({ min: 1, max: 10 }), fc.boolean()])(
      'BOM on first line never prevents replay @requirement:REQ-RPL-005',
      async (contentCount: number, hasBom: boolean) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-bom-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const lines: string[] = [];
          const firstLine = sessionStartLine(1);
          lines.push(hasBom ? '\uFEFF' + firstLine : firstLine);
          for (let i = 0; i < contentCount; i++) {
            lines.push(contentLine(i + 2, makeContent(`msg ${i}`, 'human')));
          }
          const filePath = path.join(localChatsDir, 'bom-test.jsonl');
          await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);
          expect(result.history).toHaveLength(contentCount);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 60: Multiple compressions: only post-last-compression content survives.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-003
     */
    it.prop([
      fc.integer({ min: 1, max: 5 }),
      fc.integer({ min: 1, max: 5 }),
      fc.integer({ min: 0, max: 5 }),
    ])(
      'multiple compressions: only post-last-compression content survives @requirement:REQ-RPL-003',
      async (preFirst, preLast, postLast) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-multicomp-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            for (let i = 0; i < preFirst; i++) {
              svc.recordContent(makeContent(`batch1-${i}`, 'human'));
            }
            svc.recordCompressed(makeContent('First summary', 'ai'), preFirst);
            for (let i = 0; i < preLast; i++) {
              svc.recordContent(makeContent(`batch2-${i}`, 'human'));
            }
            svc.recordCompressed(
              makeContent('Last summary', 'ai'),
              preLast + 1,
            );
            for (let i = 0; i < postLast; i++) {
              svc.recordContent(makeContent(`batch3-${i}`, 'human'));
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);
          // last summary (1) + postLast content
          expect(result.history).toHaveLength(1 + postLast);
          expect(result.history[0].blocks[0]).toStrictEqual({
            type: 'text',
            text: 'Last summary',
          });
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 61: readSessionHeader always returns matching data for valid files.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it.prop([
      fc.record({
        sessionId: fc.uuid(),
        provider: fc.constantFrom('anthropic', 'openai', 'google'),
        model: fc.string({ minLength: 1, maxLength: 20 }),
      }),
    ])(
      'readSessionHeader returns matching metadata for valid files @requirement:REQ-RPL-001',
      async ({ sessionId, provider, model }) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-header-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(
            localChatsDir,
            (svc) => {
              svc.recordContent(makeContent('trigger', 'human'));
            },
            { sessionId, provider, model },
          );

          const header = await readSessionHeader(filePath);

          expect(header).not.toBeNull();
          expect(header!.sessionId).toBe(sessionId);
          expect(header!.provider).toBe(provider);
          expect(header!.model).toBe(model);
          expect(header!.projectHash).toBe(PROJECT_HASH);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 62: Corrupt last line is always silently discarded regardless of file size.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it.prop([fc.integer({ min: 1, max: 15 })])(
      'corrupt last line is always silently discarded regardless of event count @requirement:REQ-RPL-005',
      async (contentCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-corrupt-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const lines: string[] = [sessionStartLine(1)];
          for (let i = 0; i < contentCount; i++) {
            lines.push(contentLine(i + 2, makeContent(`msg ${i}`, 'human')));
          }
          // Add truncated last line
          lines.push(
            '{"v":1,"seq":999,"type":"content","payload":{"content":{"spe',
          );
          const filePath = path.join(localChatsDir, 'corrupt-last.jsonl');
          await writeJsonlFile(filePath, lines);

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);
          expect(result.history).toHaveLength(contentCount);
          // Silent discard — no warnings for corrupt last line
          expect(result.warnings).toHaveLength(0);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );
  });
});
