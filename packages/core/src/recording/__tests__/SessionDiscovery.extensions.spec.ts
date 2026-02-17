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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionDiscovery } from '../SessionDiscovery.js';
import type {
  SessionRecordLine,
  SessionStartPayload,
  ContentPayload,
} from '../types.js';
import type { IContent } from '../../services/history/IContent.js';

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
    seq: number,
    sessionId: string,
    projectHash: string,
    options?: { provider?: string; model?: string },
  ): SessionRecordLine {
    const payload: SessionStartPayload = {
      sessionId,
      projectHash,
      workspaceDirs: ['/test/dir'],
      provider: options?.provider ?? 'anthropic',
      model: options?.model ?? 'claude-3',
      startTime: new Date().toISOString(),
    };
    return {
      v: 1,
      seq,
      ts: new Date().toISOString(),
      type: 'session_start',
      payload,
    };
  }

  /**
   * Helper to create a content event line
   */
  function createContentLine(
    seq: number,
    speaker: 'human' | 'ai' | 'tool',
    text: string,
  ): SessionRecordLine {
    const content: IContent = {
      speaker,
      blocks: [{ type: 'text', text }],
    };
    const payload: ContentPayload = { content };
    return {
      v: 1,
      seq,
      ts: new Date().toISOString(),
      type: 'content',
      payload,
    };
  }

  /**
   * Helper to create a content event with mixed parts
   */
  function createContentLineWithMixedParts(
    seq: number,
    speaker: 'human' | 'ai' | 'tool',
    textParts: string[],
    includeMedia: boolean = false,
  ): SessionRecordLine {
    const blocks: IContent['blocks'] = textParts.map((text) => ({
      type: 'text' as const,
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
    const payload: ContentPayload = { content };
    return {
      v: 1,
      seq,
      ts: new Date().toISOString(),
      type: 'content',
      payload,
    };
  }

  /**
   * Helper to create a tool call content line
   */
  function createToolCallLine(
    seq: number,
    toolName: string,
    callId: string,
  ): SessionRecordLine {
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
    const payload: ContentPayload = { content };
    return {
      v: 1,
      seq,
      ts: new Date().toISOString(),
      type: 'content',
      payload,
    };
  }

  /**
   * Helper to write a session file with given lines
   */
  async function writeSession(
    filename: string,
    lines: SessionRecordLine[],
  ): Promise<string> {
    const filePath = path.join(tempDir, filename);
    const content = lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
    await fs.writeFile(filePath, content);
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

  // =========================================================================
  // hasContentEvents Tests (6 tests)
  // =========================================================================

  describe('hasContentEvents', () => {
    it('returns false for session with only session_start', async () => {
      const filePath = await writeSession('empty-session.jsonl', [
        createSessionStartLine(1, 'sess-001', 'hash-abc'),
      ]);
      const result = await SessionDiscovery.hasContentEvents(filePath);
      expect(result).toBe(false);
    });

    it('returns true for session with content event', async () => {
      const filePath = await writeSession('with-content.jsonl', [
        createSessionStartLine(1, 'sess-002', 'hash-abc'),
        createContentLine(2, 'human', 'Hello, world!'),
      ]);
      const result = await SessionDiscovery.hasContentEvents(filePath);
      expect(result).toBe(true);
    });

    it('returns true for session with multiple events including content', async () => {
      const filePath = await writeSession('multi-content.jsonl', [
        createSessionStartLine(1, 'sess-003', 'hash-abc'),
        createContentLine(2, 'human', 'First message'),
        createContentLine(3, 'ai', 'Response'),
        createContentLine(4, 'human', 'Follow-up'),
      ]);
      const result = await SessionDiscovery.hasContentEvents(filePath);
      expect(result).toBe(true);
    });

    it('returns false for non-existent file', async () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.jsonl');
      const result = await SessionDiscovery.hasContentEvents(nonExistentPath);
      expect(result).toBe(false);
    });

    it('returns false for empty file (no lines)', async () => {
      const filePath = await writeRawFile('empty-file.jsonl', '');
      const result = await SessionDiscovery.hasContentEvents(filePath);
      expect(result).toBe(false);
    });

    it('returns false for file with only whitespace after header', async () => {
      const sessionStart = createSessionStartLine(1, 'sess-whitespace', 'hash');
      const content = JSON.stringify(sessionStart) + '\n   \n\t\n  \n';
      const filePath = await writeRawFile('whitespace-only.jsonl', content);
      const result = await SessionDiscovery.hasContentEvents(filePath);
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // listSessionsDetailed Tests (5 tests)
  // =========================================================================

  describe('listSessionsDetailed', () => {
    it('returns all valid sessions with skippedCount: 0', async () => {
      await writeSession('session-001.jsonl', [
        createSessionStartLine(1, 'sess-001', 'project-hash'),
        createContentLine(2, 'human', 'Hello'),
      ]);
      await writeSession('session-002.jsonl', [
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
      await writeSession('session-valid.jsonl', [
        createSessionStartLine(1, 'sess-valid', 'project-hash'),
        createContentLine(2, 'human', 'Valid'),
      ]);
      // Corrupted session - invalid JSON
      await writeRawFile('session-corrupted1.jsonl', '{ not valid json');
      // Corrupted session - missing required fields
      await writeRawFile('session-corrupted2.jsonl', '{"v":1}\n');

      const result = await SessionDiscovery.listSessionsDetailed(
        tempDir,
        'project-hash',
      );

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].sessionId).toBe('sess-valid');
      expect(result.skippedCount).toBe(2);
    });

    it('returns empty sessions array with skippedCount for all corrupted', async () => {
      await writeRawFile('session-bad1.jsonl', 'invalid json line');
      await writeRawFile('session-bad2.jsonl', '{"incomplete":');
      await writeRawFile('session-bad3.jsonl', '{}');

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
      // Create sessions with different timestamps
      const path1 = await writeSession('session-oldest.jsonl', [
        createSessionStartLine(1, 'sess-oldest', 'project-hash'),
      ]);
      // Add a small delay to ensure different mtimes
      await new Promise((resolve) => setTimeout(resolve, 50));
      const _path2 = await writeSession('session-middle.jsonl', [
        createSessionStartLine(1, 'sess-middle', 'project-hash'),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const _path3 = await writeSession('session-newest.jsonl', [
        createSessionStartLine(1, 'sess-newest', 'project-hash'),
      ]);

      // Touch the oldest file to make it newest
      const now = new Date();
      await fs.utimes(path1, now, now);

      const result = await SessionDiscovery.listSessionsDetailed(
        tempDir,
        'project-hash',
      );

      expect(result.sessions).toHaveLength(3);
      // After touching, sess-oldest should be first (newest mtime)
      expect(result.sessions[0].sessionId).toBe('sess-oldest');
    });
  });

  // =========================================================================
  // readFirstUserMessage Tests (12 tests)
  // =========================================================================

  describe('readFirstUserMessage', () => {
    it('returns text from single user message', async () => {
      const filePath = await writeSession('single-user.jsonl', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLine(2, 'human', 'Hello, this is my first message'),
      ]);
      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      expect(result).toBe('Hello, this is my first message');
    });

    it('returns FIRST user message when multiple exist', async () => {
      const filePath = await writeSession('multi-user.jsonl', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLine(2, 'human', 'First user message'),
        createContentLine(3, 'ai', 'AI response'),
        createContentLine(4, 'human', 'Second user message'),
      ]);
      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      expect(result).toBe('First user message');
    });

    it('returns null when no user messages exist (system only)', async () => {
      const filePath = await writeSession('system-only.jsonl', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLine(2, 'ai', 'AI greeting'),
      ]);
      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      expect(result).toBeNull();
    });

    it('extracts text correctly from message with TextPart only', async () => {
      const filePath = await writeSession('text-part.jsonl', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLine(2, 'human', 'Simple text content'),
      ]);
      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      expect(result).toBe('Simple text content');
    });

    it('concatenates text from mixed parts (Text + Media)', async () => {
      const filePath = await writeSession('mixed-parts.jsonl', [
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

      const filePath = await writeSession('long-message.jsonl', [
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

      const filePath = await writeSession('exact-120.jsonl', [
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

      const filePath = await writeSession('under-120.jsonl', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLine(2, 'human', shortMessage),
      ]);
      const result = await SessionDiscovery.readFirstUserMessage(filePath, 120);
      expect(result).toBe(shortMessage);
      expect(result).toHaveLength(119);
    });

    it('returns empty string or null for empty text in TextPart', async () => {
      const filePath = await writeSession('empty-text.jsonl', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLine(2, 'human', ''),
      ]);
      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      // Empty string or null are both acceptable
      expect(result === '' || result === null).toBe(true);
    });

    it('returns null for valid JSON with unexpected schema', async () => {
      // Valid JSON but not matching expected structure
      const weirdLine = JSON.stringify({
        v: 1,
        seq: 2,
        ts: new Date().toISOString(),
        type: 'content',
        payload: { unexpected: 'schema', no_content: true },
      });
      const content =
        JSON.stringify(createSessionStartLine(1, 'sess-001', 'hash')) +
        '\n' +
        weirdLine +
        '\n';
      const filePath = await writeRawFile('weird-schema.jsonl', content);

      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      expect(result).toBeNull();
    });

    it('returns null for file I/O error (unreadable file)', async () => {
      const filePath = path.join(tempDir, 'unreadable.jsonl');
      await fs.writeFile(filePath, 'content');
      // Make file unreadable (this may not work on all platforms)
      try {
        await fs.chmod(filePath, 0o000);
        const result = await SessionDiscovery.readFirstUserMessage(filePath);
        expect(result).toBeNull();
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(filePath, 0o644);
      }
    });

    it('returns null for non-existent file', async () => {
      const nonExistentPath = path.join(tempDir, 'ghost.jsonl');
      const result =
        await SessionDiscovery.readFirstUserMessage(nonExistentPath);
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Edge Cases Tests (4 tests)
  // =========================================================================

  describe('edge cases', () => {
    it('handles JSONL with trailing newline correctly', async () => {
      const lines = [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createContentLine(2, 'human', 'Message'),
      ];
      const content =
        lines.map((line) => JSON.stringify(line)).join('\n') + '\n\n\n';
      const filePath = await writeRawFile('trailing-newlines.jsonl', content);

      const hasContent = await SessionDiscovery.hasContentEvents(filePath);
      expect(hasContent).toBe(true);

      const firstMsg = await SessionDiscovery.readFirstUserMessage(filePath);
      expect(firstMsg).toBe('Message');
    });

    it('reads efficiently until first user found (large file)', async () => {
      // Create a file with many AI messages before the first user message
      const lines: SessionRecordLine[] = [
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

      const filePath = await writeSession('large-file.jsonl', lines);

      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      expect(result).toBe('First user after many AI');
    });

    it('skips tool-call events before user message', async () => {
      const filePath = await writeSession('tool-calls-first.jsonl', [
        createSessionStartLine(1, 'sess-001', 'hash'),
        createToolCallLine(2, 'read_file', 'call-001'),
        createToolCallLine(3, 'write_file', 'call-002'),
        createContentLine(4, 'human', 'User message after tools'),
      ]);

      const result = await SessionDiscovery.readFirstUserMessage(filePath);
      expect(result).toBe('User message after tools');
    });

    it('skips model response before user message', async () => {
      const filePath = await writeSession('ai-first.jsonl', [
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
            const lines: SessionRecordLine[] = [
              createSessionStartLine(1, 'sess-prop', 'hash'),
            ];
            if (includeContent) {
              lines.push(createContentLine(2, 'human', messageText));
            }
            const filePath = await writeSession(
              `idempotent-${Date.now()}-${Math.random()}.jsonl`,
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
          fc.oneof(
            fc.constant('valid'),
            fc.constant('empty'),
            fc.constant('invalid-json'),
            fc.constant('non-existent'),
          ),
          async (fileType) => {
            let filePath: string;

            switch (fileType) {
              case 'valid':
                filePath = await writeSession(
                  `prop-valid-${Date.now()}.jsonl`,
                  [
                    createSessionStartLine(1, 'sess', 'hash'),
                    createContentLine(2, 'human', 'Message'),
                  ],
                );
                break;
              case 'empty':
                filePath = await writeRawFile(
                  `prop-empty-${Date.now()}.jsonl`,
                  '',
                );
                break;
              case 'invalid-json':
                filePath = await writeRawFile(
                  `prop-invalid-${Date.now()}.jsonl`,
                  'not json',
                );
                break;
              case 'non-existent':
                filePath = path.join(
                  tempDir,
                  `non-existent-${Date.now()}.jsonl`,
                );
                break;
              default:
                throw new Error(`Unknown file type: ${fileType}`);
            }

            const result =
              await SessionDiscovery.readFirstUserMessage(filePath);
            expect(result === null || typeof result === 'string').toBe(true);
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
              `prop-length-${Date.now()}-${Math.random()}.jsonl`,
              [
                createSessionStartLine(1, 'sess', 'hash'),
                createContentLine(2, 'human', messageText),
              ],
            );

            const result = await SessionDiscovery.readFirstUserMessage(
              filePath,
              120,
            );

            if (result !== null) {
              expect(result.length).toBeLessThanOrEqual(120);
            }
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
              await writeRawFile(
                path.relative(
                  tempDir,
                  path.join(testDir, `session-valid-${i}.jsonl`),
                ),
                JSON.stringify(
                  createSessionStartLine(1, `sess-${i}`, 'prop-hash'),
                ) + '\n',
              );
            }

            // Create invalid sessions
            for (let i = 0; i < invalidCount; i++) {
              await writeRawFile(
                path.relative(
                  tempDir,
                  path.join(testDir, `session-invalid-${i}.jsonl`),
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
              `prop-arb-${Date.now()}-${Math.random()}.jsonl`,
              [
                createSessionStartLine(1, 'sess', 'hash'),
                createContentLine(2, 'human', messageText),
              ],
            );

            const result =
              await SessionDiscovery.readFirstUserMessage(filePath);

            // Result should either be the original (if short enough) or truncated
            if (result !== null) {
              expect(typeof result).toBe('string');
            }
          },
        ),
        { numRuns: 15 },
      );
    });
  });
});
