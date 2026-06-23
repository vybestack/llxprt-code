/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for EmojiFilter
 * Tests actual transformations and behaviors, not implementation details
 */

import { describe, it, expect } from 'vitest';
import type { FilterConfiguration } from './EmojiFilter';
import { EmojiFilter } from './EmojiFilter';

// Remove mock to test actual implementation
/*
vi.mock('./EmojiFilter', async () => {
  const actual = await vi.importActual('./EmojiFilter');

  class MockEmojiFilter {
    private config: FilterConfiguration;
    private buffer: string = '';

    constructor(config: FilterConfiguration) {
      this.config = config;
    }

    filterText(text: string): any {
      if (this.config.mode === 'allowed') {
        return { filtered: text, emojiDetected: false, blocked: false };
      }

      const hasEmojis = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|✅|⚠️|🎉|🔥|💯|🚫|🎯|🤔|💭|🚀|⏳/u.test(text);

      if (!hasEmojis) {
        return { filtered: text, emojiDetected: false, blocked: false };
      }

      if (this.config.mode === 'error') {
        return { filtered: null, emojiDetected: true, blocked: true, error: 'Emojis detected in content' };
      }

      // Warn mode - convert emojis
      let filtered = text
        .replace(/✅/g, '[OK]')
        .replace(/⚠️/g, 'WARNING:')
        .replace(/🎉|🔥|💯|🚫|🎯|🤔|💭|🚀|⏳/g, '');

      return {
        filtered,
        emojiDetected: true,
        blocked: false,
        systemFeedback: 'Emojis were detected and removed. Please avoid using emojis.'
      };
    }

    filterStreamChunk(chunk: string): any {
      this.buffer += chunk;

      // Simple implementation - only process complete words
      if (chunk.includes(' ') || chunk === '') {
        const result = this.filterText(this.buffer);
        if (result.filtered !== null) {
          this.buffer = '';
          return result;
        }
      }

      return { filtered: '', emojiDetected: false, blocked: false };
    }

    filterToolArgs(args: any): any {
      const serialized = JSON.stringify(args);
      const textResult = this.filterText(serialized);

      if (textResult.blocked) {
        return {
          filtered: null,
          emojiDetected: true,
          blocked: true,
          error: 'Cannot execute tool with emojis in parameters'
        };
      }

      if (textResult.emojiDetected) {
        const filteredArgs = this.deepFilterObject(args);
        return {
          filtered: filteredArgs,
          emojiDetected: true,
          blocked: false,
          systemFeedback: 'Emojis were detected and removed from your tool call. Please avoid using emojis in tool parameters.'
        };
      }

      return { filtered: args, emojiDetected: false, blocked: false };
    }

    filterFileContent(content: string, toolName: string): any {
      const result = this.filterText(content);

      if (result.blocked) {
        return {
          filtered: null,
          emojiDetected: true,
          blocked: true,
          error: 'Cannot write emojis to code files'
        };
      }

      if (result.emojiDetected) {
        return {
          ...result,
          systemFeedback: `Emojis were removed from ${toolName} content. Please avoid using emojis in code.`
        };
      }

      return result;
    }

    flushBuffer(): string {
      if (this.config.mode === 'error' && /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|✅|⚠️|🎉|🔥|💯|🚫|🎯|🤔|💭|🚀|⏳/u.test(this.buffer)) {
        this.buffer = '';
        return '';
      }

      const result = this.filterText(this.buffer);
      this.buffer = '';
      return result.filtered || '';
    }

    private deepFilterObject(obj: any): any {
      if (typeof obj === 'string') {
        return this.filterText(obj).filtered;
      }

      if (Array.isArray(obj)) {
        return obj.map(item => this.deepFilterObject(item));
      }

      if (obj && typeof obj === 'object') {
        const filtered: any = {};
        for (const [key, value] of Object.entries(obj)) {
          filtered[key] = this.deepFilterObject(value);
        }
        return filtered;
      }

      return obj;
    }
  }

  return {
    ...actual,
    EmojiFilter: MockEmojiFilter
  };
});
*/

describe('EmojiFilter', () => {
  describe('constructor', () => {
    it('should create filter with allowed mode configuration', () => {
      const config: FilterConfiguration = { mode: 'allowed' };
      const filter = new EmojiFilter(config);
      expect(filter).toBeDefined();
    });

    it('should create filter with warn mode configuration', () => {
      const config: FilterConfiguration = { mode: 'warn' };
      const filter = new EmojiFilter(config);
      expect(filter).toBeDefined();
    });

    it('should create filter with error mode configuration', () => {
      const config: FilterConfiguration = { mode: 'error' };
      const filter = new EmojiFilter(config);
      expect(filter).toBeDefined();
    });

    it('should create filter with auto mode configuration', () => {
      const config: FilterConfiguration = { mode: 'auto' };
      const filter = new EmojiFilter(config);
      expect(filter).toBeDefined();
    });
  });

  describe('filterText - auto mode', () => {
    const filter = new EmojiFilter({ mode: 'auto' });

    /**
     * @requirement REQ-004.1 - Silent filtering in auto mode
     * Auto mode should filter emojis silently without providing systemFeedback
     */
    it('should convert emoji checkmarks to [OK] in auto mode without feedback', () => {
      const input = '✅ Task completed!';
      const result = filter.filterText(input);

      expect(result.filtered).toBe('[OK] Task completed!');
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBeUndefined(); // No feedback in auto mode
    });

    it('should convert warning emoji to WARNING text in auto mode without feedback', () => {
      const input = '⚠️ Be careful with this operation';
      const result = filter.filterText(input);

      expect(result.filtered).toBe('WARNING: Be careful with this operation');
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBeUndefined(); // No feedback in auto mode
    });

    it('should remove decorative emojis in auto mode without feedback', () => {
      const input = 'Great job! 🎉😀👍';
      const result = filter.filterText(input);

      expect(result.filtered).toBe('Great job! ');
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBeUndefined(); // No feedback in auto mode
    });

    it('should pass through text without emojis unchanged in auto mode', () => {
      const input = 'Plain text without emojis';
      const result = filter.filterText(input);

      expect(result.filtered).toBe(input);
      expect(result.emojiDetected).toBe(false);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBeUndefined();
    });
  });

  describe('filterText - allowed mode', () => {
    const filter = new EmojiFilter({ mode: 'allowed' });

    it('should pass through text with emojis unchanged in allowed mode', () => {
      const input = '✅ Task completed! 🎉 Great work! 😀';
      const result = filter.filterText(input);

      expect(result.filtered).toBe(input);
      expect(result.emojiDetected).toBe(false);
      expect(result.blocked).toBe(false);
      expect(result.error).toBeUndefined();
      expect(result.systemFeedback).toBeUndefined();
    });

    it('should pass through text without emojis unchanged in allowed mode', () => {
      const input = 'Plain text without any emojis';
      const result = filter.filterText(input);

      expect(result.filtered).toBe(input);
      expect(result.emojiDetected).toBe(false);
      expect(result.blocked).toBe(false);
    });

    it('should pass through empty string in allowed mode', () => {
      const result = filter.filterText('');

      expect(result.filtered).toBe('');
      expect(result.emojiDetected).toBe(false);
      expect(result.blocked).toBe(false);
    });
  });

  describe('filterText - warn mode', () => {
    const filter = new EmojiFilter({ mode: 'warn' });

    it('should convert emoji checkmarks to [OK] in warn mode', () => {
      const input = '✅ Task completed!';
      const result = filter.filterText(input);

      expect(result.filtered).toBe('[OK] Task completed!');
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBe(
        'Emojis were detected and removed. Please avoid using emojis.',
      );
    });

    it('should convert warning emoji to WARNING text in warn mode', () => {
      const input = '⚠️ Be careful with this operation';
      const result = filter.filterText(input);

      expect(result.filtered).toBe('WARNING: Be careful with this operation');
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBe(
        'Emojis were detected and removed. Please avoid using emojis.',
      );
    });

    it('should remove decorative emojis in warn mode', () => {
      const input = 'Great job! 🎉😀👍';
      const result = filter.filterText(input);

      expect(result.filtered).toBe('Great job! ');
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBe(
        'Emojis were detected and removed. Please avoid using emojis.',
      );
    });

    it('should handle mixed functional and decorative emojis in warn mode', () => {
      const input = '✅ Success! 🎉 Now check ⚠️ warnings 😀';
      const result = filter.filterText(input);

      expect(result.filtered).toBe(
        '[OK] Success!  Now check WARNING: warnings ',
      );
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should pass through text without emojis unchanged in warn mode', () => {
      const input = 'Plain text without emojis';
      const result = filter.filterText(input);

      expect(result.filtered).toBe(input);
      expect(result.emojiDetected).toBe(false);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBeUndefined();
    });

    it('should handle emoji in code comments scenario', () => {
      const input = '// ✅ TODO: Fix this function 🔧 and add tests 🎯';
      const result = filter.filterText(input);

      expect(result.filtered).toBe(
        '// [OK] TODO: Fix this function  and add tests ',
      );
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBe(
        'Emojis were detected and removed. Please avoid using emojis.',
      );
    });

    it('should handle emoji in error messages', () => {
      const input =
        'Error: ⚠️ Database connection failed! 🚫 Please check configuration';
      const result = filter.filterText(input);

      expect(result.filtered).toBe(
        'Error: WARNING: Database connection failed!  Please check configuration',
      );
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBe(
        'Emojis were detected and removed. Please avoid using emojis.',
      );
    });

    it('should handle multiple emoji types in one string', () => {
      const input =
        'Status: ✅ OK, Progress: ⏳ 80%, Alert: ⚠️ Check disk space 💾, Complete: 🎉';
      const result = filter.filterText(input);

      expect(result.filtered).toBe(
        'Status: [OK] OK, Progress:  80%, Alert: WARNING: Check disk space , Complete: ',
      );
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBe(
        'Emojis were detected and removed. Please avoid using emojis.',
      );
    });
  });

  describe('filterText - error mode', () => {
    const filter = new EmojiFilter({ mode: 'error' });

    it('should block text with emojis in error mode', () => {
      const input = '✅ Task completed!';
      const result = filter.filterText(input);

      expect(result.filtered).toBeNull();
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(true);
      expect(result.error).toBe('Emojis detected in content');
      expect(result.systemFeedback).toBeUndefined();
    });

    it('should block text with decorative emojis in error mode', () => {
      const input = 'Great work! 🎉😀';
      const result = filter.filterText(input);

      expect(result.filtered).toBeNull();
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(true);
      expect(result.error).toBe('Emojis detected in content');
    });

    it('should pass through text without emojis in error mode', () => {
      const input = 'Plain text without emojis';
      const result = filter.filterText(input);

      expect(result.filtered).toBe(input);
      expect(result.emojiDetected).toBe(false);
      expect(result.blocked).toBe(false);
      expect(result.error).toBeUndefined();
    });
  });

  describe('filterStreamChunk', () => {
    it('should handle streaming chunks with buffer management in warn mode', () => {
      const filter = new EmojiFilter({ mode: 'warn' });

      // First chunk - incomplete emoji at end
      const result1 = filter.filterStreamChunk('Hello ✅ tas');
      expect(result1.filtered).toBe('');
      expect(result1.emojiDetected).toBe(false);
      expect(result1.blocked).toBe(false);

      // Second chunk completes the text
      const result2 = filter.filterStreamChunk('k completed!');
      expect(result2.filtered).toBe('Hello [OK] task completed!');
      expect(result2.emojiDetected).toBe(true);
      expect(result2.blocked).toBe(false);
    });

    it('should handle empty chunks in streaming', () => {
      const filter = new EmojiFilter({ mode: 'warn' });

      const result = filter.filterStreamChunk('');
      expect(result.filtered).toBe('');
      expect(result.emojiDetected).toBe(false);
      expect(result.blocked).toBe(false);
    });

    it('should block streaming content with emojis in error mode', () => {
      const filter = new EmojiFilter({ mode: 'error' });

      const result = filter.filterStreamChunk('Task done ✅');
      expect(result.filtered).toBeNull();
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(true);
      expect(result.error).toBe('Emojis detected in content');
    });
  });

  describe('filterToolArgs', () => {
    it('should filter emojis from tool arguments in warn mode', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const args = {
        content: 'console.log("✅ Success!");',
        file_path: '/src/test.ts',
      };

      const result = filter.filterToolArgs(args);

      expect(result.filtered).toStrictEqual({
        content: 'console.log("[OK] Success!");',
        file_path: '/src/test.ts',
      });
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBe(
        'Emojis were detected and removed from your tool call. Please avoid using emojis in tool parameters.',
      );
    });

    it('should block tool execution with emojis in error mode', () => {
      const filter = new EmojiFilter({ mode: 'error' });
      const args = {
        content: 'console.log("✅ Success!");',
        file_path: '/src/test.ts',
      };

      const result = filter.filterToolArgs(args);

      expect(result.filtered).toBeNull();
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(true);
      expect(result.error).toBe(
        'Cannot execute tool with emojis in parameters',
      );
    });

    it('should pass through tool arguments without emojis', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const args = {
        content: 'console.log("Success!");',
        file_path: '/src/test.ts',
      };

      const result = filter.filterToolArgs(args);

      expect(result.filtered).toStrictEqual(args);
      expect(result.emojiDetected).toBe(false);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBeUndefined();
    });

    it('should allow emojis in tool arguments in allowed mode', () => {
      const filter = new EmojiFilter({ mode: 'allowed' });
      const args = {
        content: 'console.log("✅ Success! 🎉");',
        file_path: '/src/test.ts',
      };

      const result = filter.filterToolArgs(args);

      expect(result.filtered).toStrictEqual(args);
      expect(result.emojiDetected).toBe(false);
      expect(result.blocked).toBe(false);
    });

    it('should filter nested object with emojis in warn mode', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const args = {
        config: {
          database: {
            host: 'localhost',
            status: '✅ Connected',
            alerts: {
              warning: '⚠️ High CPU usage',
              info: 'Normal operation 🎯',
            },
          },
          cache: {
            enabled: true,
            status: '🚀 Optimized performance',
          },
        },
      };

      const result = filter.filterToolArgs(args);

      expect(result.filtered).toStrictEqual({
        config: {
          database: {
            host: 'localhost',
            status: '[OK] Connected',
            alerts: {
              warning: 'WARNING: High CPU usage',
              info: 'Normal operation ',
            },
          },
          cache: {
            enabled: true,
            status: ' Optimized performance',
          },
        },
      });
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBe(
        'Emojis were detected and removed from your tool call. Please avoid using emojis in tool parameters.',
      );
    });

    it('should filter array arguments with emojis in warn mode', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const args = {
        commands: [
          'npm install',
          'npm test ✅',
          'npm run build ⚠️ check warnings',
          'npm start 🚀',
        ],
        flags: ['--verbose', '--production 🎯', '--silent'],
      };

      const result = filter.filterToolArgs(args);

      expect(result.filtered).toStrictEqual({
        commands: [
          'npm install',
          'npm test [OK]',
          'npm run build WARNING: check warnings',
          'npm start ',
        ],
        flags: ['--verbose', '--production ', '--silent'],
      });
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBe(
        'Emojis were detected and removed from your tool call. Please avoid using emojis in tool parameters.',
      );
    });
  });
});
