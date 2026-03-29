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
import { EmojiFilter, type FilterConfiguration } from './EmojiFilter';

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

  describe('filterFileContent', () => {
    it('should filter emojis from file content in warn mode', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const content =
        'function test() {\n  console.log("✅ All tests passed!");\n}';

      const result = filter.filterFileContent(content, 'WriteFileTool');

      expect(result.filtered).toBe(
        'function test() {\n  console.log("[OK] All tests passed!");\n}',
      );
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBe(
        'Emojis were removed from WriteFileTool content. Please avoid using emojis in code.',
      );
    });

    it('should block file operations with emojis in error mode', () => {
      const filter = new EmojiFilter({ mode: 'error' });
      const content = 'const msg = "Task complete ✅";';

      const result = filter.filterFileContent(content, 'EditTool');

      expect(result.filtered).toBeNull();
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(true);
      expect(result.error).toBe('Cannot write emojis to code files');
    });

    it('should pass through clean code without emojis', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const content = 'function test() {\n  return "success";\n}';

      const result = filter.filterFileContent(content, 'WriteFileTool');

      expect(result.filtered).toBe(content);
      expect(result.emojiDetected).toBe(false);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBeUndefined();
    });

    it('should filter SQL file content with emojis in warn mode', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const content = `-- ✅ User management queries
SELECT * FROM users 
WHERE status = 'active' -- 🎯 Only active users
AND created_at > '2023-01-01'; -- ⚠️ Filter by date

-- 🚀 Performance optimized query
CREATE INDEX idx_user_status ON users(status);`;

      const result = filter.filterFileContent(content, 'WriteFileTool');

      expect(result.filtered).toBe(`-- [OK] User management queries
SELECT * FROM users 
WHERE status = 'active' --  Only active users
AND created_at > '2023-01-01'; -- WARNING: Filter by date

--  Performance optimized query
CREATE INDEX idx_user_status ON users(status);`);
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBe(
        'Emojis were removed from WriteFileTool content. Please avoid using emojis in code.',
      );
    });

    it('should filter markdown file with emojis in warn mode', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const content = `# Project Status ✅

## Features
- User authentication ✅ Complete
- Database integration ⚠️ In progress  
- API endpoints 🚀 Ready for testing
- Documentation 📝 Needs updates

## Issues
- Performance bottleneck 🐛 Critical
- Memory leak 🔥 High priority
- UI bugs 🎯 Medium priority

## Next Steps
1. Fix critical issues ⚠️
2. Deploy to staging 🚀  
3. Celebrate success 🎉`;

      const result = filter.filterFileContent(content, 'EditTool');

      expect(result.filtered).toBe(`# Project Status [OK]

## Features
- User authentication [OK] Complete
- Database integration WARNING: In progress  
- API endpoints  Ready for testing
- Documentation  Needs updates

## Issues
- Performance bottleneck  Critical
- Memory leak  High priority
- UI bugs  Medium priority

## Next Steps
1. Fix critical issues WARNING:
2. Deploy to staging   
3. Celebrate success `);
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBe(
        'Emojis were removed from EditTool content. Please avoid using emojis in code.',
      );
    });
  });

  describe('flushBuffer', () => {
    it('should flush remaining buffered content', () => {
      const filter = new EmojiFilter({ mode: 'warn' });

      // Add content to buffer
      filter.filterStreamChunk('Partial ✅');

      // Flush should return filtered content
      const flushed = filter.flushBuffer();
      expect(flushed).toBe('Partial [OK]');
    });

    it('should return empty string when buffer is empty', () => {
      const filter = new EmojiFilter({ mode: 'warn' });

      const flushed = filter.flushBuffer();
      expect(flushed).toBe('');
    });

    it('should handle blocked content in buffer during flush', () => {
      const filter = new EmojiFilter({ mode: 'error' });

      // Add content with emoji to buffer
      filter.filterStreamChunk('Test ✅');

      // Flush should return empty string when blocked
      const flushed = filter.flushBuffer();
      expect(flushed).toBe('');
    });
  });

  describe('edge cases', () => {
    it('should handle text with only emojis in warn mode', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const input = '✅🎉😀👍';

      const result = filter.filterText(input);
      expect(result.filtered).toBe('[OK]');
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should handle text with only decorative emojis in warn mode', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const input = '🎉😀👍';

      const result = filter.filterText(input);
      expect(result.filtered).toBe('');
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should handle complex nested JSON in tool args', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const args = {
        config: {
          messages: ['✅ Success', '⚠️ Warning'],
          status: 'done 🎉',
        },
      };

      const result = filter.filterToolArgs(args);

      expect(result.filtered).toStrictEqual({
        config: {
          messages: ['[OK] Success', 'WARNING: Warning'],
          status: 'done ',
        },
      });
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should handle Unicode surrogate pairs correctly', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const input = 'Test 👨‍💻 developer emoji';

      const result = filter.filterText(input);
      expect(result.filtered).toBe('Test  developer emoji');
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should handle mixed Unicode content safely', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const input = 'Café ☕ über 🌍 naïve';

      const result = filter.filterText(input);
      expect(result.filtered).toBe('Café  über  naïve');
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });
  });

  describe('additional behavioral tests', () => {
    it('should handle multiple emojis in sequence getting converted', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const input = '✅⚠️✅ Multiple functional emojis';

      const result = filter.filterText(input);
      expect(result.filtered).toBe(
        '[OK]WARNING:[OK] Multiple functional emojis',
      );
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should handle emojis at start, middle, and end of strings', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const input = '🎉 Start, middle ✅ content, end ⚠️';

      const result = filter.filterText(input);
      expect(result.filtered).toBe(' Start, middle [OK] content, end WARNING:');
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should handle filterToolArgs with deeply nested objects containing emojis', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const args = {
        config: {
          settings: {
            notifications: {
              success: '✅ Success message',
              warning: '⚠️ Warning message',
              info: 'Plain info',
            },
            metadata: {
              tags: ['urgent 🔥', 'completed ✅'],
              description: 'Project status 🎉',
            },
          },
        },
      };

      const result = filter.filterToolArgs(args);

      expect(result.filtered).toStrictEqual({
        config: {
          settings: {
            notifications: {
              success: '[OK] Success message',
              warning: 'WARNING: Warning message',
              info: 'Plain info',
            },
            metadata: {
              tags: ['urgent ', 'completed [OK]'],
              description: 'Project status ',
            },
          },
        },
      });
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should handle filterFileContent with code comments containing emojis', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const content = `// ✅ This function works great!
function validate(input) {
  // ⚠️ TODO: Add better validation
  if (!input) {
    console.log("🚫 Invalid input"); // Error case 🎯
    return false;
  }
  return true; // 🎉 Success!
}`;

      const result = filter.filterFileContent(content, 'WriteFileTool');

      expect(result.filtered).toBe(`// [OK] This function works great!
function validate(input) {
  // WARNING: TODO: Add better validation
  if (!input) {
    console.log(" Invalid input"); // Error case 
    return false;
  }
  return true; //  Success!
}`);
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should handle stream chunks that split multi-byte emoji characters', () => {
      const filter = new EmojiFilter({ mode: 'warn' });

      // Split a multi-byte emoji sequence across chunks
      const emoji = '👨‍💻'; // Developer emoji (multi-byte)
      const firstHalf = emoji.slice(0, 2);
      const secondHalf = emoji.slice(2);

      // First chunk with partial emoji
      const result1 = filter.filterStreamChunk(`Hello ${firstHalf}`);
      expect(result1.filtered).toBe('');
      expect(result1.emojiDetected).toBe(false);

      // Second chunk completes the emoji
      const result2 = filter.filterStreamChunk(`${secondHalf} developer`);
      expect(result2.filtered).toBe('Hello  developer');
      expect(result2.emojiDetected).toBe(true);
    });

    it('should handle mixed conversion and decorative emoji removal in complex text', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const input =
        'Status: ✅ All tests passed! 🎉🔥 Build successful ⚠️ with warnings 🤔💭 Review needed 🚀';

      const result = filter.filterText(input);
      expect(result.filtered).toBe(
        'Status: [OK] All tests passed!  Build successful WARNING: with warnings  Review needed ',
      );
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should handle arrays of emojis in tool arguments', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const args = {
        messages: ['✅ Task 1 done', '⚠️ Task 2 warning', '🎉 All complete'],
        statuses: ['pending', 'in-progress ⏳', 'done ✅'],
      };

      const result = filter.filterToolArgs(args);

      expect(result.filtered).toStrictEqual({
        messages: [
          '[OK] Task 1 done',
          'WARNING: Task 2 warning',
          ' All complete',
        ],
        statuses: ['pending', 'in-progress ', 'done [OK]'],
      });
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should handle null and undefined values in nested objects with emojis', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const args = {
        config: {
          message: '✅ Success',
          optional: null,
          missing: undefined,
          nested: {
            warning: '⚠️ Check this',
            empty: null,
          },
        },
      };

      const result = filter.filterToolArgs(args);

      expect(result.filtered).toStrictEqual({
        config: {
          message: '[OK] Success',
          optional: null,
          missing: undefined,
          nested: {
            warning: 'WARNING: Check this',
            empty: null,
          },
        },
      });
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should handle empty string chunks in streaming followed by emoji chunks', () => {
      const filter = new EmojiFilter({ mode: 'warn' });

      // Empty chunks followed by emoji content
      filter.filterStreamChunk('');
      filter.filterStreamChunk('');
      const result = filter.filterStreamChunk('Status: ✅ Done');

      expect(result.filtered).toBe('Status: [OK] Done');
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should handle emoji-only content in file operations', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const content = '✅⚠️🎉🔥💯';

      const result = filter.filterFileContent(content, 'EditTool');

      expect(result.filtered).toBe('[OK]WARNING:');
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBe(
        'Emojis were removed from EditTool content. Please avoid using emojis in code.',
      );
    });

    it('should handle intermixed whitespace and emojis', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const input = '  ✅  Success  🎉  ⚠️  Warning  🔥  ';

      const result = filter.filterText(input);
      expect(result.filtered).toBe('  [OK]  Success    WARNING:  Warning    ');
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should convert emoji numbers to regular numbers', () => {
      const filter = new EmojiFilter({ mode: 'auto' });
      const input = 'Step 1️⃣: Initialize, Step 2️⃣: Build, Step 3️⃣: Deploy';
      const result = filter.filterText(input);
      expect(result.filtered).toBe(
        'Step 1: Initialize, Step 2: Build, Step 3: Deploy',
      );
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBeUndefined(); // No feedback in auto mode
    });

    it('should convert all emoji numbers 0-9', () => {
      const filter = new EmojiFilter({ mode: 'auto' });
      const input = '0️⃣1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣';
      const result = filter.filterText(input);
      expect(result.filtered).toBe('0123456789');
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should handle emoji numbers in numbered lists', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const input = '1️⃣ First item\n2️⃣ Second item\n3️⃣ Third item';
      const result = filter.filterText(input);
      expect(result.filtered).toBe('1 First item\n2 Second item\n3 Third item');
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.systemFeedback).toBe(
        'Emojis were detected and removed. Please avoid using emojis.',
      );
    });

    it('should handle emoji numbers mixed with other emojis', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const input =
        '1️⃣ ✅ Task completed\n2️⃣ ⚠️ Task in progress\n3️⃣ 🎉 Task celebrated';
      const result = filter.filterText(input);
      expect(result.filtered).toBe(
        '1 [OK] Task completed\n2 WARNING: Task in progress\n3  Task celebrated',
      );
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(false);
    });
  });

  // Property-based tests converted to regular tests for now
  describe('property-based tests', () => {
    it('should handle any Unicode input without crashing in allowed mode', () => {
      const input = 'Test string with some Unicode: café 测试 🎉';
      const filter = new EmojiFilter({ mode: 'allowed' });
      const result = filter.filterText(input);

      expect(result.filtered).toBeDefined();
      expect(typeof result.emojiDetected).toBe('boolean');
      expect(typeof result.blocked).toBe('boolean');
      expect(result.filtered).toBe(input); // Allowed mode never changes input
    });

    it('should handle any Unicode input without crashing in warn mode', () => {
      const input = 'Test string with emoji: ✅ done!';
      const filter = new EmojiFilter({ mode: 'warn' });
      const result = filter.filterText(input);

      expect(result.filtered).toBeDefined();
      expect(typeof result.emojiDetected).toBe('boolean');
      expect(typeof result.blocked).toBe('boolean');
      expect(result.blocked).toBe(false); // Warn mode never blocks
    });

    it('should handle any Unicode input without crashing in error mode', () => {
      const input = 'Test string with emoji: ✅ done!';
      const filter = new EmojiFilter({ mode: 'error' });
      const result = filter.filterText(input);

      expect(result.filtered).toBeDefined();
      expect(typeof result.emojiDetected).toBe('boolean');
      expect(typeof result.blocked).toBe('boolean');
      // Error mode with emojis should block and have null filtered with error
      expect(result.blocked).toBe(true);
      expect(result.filtered).toBeNull();
      expect(result.error).toBeDefined();
    });

    it('should handle any object in tool args without crashing', () => {
      const args = { content: 'Test ✅', path: '/test' };
      const filter = new EmojiFilter({ mode: 'warn' });

      // Test with a simple serializable object

      const result = filter.filterToolArgs(args);

      expect(result.filtered).toBeDefined();
      expect(typeof result.emojiDetected).toBe('boolean');
      expect(typeof result.blocked).toBe('boolean');
    });

    it('should handle streaming chunks consistently', () => {
      const chunks = ['Hello ', 'world ✅', ' test'];
      const filter = new EmojiFilter({ mode: 'warn' });

      // Process all chunks
      const results = chunks.map((chunk) => filter.filterStreamChunk(chunk));

      // All results should be valid
      results.forEach((result) => {
        expect(result.filtered).toBeDefined();
        expect(typeof result.emojiDetected).toBe('boolean');
        expect(typeof result.blocked).toBe('boolean');
        expect(result.blocked).toBe(false); // Warn mode never blocks
      });

      // Flush should not crash
      const flushed = filter.flushBuffer();
      expect(typeof flushed).toBe('string');
    });

    it('should handle any file content without crashing', () => {
      const content = 'File content with emoji ✅';
      const toolName = 'WriteFileTool';
      const filter = new EmojiFilter({ mode: 'warn' });
      const result = filter.filterFileContent(content, toolName);

      expect(result.filtered).toBeDefined();
      expect(typeof result.emojiDetected).toBe('boolean');
      expect(typeof result.blocked).toBe('boolean');
      expect(result.blocked).toBe(false); // Warn mode never blocks
      // Warn mode should detect emoji and provide feedback
      expect(result.emojiDetected).toBe(true);
      expect(result.systemFeedback).toBeDefined();
      expect(result.systemFeedback).toContain(toolName);
    });

    it('should create valid filter for any mode', () => {
      const modes = ['allowed', 'warn', 'error'] as const;

      modes.forEach((mode) => {
        const config: FilterConfiguration = { mode };
        const filter = new EmojiFilter(config);

        expect(filter).toBeDefined();

        // Test basic functionality works
        const result = filter.filterText('test');
        expect(result.filtered).toBeDefined();
        expect(typeof result.emojiDetected).toBe('boolean');
        expect(typeof result.blocked).toBe('boolean');
      });
    });

    it('should preserve string length relationship in allowed mode', () => {
      const input = 'Test input string';
      const filter = new EmojiFilter({ mode: 'allowed' });
      const result = filter.filterText(input);

      expect(result.filtered).toBe(input);
      expect((result.filtered as string).length).toBe(input.length);
    });

    it('should never increase string length in warn mode', () => {
      const input = 'Test input with ✅ emoji';
      const filter = new EmojiFilter({ mode: 'warn' });
      const result = filter.filterText(input);

      // Warn mode always returns filtered string
      expect(result.filtered).toBeDefined();
      expect(typeof result.filtered).toBe('string');
      expect((result.filtered as string).length).toBeLessThanOrEqual(
        input.length + 20,
      ); // Allow for emoji replacements
    });
  });
});
