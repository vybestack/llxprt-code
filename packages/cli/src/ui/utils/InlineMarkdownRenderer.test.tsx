/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { RenderInline } from './InlineMarkdownRenderer.js';

describe('InlineMarkdownRenderer', () => {
  describe('link rendering', () => {
    it('should render standalone URLs as clickable', () => {
      const { lastFrame } = render(
        <RenderInline text="Check out https://example.com for more info" />,
      );
      expect(lastFrame()).toContain('https://example.com');
    });

    it('should render http URLs as clickable', () => {
      const { lastFrame } = render(
        <RenderInline text="Visit http://example.org today" />,
      );
      expect(lastFrame()).toContain('http://example.org');
    });

    it('should render multiple URLs in the same text as clickable', () => {
      const { lastFrame } = render(
        <RenderInline text="See https://example.com and also http://test.org" />,
      );
      expect(lastFrame()).toContain('https://example.com');
      expect(lastFrame()).toContain('http://test.org');
    });

    it('should render markdown links with clickable URLs', () => {
      const { lastFrame } = render(
        <RenderInline text="Check out [example](https://example.com) for more info" />,
      );
      expect(lastFrame()).toContain('https://example.com');
    });

    it('should preserve URL formatting when wrapped across lines', () => {
      const longUrl = 'https://github.com/vybestack/llxprt-code/issues/611';
      const { lastFrame } = render(
        <RenderInline text={`Here is the PR: ${longUrl}`} />,
      );
      expect(lastFrame()).toContain(longUrl);
    });

    it('should handle URLs with query parameters and fragments', () => {
      const complexUrl =
        'https://example.com/path?param=value&other=test#section';
      const { lastFrame } = render(
        <RenderInline text={`Complex URL: ${complexUrl}`} />,
      );
      expect(lastFrame()).toContain(complexUrl);
    });

    it('should render URLs alongside other markdown formatting', () => {
      const { lastFrame } = render(
        <RenderInline text="**Important**: Visit https://example.com now!" />,
      );
      expect(lastFrame()).toContain('https://example.com');
      expect(lastFrame()).toContain('Important');
    });
  });
});
