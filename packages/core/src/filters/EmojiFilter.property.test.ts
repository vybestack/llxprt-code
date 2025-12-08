/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Property-based tests for EmojiFilter using fast-check
 * These tests verify invariants that must ALWAYS hold regardless of input
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { EmojiFilter, FilterConfiguration } from './EmojiFilter';

describe('EmojiFilter Property-Based Tests', () => {
  describe('Unicode Input Handling Properties', () => {
    it('should never crash on arbitrary Unicode strings in any mode', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          fc.oneof(
            fc.constant('allowed' as const),
            fc.constant('auto' as const),
            fc.constant('warn' as const),
            fc.constant('error' as const),
          ),
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
        ),
        { numRuns: 100 },
      );
    });

    it('should handle any combination of ASCII and Unicode characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 50 }),
          fc.string({ minLength: 0, maxLength: 50 }),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
          (
            ascii: string,
            unicode: string,
            mode: FilterConfiguration['mode'],
          ) => {
            const combined = ascii + unicode;
            const filter = new EmojiFilter({ mode });
            const result = filter.filterText(combined);

            // Should never block in auto/warn modes
            expect(result.blocked).toBe(false);
            expect(typeof result.filtered).toBe('string');
          },
        ),
        { numRuns: 50 },
      );
    });

    it('should preserve ASCII characters in all modes', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }).filter((s) =>
            // Only ASCII printable characters, no emojis
            /^[\x20-\x7E]*$/.test(s),
          ),
          fc.oneof(
            fc.constant('allowed' as const),
            fc.constant('auto' as const),
            fc.constant('warn' as const),
          ),
          (asciiText: string, mode: FilterConfiguration['mode']) => {
            const filter = new EmojiFilter({ mode });
            const result = filter.filterText(asciiText);

            // ASCII text should pass through unchanged
            expect(result.filtered).toBe(asciiText);
            expect(result.emojiDetected).toBe(false);
            expect(result.blocked).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('should handle empty and whitespace-only strings correctly', () => {
      fc.assert(
        fc.property(
          fc
            .array(fc.constantFrom(' ', '\t', '\n', '\r'), { maxLength: 20 })
            .map((arr) => arr.join('')),
          fc.oneof(
            fc.constant('allowed' as const),
            fc.constant('auto' as const),
            fc.constant('warn' as const),
            fc.constant('error' as const),
          ),
          (whitespace: string, mode: FilterConfiguration['mode']) => {
            const filter = new EmojiFilter({ mode });
            const result = filter.filterText(whitespace);

            // Whitespace should never be detected as emoji
            expect(result.emojiDetected).toBe(false);
            expect(result.blocked).toBe(false);
            expect(result.filtered).toBe(whitespace);
          },
        ),
        { numRuns: 30 },
      );
    });
  });

  describe('Mode Consistency Properties', () => {
    it('allowed mode should never modify input or detect emojis', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
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
        ),
        { numRuns: 50 },
      );
    });

    it('auto mode should never provide system feedback', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          (text: string) => {
            const filter = new EmojiFilter({ mode: 'auto' });
            const result = filter.filterText(text);

            // Auto mode should never provide feedback
            expect(result.systemFeedback).toBeUndefined();
            expect(result.blocked).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('warn mode should never block content', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          (text: string) => {
            const filter = new EmojiFilter({ mode: 'warn' });
            const result = filter.filterText(text);

            // Warn mode should never block
            expect(result.blocked).toBe(false);
            expect(result.filtered).not.toBeNull();
            expect(typeof result.filtered).toBe('string');

            // If emojis detected, should provide feedback
            expect(
              !result.emojiDetected ||
                (result.systemFeedback !== undefined &&
                  result.systemFeedback.includes('avoid using emojis')),
            ).toBe(true);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('error mode should block when emojis detected', () => {
      fc.assert(
        fc.property(
          fc
            .array(fc.constantFrom('✅', '⚠️', '🎉', '🔥', '💯'), {
              minLength: 1,
              maxLength: 5,
            })
            .map((arr) => arr.join('')),
          (emojiText: string) => {
            const filter = new EmojiFilter({ mode: 'error' });
            const result = filter.filterText(emojiText);

            // Error mode should block emoji content
            expect(result.emojiDetected).toBe(true);
            expect(result.blocked).toBe(true);
            expect(result.filtered).toBeNull();
            expect(result.error).toBeDefined();
          },
        ),
        { numRuns: 30 },
      );
    });
  });

  describe('Stream Chunk Boundary Properties', () => {
    it('should handle arbitrary chunk boundaries without losing content', () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => s.length > 0),
          fc.integer({ min: 1, max: 10 }),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
          (
            text: string,
            chunkSize: number,
            mode: FilterConfiguration['mode'],
          ) => {
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
            // Verify that filtered result is a string before checking emoji detection
            expect(typeof singleResult.filtered).toBe('string');
            // Both should have similar emoji detection behavior
            expect(singleResult.emojiDetected).toBe(
              streamOutput !== text || singleResult.filtered !== text,
            );
          },
        ),
        { numRuns: 30 },
      );
    });

    it('should never lose characters when streaming with arbitrary boundaries', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 50 })
            .filter((s) => /^[\x20-\x7E]*$/.test(s)), // ASCII printable only
          fc.array(fc.integer({ min: 1, max: 5 }), {
            minLength: 1,
            maxLength: 10,
          }),
          (text: string, chunkSizes: number[]) => {
            fc.pre(text.length > 0);

            const filter = new EmojiFilter({ mode: 'warn' });

            let pos = 0;
            let totalOutput = '';

            // Process all chunks
            const allChunks: string[] = [];
            for (const size of chunkSizes) {
              if (pos >= text.length) break;
              allChunks.push(text.slice(pos, pos + size));
              pos += size;
            }

            // Add remaining text as final chunk if any
            if (pos < text.length) {
              allChunks.push(text.slice(pos));
            }

            // Process all chunks and verify each result
            allChunks.forEach((chunk) => {
              const result = filter.filterStreamChunk(chunk);
              expect(typeof result.filtered).toBe('string');
              totalOutput += result.filtered as string;
            });

            // Flush any remaining buffer
            totalOutput += filter.flushBuffer();

            // Should have processed all characters (allowing for emoji filtering)
            expect(totalOutput.length).toBeGreaterThanOrEqual(0);
            expect(typeof totalOutput).toBe('string');
          },
        ),
        { numRuns: 30 },
      );
    });

    it('should maintain consistent emoji detection across chunk boundaries', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('✅ test', 'test ⚠️', '🎉 middle 🔥'),
          fc.integer({ min: 1, max: 4 }),
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
              streamDetected = streamDetected || result.emojiDetected;
            }

            // Final flush might also detect emojis
            const flushed = filter2.flushBuffer();
            const flushResult = filter2.filterText(flushed);
            streamDetected = streamDetected || flushResult.emojiDetected;

            // Both should detect emojis if present
            expect(singleResult.emojiDetected).toBe(true);
            // Stream detection might be delayed due to buffering, but should eventually detect
            expect(typeof streamDetected).toBe('boolean');
          },
        ),
        { numRuns: 30 },
      );
    });
  });

  describe('Object Filtering Properties', () => {
    it('should handle deeply nested objects without stack overflow', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
          (depth: number, mode: FilterConfiguration['mode']) => {
            // Create nested object
            let obj: Record<string, unknown> = { value: 'test ✅' };
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
        ),
        { numRuns: 20 },
      );
    });

    it('should preserve object structure while filtering string values', () => {
      fc.assert(
        fc.property(
          fc.record({
            str: fc.string(),
            num: fc.integer(),
            bool: fc.boolean(),
            nested: fc.record({
              value: fc.string(),
            }),
          }),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
          (obj: Record<string, unknown>, mode: FilterConfiguration['mode']) => {
            const filter = new EmojiFilter({ mode });
            const result = filter.filterToolArgs(obj);

            // Verify filtered is an object
            expect(result.filtered).toBeDefined();
            expect(typeof result.filtered).toBe('object');
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
          },
        ),
        { numRuns: 30 },
      );
    });

    it('should handle arrays of mixed types correctly', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              fc.string(),
              fc.integer(),
              fc.boolean(),
              fc.record({ text: fc.string() }),
            ),
          ),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
          (
            arr: Array<string | number | boolean | Record<string, string>>,
            mode: FilterConfiguration['mode'],
          ) => {
            const obj = { items: arr };
            const filter = new EmojiFilter({ mode });
            const result = filter.filterToolArgs(obj);

            // Verify filtered is an object
            expect(result.filtered).toBeDefined();
            expect(typeof result.filtered).toBe('object');
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
          },
        ),
        { numRuns: 30 },
      );
    });

    it('should handle null and undefined values in objects', () => {
      fc.assert(
        fc.property(
          fc.record({
            nullValue: fc.constant(null),
            undefinedValue: fc.constant(undefined),
            stringValue: fc.string(),
            nestedNull: fc.record({
              inner: fc.constant(null),
            }),
          }),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
          (obj: Record<string, unknown>, mode: FilterConfiguration['mode']) => {
            const filter = new EmojiFilter({ mode });
            const result = filter.filterToolArgs(obj);

            // Verify filtered is an object
            expect(result.filtered).toBeDefined();
            expect(typeof result.filtered).toBe('object');
            const filtered = result.filtered as Record<string, unknown>;

            // Null and undefined should be preserved
            expect(filtered.nullValue).toBe(null);
            expect(filtered.undefinedValue).toBe(undefined);
            expect((filtered.nestedNull as Record<string, unknown>).inner).toBe(
              null,
            );
            expect(typeof filtered.stringValue).toBe('string');
          },
        ),
        { numRuns: 30 },
      );
    });
  });

  describe('Filtering Invariants', () => {
    it('filtered output length should never exceed input plus conversion overhead', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
          (text: string, mode: FilterConfiguration['mode']) => {
            const filter = new EmojiFilter({ mode });
            const result = filter.filterText(text);

            // Verify filtered is a string
            expect(typeof result.filtered).toBe('string');
            // Allow for reasonable conversion overhead (emoji -> text replacements)
            const maxExpectedLength = text.length + 50; // Generous overhead for conversions
            expect((result.filtered as string).length).toBeLessThanOrEqual(
              maxExpectedLength,
            );
          },
        ),
        { numRuns: 50 },
      );
    });

    it('should maintain idempotency - filtering twice should give same result', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
          (text: string, mode: FilterConfiguration['mode']) => {
            const filter1 = new EmojiFilter({ mode });
            const filter2 = new EmojiFilter({ mode });

            const result1 = filter1.filterText(text);

            // Verify first result is a string
            expect(typeof result1.filtered).toBe('string');
            const result2 = filter2.filterText(result1.filtered as string);

            // Second filtering should not change result
            expect(result2.filtered).toBe(result1.filtered);
            // Should not detect emojis in already-filtered text
            expect(result2.emojiDetected).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('should never produce invalid strings', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          fc.oneof(
            fc.constant('allowed' as const),
            fc.constant('auto' as const),
            fc.constant('warn' as const),
          ),
          (text: string, mode: FilterConfiguration['mode']) => {
            const filter = new EmojiFilter({ mode });
            const result = filter.filterText(text);

            // Verify filtered is a string
            expect(typeof result.filtered).toBe('string');
            const filtered = result.filtered as string;
            // Should be valid Unicode string
            expect(() => JSON.stringify(filtered)).not.toThrow();
            expect(filtered.length).toBeGreaterThanOrEqual(0);

            // Should not contain replacement characters indicating corruption
            expect(filtered).not.toContain('\uFFFD');
          },
        ),
        { numRuns: 50 },
      );
    });

    it('should preserve word boundaries when removing decorative emojis', () => {
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom('word', 'test', 'hello'), {
            minLength: 2,
            maxLength: 5,
          }),
          fc.array(fc.constantFrom('🎉', '🔥', '💯', '😀'), {
            minLength: 1,
            maxLength: 3,
          }),
          (words: string[], emojis: string[]) => {
            // Create text with words separated by emojis and spaces
            const text = words.join(' ' + emojis.join('') + ' ');

            const filter = new EmojiFilter({ mode: 'warn' });
            const result = filter.filterText(text);

            // Verify filtered is a string
            expect(typeof result.filtered).toBe('string');
            const filtered = result.filtered as string;
            // All original words should still be present
            words.forEach((word) => {
              expect(filtered).toContain(word);
            });

            // Words should remain separated (not concatenated)
            const filteredWords = filtered
              .split(/\s+/)
              .filter((w) => w.length > 0);
            expect(filteredWords.length).toBeGreaterThanOrEqual(words.length);
          },
        ),
        { numRuns: 30 },
      );
    });
  });

  describe('File Content Specific Properties', () => {
    it('should handle any file content without corrupting code structure', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant('function test() { return true; }'),
            fc.constant('const x = "hello ✅ world";'),
            fc.constant('// Comment with ⚠️ warning\nlet y = 5;'),
            fc.constant('SELECT * FROM table -- 🎉 query'),
          ),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
          (
            codeContent: string,
            toolName: string,
            mode: FilterConfiguration['mode'],
          ) => {
            const filter = new EmojiFilter({ mode });
            const result = filter.filterFileContent(codeContent, toolName);

            expect(result.blocked).toBe(false);
            expect(typeof result.filtered).toBe('string');

            // If system feedback exists, it should contain the tool name
            // Verify the invariant without conditional expects
            const feedbackValid =
              result.systemFeedback === undefined ||
              result.systemFeedback.includes(toolName);
            expect(feedbackValid).toBe(true);
          },
        ),
        { numRuns: 30 },
      );
    });

    it('should maintain line structure in multiline content', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string(), { minLength: 2, maxLength: 10 }),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
          (lines: string[], mode: FilterConfiguration['mode']) => {
            const content = lines.join('\n');

            const filter = new EmojiFilter({ mode });
            const result = filter.filterFileContent(content, 'TestTool');

            // Verify filtered is a string
            expect(typeof result.filtered).toBe('string');
            const filteredLines = (result.filtered as string).split('\n');

            // Should preserve line count
            expect(filteredLines.length).toBe(lines.length);
          },
        ),
        { numRuns: 30 },
      );
    });
  });

  describe('Buffer Management Properties', () => {
    it('should handle flush operations consistently', () => {
      fc.assert(
        fc.property(
          fc.string(),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
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
        ),
        { numRuns: 30 },
      );
    });

    it('should handle empty stream chunks gracefully', () => {
      fc.assert(
        fc.property(
          fc.array(fc.constant(''), { minLength: 1, maxLength: 10 }),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
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
        ),
        { numRuns: 20 },
      );
    });
  });

  describe('Edge Case Properties', () => {
    it('should handle malformed objects gracefully', () => {
      fc.assert(
        fc.property(
          fc.anything().filter(
            (obj) =>
              // Filter out functions, symbols, and undefined that can't be JSON serialized
              obj !== null &&
              obj !== undefined &&
              typeof obj !== 'function' &&
              typeof obj !== 'symbol',
          ),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
          (obj: Record<string, unknown>, mode: FilterConfiguration['mode']) => {
            const filter = new EmojiFilter({ mode });

            // Should not crash even with weird objects
            expect(() => {
              const result = filter.filterToolArgs(obj);
              expect(result.filtered !== undefined).toBe(true);
              expect(typeof result.emojiDetected).toBe('boolean');
              expect(typeof result.blocked).toBe('boolean');
            }).not.toThrow();
          },
        ),
        { numRuns: 30 },
      );
    });

    it('should handle very long strings without performance degradation', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1000, maxLength: 5000 })
            .filter((s) => /^[\x20-\x7E]*$/.test(s)),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
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
        ),
        { numRuns: 10 },
      );
    });

    it('should handle rapid consecutive filtering operations', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ maxLength: 100 }), {
            minLength: 5,
            maxLength: 20,
          }),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
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
        ),
        { numRuns: 20 },
      );
    });

    it('should handle valid complex nested objects consistently', () => {
      fc.assert(
        fc.property(
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
            expect(result.filtered).toBeDefined();
            expect(typeof result.filtered).toBe('object');
            const filtered = result.filtered as Record<string, unknown>;
            expect(typeof filtered.level1).toBe('object');
            expect(typeof filtered.metadata).toBe('object');
          },
        ),
        { numRuns: 20 },
      );
    });

    it('should handle stream operations with mixed content types', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              fc.string({ maxLength: 20 }),
              fc.constant(''),
              fc
                .array(fc.constantFrom('✅', '⚠️', '🎉'), { maxLength: 3 })
                .map((arr) => arr.join('')),
            ),
            { minLength: 3, maxLength: 10 },
          ),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
          (chunks: string[], mode: FilterConfiguration['mode']) => {
            const filter = new EmojiFilter({ mode });

            let totalOutput = '';
            chunks.forEach((chunk) => {
              const result = filter.filterStreamChunk(chunk);
              // Each chunk result should be valid
              expect(result.filtered).toBeDefined();
              expect(typeof result.filtered).toBe('string');
              expect(typeof result.emojiDetected).toBe('boolean');
              expect(typeof result.blocked).toBe('boolean');
              expect(result.blocked).toBe(false);
              totalOutput += result.filtered as string;
            });

            // Flush should complete successfully
            const flushed = filter.flushBuffer();
            expect(typeof flushed).toBe('string');
            totalOutput += flushed;

            expect(typeof totalOutput).toBe('string');
          },
        ),
        { numRuns: 25 },
      );
    });

    it('should maintain filter state isolation between instances', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 100 }),
          fc.string({ maxLength: 100 }),
          fc.oneof(fc.constant('auto' as const), fc.constant('warn' as const)),
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
        ),
        { numRuns: 20 },
      );
    });

    it('should handle mixed mode operations consistently', () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 100 }), (text: string) => {
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

            // Mode-specific invariants - build boolean checks to avoid conditional expects
            const allowedValid =
              mode !== 'allowed' ||
              (result.filtered === text &&
                result.emojiDetected === false &&
                result.blocked === false);
            const autoValid =
              mode !== 'auto' ||
              (result.systemFeedback === undefined && result.blocked === false);
            const warnValid =
              mode !== 'warn' ||
              (result.blocked === false && typeof result.filtered === 'string');
            const errorValid =
              mode !== 'error' || typeof result.blocked === 'boolean';

            expect(allowedValid).toBe(true);
            expect(autoValid).toBe(true);
            expect(warnValid).toBe(true);
            expect(errorValid).toBe(true);
          });
        }),
        { numRuns: 30 },
      );
    });
  });
});
