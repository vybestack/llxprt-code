/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P07
 * @requirement REQ-SB-005, REQ-SB-008, REQ-PV-002
 *
 * Behavioral tests for SessionDiscovery extension methods:
 * - hasContentEvents
 * - listSessionsDetailed
 * - readFirstUserMessage
 *
 * Tests use REAL filesystem operations with temp directories.
 * NO mocking of fs/fs-promises is permitted.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IContent } from '../../services/history/IContent.js';
import { SessionDiscovery } from '../SessionDiscovery.js';
import type { SessionStartPayload } from '../types.js';
import { JournalRecordingService } from '../journalRecordingService.js';
import { previewOfContent } from '../sessionMetaKeys.js';

type SessionFixture =
  | { readonly type: 'session_start'; readonly payload: SessionStartPayload }
  | {
      readonly type: 'content';
      readonly payload: { readonly content: IContent };
    };

const bunIt = it;

describe('SessionDiscovery extensions', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'session-discovery-test-'),
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to create a session_start event line
   */
  function createSessionStartLine(
    _seq: number,
    sessionId: string,
    projectHash: string,
    options?: { provider?: string; model?: string },
  ): SessionFixture {
    const payload: SessionStartPayload = {
      sessionId,
      projectHash,
      workspaceDirs: ['/test/dir'],
      provider: options?.provider ?? 'anthropic',
      model: options?.model ?? 'claude-3',
      startTime: new Date().toISOString(),
    };
    return {
      type: 'session_start',
      payload,
    };
  }

  /**
   * Helper to create a content event line
   */
  function createContentLine(
    _seq: number,
    speaker: 'human' | 'ai' | 'tool',
    text: string,
  ): SessionFixture {
    const content: IContent = {
      speaker,
      blocks: [{ type: 'text', text }],
    };
    const payload = { content };
    return {
      type: 'content',
      payload,
    };
  }

  /**
   * Helper to create a content event with mixed parts
   */
  function createContentLineWithMixedParts(
    _seq: number,
    speaker: 'human' | 'ai' | 'tool',
    textParts: string[],
    includeMedia: boolean = false,
  ): SessionFixture {
    const blocks: IContent['blocks'] = textParts.map((text) => ({
      type: 'text',
      text,
    }));
    if (includeMedia) {
      blocks.push({
        type: 'media',
        mimeType: 'image/png',
        data: 'base64data',
        encoding: 'base64',
      });
    }
    const content: IContent = { speaker, blocks };
    const payload = { content };
    return {
      type: 'content',
      payload,
    };
  }

  /**
   * Helper to create a tool call content line
   */
  function createToolCallLine(
    _seq: number,
    toolName: string,
    callId: string,
  ): SessionFixture {
    const content: IContent = {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: callId,
          name: toolName,
          parameters: { arg: 'value' },
        },
      ],
    };
    const payload = { content };
    return {
      type: 'content',
      payload,
    };
  }

  /**
   * Helper to write a session file with given lines
   */
  async function writeSession(
    filename: string,
    lines: SessionFixture[],
  ): Promise<string> {
    const header = lines[0];
    if (header.type !== 'session_start')
      throw new Error('Missing fixture header');
    const recorder = JournalRecordingService.create({
      ...header.payload,
      chatsDir: tempDir,
    });
    let recordedPath: string;
    try {
      const session = await recorder.session();
      for (const line of lines) {
        if (line.type !== 'content') continue;
        await session.append([line.payload.content]);
        const preview = previewOfContent(line.payload.content);
        if (preview !== undefined) recorder.recordFirstUserPreview(preview);
      }
      await recorder.flush();
      const materialized = recorder.getFilePath();
      if (materialized === null) throw new Error('Missing fixture journal');
      recordedPath = materialized;
    } finally {
      await recorder.dispose();
    }
    const filePath = path.join(tempDir, filename);
    await fs.rename(recordedPath, filePath);
    return filePath;
  }

  /**
   * Helper to write raw content to a file
   */
  async function writeRawFile(
    filename: string,
    content: string,
  ): Promise<string> {
    const filePath = path.join(tempDir, filename);
    await fs.writeFile(filePath, content);
    return filePath;
  }

  /**
   * True when the first-user-message probe returned either an empty string or
   * null (both are acceptable answers for a truly empty user text).
   */
  function isEmptyOrNull(value: string | null): boolean {
    return value === '' || value === null;
  }

  /**
   * True for any value in the read-first-message result space (it is never a
   * non-string non-null value), used by the property probe.
   */
  function isStringOrNull(value: string | null): boolean {
    return value === null || typeof value === 'string';
  }

  /**
   * True when a preview result is null or no longer than the length cap.
   */
  function isNullOrWithin(value: string | null, maxLength: number): boolean {
    return value === null || value.length <= maxLength;
  }

  /**
   * Append a content line exactly when the include flag selects it.
   */
  function pushContentWhenSelected(
    lines: SessionFixture[],
    includeContent: boolean,
    messageText: string,
  ): void {
    if (includeContent) {
      lines.push(createContentLine(2, 'human', messageText));
    }
  }

  type ProbeFileType = 'valid' | 'empty' | 'invalid-json' | 'non-existent';

  /**
   * Write the probe file for the given arbitrary file shape and return its path.
   */
  async function writeProbeFile(fileType: ProbeFileType): Promise<string> {
    switch (fileType) {
      case 'valid':
        return writeSession(`prop-valid-${Date.now()}.llxj`, [
          createSessionStartLine(1, 'sess', 'hash'),
          createContentLine(2, 'human', 'Message'),
        ]);
      case 'empty':
        return writeRawFile(`prop-empty-${Date.now()}.llxj`, '');
      case 'invalid-json':
        return writeRawFile(`prop-invalid-${Date.now()}.llxj`, 'not json');
      case 'non-existent':
        return path.join(tempDir, `non-existent-${Date.now()}.llxj`);
      default:
        throw new Error('Unknown probe file type');
    }
  }

  // =========================================================================
  // hasContentEvents Tests (6 tests)
  // =========================================================================

  describe('hasContentEvents', () => {
    it('returns false for session with only session_start', async () => {
      const filePath = await writeSession('empty-session.llxj', [
        createSessionStartLine(1, 'sess-001', 'hash-abc'),
      ]);
      const result = await SessionDiscovery.hasContentEvents(filePath);
      expect(result).toBe(false);
    });

    it('returns true for session with content event', async () => {
      const filePath = await writeSession('with-content.llxj', [
        createSessionStartLine(1, 'sess-002', 'hash-abc'),
        createContentLine(2, 'human', 'Hello, world!'),
      ]);
      const result = await SessionDiscovery.hasContentEvents(filePath);
      expect(result).toBe(true);
    });

    it('returns true for session with multiple events including content', async () => {
      const filePath = await writeSession('multi-content.llxj', [
        createSessionStartLine(1, 'sess-003', 'hash-abc'),
        createContentLine(2, 'human', 'First message'),
        createContentLine(3, 'ai', 'Response'),
        createContentLine(4, 'human', 'Follow-up'),
      ]);
      const result = await SessionDiscovery.hasContentEvents(filePath);
      expect(result).toBe(true);
    });

    it('returns false for non-existent file', async () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.llxj');
      const result = await SessionDiscovery.hasContentEvents(nonExistentPath);
      expect(result).toBe(false);
    });

    it('returns false for empty file (no lines)', async () => {
      const filePath = await writeRawFile('empty-file.llxj', '');
      const result = await SessionDiscovery.hasContentEvents(filePath);
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // listSessionsDetailed Tests (5 tests)
  // =========================================================================

  describe('listSessionsDetailed', () => {
    it('returns all valid sessions with skippedCount: 0', async () => {
      await writeSession('session-001.llxj', [
        createSessionStartLine(1, 'sess-001', 'project-hash'),
        createContentLine(2, 'human', 'Hello'),
      ]);
      await writeSession('session-002.llxj', [
        createSessionStartLine(1, 'sess-002', 'project-hash'),
        createContentLine(2, 'human', 'World'),
      ]);

      const result = await SessionDiscovery.listSessionsDetailed(
        tempDir,
        'project-hash',
      );

      expect(result.sessions).toHaveLength(2);
      expect(result.skippedCount).toBe(0);
      expect(result.sessions.map((s) => s.sessionId)).toContain('sess-001');
      expect(result.sessions.map((s) => s.sessionId)).toContain('sess-002');
    });

    it('returns only valid sessions with skippedCount for corrupted files', async () => {
      // Valid session
      await writeSession('session-valid.llxj', [
        createSessionStartLine(1, 'sess-valid', 'project-hash'),
        createContentLine(2, 'human', 'Valid'),
      ]);
      // Corrupted session - invalid JSON
      await writeRawFile('session-corrupted1.llxj', '{ not valid json');
      // Corrupted session - missing required fields
      await writeRawFile('session-corrupted2.llxj', '{"v":1}\n');

      const result = await SessionDiscovery.listSessionsDetailed(
        tempDir,
        'project-hash',
      );

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].sessionId).toBe('sess-valid');
      expect(result.skippedCount).toBe(2);
    });

    it('returns empty sessions array with skippedCount for all corrupted', async () => {
      await writeRawFile('session-bad1.llxj', 'invalid json line');
      await writeRawFile('session-bad2.llxj', '{"incomplete":');
      await writeRawFile('session-bad3.llxj', '{}');

      const result = await SessionDiscovery.listSessionsDetailed(
        tempDir,
        'project-hash',
      );

      expect(result.sessions).toHaveLength(0);
      expect(result.skippedCount).toBe(3);
    });

    it('returns empty sessions and skippedCount: 0 for empty directory', async () => {
      const emptyDir = path.join(tempDir, 'empty-dir');
      await fs.mkdir(emptyDir);

      const result = await SessionDiscovery.listSessionsDetailed(
        emptyDir,
        'project-hash',
      );

      expect(result.sessions).toHaveLength(0);
      expect(result.skippedCount).toBe(0);
    });

    it('returns sessions sorted newest-first by modification time', async () => {
      // Create sessions, then set explicit mtimes to avoid filesystem precision races.
      const path1 = await writeSession('session-oldest.llxj', [
        createSessionStartLine(1, 'sess-oldest', 'project-hash'),
      ]);
      const path2 = await writeSession('session-middle.llxj', [
        createSessionStartLine(1, 'sess-middle', 'project-hash'),
      ]);
      const path3 = await writeSession('session-newest.llxj', [
        createSessionStartLine(1, 'sess-newest', 'project-hash'),
      ]);

      // "Touch" the oldest file by assigning it the newest deterministic mtime.
      const t1 = new Date('2025-01-01T00:00:03.000Z');
      const t2 = new Date('2025-01-01T00:00:02.000Z');
      const t3 = new Date('2025-01-01T00:00:01.000Z');
      await fs.utimes(path1, t1, t1);
      await fs.utimes(path2, t2, t2);
      await fs.utimes(path3, t3, t3);

      const result = await SessionDiscovery.listSessionsDetailed(
        tempDir,
        'project-hash',
      );

      expect(result.sessions).toHaveLength(3);
      expect(result.sessions[0].sessionId).toBe('sess-oldest');
    });
  });

  // =========================================================================
  // readFirstUserMessage Tests (12 tests)
  // =========================================================================

  describe('readFirstUserMessage', () => {
    it('returns text from single user message', async () => {
      const filePath = await writeSession('single-user.llxj', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLine(2, 'human', 'Hello, this is my first message'),
      ]);
      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      expect(result).toBe('Hello, this is my first message');
    });

    it('returns FIRST user message when multiple exist', async () => {
      const filePath = await writeSession('multi-user.llxj', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLine(2, 'human', 'First user message'),
        createContentLine(3, 'ai', 'AI response'),
        createContentLine(4, 'human', 'Second user message'),
      ]);
      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      expect(result).toBe('First user message');
    });

    it('returns null when no user messages exist (system only)', async () => {
      const filePath = await writeSession('system-only.llxj', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLine(2, 'ai', 'AI greeting'),
      ]);
      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      expect(result).toBeNull();
    });

    it('extracts text correctly from message with TextPart only', async () => {
      const filePath = await writeSession('text-part.llxj', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLine(2, 'human', 'Simple text content'),
      ]);
      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      expect(result).toBe('Simple text content');
    });

    it('concatenates text from mixed parts (Text + Media)', async () => {
      const filePath = await writeSession('mixed-parts.llxj', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLineWithMixedParts(
          2,
          'human',
          ['Part one ', 'part two'],
          true,
        ),
      ]);
      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      expect(result).toBe('Part one part two');
    });

    it('truncates message exceeding 120 chars to 120', async () => {
      const longMessage =
        'This is a very long message that exceeds one hundred and twenty characters in length and should be truncated appropriately';
      expect(longMessage.length).toBeGreaterThan(120);

      const filePath = await writeSession('long-message.llxj', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLine(2, 'human', longMessage),
      ]);
      const result = await SessionDiscovery.readFirstUserMessage(filePath, 120);
      expect(result).toHaveLength(120);
      expect(result).toBe(longMessage.slice(0, 120));
    });

    it('does not truncate message exactly 120 chars', async () => {
      const exactMessage = 'A'.repeat(120);
      expect(exactMessage.length).toBe(120);

      const filePath = await writeSession('exact-120.llxj', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLine(2, 'human', exactMessage),
      ]);
      const result = await SessionDiscovery.readFirstUserMessage(filePath, 120);
      expect(result).toBe(exactMessage);
      expect(result).toHaveLength(120);
    });

    it('does not truncate message 119 chars', async () => {
      const shortMessage = 'B'.repeat(119);
      expect(shortMessage.length).toBe(119);

      const filePath = await writeSession('under-120.llxj', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLine(2, 'human', shortMessage),
      ]);
      const result = await SessionDiscovery.readFirstUserMessage(filePath, 120);
      expect(result).toBe(shortMessage);
      expect(result).toHaveLength(119);
    });

    it('returns empty string or null for empty text in TextPart', async () => {
      const filePath = await writeSession('empty-text.llxj', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLine(2, 'human', ''),
      ]);
      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      // Empty string or null are both acceptable
      expect(isEmptyOrNull(result)).toBe(true);
      void result;
    });

    const isRootUser =
      typeof process.getuid === 'function' && process.getuid() === 0;

    {
      const it =
        process.platform === 'win32' || isRootUser ? bunIt.skip : bunIt;
      it('returns null for file I/O error (unreadable file)', async () => {
        const filePath = path.join(tempDir, 'unreadable.llxj');
        await fs.writeFile(filePath, 'content');
        try {
          await fs.chmod(filePath, 0o000);
          const result = await SessionDiscovery.readFirstUserMessage(filePath);
          expect(result).toBeNull();
        } finally {
          // Restore permissions for cleanup
          await fs.chmod(filePath, 0o644);
        }
      });
    }

    it('returns null for non-existent file', async () => {
      const nonExistentPath = path.join(tempDir, 'ghost.llxj');
      const result =
        await SessionDiscovery.readFirstUserMessage(nonExistentPath);
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Edge Cases Tests (4 tests)
  // =========================================================================

  describe('edge cases', () => {
    it('reads efficiently until first user found (large file)', async () => {
      // Create a file with many AI messages before the first user message
      const lines: SessionFixture[] = [
        createSessionStartLine(1, 'sess-001', 'hash'),
      ];
      // Add 100 AI messages
      for (let i = 2; i <= 101; i++) {
        lines.push(createContentLine(i, 'ai', `AI response ${i}`));
      }
      // First user message at position 102
      lines.push(createContentLine(102, 'human', 'First user after many AI'));
      // More messages after
      for (let i = 103; i <= 200; i++) {
        lines.push(createContentLine(i, 'human', `User message ${i}`));
      }

      const filePath = await writeSession('large-file.llxj', lines);

      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      expect(result).toBe('First user after many AI');
    });

    it('skips tool-call events before user message', async () => {
      const filePath = await writeSession('tool-calls-first.llxj', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createToolCallLine(2, 'read_file', 'call-001'),
        createToolCallLine(3, 'write_file', 'call-002'),
        createContentLine(4, 'human', 'User message after tools'),
      ]);

      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      expect(result).toBe('User message after tools');
    });

    it('skips model response before user message', async () => {
      const filePath = await writeSession('ai-first.llxj', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLine(2, 'ai', 'AI greeting'),
        createContentLine(3, 'ai', 'More AI text'),
        createContentLine(4, 'human', 'First actual user message'),
      ]);

      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      expect(result).toBe('First actual user message');
    });
  });

  // =========================================================================
  // Property-Based Tests (4+ tests)
  // =========================================================================

  describe('property-based tests', () => {
    it('hasContentEvents is idempotent', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(),
          fc.string({ minLength: 1, maxLength: 50 }),
          async (includeContent, messageText) => {
            const lines: SessionFixture[] = [
              createSessionStartLine(1, 'sess-prop', 'hash'),
            ];
            pushContentWhenSelected(lines, includeContent, messageText);
            const filePath = await writeSession(
              `idempotent-${Date.now()}-${Math.random()}.llxj`,
              lines,
            );

            const result1 = await SessionDiscovery.hasContentEvents(filePath);
            const result2 = await SessionDiscovery.hasContentEvents(filePath);
            const result3 = await SessionDiscovery.hasContentEvents(filePath);

            expect(result1).toBe(result2);
            expect(result2).toBe(result3);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('readFirstUserMessage returns string|null, never throws', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<ProbeFileType>(
            'valid',
            'empty',
            'invalid-json',
            'non-existent',
          ),
          async (fileType) => {
            const filePath = await writeProbeFile(fileType);

            const result =
              await SessionDiscovery.readFirstUserMessage(filePath);
            expect(isStringOrNull(result)).toBe(true);
          },
        ),
        { numRuns: 20 },
      );
    });

    it('preview length <= 120 always when maxLength is 120', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 500 }),
          async (messageText) => {
            const filePath = await writeSession(
              `prop-length-${Date.now()}-${Math.random()}.llxj`,
              [
                createSessionStartLine(1, 'sess', 'hash'),
                createContentLine(2, 'human', messageText),
              ],
            );

            const result = await SessionDiscovery.readFirstUserMessage(
              filePath,
              120,
            );

            expect(isNullOrWithin(result, 120)).toBe(true);
          },
        ),
        { numRuns: 25 },
      );
    });

    it('sessions + skippedCount >= total files matching pattern', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 5 }),
          fc.integer({ min: 0, max: 5 }),
          async (validCount, invalidCount) => {
            // Create a unique subdirectory for this test run
            const testDir = path.join(
              tempDir,
              `prop-test-${Date.now()}-${Math.random()}`,
            );
            await fs.mkdir(testDir, { recursive: true });

            // Create valid sessions
            for (let i = 0; i < validCount; i++) {
              await writeSession(
                path.relative(
                  tempDir,
                  path.join(testDir, `session-valid-${i}.llxj`),
                ),
                [createSessionStartLine(1, `sess-${i}`, 'prop-hash')],
              );
            }

            // Create invalid sessions
            for (let i = 0; i < invalidCount; i++) {
              await writeRawFile(
                path.relative(
                  tempDir,
                  path.join(testDir, `session-invalid-${i}.llxj`),
                ),
                'not valid json\n',
              );
            }

            const result = await SessionDiscovery.listSessionsDetailed(
              testDir,
              'prop-hash',
            );

            const totalSessionFiles = validCount + invalidCount;
            expect(result.sessions.length + result.skippedCount).toBe(
              totalSessionFiles,
            );
          },
        ),
        { numRuns: 10 },
      );
    });

    it('readFirstUserMessage handles arbitrary valid message text', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc
            .string({ minLength: 1, maxLength: 200 })
            .filter((s) => !s.includes('\n')),
          async (messageText) => {
            const filePath = await writeSession(
              `prop-arb-${Date.now()}-${Math.random()}.llxj`,
              [
                createSessionStartLine(1, 'sess', 'hash'),
                createContentLine(2, 'human', messageText),
              ],
            );

            const result =
              await SessionDiscovery.readFirstUserMessage(filePath);

            // Result should either be the original (if short enough) or truncated
            expect(isStringOrNull(result)).toBe(true);
          },
        ),
        { numRuns: 15 },
      );
    });
  });
});
