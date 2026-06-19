/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P05
 * @requirement REQ-CS-002.7, REQ-CS-002.8
 *
 * Media block sanitization behavioral tests for MiddleOutStrategy.
 * Verifies that raw media bytes are never sent to the compression provider.
 * Addresses issue #1889.
 */

import { describe, it, expect } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { MiddleOutStrategy } from './MiddleOutStrategy.js';
import {
  buildContext,
  createCaptureProvider,
  createFakeProvider,
  humanMsg,
  aiTextMsg,
  humanMsgWithMedia,
  testProviderRuntime,
} from './MiddleOutStrategy-test-helpers.js';

/**
 * Type guard for text blocks — used to extract text content from blocks.
 */
function isTextBlock(b: IContent['blocks'][number]): b is {
  type: 'text';
  text: string;
} {
  return b.type === 'text';
}

describe('MiddleOutStrategy media sanitization', () => {
  // -----------------------------------------------------------------------
  // Media block sanitization — issue #1889
  // -----------------------------------------------------------------------

  describe('media block sanitization (issue #1889)', () => {
    it('does not send raw media bytes to the compression provider for middle messages with images', async () => {
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 5) {
          history.push(
            humanMsgWithMedia('Here is the screenshot:', {
              type: 'media',
              mimeType: 'image/png',
              data: 'not-valid-base64===',
              encoding: 'base64',
              filename: 'screenshot.png',
            }),
          );
        } else if (i === 8) {
          history.push(
            humanMsgWithMedia('And this PDF document:', {
              type: 'media',
              mimeType: 'application/pdf',
              data: 'JVBERi0xLjQ=',
              encoding: 'base64',
              filename: 'report.pdf',
            }),
          );
        } else if (i % 2 === 0) {
          history.push(humanMsg(`user message ${i}`));
        } else {
          history.push(aiTextMsg(`ai response ${i}`));
        }
      }

      const capturedRequests: IContent[] = [];
      const captureProvider = createCaptureProvider(
        capturedRequests,
        '<state_snapshot>Compressed summary</state_snapshot>',
      );

      const ctx = buildContext({
        history,
        resolveProvider: () => ({
          provider: captureProvider,
          runtime: testProviderRuntime,
        }),
      });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.llmCallMade).toBe(true);
      expect(result.metadata.strategyUsed).toBe('middle-out');

      const allBlocks = capturedRequests.flatMap((m) => m.blocks);
      const mediaBlocks = allBlocks.filter((b) => b.type === 'media');
      expect(mediaBlocks).toHaveLength(0);

      const textBlocks = allBlocks.filter(isTextBlock);
      for (const tb of textBlocks) {
        expect(tb.text).not.toContain('not-valid-base64===');
        expect(tb.text).not.toContain('JVBERi0xLjQ=');
      }

      const placeholderTexts = textBlocks.map((b) => b.text);
      const hasScreenshotPlaceholder = placeholderTexts.some(
        (t) =>
          t.includes('[Attached image: screenshot.png]') ||
          t.includes('screenshot.png'),
      );
      const hasPdfPlaceholder = placeholderTexts.some(
        (t) =>
          t.includes('[Attached PDF: report.pdf]') || t.includes('report.pdf'),
      );
      expect(hasScreenshotPlaceholder).toBe(true);
      expect(hasPdfPlaceholder).toBe(true);

      const bottomCount = result.metadata.bottomPreserved!;
      const bottomMessages = result.newHistory.slice(
        result.newHistory.length - bottomCount,
      );
      expect(bottomMessages).toStrictEqual(
        history.slice(history.length - bottomCount),
      );
    });

    it('preserves media blocks in top and bottom sections that are not sent to the LLM', async () => {
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 0) {
          history.push(
            humanMsgWithMedia('Initial screenshot', {
              type: 'media',
              mimeType: 'image/png',
              data: 'toppngdata',
              encoding: 'base64',
              filename: 'initial.png',
            }),
          );
        } else if (i === 19) {
          history.push(
            humanMsgWithMedia('Final screenshot', {
              type: 'media',
              mimeType: 'image/jpeg',
              data: 'bottomjpgdata',
              encoding: 'base64',
              filename: 'final.jpg',
            }),
          );
        } else if (i % 2 === 0) {
          history.push(humanMsg(`user message ${i}`));
        } else {
          history.push(aiTextMsg(`ai response ${i}`));
        }
      }

      const capturedRequests: IContent[] = [];
      const captureProvider = createCaptureProvider(
        capturedRequests,
        '<state_snapshot>Compressed</state_snapshot>',
      );

      const ctx = buildContext({
        history,
        resolveProvider: () => ({
          provider: captureProvider,
          runtime: testProviderRuntime,
        }),
      });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      const topCount = result.metadata.topPreserved!;
      const topMessages = result.newHistory.slice(0, topCount);
      const topMediaBlocks = topMessages.flatMap((m) =>
        m.blocks.filter((b) => b.type === 'media'),
      );
      expect(topMediaBlocks).toHaveLength(1);
      expect(topMediaBlocks[0].filename).toBe('initial.png');

      const bottomCount = result.metadata.bottomPreserved!;
      const bottomMessages = result.newHistory.slice(
        result.newHistory.length - bottomCount,
      );
      const bottomMediaBlocks = bottomMessages.flatMap((m) =>
        m.blocks.filter((b) => b.type === 'media'),
      );
      expect(bottomMediaBlocks).toHaveLength(1);
      expect(bottomMediaBlocks[0].filename).toBe('final.jpg');

      const allBlocks = capturedRequests.flatMap((m) => m.blocks);
      const mediaInRequest = allBlocks.filter((b) => b.type === 'media');
      expect(mediaInRequest).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // largeLastPromptInjection media sanitization — issue #1889
  // -----------------------------------------------------------------------

  describe('largeLastPromptInjection media sanitization (issue #1889)', () => {
    it('uses text placeholders for media blocks in the largeLastPromptInjection (no raw media in provider request)', async () => {
      const longText = 'x'.repeat(5000);
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 9) {
          history.push(
            humanMsgWithMedia(longText, {
              type: 'media',
              mimeType: 'image/png',
              data: 'malformed-base64===',
              encoding: 'base64',
              filename: 'crash-screenshot.png',
              caption: 'Error screenshot showing crash',
            }),
          );
        } else if (i % 2 === 0) {
          history.push(humanMsg(`user message ${i}`));
        } else {
          history.push(aiTextMsg(`ai response ${i}`));
        }
      }

      const capturedRequests: IContent[] = [];
      const captureProvider = createCaptureProvider(
        capturedRequests,
        '<state_snapshot>Compressed summary</state_snapshot>',
      );

      const ctx = buildContext({
        history,
        resolveProvider: () => ({
          provider: captureProvider,
          runtime: testProviderRuntime,
        }),
      });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.llmCallMade).toBe(true);

      const allBlocks = capturedRequests.flatMap((m) => m.blocks);
      const mediaBlocks = allBlocks.filter((b) => b.type === 'media');
      expect(mediaBlocks).toHaveLength(0);

      const textBlocks = allBlocks.filter(isTextBlock);
      for (const tb of textBlocks) {
        expect(tb.text).not.toContain('malformed-base64===');
      }

      const injectionTexts = textBlocks.map((b) => b.text);
      const hasCrashPlaceholder = injectionTexts.some(
        (t) =>
          t.includes('[Attached image: Error screenshot showing crash]') ||
          t.includes('[Attached image: crash-screenshot.png]'),
      );
      expect(hasCrashPlaceholder).toBe(true);

      const topCount = result.metadata.topPreserved!;
      const ackMsg = result.newHistory[topCount + 1];
      expect(ackMsg.speaker).toBe('ai');
      const ackText = (ackMsg.blocks[0] as { type: 'text'; text: string }).text;
      expect(ackText).not.toContain('malformed-base64===');
    });

    it('uses placeholders when the large last human prompt in compress range includes media', async () => {
      const longText = 'y'.repeat(5000);
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 9) {
          history.push({
            speaker: 'human',
            blocks: [
              { type: 'text', text: longText },
              {
                type: 'media',
                mimeType: 'image/webp',
                data: 'AAAA=',
                encoding: 'base64',
                filename: 'diagram.webp',
              },
            ],
          });
        } else if (i % 2 === 0) {
          history.push(humanMsg(`user message ${i}`));
        } else {
          history.push(aiTextMsg(`ai response ${i}`));
        }
      }

      const capturedRequests: IContent[] = [];
      const captureProvider = createCaptureProvider(
        capturedRequests,
        '<state_snapshot>Compressed</state_snapshot>',
      );

      const ctx = buildContext({
        history,
        resolveProvider: () => ({
          provider: captureProvider,
          runtime: testProviderRuntime,
        }),
      });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.llmCallMade).toBe(true);

      const allBlocks = capturedRequests.flatMap((m) => m.blocks);
      const mediaBlocks = allBlocks.filter((b) => b.type === 'media');
      expect(mediaBlocks).toHaveLength(0);

      const textBlocks = allBlocks.filter(isTextBlock);
      for (const tb of textBlocks) {
        expect(tb.text).not.toContain('AAAA=');
      }

      const injectionTexts = textBlocks.map((b) => b.text);
      const hasDiagramPlaceholder = injectionTexts.some((t) =>
        t.includes('[Attached image: diagram.webp]'),
      );
      expect(hasDiagramPlaceholder).toBe(true);
    });

    it('no media blocks reach the provider when short prompt with media is moved to bottom', async () => {
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 9) {
          history.push(
            humanMsgWithMedia('Check this image:', {
              type: 'media',
              mimeType: 'image/jpeg',
              data: 'base64imagedata==',
              encoding: 'base64',
              filename: 'photo.jpg',
            }),
          );
        } else if (i % 2 === 0) {
          history.push(humanMsg(`user message ${i}`));
        } else {
          history.push(aiTextMsg(`ai response ${i}`));
        }
      }

      const capturedRequests: IContent[] = [];
      const captureProvider = createCaptureProvider(
        capturedRequests,
        '<state_snapshot>Compressed</state_snapshot>',
      );

      const ctx = buildContext({
        history,
        resolveProvider: () => ({
          provider: captureProvider,
          runtime: testProviderRuntime,
        }),
      });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.llmCallMade).toBe(true);

      const allBlocks = capturedRequests.flatMap((m) => m.blocks);
      const mediaInRequest = allBlocks.filter((b) => b.type === 'media');
      expect(mediaInRequest).toHaveLength(0);

      const textBlocks = allBlocks.filter(isTextBlock);
      for (const tb of textBlocks) {
        expect(tb.text).not.toContain('base64imagedata==');
      }

      const topCount = result.metadata.topPreserved!;
      const ackMsg = result.newHistory[topCount + 1];
      const ackText = (ackMsg.blocks[0] as { type: 'text'; text: string }).text;
      expect(ackText).not.toContain('base64imagedata==');
    });

    it('lastUserPromptContext string contains placeholder text, not raw media data, for messages with media', async () => {
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 19) {
          history.push(
            humanMsgWithMedia('Look at this chart:', {
              type: 'media',
              mimeType: 'image/png',
              data: 'rawchartdata=',
              encoding: 'base64',
              filename: 'chart.png',
              caption: 'Revenue chart Q4',
            }),
          );
        } else if (i % 2 === 0) {
          history.push(humanMsg(`user message ${i}`));
        } else {
          history.push(aiTextMsg(`ai response ${i}`));
        }
      }

      const defaultProvider = createFakeProvider('default-provider');
      const ctx = buildContext({
        history,
        resolveProvider: () => ({
          provider: defaultProvider,
          runtime: testProviderRuntime,
        }),
      });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      const topCount = result.metadata.topPreserved!;
      const ackMsg = result.newHistory[topCount + 1];
      const ackText = (ackMsg.blocks[0] as { type: 'text'; text: string }).text;

      expect(ackText).not.toContain('rawchartdata=');
      expect(ackText).toContain('[Attached image: Revenue chart Q4]');
    });
  });
});
