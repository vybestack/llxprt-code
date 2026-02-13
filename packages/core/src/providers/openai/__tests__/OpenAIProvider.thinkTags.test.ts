/**
 * Tests for think tag extraction and text sanitization shared utilities.
 *
 * These tests verify:
 * - Bug #1: Kimi-K2 text content should be sanitized (think tags stripped from text)
 * - extractThinkTagsAsBlock correctly extracts thinking content
 * - sanitizeProviderText correctly strips think tags
 *
 * @plan PLAN-20251202-THINKING.P16
 * @requirement REQ-THINK-003
 */
import { describe, it, expect } from 'vitest';
import { extractThinkTagsAsBlock } from '../../utils/thinkingExtraction';
import { sanitizeProviderText } from '../../utils/textSanitizer';

describe('OpenAIProvider think tag handling @plan:PLAN-20251202-THINKING.P16', () => {
  describe('extractThinkTagsAsBlock @requirement:REQ-THINK-003', () => {
    it('should extract single <think> tag content', () => {
      const text =
        '<think>Let me analyze this problem carefully.</think>Here is my answer.';
      const result = extractThinkTagsAsBlock(text);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('thinking');
      expect(result?.thought).toBe('Let me analyze this problem carefully.');
      expect(result?.sourceField).toBe('think_tags');
    });

    it('should extract multiple <think> tags and join with newlines (standard format)', () => {
      const text = `<think>First thought about the problem.</think>
Some content here.
<think>Second thought with more analysis.</think>
Final answer.`;
      const result = extractThinkTagsAsBlock(text);

      expect(result).not.toBeNull();
      expect(result?.thought).toContain('First thought about the problem.');
      expect(result?.thought).toContain('Second thought with more analysis.');
      // Standard format joins with double newlines
      expect(result?.thought).toBe(
        'First thought about the problem.\n\nSecond thought with more analysis.',
      );
    });

    it('should extract fragmented <think>word</think> format (Synthetic API style)', () => {
      // This simulates the Synthetic API's token-by-token streaming with individual tags
      const text =
        '<think>The</think><think>user</think><think>wants</think><think>to</think><think>know</think><think>about</think><think>this</think><think>topic</think>';
      const result = extractThinkTagsAsBlock(text);

      expect(result).not.toBeNull();
      // Fragmented format should join with spaces
      expect(result?.thought).toBe('The user wants to know about this topic');
      expect(result?.sourceField).toBe('think_tags');
    });

    it('should detect fragmented format based on part count and average length', () => {
      // Many short parts = fragmented
      const fragmented =
        '<think>a</think><think>b</think><think>c</think><think>d</think><think>e</think><think>f</think><think>g</think>';
      const fragmentedResult = extractThinkTagsAsBlock(fragmented);
      expect(fragmentedResult?.thought).toBe('a b c d e f g'); // Joined with spaces

      // Few longer parts = standard
      const standard =
        '<think>This is a longer thought.</think><think>And another longer thought.</think>';
      const standardResult = extractThinkTagsAsBlock(standard);
      expect(standardResult?.thought).toBe(
        'This is a longer thought.\n\nAnd another longer thought.',
      ); // Joined with newlines
    });

    it('should extract <thinking> tags', () => {
      const text =
        '<thinking>Deep analysis here.</thinking>Result of analysis.';
      const result = extractThinkTagsAsBlock(text);

      expect(result).not.toBeNull();
      expect(result?.thought).toBe('Deep analysis here.');
    });

    it('should extract <analysis> tags', () => {
      const text = '<analysis>Analyzing the data...</analysis>Conclusion.';
      const result = extractThinkTagsAsBlock(text);

      expect(result).not.toBeNull();
      expect(result?.thought).toBe('Analyzing the data...');
    });

    it('should return null when no think tags present', () => {
      const text = 'Just regular content without any thinking tags.';
      const result = extractThinkTagsAsBlock(text);

      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = extractThinkTagsAsBlock('');
      expect(result).toBeNull();
    });

    it('should return null for null/undefined input', () => {
      const result1 = extractThinkTagsAsBlock(null as unknown as string);
      const result2 = extractThinkTagsAsBlock(undefined as unknown as string);

      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });

    it('should handle empty think tags', () => {
      const text = '<think></think>Some content.';
      const result = extractThinkTagsAsBlock(text);

      // Empty tags should not produce a thinking block
      expect(result).toBeNull();
    });

    it('should handle whitespace-only think tags', () => {
      const text = '<think>   \n\t  </think>Some content.';
      const result = extractThinkTagsAsBlock(text);

      // Whitespace-only should not produce a thinking block
      expect(result).toBeNull();
    });

    it('should be case-insensitive for tag names', () => {
      const text1 = '<THINK>Uppercase thinking.</THINK>';
      const text2 = '<Think>Mixed case.</Think>';
      const text3 = '<ThInK>Random case.</ThInK>';

      expect(extractThinkTagsAsBlock(text1)?.thought).toBe(
        'Uppercase thinking.',
      );
      expect(extractThinkTagsAsBlock(text2)?.thought).toBe('Mixed case.');
      expect(extractThinkTagsAsBlock(text3)?.thought).toBe('Random case.');
    });

    it('should handle multiline content within think tags', () => {
      const text = `<think>
First line of thinking.
Second line of thinking.
Third line with conclusion.
</think>Answer here.`;
      const result = extractThinkTagsAsBlock(text);

      expect(result).not.toBeNull();
      expect(result?.thought).toContain('First line of thinking.');
      expect(result?.thought).toContain('Second line of thinking.');
      expect(result?.thought).toContain('Third line with conclusion.');
    });
  });

  describe('sanitizeProviderText @requirement:REQ-THINK-003', () => {
    it('should strip <think> tags and their content', () => {
      const text = '<think>Some thinking here.</think>Visible content remains.';
      const result = sanitizeProviderText(text);

      expect(result).toBe('Visible content remains.');
      expect(result).not.toContain('<think>');
      expect(result).not.toContain('Some thinking here.');
    });

    it('should strip <thinking> tags and their content', () => {
      const text = '<thinking>Analysis.</thinking>Result.';
      const result = sanitizeProviderText(text);

      expect(result).toBe('Result.');
    });

    it('should strip <analysis> tags and their content', () => {
      const text = '<analysis>Deep thought.</analysis>Conclusion.';
      const result = sanitizeProviderText(text);

      expect(result).toBe('Conclusion.');
    });

    it('should strip multiple think tags', () => {
      const text =
        '<think>First.</think>Middle content.<think>Second.</think>End.';
      const result = sanitizeProviderText(text);

      // Think tags are replaced with spaces to preserve word separation
      // (prevents "these5" instead of "these 5")
      expect(result).toBe('Middle content. End.');
    });

    it('should strip orphaned/unmatched tags', () => {
      const text1 = '<think>Content';
      const text2 = 'Content</think>';
      const text3 = 'Before<think>After';

      expect(sanitizeProviderText(text1)).not.toContain('<think>');
      expect(sanitizeProviderText(text2)).not.toContain('</think>');
      expect(sanitizeProviderText(text3)).not.toContain('<think>');
    });

    it('should handle mixed tag types', () => {
      const text =
        '<think>A</think>B<thinking>C</thinking>D<analysis>E</analysis>F';
      const result = sanitizeProviderText(text);

      // Think tags are replaced with spaces to preserve word separation
      // (prevents "these5" instead of "these 5")
      expect(result).toBe('B D F');
    });

    it('should be case-insensitive', () => {
      const text = '<THINK>upper</THINK><Think>mixed</Think>';
      const result = sanitizeProviderText(text);

      expect(result).toBe('');
      expect(result).not.toContain('upper');
      expect(result).not.toContain('mixed');
    });

    it('should handle null/undefined input', () => {
      expect(sanitizeProviderText(null)).toBe('');
      expect(sanitizeProviderText(undefined)).toBe('');
    });

    it('should handle non-string input', () => {
      expect(sanitizeProviderText(123)).toBe('123');
      expect(sanitizeProviderText({ toString: () => 'object' })).toBe('object');
    });

    it('should preserve content without think tags', () => {
      const text = 'Regular content without any special tags.';
      const result = sanitizeProviderText(text);

      expect(result).toBe(text);
    });

    it('should preserve newlines after think tag content when think tags were stripped', () => {
      const text = '<think>My analysis</think>\nHere is the result.';
      const result = sanitizeProviderText(text);
      // The newline after the think tag should be preserved
      expect(result).toBe('\nHere is the result.');
    });

    it('should preserve paragraph breaks after think tags', () => {
      const text =
        '<think>Deep analysis here</think>\n\nParagraph 1.\n\nParagraph 2.';
      const result = sanitizeProviderText(text);
      // Should preserve the paragraph structure
      expect(result).toBe('\n\nParagraph 1.\n\nParagraph 2.');
    });

    it('should handle streaming chunk with closing think tag followed by newline', () => {
      const text = '</think>\n';
      const result = sanitizeProviderText(text);
      // The newline should be preserved
      expect(result).toBe('\n');
    });

    it('should only trim leading spaces and tabs, not newlines, after think tag removal', () => {
      const text = '<think>thought</think>   \n\nContent here';
      const result = sanitizeProviderText(text);
      // Spaces before newline collapsed to single space, then removed as leading horizontal whitespace
      // But newlines are preserved
      expect(result).toBe('\n\nContent here');
    });
  });

  describe('Bug #1: Kimi-K2 text content sanitization', () => {
    /**
     * This test verifies that text content for Kimi-K2 models is properly sanitized
     * to remove <think> tags. Previously, Kimi-K2 text was NOT sanitized (line 2590-2592),
     * causing <think> tags to leak into the visible output.
     */
    it('should sanitize text content for Kimi-K2 model (removing think tags)', () => {
      // Simulate Kimi-K2 response with think tags in content
      const kimiContent =
        '<think>Let me analyze the code.</think>The code looks correct.';

      // After extraction, the text should be sanitized
      const sanitized = sanitizeProviderText(kimiContent);

      // The sanitized text should not contain think tags
      expect(sanitized).toBe('The code looks correct.');
      expect(sanitized).not.toContain('<think>');
      expect(sanitized).not.toContain('</think>');
      expect(sanitized).not.toContain('Let me analyze');
    });

    it('should handle fragmented think tags from Synthetic API in Kimi-K2 content', () => {
      // Synthetic API sends fragmented think tags token-by-token
      const fragmentedContent =
        '<think>The</think><think>user</think><think>asks</think>Here is the answer.';

      const sanitized = sanitizeProviderText(fragmentedContent);

      expect(sanitized).toBe('Here is the answer.');
      expect(sanitized).not.toContain('<think>');
      expect(sanitized).not.toContain('The');
      expect(sanitized).not.toContain('user');
      expect(sanitized).not.toContain('asks');
    });
  });
});
