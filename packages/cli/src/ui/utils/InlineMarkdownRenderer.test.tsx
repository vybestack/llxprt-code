/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { RenderInline } from './InlineMarkdownRenderer.js';

describe('<RenderInline />', () => {
  describe('link rendering', () => {
    it('renders markdown links with OSC 8 hyperlinks', () => {
      const text = 'Check out this [link](https://example.com) for more info';
      const { lastFrame } = render(<RenderInline text={text} />);
      const output = lastFrame();

      // Should contain OSC 8 hyperlink sequence
      expect(output).toContain('\u001b]8;;https://example.com\u001b\\');
      expect(output).toContain('\u001b]8;;\u001b\\');
      expect(output).toContain('link');
    });

    it('renders plain URLs with OSC 8 hyperlinks', () => {
      const text = 'Visit https://example.com for more information';
      const { lastFrame } = render(<RenderInline text={text} />);
      const output = lastFrame();

      // Should contain OSC 8 hyperlink sequence
      expect(output).toContain('\u001b]8;;https://example.com\u001b\\');
      expect(output).toContain('\u001b]8;;\u001b\\');
    });

    it('renders HTTP URLs with OSC 8 hyperlinks', () => {
      const text = 'Go to http://example.com for details';
      const { lastFrame } = render(<RenderInline text={text} />);
      const output = lastFrame();

      // Should contain OSC 8 hyperlink sequence
      expect(output).toContain('\u001b]8;;http://example.com\u001b\\');
      expect(output).toContain('\u001b]8;;\u001b\\');
    });

    it('renders multiple links correctly', () => {
      const text =
        'Visit [Google](https://google.com) and [GitHub](https://github.com)';
      const { lastFrame } = render(<RenderInline text={text} />);
      const output = lastFrame();

      // Should contain both OSC 8 hyperlink sequences
      expect(output).toContain('\u001b]8;;https://google.com\u001b\\');
      expect(output).toContain('\u001b]8;;https://github.com\u001b\\');
      expect(output).toContain('Google');
      expect(output).toContain('GitHub');
    });

    it('renders mixed markdown and plain URLs', () => {
      const text =
        'Visit [Google](https://google.com) and also https://example.com';
      const { lastFrame } = render(<RenderInline text={text} />);
      const output = lastFrame();

      // Should contain both OSC 8 hyperlink sequences
      expect(output).toContain('\u001b]8;;https://google.com\u001b\\');
      expect(output).toContain('\u001b]8;;https://example.com\u001b\\');
      expect(output).toContain('Google');
    });

    it('handles URLs with query parameters', () => {
      const text = 'Visit https://example.com/path?query=value&other=123';
      const { lastFrame } = render(<RenderInline text={text} />);
      const output = lastFrame();

      // Should contain OSC 8 hyperlink sequence with full URL
      expect(output).toContain(
        '\u001b]8;;https://example.com/path?query=value&other=123\u001b\\',
      );
      expect(output).toContain('\u001b]8;;\u001b\\');
    });

    it('handles URLs with fragments', () => {
      const text = 'Visit https://example.com/path#section';
      const { lastFrame } = render(<RenderInline text={text} />);
      const output = lastFrame();

      // Should contain OSC 8 hyperlink sequence with full URL
      expect(output).toContain(
        '\u001b]8;;https://example.com/path#section\u001b\\',
      );
      expect(output).toContain('\u001b]8;;\u001b\\');
    });

    it('does not convert text without proper URL format', () => {
      const text = 'This is not a url: example.com or www.google.com';
      const { lastFrame } = render(<RenderInline text={text} />);
      const output = lastFrame();

      // Should not contain OSC 8 hyperlink sequence
      expect(output).not.toContain('\u001b]8;;');
    });

    it('handles edge cases with punctuation', () => {
      const text = 'Visit https://example.com, then https://github.com.';
      const { lastFrame } = render(<RenderInline text={text} />);
      const output = lastFrame();

      // Should contain OSC 8 hyperlink sequences
      expect(output).toContain('\u001b]8;;https://example.com\u001b\\');
      expect(output).toContain('\u001b]8;;https://github.com\u001b\\');
      // Should preserve punctuation
      expect(output).toContain(',');
      expect(output).toContain('.');
    });
  });

  describe('existing functionality', () => {
    it('renders bold text', () => {
      const text = 'This is **bold** text';
      const { lastFrame } = render(<RenderInline text={text} />);
      const output = lastFrame();

      expect(output).toContain('bold');
    });

    it('renders italic text', () => {
      const text = 'This is *italic* text';
      const { lastFrame } = render(<RenderInline text={text} />);
      const output = lastFrame();

      expect(output).toContain('italic');
    });

    it('renders inline code', () => {
      const text = 'This is `code` text';
      const { lastFrame } = render(<RenderInline text={text} />);
      const output = lastFrame();

      expect(output).toContain('code');
    });
  });
});
