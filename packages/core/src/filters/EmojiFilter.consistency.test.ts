/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Emoji consistency tests for llxprt's emoji-free policy
 * These tests ensure that emojis are consistently filtered across all contexts
 */

import { describe, it, expect } from 'vitest';
import { EmojiFilter, FilterConfiguration } from './EmojiFilter';

describe('EmojiFilter - Consistency Tests for llxprt Emoji-Free Policy', () => {
  const commonEmojis = [
    '✅',
    '⚠️',
    '🎉',
    '🔥',
    '💯',
    '🚫',
    '🎯',
    '🤔',
    '💭',
    '🚀',
    '⏳',
    '📝',
    '🔧',
    '🐛',
    '💾',
    '📊',
    '📈',
    '📉',
    '🔍',
    '🎨',
    '👍',
    '👎',
    '❤️',
    '💡',
    '🌟',
    '📱',
    '💻',
    '🖥️',
    '⌨️',
  ];

  const emojiModes = ['auto', 'warn', 'error'] as const;

  describe('Consistent emoji detection across all modes', () => {
    describe('allowed mode', () => {
      it.each(commonEmojis)(
        'should not detect emoji "%s" in allowed mode',
        (emoji) => {
          const filter = new EmojiFilter({ mode: 'allowed' });
          const input = `Test message with ${emoji} emoji`;
          const result = filter.filterText(input);

          expect(result.emojiDetected).toBe(false);
          expect(result.filtered).toBe(input);
        },
      );
    });

    describe('auto mode', () => {
      it.each(commonEmojis)(
        'should detect and filter emoji "%s" in auto mode',
        (emoji) => {
          const filter = new EmojiFilter({ mode: 'auto' });
          const input = `Test message with ${emoji} emoji`;
          const result = filter.filterText(input);

          expect(result.emojiDetected).toBe(true);
          expect(result.blocked).toBe(false);
          expect(result.filtered).toBeDefined();
        },
      );
    });

    describe('warn mode', () => {
      it.each(commonEmojis)(
        'should detect and filter emoji "%s" in warn mode',
        (emoji) => {
          const filter = new EmojiFilter({ mode: 'warn' });
          const input = `Test message with ${emoji} emoji`;
          const result = filter.filterText(input);

          expect(result.emojiDetected).toBe(true);
          expect(result.blocked).toBe(false);
          expect(result.filtered).toBeDefined();
        },
      );
    });

    describe('error mode', () => {
      it.each(commonEmojis)(
        'should detect and block emoji "%s" in error mode',
        (emoji) => {
          const filter = new EmojiFilter({ mode: 'error' });
          const input = `Test message with ${emoji} emoji`;
          const result = filter.filterText(input);

          expect(result.emojiDetected).toBe(true);
          expect(result.blocked).toBe(true);
          expect(result.filtered).toBeNull();
        },
      );
    });
  });

  describe('Consistent emoji removal in output content', () => {
    const testCases = [
      {
        name: 'CLI command responses',
        input: '✅ Command executed successfully! 🎉 All tests passed.',
        expectedAuto: '[OK] Command executed successfully!  All tests passed.',
        expectedWarn: '[OK] Command executed successfully!  All tests passed.',
      },
      {
        name: 'Error messages',
        input: '⚠️ Warning: Configuration issue detected! 🚫 Build failed.',
        expectedAuto:
          'WARNING: Warning: Configuration issue detected!  Build failed.',
        expectedWarn:
          'WARNING: Warning: Configuration issue detected!  Build failed.',
      },
      {
        name: 'Code file content',
        input:
          '// ✅ TODO: Refactor this function 🔧\nfunction test() { /* 🎯 Focus here */ }',
        expectedAuto:
          '// [OK] TODO: Refactor this function \nfunction test() { /*  Focus here */ }',
        expectedWarn:
          '// [OK] TODO: Refactor this function \nfunction test() { /*  Focus here */ }',
      },
      {
        name: 'Log messages',
        input: 'INFO: Database connected ✅\nERROR: Connection timeout ⚠️',
        expectedAuto:
          'INFO: Database connected [OK]\nERROR: Connection timeout WARNING:',
        expectedWarn:
          'INFO: Database connected [OK]\nERROR: Connection timeout WARNING:',
      },
    ];

    testCases.forEach(({ name, input, expectedAuto, expectedWarn }) => {
      it(`should consistently filter emojis from ${name} in auto mode`, () => {
        const filter = new EmojiFilter({ mode: 'auto' });
        const result = filter.filterText(input);

        expect(result.filtered).toBe(expectedAuto);
        expect(result.emojiDetected).toBe(true);
        expect(result.blocked).toBe(false);
        expect(result.systemFeedback).toBeUndefined(); // Auto mode is silent
      });

      it(`should consistently filter emojis from ${name} in warn mode`, () => {
        const filter = new EmojiFilter({ mode: 'warn' });
        const result = filter.filterText(input);

        expect(result.filtered).toBe(expectedWarn);
        expect(result.emojiDetected).toBe(true);
        expect(result.blocked).toBe(false);
        expect(result.systemFeedback).toBe(
          'Emojis were detected and removed. Please avoid using emojis.',
        );
      });

      it(`should consistently block ${name} in error mode`, () => {
        const filter = new EmojiFilter({ mode: 'error' });
        const result = filter.filterText(input);

        expect(result.filtered).toBeNull();
        expect(result.emojiDetected).toBe(true);
        expect(result.blocked).toBe(true);
        expect(result.error).toBe('Emojis detected in content');
      });
    });
  });

  describe('Tool parameter filtering consistency', () => {
    it('should consistently filter emojis from all tool parameters', () => {
      const filter = new EmojiFilter({ mode: 'warn' });

      const testArgs = {
        filePath: '/src/test.js',
        content: 'console.log("✅ Success!"); // 🎉 Celebration',
        message: 'Update complete ⚠️ Check warnings',
        tags: ['bug 🐛', 'feature ✅', 'docs 📝'],
        config: {
          notifications: {
            success: '🎯 Target achieved',
            warning: '⚠️ Attention needed',
          },
          metadata: ['priority 🔥', 'reviewed ✅'],
        },
      };

      const result = filter.filterToolArgs(testArgs);

      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.filtered).toStrictEqual({
        filePath: '/src/test.js',
        content: 'console.log("[OK] Success!"); //  Celebration',
        message: 'Update complete WARNING: Check warnings',
        tags: ['bug ', 'feature [OK]', 'docs '],
        config: {
          notifications: {
            success: ' Target achieved',
            warning: 'WARNING: Attention needed',
          },
          metadata: ['priority ', 'reviewed [OK]'],
        },
      });
      expect(result.systemFeedback).toBe(
        'Emojis were detected and removed from your tool call. Please avoid using emojis in tool parameters.',
      );
    });

    it('should block tool execution in error mode when emojis are present', () => {
      const filter = new EmojiFilter({ mode: 'error' });

      const testArgs = {
        content: 'Simple task ✅',
        path: '/test',
      };

      const result = filter.filterToolArgs(testArgs);

      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(true);
      expect(result.filtered).toBeNull();
      expect(result.error).toBe(
        'Cannot execute tool with emojis in parameters',
      );
    });
  });

  describe('File content filtering consistency', () => {
    const fileTypes = [
      {
        name: 'JavaScript',
        content: '// ✅ Working\nconst success = "🎉";',
        tool: 'WriteFileTool',
      },
      {
        name: 'TypeScript',
        content: 'interface Config {\n  status: "✅" | "⚠️";\n}',
        tool: 'EditTool',
      },
      {
        name: 'Python',
        content: '# 🐍 Python script\nprint("Done ✅")',
        tool: 'WriteFileTool',
      },
      {
        name: 'Markdown',
        content: '# Project Status ✅\n\n- Feature complete 🎉\n- Testing ⚠️',
        tool: 'EditTool',
      },
      {
        name: 'JSON',
        content: '{\n  "status": "✅ complete",\n  "priority": "🔥 high"\n}',
        tool: 'WriteFileTool',
      },
      {
        name: 'CSS',
        content: '/* 🎨 Styling */\n.success::after { content: "✅"; }',
        tool: 'EditTool',
      },
    ];

    fileTypes.forEach(({ name, content, tool }) => {
      it(`should consistently filter emojis from ${name} file content`, () => {
        const warnFilter = new EmojiFilter({ mode: 'warn' });
        const errorFilter = new EmojiFilter({ mode: 'error' });

        const warnResult = warnFilter.filterFileContent(content, tool);
        const errorResult = errorFilter.filterFileContent(content, tool);

        // Warn mode should filter but not block
        expect(warnResult.emojiDetected).toBe(true);
        expect(warnResult.blocked).toBe(false);
        expect(warnResult.filtered).toBeDefined();
        expect(warnResult.filtered).not.toContain('✅');
        expect(warnResult.filtered).not.toContain('🎉');
        expect(warnResult.filtered).not.toContain('⚠️');
        expect(warnResult.systemFeedback).toContain(tool);

        // Error mode should block
        expect(errorResult.emojiDetected).toBe(true);
        expect(errorResult.blocked).toBe(true);
        expect(errorResult.filtered).toBeNull();
        expect(errorResult.error).toBe('Cannot write emojis to code files');
      });
    });
  });

  describe('Streaming consistency', () => {
    it('should maintain consistency across streaming chunks', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const chunks = [
        'Starting task ',
        '✅ First step complete, ',
        'proceeding to next ',
        '⚠️ Warning detected, ',
        'continuing... 🎉 ',
        'All done!',
      ];

      let fullResult = '';
      let detectedEmojis = false;

      chunks.forEach((chunk) => {
        const result = filter.filterStreamChunk(chunk);
        expect(result.filtered).toBeDefined();
        fullResult += result.filtered || '';
        detectedEmojis = detectedEmojis || result.emojiDetected;
      });

      // Flush any remaining content
      const flushed = filter.flushBuffer();
      expect(typeof flushed).toBe('string');
      fullResult += flushed;

      expect(detectedEmojis).toBe(true);
      expect(fullResult).toContain('[OK]');
      expect(fullResult).toContain('WARNING:');
      expect(fullResult).not.toContain('✅');
      expect(fullResult).not.toContain('⚠️');
      expect(fullResult).not.toContain('🎉');
    });
  });

  describe('Emoji-free text preservation', () => {
    const cleanTexts = [
      'Simple message without emojis',
      'Code: function test() { return "success"; }',
      'Log: INFO - Operation completed successfully',
      'Documentation: This function handles user authentication',
      'Error: Connection timeout after 30 seconds',
    ];

    const testCases = cleanTexts.flatMap((text) =>
      emojiModes.map((mode) => ({ text, mode })),
    );

    it.each(testCases)(
      'should pass through emoji-free text unchanged in $mode mode: "$text"',
      ({ text, mode }) => {
        const filter = new EmojiFilter({ mode });
        const result = filter.filterText(text);

        expect(result.filtered).toBe(text);
        expect(result.emojiDetected).toBe(false);
        expect(result.blocked).toBe(false);
        expect(result.error).toBeUndefined();
        expect(result.systemFeedback).toBeUndefined();
      },
    );
  });

  describe('Configuration consistency validation', () => {
    it.each([
      {
        mode: 'allowed' as const,
        expectedEmojiDetected: false,
        expectedBlocked: false,
        expectedFilteredCheck: (filtered: string | null, testInput: string) => {
          expect(filtered).toBe(testInput);
        },
      },
      {
        mode: 'auto' as const,
        expectedEmojiDetected: true,
        expectedBlocked: false,
        expectedFilteredCheck: (filtered: string | null) => {
          expect(filtered).not.toContain('✅');
        },
      },
      {
        mode: 'warn' as const,
        expectedEmojiDetected: true,
        expectedBlocked: false,
        expectedFilteredCheck: (filtered: string | null) => {
          expect(filtered).not.toContain('✅');
        },
      },
      {
        mode: 'error' as const,
        expectedEmojiDetected: true,
        expectedBlocked: true,
        expectedFilteredCheck: (filtered: string | null) => {
          expect(filtered).toBeNull();
        },
      },
    ])(
      'should create consistent filter instance for $mode mode',
      ({
        mode,
        expectedEmojiDetected,
        expectedBlocked,
        expectedFilteredCheck,
      }) => {
        const config: FilterConfiguration = { mode };
        const filter = new EmojiFilter(config);

        expect(filter).toBeDefined();

        // Test basic functionality works consistently
        const testInput = 'Test with ✅ emoji';
        const result = filter.filterText(testInput);

        expect(result).toBeDefined();
        expect(typeof result.emojiDetected).toBe('boolean');
        expect(typeof result.blocked).toBe('boolean');

        // Mode-specific assertions
        expect(result.emojiDetected).toBe(expectedEmojiDetected);
        expect(result.blocked).toBe(expectedBlocked);
        expectedFilteredCheck(result.filtered, testInput);
      },
    );
  });

  describe('Performance and memory consistency', () => {
    it('should handle large amounts of emoji-containing content consistently', () => {
      const filter = new EmojiFilter({ mode: 'warn' });

      // Create large content with mixed emojis and text
      const chunks = [];
      for (let i = 0; i < 100; i++) {
        chunks.push(`Line ${i}: Status ✅, Warning ⚠️, Success 🎉\n`);
      }
      const largeContent = chunks.join('');

      const result = filter.filterText(largeContent);

      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.filtered).toBeDefined();
      expect((result.filtered as string).split('\n')).toHaveLength(101); // 100 lines + 1 empty
      expect(result.filtered).not.toContain('✅');
      expect(result.filtered).not.toContain('⚠️');
      expect(result.filtered).not.toContain('🎉');
      expect(result.filtered).toContain('[OK]');
      expect(result.filtered).toContain('WARNING:');
    });

    it('should handle buffer flushing consistently', () => {
      const filter = new EmojiFilter({ mode: 'warn' });

      // Add content to buffer without triggering immediate processing
      filter.filterStreamChunk('Partial content ✅');

      // Flush should return consistent results
      const flushed = filter.flushBuffer();
      expect(flushed).toBe('Partial content [OK]');

      // Second flush should be empty
      const secondFlush = filter.flushBuffer();
      expect(secondFlush).toBe('');
    });
  });
});
