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
import { replaySession } from './ReplayEngine.js';
import {
  assertReplayOk,
  PROJECT_HASH,
  makeContent,
  sessionStartLine,
  contentLine,
  compressedLine,
  rewindLine,
  sessionEventLine,
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

  // =========================================================================
  // Property-Based Tests (≥30% of total — 12 property tests out of ~42 total)
  // =========================================================================

  describe('Property-Based Tests @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 43: Any sequence of content events produces history of same length.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002
     */
    it.prop([
      fc.array(
        fc.record({
          text: fc.string({ minLength: 1, maxLength: 100 }),
          speaker: fc.constantFrom('human' as const, 'ai' as const),
        }),
        { minLength: 1, maxLength: 20 },
      ),
    ])(
      'any sequence of content events produces history of same length @requirement:REQ-RPL-002',
      async (contents) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-replay-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            for (const c of contents) {
              svc.recordContent(makeContent(c.text, c.speaker));
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);
          expect(result.history).toHaveLength(contents.length);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 44: Compression always resets to exactly 1+post items.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-003
     */
    it.prop([fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 10 })])(
      'compression always resets to exactly 1+post items @requirement:REQ-RPL-003',
      async (preCount, postCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-comp-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            for (let i = 0; i < preCount; i++) {
              svc.recordContent(makeContent(`pre ${i}`, 'human'));
            }
            svc.recordCompressed(makeContent('Summary', 'ai'), preCount);
            for (let i = 0; i < postCount; i++) {
              svc.recordContent(makeContent(`post ${i}`, 'human'));
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);
          // summary (1) + postCount
          expect(result.history).toHaveLength(1 + postCount);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 45: Rewind(N) on history of size M produces max(0, M-N) items.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002d
     */
    it.prop([fc.integer({ min: 1, max: 15 }), fc.integer({ min: 0, max: 20 })])(
      'rewind(N) on history of size M produces max(0, M-N) items @requirement:REQ-RPL-002d',
      async (historySize, rewindCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-rewind-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            for (let i = 0; i < historySize; i++) {
              svc.recordContent(makeContent(`msg ${i}`, 'human'));
            }
            svc.recordRewind(rewindCount);
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);
          expect(result.history).toHaveLength(
            Math.max(0, historySize - rewindCount),
          );
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 46: Multiple write-then-replay cycles are idempotent.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it.prop([
      fc.array(
        fc.record({
          text: fc.string({ minLength: 1, maxLength: 50 }),
          speaker: fc.constantFrom('human' as const, 'ai' as const),
        }),
        { minLength: 1, maxLength: 10 },
      ),
    ])(
      'replaying the same file twice produces identical results @requirement:REQ-RPL-001',
      async (contents) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-idem-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            for (const c of contents) {
              svc.recordContent(makeContent(c.text, c.speaker));
            }
          });

          const result1 = await replaySession(filePath, PROJECT_HASH);
          const result2 = await replaySession(filePath, PROJECT_HASH);

          expect(result1.ok).toBe(true);
          expect(result2.ok).toBe(true);
          if (!result1.ok || !result2.ok) return;

          expect(result1.history).toStrictEqual(result2.history);
          expect(result1.lastSeq).toBe(result2.lastSeq);
          expect(result1.eventCount).toBe(result2.eventCount);
          expect(result1.warnings).toStrictEqual(result2.warnings);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 47: Session metadata survives any event sequence.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-007
     */
    it.prop([
      fc.array(
        fc.constantFrom(
          'content' as const,
          'provider_switch' as const,
          'session_event' as const,
          'directories_changed' as const,
        ),
        { minLength: 1, maxLength: 10 },
      ),
    ])(
      'session metadata always present after replay @requirement:REQ-RPL-007',
      async (eventTypes) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-meta-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            // Ensure at least one content event for materialization
            svc.recordContent(makeContent('trigger', 'human'));
            for (const eventType of eventTypes) {
              switch (eventType) {
                case 'content':
                  svc.recordContent(makeContent('test', 'ai'));
                  break;
                case 'provider_switch':
                  svc.recordProviderSwitch('test-provider', 'test-model');
                  break;
                case 'session_event':
                  svc.recordSessionEvent('info', 'test event');
                  break;
                case 'directories_changed':
                  svc.recordDirectoriesChanged(['/test']);
                  break;
                default:
                  break;
              }
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);
          expect(result.metadata).toBeDefined();
          expect(result.metadata.sessionId).toBeTruthy();
          expect(result.metadata.projectHash).toBe(PROJECT_HASH);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 48: lastSeq always equals the final event's seq.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it.prop([fc.integer({ min: 1, max: 30 })])(
      'lastSeq always equals the final event seq regardless of event count @requirement:REQ-RPL-001',
      async (eventCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-lastseq-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            for (let i = 0; i < eventCount; i++) {
              svc.recordContent(
                makeContent(`msg ${i}`, i % 2 === 0 ? 'human' : 'ai'),
              );
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);
          // session_start (seq=1) + eventCount content events
          expect(result.lastSeq).toBe(eventCount + 1);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 49: eventCount always matches total events regardless of corruption.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it.prop([fc.integer({ min: 1, max: 20 }), fc.boolean()])(
      'eventCount matches total valid events regardless of optional corrupt last line @requirement:REQ-RPL-001',
      async (contentCount: number, hasCorruptLastLine: boolean) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-evcount-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const lines: string[] = [sessionStartLine(1)];
          for (let i = 0; i < contentCount; i++) {
            lines.push(contentLine(i + 2, makeContent(`msg ${i}`, 'human')));
          }
          if (hasCorruptLastLine) {
            lines.push(
              '{"v":1,"seq":999,"type":"content","payload":{"content":{"spea',
            );
          }
          const filePath = path.join(
            localChatsDir,
            `evcount-${contentCount}.jsonl`,
          );
          await writeJsonlFile(filePath, lines);

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);
          // session_start + contentCount valid content events
          expect(result.eventCount).toBe(1 + contentCount);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 50: Any valid IContent round-trips through record -> replay losslessly.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002
     */
    it.prop([
      fc.record({
        speaker: fc.constantFrom('human' as const, 'ai' as const),
        text: fc.string({ minLength: 1, maxLength: 200 }),
      }),
    ])(
      'any valid IContent round-trips through record -> replay losslessly @requirement:REQ-RPL-002',
      async ({ speaker, text }) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-roundtrip-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const content: IContent = {
            speaker,
            blocks: [{ type: 'text', text }],
          };

          const filePath = await createValidFile(localChatsDir, (svc) => {
            svc.recordContent(content);
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);
          expect(result.history).toHaveLength(1);
          expect(result.history[0]).toStrictEqual(content);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 51: Warnings array is always present (possibly empty) regardless of input.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it.prop([
      fc.array(
        fc.record({
          text: fc.string({ minLength: 1, maxLength: 50 }),
          speaker: fc.constantFrom('human' as const, 'ai' as const),
        }),
        { minLength: 1, maxLength: 10 },
      ),
    ])(
      'warnings array is always present regardless of input @requirement:REQ-RPL-001',
      async (contents) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-warn-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            for (const c of contents) {
              svc.recordContent(makeContent(c.text, c.speaker));
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);
          expect(Array.isArray(result.warnings)).toBe(true);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 52: seq monotonicity is preserved across any number of resumes.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it.prop([fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 10 })])(
      'seq monotonicity preserved across N resumes @requirement:REQ-RPL-001',
      async (resumeCount, turnsPerSegment) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-resume-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          let seq = 1;
          const lines: string[] = [sessionStartLine(seq)];

          for (let r = 0; r <= resumeCount; r++) {
            if (r > 0) {
              seq++;
              lines.push(
                sessionEventLine(seq, 'info', `Session resumed at T${r}`),
              );
            }
            for (let t = 0; t < turnsPerSegment; t++) {
              seq++;
              lines.push(contentLine(seq, makeContent(`r${r}-t${t}`, 'human')));
            }
          }

          const filePath = path.join(
            localChatsDir,
            `resume-mono-${resumeCount}.jsonl`,
          );
          await writeJsonlFile(filePath, lines);

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);

          const expectedContentCount = (resumeCount + 1) * turnsPerSegment;
          expect(result.history).toHaveLength(expectedContentCount);
          expect(result.sessionEvents).toHaveLength(resumeCount);
          expect(result.lastSeq).toBe(seq);
          expect(result.warnings).toHaveLength(0);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 53: Arbitrary interleaving of content/compressed/rewind produces valid history.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002
     */
    it.prop([
      fc.array(
        fc.oneof(
          fc.constant('content' as const),
          fc.constant('compressed' as const),
          fc.constant('rewind' as const),
        ),
        { minLength: 1, maxLength: 15 },
      ),
    ])(
      'arbitrary interleaving of content/compressed/rewind produces valid history @requirement:REQ-RPL-002',
      async (eventTypes) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-interleave-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          let seq = 1;
          const lines: string[] = [sessionStartLine(seq)];

          // Always start with one content event
          seq++;
          lines.push(contentLine(seq, makeContent('seed', 'human')));

          for (const eventType of eventTypes) {
            seq++;
            switch (eventType) {
              case 'content':
                lines.push(
                  contentLine(seq, makeContent(`msg-${seq}`, 'human')),
                );
                break;
              case 'compressed':
                lines.push(
                  compressedLine(seq, makeContent('summary', 'ai'), 1),
                );
                break;
              case 'rewind':
                lines.push(rewindLine(seq, 1));
                break;
              default:
                break;
            }
          }

          const filePath = path.join(localChatsDir, 'interleave.jsonl');
          await writeJsonlFile(filePath, lines);

          const result = await replaySession(filePath, PROJECT_HASH);

          assertReplayOk(result);

          // History length should be non-negative
          expect(result.history.length).toBeGreaterThanOrEqual(0);
          // No undefined items
          for (const item of result.history) {
            expect(item).toBeDefined();
            expect(item.speaker).toBeTruthy();
            expect(Array.isArray(item.blocks)).toBe(true);
          }
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );
  });
});
