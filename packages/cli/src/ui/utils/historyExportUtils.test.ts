/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, unlink } from 'node:fs/promises';
import {
  sanitizeTranscript,
  exportHistoryForBugReport,
} from './historyExportUtils.js';
import { Content } from '@google/genai';

describe('historyExportUtils', () => {
  describe('sanitizeTranscript', () => {
    it('should redact LLXPRT_API_KEY', () => {
      const text = 'Config: LLXPRT_API_KEY=secret123456';
      const result = sanitizeTranscript(text);
      expect(result).toBe('Config: LLXPRT_API_KEY=[REDACTED]');
      expect(result).not.toContain('secret123456');
    });

    it('should redact OPENAI_API_KEY', () => {
      const text = 'Using OPENAI_API_KEY=sk-1234567890abcdef';
      const result = sanitizeTranscript(text);
      expect(result).toBe('Using OPENAI_API_KEY=[REDACTED]');
    });

    it('should redact ANTHROPIC_API_KEY', () => {
      const text = 'Set ANTHROPIC_API_KEY=anthropic-key-abc123';
      const result = sanitizeTranscript(text);
      expect(result).toBe('Set ANTHROPIC_API_KEY=[REDACTED]');
    });

    it('should redact GEMINI_API_KEY', () => {
      const text = 'GEMINI_API_KEY=gemini-key-xyz';
      const result = sanitizeTranscript(text);
      expect(result).toBe('GEMINI_API_KEY=[REDACTED]');
    });

    it('should redact OpenAI-style keys (sk-...)', () => {
      const text = 'The key is sk-1234567890abcdefghijklmnopqrstuvwxyz';
      const result = sanitizeTranscript(text);
      expect(result).toBe('The key is sk-[REDACTED]');
    });

    it('should redact GitHub personal access tokens', () => {
      const text = 'Token: ghp_1234567890abcdefghijklmnopqrstuvwx';
      const result = sanitizeTranscript(text);
      expect(result).toBe('Token: ghp_[REDACTED]');
    });

    it('should redact AWS access keys', () => {
      const text = 'AWS key: AKIAIOSFODNN7EXAMPLE';
      const result = sanitizeTranscript(text);
      expect(result).toBe('AWS key: AKIA[REDACTED]');
    });

    it('should redact AWS secret keys', () => {
      const text =
        'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
      const result = sanitizeTranscript(text);
      expect(result).toBe('AWS_SECRET_ACCESS_KEY=[REDACTED]');
    });

    it('should redact Bearer tokens', () => {
      const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const result = sanitizeTranscript(text);
      expect(result).toBe('Authorization: Bearer [REDACTED]');
    });

    it('should redact multiple secrets in the same text', () => {
      const text = `
        OPENAI_API_KEY=sk-test123
        ANTHROPIC_API_KEY=anthropic-abc
        Bearer token123
      `;
      const result = sanitizeTranscript(text);
      expect(result).not.toContain('sk-test123');
      expect(result).not.toContain('anthropic-abc');
      expect(result).not.toContain('token123');
      expect(result).toContain('OPENAI_API_KEY=[REDACTED]');
      expect(result).toContain('ANTHROPIC_API_KEY=[REDACTED]');
      expect(result).toContain('Bearer [REDACTED]');
    });

    it('should preserve non-sensitive content', () => {
      const text = 'This is a normal message with no secrets';
      const result = sanitizeTranscript(text);
      expect(result).toBe(text);
    });

    it('should handle empty strings', () => {
      const result = sanitizeTranscript('');
      expect(result).toBe('');
    });
  });

  describe('exportHistoryForBugReport', () => {
    let exportedFilePath: string | null = null;

    beforeEach(() => {
      exportedFilePath = null;
    });

    afterEach(async () => {
      // Clean up exported files
      if (exportedFilePath) {
        try {
          await unlink(exportedFilePath);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should export history to a file in temp directory', async () => {
      const history: Content[] = [
        {
          role: 'user',
          parts: [{ text: 'Hello, assistant!' }],
        },
        {
          role: 'model',
          parts: [{ text: 'Hello! How can I help you today?' }],
        },
      ];

      const result = await exportHistoryForBugReport(history);
      exportedFilePath = result.filePath;

      expect(result.filePath).toMatch(/llxprt-bug-report-.*\.md$/);
      expect(result.filePath).toContain(require('node:os').tmpdir());

      // Verify file was created
      const fileContent = await readFile(result.filePath, 'utf-8');
      expect(fileContent).toContain('# LLxprt Code Conversation Transcript');
      expect(fileContent).toContain('Hello, assistant!');
      expect(fileContent).toContain('Hello! How can I help you today?');
    });

    it('should format user and assistant messages correctly', async () => {
      const history: Content[] = [
        {
          role: 'user',
          parts: [{ text: 'User question' }],
        },
        {
          role: 'model',
          parts: [{ text: 'Assistant answer' }],
        },
      ];

      const result = await exportHistoryForBugReport(history);
      exportedFilePath = result.filePath;

      expect(result.sanitized).toContain('## User');
      expect(result.sanitized).toContain('User question');
      expect(result.sanitized).toContain('## Assistant');
      expect(result.sanitized).toContain('Assistant answer');
    });

    it('should format function calls in markdown', async () => {
      const history: Content[] = [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'read_file',
                args: { path: '/tmp/test.txt' },
              },
            },
          ],
        },
      ];

      const result = await exportHistoryForBugReport(history);
      exportedFilePath = result.filePath;

      expect(result.sanitized).toContain('**Function Call:** `read_file`');
      expect(result.sanitized).toContain('```json');
      expect(result.sanitized).toContain('"/tmp/test.txt"');
    });

    it('should format function responses in markdown', async () => {
      const history: Content[] = [
        {
          role: 'function',
          parts: [
            {
              functionResponse: {
                name: 'read_file',
                response: { content: 'File contents here' },
              },
            },
          ],
        },
      ];

      const result = await exportHistoryForBugReport(history);
      exportedFilePath = result.filePath;

      expect(result.sanitized).toContain('**Function Response:** `read_file`');
      expect(result.sanitized).toContain('```json');
      expect(result.sanitized).toContain('File contents here');
    });

    it('should sanitize sensitive data in exported history', async () => {
      const history: Content[] = [
        {
          role: 'user',
          parts: [{ text: 'My API key is OPENAI_API_KEY=sk-secret123' }],
        },
      ];

      const result = await exportHistoryForBugReport(history);
      exportedFilePath = result.filePath;

      expect(result.sanitized).not.toContain('sk-secret123');
      expect(result.sanitized).toContain('OPENAI_API_KEY=[REDACTED]');

      const fileContent = await readFile(result.filePath, 'utf-8');
      expect(fileContent).not.toContain('sk-secret123');
    });

    it('should handle empty history', async () => {
      const history: Content[] = [];

      const result = await exportHistoryForBugReport(history);
      exportedFilePath = result.filePath;

      expect(result.sanitized).toContain(
        '# LLxprt Code Conversation Transcript',
      );

      const fileContent = await readFile(result.filePath, 'utf-8');
      expect(fileContent).toBeTruthy();
    });

    it('should handle history with multiple parts per message', async () => {
      const history: Content[] = [
        {
          role: 'user',
          parts: [{ text: 'First part' }, { text: 'Second part' }],
        },
      ];

      const result = await exportHistoryForBugReport(history);
      exportedFilePath = result.filePath;

      expect(result.sanitized).toContain('First part');
      expect(result.sanitized).toContain('Second part');
    });

    it('should create unique filenames with timestamps', async () => {
      const history: Content[] = [
        {
          role: 'user',
          parts: [{ text: 'Test' }],
        },
      ];

      const result1 = await exportHistoryForBugReport(history);
      exportedFilePath = result1.filePath;

      // Wait a tiny bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result2 = await exportHistoryForBugReport(history);

      // Different exports should have different filenames
      expect(result1.filePath).not.toBe(result2.filePath);

      // Clean up second file
      await unlink(result2.filePath).catch(() => {});
    });
  });
});
