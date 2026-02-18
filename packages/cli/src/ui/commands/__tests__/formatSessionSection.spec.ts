/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * TDD tests for formatSessionSection function.
 * These tests should FAIL against the current stub (Red phase).
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P25
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { formatSessionSection } from '../formatSessionSection.js';
import type { SessionRecordingMetadata } from '../../types/SessionRecordingMetadata.js';

describe('formatSessionSection @plan:PLAN-20260214-SESSIONBROWSER.P25', () => {
  let tempDir: string;
  let tempFilePath: string;

  beforeEach(() => {
    // Create a temp directory and file for file size tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'));
    tempFilePath = path.join(tempDir, 'session-file.json');
    // Write some content to have a known file size
    fs.writeFileSync(tempFilePath, '{"test": "data with some content"}');
  });

  afterEach(() => {
    // Cleanup temp files
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Creates a valid metadata object for testing
   */
  function createMetadata(
    overrides: Partial<SessionRecordingMetadata> = {},
  ): SessionRecordingMetadata {
    return {
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      filePath: tempFilePath,
      startTime: new Date().toISOString(),
      isResumed: false,
      ...overrides,
    };
  }

  describe('Behavioral Tests', () => {
    /**
     * Test 1: No metadata (null input)
     * @requirement REQ-ST-006
     * @plan PLAN-20260214-SESSIONBROWSER.P25
     */
    it('returns lines containing "No active session recording." when metadata is null @requirement:REQ-ST-006 @plan:PLAN-20260214-SESSIONBROWSER.P25', async () => {
      const result = await formatSessionSection(null);

      expect(result.length).toBeGreaterThan(0);
      const joinedOutput = result.join('\n');
      expect(joinedOutput).toContain('No active session recording');
    });

    /**
     * Test 2: Session header
     * @requirement REQ-ST-001
     * @plan PLAN-20260214-SESSIONBROWSER.P25
     */
    it('output includes a "Session:" header line @requirement:REQ-ST-001 @plan:PLAN-20260214-SESSIONBROWSER.P25', async () => {
      const metadata = createMetadata();

      const result = await formatSessionSection(metadata);

      expect(result.length).toBeGreaterThan(0);
      const joinedOutput = result.join('\n');
      expect(joinedOutput).toMatch(/Session:/i);
    });

    /**
     * Test 3: Session ID truncation to 12 chars
     * @requirement REQ-ST-002
     * @plan PLAN-20260214-SESSIONBROWSER.P25
     */
    it('truncates 36-char UUID to first 12 characters @requirement:REQ-ST-002 @plan:PLAN-20260214-SESSIONBROWSER.P25', async () => {
      const fullUuid = '550e8400-e29b-41d4-a716-446655440000';
      const expectedTruncated = fullUuid.substring(0, 12); // '550e8400-e29'
      const metadata = createMetadata({ sessionId: fullUuid });

      const result = await formatSessionSection(metadata);

      const joinedOutput = result.join('\n');
      expect(joinedOutput).toContain(expectedTruncated);
      // Should NOT contain the full UUID
      expect(joinedOutput).not.toContain(fullUuid);
    });

    /**
     * Test 4: Session ID shorter than 12 chars
     * @requirement REQ-ST-002
     * @plan PLAN-20260214-SESSIONBROWSER.P25
     */
    it('shows full ID when session ID is shorter than 12 characters @requirement:REQ-ST-002 @plan:PLAN-20260214-SESSIONBROWSER.P25', async () => {
      const shortId = 'abc123';
      const metadata = createMetadata({ sessionId: shortId });

      const result = await formatSessionSection(metadata);

      const joinedOutput = result.join('\n');
      expect(joinedOutput).toContain(shortId);
    });

    /**
     * Test 5: Start time relative format
     * @requirement REQ-ST-003
     * @plan PLAN-20260214-SESSIONBROWSER.P25
     */
    it('output includes "Started:" with a relative time string @requirement:REQ-ST-003 @plan:PLAN-20260214-SESSIONBROWSER.P25', async () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const metadata = createMetadata({
        startTime: fiveMinutesAgo.toISOString(),
      });

      const result = await formatSessionSection(metadata);

      const joinedOutput = result.join('\n');
      expect(joinedOutput).toMatch(/Started:/i);
      // Should contain some relative time indicator (ago, minutes, etc.)
      expect(joinedOutput).toMatch(/ago|just now|minutes?|hours?/i);
    });

    /**
     * Test 6: File size when file exists
     * @requirement REQ-ST-004
     * @plan PLAN-20260214-SESSIONBROWSER.P25
     */
    it('includes "File size:" with formatted bytes when file exists @requirement:REQ-ST-004 @plan:PLAN-20260214-SESSIONBROWSER.P25', async () => {
      const metadata = createMetadata({ filePath: tempFilePath });

      const result = await formatSessionSection(metadata);

      const joinedOutput = result.join('\n');
      expect(joinedOutput).toMatch(/File size:/i);
      // Should contain some byte representation (B, KB, MB, etc.)
      expect(joinedOutput).toMatch(/\d+.*(?:B|KB|MB|bytes)/i);
    });

    /**
     * Test 7: File size when file does not exist
     * @requirement REQ-ST-004
     * @plan PLAN-20260214-SESSIONBROWSER.P25
     */
    it('handles non-existent filePath gracefully (no crash) @requirement:REQ-ST-004 @plan:PLAN-20260214-SESSIONBROWSER.P25', async () => {
      const metadata = createMetadata({
        filePath: '/nonexistent/path/to/file.json',
      });

      // Should not throw
      const result = await formatSessionSection(metadata);

      // Should still return some output
      expect(Array.isArray(result)).toBe(true);
    });

    /**
     * Test 8: File size when filePath is null/undefined
     * @requirement REQ-ST-004
     * @plan PLAN-20260214-SESSIONBROWSER.P25
     */
    it('handles null filePath without crashing @requirement:REQ-ST-004 @plan:PLAN-20260214-SESSIONBROWSER.P25', async () => {
      const metadata = createMetadata({ filePath: null });

      // Should not throw
      const result = await formatSessionSection(metadata);

      // Should still return some output
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    /**
     * Test 9: Resumed: yes
     * @requirement REQ-ST-005
     * @plan PLAN-20260214-SESSIONBROWSER.P25
     */
    it('shows "Resumed: yes" when isResumed is true @requirement:REQ-ST-005 @plan:PLAN-20260214-SESSIONBROWSER.P25', async () => {
      const metadata = createMetadata({ isResumed: true });

      const result = await formatSessionSection(metadata);

      const joinedOutput = result.join('\n');
      expect(joinedOutput).toMatch(/Resumed:\s*yes/i);
    });

    /**
     * Test 10: Resumed: no
     * @requirement REQ-ST-005
     * @plan PLAN-20260214-SESSIONBROWSER.P25
     */
    it('shows "Resumed: no" when isResumed is false @requirement:REQ-ST-005 @plan:PLAN-20260214-SESSIONBROWSER.P25', async () => {
      const metadata = createMetadata({ isResumed: false });

      const result = await formatSessionSection(metadata);

      const joinedOutput = result.join('\n');
      expect(joinedOutput).toMatch(/Resumed:\s*no/i);
    });
  });

  describe('Property-Based Tests', () => {
    /**
     * Test 11: Session ID truncation property
     * @requirement REQ-ST-002
     * @plan PLAN-20260214-SESSIONBROWSER.P25
     */
    it('truncates any sessionId >= 12 chars to exactly first 12 characters @requirement:REQ-ST-002 @plan:PLAN-20260214-SESSIONBROWSER.P25', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 12, maxLength: 100 }).filter(
            (s) =>
              // Filter out strings that have characters that might break parsing
              !/[\n\r\t]/.test(s),
          ),
          async (sessionId) => {
            const metadata = createMetadata({ sessionId });

            const result = await formatSessionSection(metadata);
            const joinedOutput = result.join('\n');

            const truncated = sessionId.substring(0, 12);
            // The output should contain the truncated ID
            expect(joinedOutput).toContain(truncated);

            // If the original ID is longer than 12, it should NOT appear in full
            if (sessionId.length > 12) {
              expect(joinedOutput).not.toContain(sessionId);
            }
          },
        ),
        { numRuns: 50 },
      );
    });

    /**
     * Test 12: Resumed boolean mapping property
     * @requirement REQ-ST-005
     * @plan PLAN-20260214-SESSIONBROWSER.P25
     */
    it('maps any boolean to "yes" if true, "no" if false @requirement:REQ-ST-005 @plan:PLAN-20260214-SESSIONBROWSER.P25', async () => {
      await fc.assert(
        fc.asyncProperty(fc.boolean(), async (isResumed) => {
          const metadata = createMetadata({ isResumed });

          const result = await formatSessionSection(metadata);
          const joinedOutput = result.join('\n').toLowerCase();

          if (isResumed) {
            expect(joinedOutput).toMatch(/resumed:\s*yes/);
          } else {
            expect(joinedOutput).toMatch(/resumed:\s*no/);
          }
        }),
        { numRuns: 20 },
      );
    });

    /**
     * Test 13: Non-null metadata always has Session header
     * @requirement REQ-ST-001
     * @plan PLAN-20260214-SESSIONBROWSER.P25
     */
    it('any valid metadata always produces output with Session header @requirement:REQ-ST-001 @plan:PLAN-20260214-SESSIONBROWSER.P25', async () => {
      // Arbitrary metadata generator
      const metadataArb = fc.record({
        sessionId: fc
          .string({ minLength: 1, maxLength: 50 })
          .filter((s) => !/[\n\r\t]/.test(s) && s.trim().length > 0),
        filePath: fc.oneof(
          fc.constant(tempFilePath), // Existing file
          fc.constant(null), // Null
          fc.string({ minLength: 5, maxLength: 50 }).map((s) => `/tmp/${s}`), // Random path
        ),
        startTime: fc
          .integer({ min: Date.UTC(2020, 0, 1), max: Date.now() })
          .map((ms) => new Date(ms).toISOString()),
        isResumed: fc.boolean(),
      }) as fc.Arbitrary<SessionRecordingMetadata>;

      await fc.assert(
        fc.asyncProperty(metadataArb, async (metadata) => {
          const result = await formatSessionSection(metadata);

          // Should have non-empty output
          expect(result.length).toBeGreaterThan(0);

          // Should contain Session header
          const joinedOutput = result.join('\n');
          expect(joinedOutput).toMatch(/Session:/i);
        }),
        { numRuns: 30 },
      );
    });
  });
});
