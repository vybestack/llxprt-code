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
    it.each(commonEmojis)(
      'should consistently detect emoji "%s" in all filtering modes',
      (emoji) => {
        emojiModes.forEach((mode) => {
          const filter = new EmojiFilter({ mode });
          const input = `Test message with ${emoji} emoji`;
          const result = filter.filterText(input);

          if (mode === 'allowed') {
            expect(result.emojiDetected).toBe(false);
            expect(result.filtered).toBe(input);
          } else {
            expect(result.emojiDetected).toBe(true);
            if (mode === 'error') {
              expect(result.blocked).toBe(true);
              expect(result.filtered).toBeNull();
            } else {
              expect(result.blocked).toBe(false);
              expect(result.filtered).toBeDefined();
            }
          }
        });
      },
    );
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
      expect(result.filtered).toEqual({
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
        if (result.filtered) {
          fullResult += result.filtered;
        }
        if (result.emojiDetected) {
          detectedEmojis = true;
        }
      });

      // Flush any remaining content
      const flushed = filter.flushBuffer();
      if (flushed) {
        fullResult += flushed;
      }

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

    cleanTexts.forEach((text) => {
      it(`should pass through emoji-free text unchanged: "${text}"`, () => {
        emojiModes.forEach((mode) => {
          const filter = new EmojiFilter({ mode });
          const result = filter.filterText(text);

          expect(result.filtered).toBe(text);
          expect(result.emojiDetected).toBe(false);
          expect(result.blocked).toBe(false);
          expect(result.error).toBeUndefined();
          expect(result.systemFeedback).toBeUndefined();
        });
      });
    });
  });

  describe('Configuration consistency validation', () => {
    it('should create consistent filter instances for each mode', () => {
      const modes = ['allowed', 'auto', 'warn', 'error'] as const;

      modes.forEach((mode) => {
        const config: FilterConfiguration = { mode };
        const filter = new EmojiFilter(config);

        expect(filter).toBeDefined();

        // Test basic functionality works consistently
        const testInput = 'Test with ✅ emoji';
        const result = filter.filterText(testInput);

        expect(result).toBeDefined();
        expect(typeof result.emojiDetected).toBe('boolean');
        expect(typeof result.blocked).toBe('boolean');

        if (result.filtered !== null) {
          expect(typeof result.filtered).toBe('string');
        }

        // Mode-specific assertions
        switch (mode) {
          case 'allowed':
            expect(result.emojiDetected).toBe(false);
            expect(result.blocked).toBe(false);
            expect(result.filtered).toBe(testInput);
            break;
          case 'auto':
          case 'warn':
            expect(result.emojiDetected).toBe(true);
            expect(result.blocked).toBe(false);
            expect(result.filtered).not.toContain('✅');
            break;
          case 'error':
            expect(result.emojiDetected).toBe(true);
            expect(result.blocked).toBe(true);
            expect(result.filtered).toBeNull();
            break;
          default:
            throw new Error(`Unknown mode: ${mode}`);
        }
      });
    });
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
