/**
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-SESSIONRECORDING.P19
 * @requirement REQ-RSM-001, REQ-RSM-002, REQ-RSM-004, REQ-RSM-005, REQ-RSM-006
 *
 * Behavioral and property-based tests for resumeSession. Tests use real
 * SessionRecordingService, SessionLockManager, and ReplayEngine instances
 * to create, lock, and resume genuine session JSONL files in real temp
 * directories — no mock theater.
 *
 * Property-based tests use fast-check (≥30% of total tests).
 * All tests expect real behavior. They will fail against the Phase 18 stub
 * — that is correct TDD.
 */

import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { readJournalFileFacts } from './journalSessionListing.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import { resumeSession } from './resumeSession.js';
import { type IContent } from '../services/history/IContent.js';
import {
  PROJECT_HASH,
  makeConfig,
  makeContent,
  alternatingSpeaker,
  createJournalTestSession,
  makeResumeRequest,
  expectOk,
  collectBootRows,
  useResumeFixture,
} from './resumeSession.test.helpers.js';

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: preserves any IContent through write-resume cycle @requirement:REQ-RSM-004', () => {
  useResumeFixture();
  describe('Property-Based Tests @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 26: Resume preserves any valid IContent through write-replay cycle
     * fc.record for IContent, record, resume → history matches
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-004
     */
    it('preserves any IContent through write-resume cycle @requirement:REQ-RSM-004', async () =>
      fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              speaker: fc.constantFrom('human' as const, 'ai' as const),
              text: fc.string({ minLength: 1, maxLength: 100 }),
            }),
            { minLength: 1, maxLength: 5 },
          ),
          async (items) => {
            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-resume-roundtrip-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              const contents: IContent[] = items.map((item) => ({
                speaker: item.speaker,
                blocks: [{ type: 'text' as const, text: item.text }],
              }));

              await createJournalTestSession(localChatsDir, {
                projectHash: PROJECT_HASH,
                contents,
              });

              const result = await resumeSession(
                makeResumeRequest(localChatsDir),
              );

              const okResult = expectOk(result);
              expect(
                await collectBootRows(okResult.boot.streamRows()),
              ).toHaveLength(contents.length);
              for (let i = 0; i < contents.length; i++) {
                expect(
                  (await collectBootRows(okResult.boot.streamRows()))[i]
                    .speaker,
                ).toBe(contents[i].speaker);
                expect(
                  (await collectBootRows(okResult.boot.streamRows()))[i]
                    .blocks[0],
                ).toStrictEqual(contents[i].blocks[0]);
              }
              await okResult.recording.dispose();
              await okResult.lockHandle.release();
            } finally {
              await fs.rm(localTempDir, { recursive: true, force: true });
            }
          },
        ),
      ));
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: detects provider mismatch for any two different provider strings @requirement:REQ-RSM-005', () => {
  useResumeFixture();
  describe('Property-Based Tests @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 28: Provider mismatch detection works for any provider strings
     * fc.string pairs, verify mismatch detected when different
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-005
     */
    it('detects provider mismatch for any two different provider strings @requirement:REQ-RSM-005', async () =>
      fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          async (sessionProvider, currentProvider) => {
            fc.pre(sessionProvider !== currentProvider);

            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-provider-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              await createJournalTestSession(localChatsDir, {
                projectHash: PROJECT_HASH,
                provider: sessionProvider,
                model: 'model-a',
              });

              const result = await resumeSession(
                makeResumeRequest(localChatsDir, {
                  currentProvider,
                  currentModel: 'model-b',
                }),
              );

              const okResult = expectOk(result);
              await okResult.recording.flush();

              const facts = await readJournalFileFacts(
                okResult.recording.getFilePath()!,
              );
              expect(facts).toBeDefined();
              expect(facts?.facts.provider).toBe(currentProvider);
              expect(facts?.facts.model).toBe('model-b');

              await okResult.recording.dispose();
              await okResult.lockHandle.release();
            } finally {
              await fs.rm(localTempDir, { recursive: true, force: true });
            }
          },
        ),
      ));
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: sequence is monotonic across resume boundary @requirement:REQ-RSM-006', () => {
  useResumeFixture();
  describe('Property-Based Tests @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 29: Sequence continuation after resume produces monotonic seq
     * fc.nat for original event count, resume, add events, verify monotonic
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-006
     */
    it('sequence is monotonic across resume boundary @requirement:REQ-RSM-006', async () =>
      fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 8 }),
          fc.integer({ min: 1, max: 5 }),
          async (originalCount, newCount) => {
            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-seq-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              const originalContents: IContent[] = [];
              for (let i = 0; i < originalCount; i++) {
                originalContents.push(makeContent(`original-${i}`));
              }

              await createJournalTestSession(localChatsDir, {
                projectHash: PROJECT_HASH,
                contents: originalContents,
              });

              const result = await resumeSession(
                makeResumeRequest(localChatsDir),
              );

              const okResult = expectOk(result);
              if (!(okResult.recording instanceof JournalRecordingService))
                throw new Error('Expected journal recorder');
              const session = await okResult.recording.session();
              let previous = session.store.published?.commitSeq;
              if (previous === undefined)
                throw new Error('Missing resumed version');
              for (let i = 0; i < newCount; i++) {
                await session.append([makeContent(`new-${i}`)]);
                const next = session.store.published?.commitSeq;
                expect(next).toBeGreaterThan(previous);
                if (next === undefined)
                  throw new Error('Missing appended version');
                previous = next;
              }
              const contents = await Array.fromAsync(session.rows());
              expect(
                contents.map(({ content }) => content.blocks),
              ).toStrictEqual(
                [
                  ...originalContents,
                  ...Array.from({ length: newCount }, (_, i) =>
                    makeContent(`new-${i}`),
                  ),
                ].map((content) => content.blocks),
              );

              await okResult.recording.dispose();
              await okResult.lockHandle.release();
            } finally {
              await fs.rm(localTempDir, { recursive: true, force: true });
            }
          },
        ),
      ));
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: resume always returns a non-null active recording service @requirement:REQ-RSM-006', () => {
  useResumeFixture();
  describe('Property-Based Tests @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 32: Resume result always has non-null recording service
     * fc.nat(1-5) for session events, resume, verify recording is defined
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-006
     */
    it('resume always returns a non-null active recording service @requirement:REQ-RSM-006', async () =>
      fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          async (contentCount) => {
            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-recording-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              const contents: IContent[] = [];
              for (let i = 0; i < contentCount; i++) {
                contents.push(makeContent(`content-${i}`));
              }

              await createJournalTestSession(localChatsDir, {
                projectHash: PROJECT_HASH,
                contents,
              });

              const result = await resumeSession(
                makeResumeRequest(localChatsDir),
              );

              const okResult = expectOk(result);
              expect(okResult.recording).toBeDefined();
              expect(okResult.recording.getFilePath()).not.toBeNull();
              expect(okResult.recording.isActive()).toBe(true);
              await okResult.recording.dispose();
              await okResult.lockHandle.release();
            } finally {
              await fs.rm(localTempDir, { recursive: true, force: true });
            }
          },
        ),
      ));
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: compression + new content produces correct history length @requirement:REQ-RSM-004', () => {
  useResumeFixture();
  describe('Property-Based Tests @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Test 33: Compression followed by content produces correct resume history length
     * fc.nat pairs for pre/post compression counts, resume, verify
     * history length = 1 (summary) + post-compression count
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-004
     */
    it('compression + new content produces correct history length @requirement:REQ-RSM-004', async () =>
      fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 0, max: 5 }),
          async (preCompressCount, postCompressCount) => {
            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-compress-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              const sessionId = crypto.randomUUID();
              const config = makeConfig(localChatsDir, {
                sessionId,
                projectHash: PROJECT_HASH,
              });
              const svc = JournalRecordingService.create(config);

              const session = await svc.session();

              // Pre-compression content
              for (let i = 0; i < preCompressCount; i++) {
                await session.append([makeContent(`pre-${i}`)]);
              }

              // Compression
              const summary: IContent = {
                speaker: 'ai',
                blocks: [{ type: 'text', text: 'Summary' }],
                metadata: { isSummary: true },
              };
              const version = session.store.published;
              if (version === undefined)
                throw new Error('Missing seeded version');
              await session.store.commit([
                {
                  kind: 'compress',
                  summary: encodeContentRow(summary, { owner: 0 }),
                  retainFromLabel: version.nextLabel,
                  expectedReplaced: preCompressCount,
                },
              ]);

              // Post-compression content
              for (let i = 0; i < postCompressCount; i++) {
                await session.append([makeContent(`post-${i}`)]);
              }

              await svc.flush();
              await svc.dispose();

              const result = await resumeSession(
                makeResumeRequest(localChatsDir),
              );

              const okResult = expectOk(result);
              // history = 1 (summary) + postCompressCount
              expect(
                await collectBootRows(okResult.boot.streamRows()),
              ).toHaveLength(1 + postCompressCount);
              await okResult.recording.dispose();
              await okResult.lockHandle.release();
            } finally {
              await fs.rm(localTempDir, { recursive: true, force: true });
            }
          },
        ),
      ));
  });
});

describe('resumeSession @plan:PLAN-20260211-SESSIONRECORDING.P19: resume succeeds for any N content items @requirement:REQ-RSM-004', () => {
  useResumeFixture();
  describe('Property-Based Tests @plan:PLAN-20260211-SESSIONRECORDING.P19', () => {
    /**
     * Extra property: Resume succeeds for any number of content items
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P19
     * @requirement REQ-RSM-004
     */
    it('resume succeeds for any N content items @requirement:REQ-RSM-004', async () =>
      fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10 }),
          async (contentCount) => {
            const localTempDir = await fs.mkdtemp(
              path.join(os.tmpdir(), 'prop-any-count-'),
            );
            const localChatsDir = path.join(localTempDir, 'chats');
            await fs.mkdir(localChatsDir, { recursive: true });

            try {
              const contents: IContent[] = [];
              for (let i = 0; i < contentCount; i++) {
                contents.push(makeContent(`msg-${i}`, alternatingSpeaker(i)));
              }

              await createJournalTestSession(localChatsDir, {
                projectHash: PROJECT_HASH,
                contents,
              });

              const result = await resumeSession(
                makeResumeRequest(localChatsDir),
              );

              const okResult = expectOk(result);
              expect(
                await collectBootRows(okResult.boot.streamRows()),
              ).toHaveLength(contentCount);
              await okResult.recording.dispose();
              await okResult.lockHandle.release();
            } finally {
              await fs.rm(localTempDir, { recursive: true, force: true });
            }
          },
        ),
      ));
  });
});
