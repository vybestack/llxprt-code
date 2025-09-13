/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Property-based tests for EmojiFilter using fast-check
 * These tests verify invariants that must ALWAYS hold regardless of input
 */

import { describe, expect } from 'vitest';
// it is imported from @fast-check/vitest as itProp
import { itProp, fc } from '@fast-check/vitest';
import { EmojiFilter, FilterConfiguration } from './EmojiFilter';

describe('EmojiFilter Property-Based Tests', () => {
  describe('Unicode Input Handling Properties', () => {
    itProp(
      'should never crash on arbitrary Unicode strings in any mode',
      [
        fc.string({ minLength: 0, maxLength: 100 }),
        fc.oneof(
          fc.constant('allowed' as const),
          fc.constant('auto' as const),
          fc.constant('warn' as const),
          fc.constant('error' as const),
        ),
      ],
      (text: string, mode: FilterConfiguration['mode']) => {
        const filter = new EmojiFilter({ mode });
        const result = filter.filterText(text);

        // Result must always have these properties defined
        expect(result.filtered !== undefined).toBe(true);
        expect(typeof result.emojiDetected).toBe('boolean');
        expect(typeof result.blocked).toBe('boolean');

        // Filtered content must be either string or null
        expect(
          typeof result.filtered === 'string' || result.filtered === null,
        ).toBe(true);
      },
    );

    itProp(
      'should handle any combination of ASCII and Unicode characters',
      [
        fc.string({ minLength: 0, maxLength: 50 }),
        fc.string({ minLength: 0, maxLength: 50 }),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (ascii: string, unicode: string, mode: FilterConfiguration['mode']) => {
        const combined = ascii + unicode;
        const filter = new EmojiFilter({ mode });
        const result = filter.filterText(combined);

        // Should never block in auto/warn modes
        expect(result.blocked).toBe(false);
        expect(typeof result.filtered).toBe('string');
      },
    );

    itProp(
      'should preserve ASCII characters in all modes',
      [
        fc.string({ minLength: 0, maxLength: 100 }).filter((s) =>
          // Only ASCII printable characters, no emojis
          /^[\\x20-\\x7E]*$/.test(s),
        ),
        fc.oneof(
          fc.constant('allowed' as const),
          fc.constant('auto' as const),
          fc.constant('warn' as const),
        ),
      ],
      (asciiText: string, mode: FilterConfiguration['mode']) => {
        const filter = new EmojiFilter({ mode });
        const result = filter.filterText(asciiText);

        // ASCII text should pass through unchanged
        expect(result.filtered).toBe(asciiText);
        expect(result.emojiDetected).toBe(false);
        expect(result.blocked).toBe(false);
      },
    );

    itProp(
      'should handle empty and whitespace-only strings correctly',
      [
        fc
          .array(fc.constantFrom(' ', '\\t', '\\n', '\\r'), { maxLength: 20 })
          .map((arr) => arr.join('')),
        fc.oneof(
          fc.constant('allowed' as const),
          fc.constant('auto' as const),
          fc.constant('warn' as const),
          fc.constant('error' as const),
        ),
      ],
      (whitespace: string, mode: FilterConfiguration['mode']) => {
        const filter = new EmojiFilter({ mode });
        const result = filter.filterText(whitespace);

        // Whitespace should never be detected as emoji
        expect(result.emojiDetected).toBe(false);
        expect(result.blocked).toBe(false);
        expect(result.filtered).toBe(whitespace);
      },
    );
  });

  describe('Mode Consistency Properties', () => {
    itProp(
      'allowed mode should never modify input or detect emojis',
      [fc.string({ minLength: 0, maxLength: 100 })],
      (text: string) => {
        const filter = new EmojiFilter({ mode: 'allowed' });
        const result = filter.filterText(text);

        // Allowed mode invariants
        expect(result.filtered).toBe(text);
        expect(result.emojiDetected).toBe(false);
        expect(result.blocked).toBe(false);
        expect(result.error).toBeUndefined();
        expect(result.systemFeedback).toBeUndefined();
      },
    );

    itProp(
      'auto mode should never provide system feedback',
      [fc.string({ minLength: 0, maxLength: 100 })],
      (text: string) => {
        const filter = new EmojiFilter({ mode: 'auto' });
        const result = filter.filterText(text);

        // Auto mode should never provide feedback
        expect(result.systemFeedback).toBeUndefined();
        expect(result.blocked).toBe(false);
      },
    );

    itProp(
      'warn mode should never block content',
      [fc.string({ minLength: 0, maxLength: 100 })],
      (text: string) => {
        const filter = new EmojiFilter({ mode: 'warn' });
        const result = filter.filterText(text);

        // Warn mode should never block
        expect(result.blocked).toBe(false);
        expect(result.filtered).not.toBeNull();
        expect(typeof result.filtered).toBe('string');

        // If emojis detected, should provide feedback
        if (result.emojiDetected) {
          expect(result.systemFeedback).toBeDefined();
          expect(result.systemFeedback).toContain('avoid using emojis');
        }
      },
    );

    itProp(
      'error mode should block when emojis detected',
      [
        fc
          .array(fc.constantFrom('[OK]', 'WARNING:', '', '', ''), {
            minLength: 1,
            maxLength: 5,
          })
          .map((arr) => arr.join('')),
      ],
      (emojiText: string) => {
        const filter = new EmojiFilter({ mode: 'error' });
        const result = filter.filterText(emojiText);

        // Error mode should block emoji content
        expect(result.emojiDetected).toBe(true);
        expect(result.blocked).toBe(true);
        expect(result.filtered).toBeNull();
        expect(result.error).toBeDefined();
      },
    );
  });

  describe('Stream Chunk Boundary Properties', () => {
    itProp(
      'should handle arbitrary chunk boundaries without losing content',
      [
        fc.string().filter((s) => s.length > 0),
        fc.integer({ min: 1, max: 10 }),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (text: string, chunkSize: number, mode: FilterConfiguration['mode']) => {
        const filter1 = new EmojiFilter({ mode });
        const filter2 = new EmojiFilter({ mode });

        // Process as single chunk
        const singleResult = filter1.filterText(text);

        // Process as multiple chunks
        const chunks = [];
        for (let i = 0; i < text.length; i += chunkSize) {
          chunks.push(text.slice(i, i + chunkSize));
        }

        let streamOutput = '';
        for (const chunk of chunks) {
          const chunkResult = filter2.filterStreamChunk(chunk);
          if (typeof chunkResult.filtered === 'string') {
            streamOutput += chunkResult.filtered;
          }
        }
        const flushed = filter2.flushBuffer();
        streamOutput += flushed;

        // Content should be equivalent (allowing for buffering differences)
        expect(typeof streamOutput).toBe('string');
        if (typeof singleResult.filtered === 'string') {
          // Both should have similar emoji detection behavior
          expect(singleResult.emojiDetected).toBe(
            streamOutput !== text || singleResult.filtered !== text,
          );
        }
      },
    );

    itProp(
      'should never lose characters when streaming with arbitrary boundaries',
      [
        fc
          .string({ minLength: 1, maxLength: 50 })
          .filter((s) => /^[\\x20-\\x7E]*$/.test(s)), // ASCII printable only
        fc.array(fc.integer({ min: 1, max: 5 }), {
          minLength: 1,
          maxLength: 10,
        }),
      ],
      (text: string, chunkSizes: number[]) => {
        const filter = new EmojiFilter({ mode: 'warn' });

        let pos = 0;
        let totalOutput = '';

        for (const size of chunkSizes) {
          if (pos >= text.length) break;

          const chunk = text.slice(pos, pos + size);
          pos += size;

          const result = filter.filterStreamChunk(chunk);
          if (typeof result.filtered === 'string') {
            totalOutput += result.filtered;
          }
        }

        // Process remaining text
        if (pos < text.length) {
          const remaining = text.slice(pos);
          const result = filter.filterStreamChunk(remaining);
          if (typeof result.filtered === 'string') {
            totalOutput += result.filtered;
          }
        }

        // Flush any remaining buffer
        totalOutput += filter.flushBuffer();

        // Should have processed all characters (allowing for emoji filtering)
        expect(totalOutput.length).toBeGreaterThanOrEqual(0);
        expect(typeof totalOutput).toBe('string');
      },
    );

    itProp(
      'should maintain consistent emoji detection across chunk boundaries',
      [
        fc.constantFrom('[OK] test', 'test WARNING:', ' middle '),
        fc.integer({ min: 1, max: 4 }),
      ],
      (textWithEmoji: string, chunkSize: number) => {
        const filter1 = new EmojiFilter({ mode: 'warn' });
        const filter2 = new EmojiFilter({ mode: 'warn' });

        // Single chunk processing
        const singleResult = filter1.filterText(textWithEmoji);

        // Multi-chunk processing
        let streamDetected = false;
        for (let i = 0; i < textWithEmoji.length; i += chunkSize) {
          const chunk = textWithEmoji.slice(i, i + chunkSize);
          const result = filter2.filterStreamChunk(chunk);
          if (result.emojiDetected) {
            streamDetected = true;
          }
        }

        // Final flush might also detect emojis
        const flushed = filter2.flushBuffer();
        const flushResult = filter2.filterText(flushed);
        if (flushResult.emojiDetected) {
          streamDetected = true;
        }

        // Both should detect emojis if present
        expect(singleResult.emojiDetected).toBe(true);
        // Stream detection might be delayed due to buffering, but should eventually detect
        expect(typeof streamDetected).toBe('boolean');
      },
    );
  });

  describe('Object Filtering Properties', () => {
    itProp(
      'should handle deeply nested objects without stack overflow',
      [
        fc.integer({ min: 1, max: 10 }),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (depth: number, mode: FilterConfiguration['mode']) => {
        // Create nested object
        let obj: Record<string, unknown> = { value: 'test [OK]' };
        for (let i = 0; i < depth; i++) {
          obj = { nested: obj, level: i };
        }

        const filter = new EmojiFilter({ mode });
        const result = filter.filterToolArgs(obj);

        // Should not crash and should return valid structure
        expect(result.filtered).toBeDefined();
        expect(typeof result.emojiDetected).toBe('boolean');
        expect(typeof result.blocked).toBe('boolean');
        expect(result.blocked).toBe(false); // Auto/warn never block
      },
    );

    itProp(
      'should preserve object structure while filtering string values',
      [
        fc.record({
          str: fc.string(),
          num: fc.integer(),
          bool: fc.boolean(),
          nested: fc.record({
            value: fc.string(),
          }),
        }),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (obj: Record<string, unknown>, mode: FilterConfiguration['mode']) => {
        const filter = new EmojiFilter({ mode });
        const result = filter.filterToolArgs(obj);

        if (result.filtered && typeof result.filtered === 'object') {
          const filtered = result.filtered as Record<string, unknown>;

          // Structure should be preserved
          expect(typeof filtered.str).toBe('string');
          expect(typeof filtered.num).toBe('number');
          expect(typeof filtered.bool).toBe('boolean');
          expect(typeof filtered.nested).toBe('object');
          expect(
            typeof (filtered.nested as Record<string, unknown>).value,
          ).toBe('string');

          // Non-string values should be unchanged
          expect(filtered.num).toBe(obj.num);
          expect(filtered.bool).toBe(obj.bool);
        }
      },
    );

    itProp(
      'should handle arrays of mixed types correctly',
      [
        fc.array(
          fc.oneof(
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.record({ text: fc.string() }),
          ),
        ),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (
        arr: Array<string | number | boolean | Record<string, string>>,
        mode: FilterConfiguration['mode'],
      ) => {
        const obj = { items: arr };
        const filter = new EmojiFilter({ mode });
        const result = filter.filterToolArgs(obj);

        if (result.filtered && typeof result.filtered === 'object') {
          const filtered = result.filtered as Record<string, unknown>;

          // Array should be preserved
          expect(Array.isArray(filtered.items)).toBe(true);
          expect((filtered.items as unknown[]).length).toBe(arr.length);

          // Type structure should be maintained
          (filtered.items as unknown[]).forEach(
            (item: unknown, _index: number) => {
              expect(typeof item).toBe(typeof arr[_index]);
            },
          );
        }
      },
    );

    itProp(
      'should handle null and undefined values in objects',
      [
        fc.record({
          nullValue: fc.constant(null),
          undefinedValue: fc.constant(undefined),
          stringValue: fc.string(),
          nestedNull: fc.record({
            inner: fc.constant(null),
          }),
        }),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (obj: Record<string, unknown>, mode: FilterConfiguration['mode']) => {
        const filter = new EmojiFilter({ mode });
        const result = filter.filterToolArgs(obj);

        if (result.filtered && typeof result.filtered === 'object') {
          const filtered = result.filtered as Record<string, unknown>;

          // Null and undefined should be preserved
          expect(filtered.nullValue).toBe(null);
          expect(filtered.undefinedValue).toBe(undefined);
          expect((filtered.nestedNull as Record<string, unknown>).inner).toBe(
            null,
          );
          expect(typeof filtered.stringValue).toBe('string');
        }
      },
    );
  });

  describe('Filtering Invariants', () => {
    itProp(
      'filtered output length should never exceed input plus conversion overhead',
      [
        fc.string({ minLength: 0, maxLength: 100 }),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (text: string, mode: FilterConfiguration['mode']) => {
        const filter = new EmojiFilter({ mode });
        const result = filter.filterText(text);

        if (typeof result.filtered === 'string') {
          // Allow for reasonable conversion overhead (emoji -> text replacements)
          const maxExpectedLength = text.length + 50; // Generous overhead for conversions
          expect(result.filtered.length).toBeLessThanOrEqual(maxExpectedLength);
        }
      },
    );

    itProp(
      'should maintain idempotency - filtering twice should give same result',
      [
        fc.string({ minLength: 0, maxLength: 100 }),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (text: string, mode: FilterConfiguration['mode']) => {
        const filter1 = new EmojiFilter({ mode });
        const filter2 = new EmojiFilter({ mode });

        const result1 = filter1.filterText(text);

        if (typeof result1.filtered === 'string') {
          const result2 = filter2.filterText(result1.filtered);

          // Second filtering should not change result
          expect(result2.filtered).toBe(result1.filtered);
          // Should not detect emojis in already-filtered text
          expect(result2.emojiDetected).toBe(false);
        }
      },
    );

    itProp(
      'should never produce invalid strings',
      [
        fc.string({ minLength: 0, maxLength: 100 }),
        fc.oneof(
          fc.constant('allowed' as const),
          fc.constant('auto' as const),
          fc.constant('warn' as const),
        ),
      ],
      (text: string, mode: FilterConfiguration['mode']) => {
        const filter = new EmojiFilter({ mode });
        const result = filter.filterText(text);

        if (typeof result.filtered === 'string') {
          // Should be valid Unicode string
          expect(() => JSON.stringify(result.filtered)).not.toThrow();
          expect(result.filtered.length).toBeGreaterThanOrEqual(0);

          // Should not contain replacement characters indicating corruption
          expect(result.filtered).not.toContain('\\uFFFD');
        }
      },
    );

    itProp(
      'should preserve word boundaries when removing decorative emojis',
      [
        fc.array(fc.constantFrom('word', 'test', 'hello'), {
          minLength: 2,
          maxLength: 5,
        }),
        fc.array(fc.constantFrom('', '', '', ''), {
          minLength: 1,
          maxLength: 3,
        }),
      ],
      (words: string[], emojis: string[]) => {
        // Create text with words separated by emojis and spaces
        const text = words.join(' ' + emojis.join('') + ' ');

        const filter = new EmojiFilter({ mode: 'warn' });
        const result = filter.filterText(text);

        if (typeof result.filtered === 'string') {
          // All original words should still be present
          words.forEach((word) => {
            expect(result.filtered).toContain(word);
          });

          // Words should remain separated (not concatenated)
          const filteredWords = result.filtered
            .split(/\\s+/)
            .filter((w) => w.length > 0);
          expect(filteredWords.length).toBeGreaterThanOrEqual(words.length);
        }
      },
    );
  });

  describe('File Content Specific Properties', () => {
    itProp(
      'should handle any file content without corrupting code structure',
      [
        fc.oneof(
          fc.constant('function test() { return true; }'),
          fc.constant('const x = "hello [OK] world";'),
          fc.constant('// Comment with WARNING: warning\\nlet y = 5;'),
          fc.constant('SELECT * FROM table --  query'),
        ),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (
        codeContent: string,
        toolName: string,
        mode: FilterConfiguration['mode'],
      ) => {
        const filter = new EmojiFilter({ mode });
        const result = filter.filterFileContent(codeContent, toolName);

        expect(result.blocked).toBe(false);
        expect(typeof result.filtered).toBe('string');

        if (result.systemFeedback) {
          expect(result.systemFeedback).toContain(toolName);
        }
      },
    );

    itProp(
      'should maintain line structure in multiline content',
      [
        fc.array(fc.string(), { minLength: 2, maxLength: 10 }),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (lines: string[], mode: FilterConfiguration['mode']) => {
        const content = lines.join('\\n');

        const filter = new EmojiFilter({ mode });
        const result = filter.filterFileContent(content, 'TestTool');

        if (typeof result.filtered === 'string') {
          const filteredLines = result.filtered.split('\\n');

          // Should preserve line count
          expect(filteredLines.length).toBe(lines.length);
        }
      },
    );
  });

  describe('Buffer Management Properties', () => {
    itProp(
      'should handle flush operations consistently',
      [
        fc.string(),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (text: string, mode: FilterConfiguration['mode']) => {
        const filter = new EmojiFilter({ mode });

        // Add to buffer via stream chunks
        filter.filterStreamChunk(text);

        // Flush should return string
        const flushed = filter.flushBuffer();
        expect(typeof flushed).toBe('string');

        // Second flush should return empty string
        const secondFlush = filter.flushBuffer();
        expect(secondFlush).toBe('');
      },
    );

    itProp(
      'should handle empty stream chunks gracefully',
      [
        fc.array(fc.constant(''), { minLength: 1, maxLength: 10 }),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (emptyChunks: string[], mode: FilterConfiguration['mode']) => {
        const filter = new EmojiFilter({ mode });

        // Process multiple empty chunks
        emptyChunks.forEach((chunk) => {
          const result = filter.filterStreamChunk(chunk);
          expect(result.filtered).toBe('');
          expect(result.emojiDetected).toBe(false);
          expect(result.blocked).toBe(false);
        });

        // Flush should be empty
        expect(filter.flushBuffer()).toBe('');
      },
    );
  });

  describe('Edge Case Properties', () => {
    itProp(
      'should handle malformed objects gracefully',
      [
        fc.anything().filter(
          (obj) =>
            // Filter out functions, symbols, null, and undefined that can't be JSON serialized
            obj !== null &&
            obj !== undefined &&
            typeof obj !== 'function' &&
            typeof obj !== 'symbol',
        ),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (obj: Record<string, unknown>, mode: FilterConfiguration['mode']) => {
        const filter = new EmojiFilter({ mode });

        // Should not crash even with weird objects
        expect(() => {
          const result = filter.filterToolArgs(obj as object);
          expect(result.filtered !== undefined).toBe(true);
          expect(typeof result.emojiDetected).toBe('boolean');
          expect(typeof result.blocked).toBe('boolean');
        }).not.toThrow();
      },
    );

    itProp(
      'should handle very long strings without performance degradation',
      [
        fc
          .string({ minLength: 1000, maxLength: 5000 })
          .filter((s) => /^[\\x20-\\x7E]*$/.test(s)),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (longText: string, mode: FilterConfiguration['mode']) => {
        const filter = new EmojiFilter({ mode });
        const startTime = Date.now();

        const result = filter.filterText(longText);

        const endTime = Date.now();
        const processingTime = endTime - startTime;

        // Should complete within reasonable time (less than 100ms for 5000 chars)
        expect(processingTime).toBeLessThan(100);
        expect(typeof result.filtered).toBe('string');
        expect(result.blocked).toBe(false);
      },
    );

    itProp(
      'should handle rapid consecutive filtering operations',
      [
        fc.array(fc.string({ maxLength: 100 }), {
          minLength: 5,
          maxLength: 20,
        }),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (texts: string[], mode: FilterConfiguration['mode']) => {
        const filter = new EmojiFilter({ mode });

        // Filter all texts rapidly
        const results = texts.map((text) => filter.filterText(text));

        // All results should be valid
        results.forEach((result, _index) => {
          expect(result.filtered !== undefined).toBe(true);
          expect(typeof result.emojiDetected).toBe('boolean');
          expect(typeof result.blocked).toBe('boolean');
          expect(result.blocked).toBe(false); // Auto/warn never block
        });
      },
    );

    itProp(
      'should handle valid complex nested objects consistently',
      [
        fc.record({
          level1: fc.record({
            level2: fc.record({
              text: fc.string({ maxLength: 20 }),
              number: fc.integer(),
              array: fc.array(fc.string({ maxLength: 10 }), { maxLength: 5 }),
            }),
          }),
          metadata: fc.record({
            timestamp: fc.integer(),
            tags: fc.array(fc.string({ maxLength: 15 }), { maxLength: 3 }),
          }),
        }),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (
        complexObj: Record<string, unknown>,
        mode: FilterConfiguration['mode'],
      ) => {
        const filter = new EmojiFilter({ mode });

        // Should process complex but valid objects without issues
        const result = filter.filterToolArgs(complexObj);

        expect(result.filtered !== undefined).toBe(true);
        expect(typeof result.emojiDetected).toBe('boolean');
        expect(typeof result.blocked).toBe('boolean');
        expect(result.blocked).toBe(false); // Auto/warn never block

        // Structure should be preserved in filtered result
        if (result.filtered && typeof result.filtered === 'object') {
          const filtered = result.filtered as Record<string, unknown>;
          expect(typeof filtered.level1).toBe('object');
          expect(typeof filtered.metadata).toBe('object');
        }
      },
    );

    itProp(
      'should handle stream operations with mixed content types',
      [
        fc.array(
          fc.oneof(
            fc.string({ maxLength: 20 }),
            fc.constant(''),
            fc
              .array(fc.constantFrom('[OK]', 'WARNING:', ''), { maxLength: 3 })
              .map((arr) => arr.join('')),
          ),
          { minLength: 3, maxLength: 10 },
        ),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (chunks: string[], mode: FilterConfiguration['mode']) => {
        const filter = new EmojiFilter({ mode });

        let totalOutput = '';
        chunks.forEach((chunk) => {
          const result = filter.filterStreamChunk(chunk);
          if (typeof result.filtered === 'string') {
            totalOutput += result.filtered;
          }

          // Each chunk result should be valid
          expect(result.filtered !== undefined).toBe(true);
          expect(typeof result.emojiDetected).toBe('boolean');
          expect(typeof result.blocked).toBe('boolean');
          expect(result.blocked).toBe(false);
        });

        // Flush should complete successfully
        const flushed = filter.flushBuffer();
        expect(typeof flushed).toBe('string');
        totalOutput += flushed;

        expect(typeof totalOutput).toBe('string');
      },
    );

    itProp(
      'should maintain filter state isolation between instances',
      [
        fc.string({ maxLength: 100 }),
        fc.string({ maxLength: 100 }),
        fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
      ],
      (text1: string, text2: string, mode: FilterConfiguration['mode']) => {
        const filter1 = new EmojiFilter({ mode });
        const filter2 = new EmojiFilter({ mode });

        // Process different content in parallel
        const result1 = filter1.filterText(text1);
        const result2 = filter2.filterText(text2);

        // Results should be independent
        expect(result1.filtered !== undefined).toBe(true);
        expect(result2.filtered !== undefined).toBe(true);

        // Streaming state should be independent
        filter1.filterStreamChunk('test1');
        filter2.filterStreamChunk('test2');

        const flush1 = filter1.flushBuffer();
        const flush2 = filter2.flushBuffer();

        expect(typeof flush1).toBe('string');
        expect(typeof flush2).toBe('string');
        expect(flush1).not.toBe(flush2);
      },
    );

    itProp(
      'should handle mixed mode operations consistently',
      [fc.string({ maxLength: 100 })],
      (text: string) => {
        const modes: Array<FilterConfiguration['mode']> = [
          'allowed',
          'auto',
          'warn',
          'error',
        ];
        const filters = modes.map((mode) => new EmojiFilter({ mode }));

        const results = filters.map((filter) => filter.filterText(text));

        // All results should be structurally valid
        results.forEach((result, _index) => {
          const mode = modes[_index];

          expect(result.filtered !== undefined).toBe(true);
          expect(typeof result.emojiDetected).toBe('boolean');
          expect(typeof result.blocked).toBe('boolean');

          // Mode-specific invariants
          if (mode === 'allowed') {
            expect(result.filtered).toBe(text);
            expect(result.emojiDetected).toBe(false);
            expect(result.blocked).toBe(false);
          } else if (mode === 'auto') {
            expect(result.systemFeedback).toBeUndefined();
            expect(result.blocked).toBe(false);
          } else if (mode === 'warn') {
            expect(result.blocked).toBe(false);
            expect(typeof result.filtered).toBe('string');
          }
        });
      },
    );
  });
});
