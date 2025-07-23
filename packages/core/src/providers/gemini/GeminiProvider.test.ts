/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GeminiProvider } from './GeminiProvider.js';
import { IMessage } from '../IMessage.js';
import { ContentGeneratorRole } from '@vybestack/llxprt-code-core';

describe('GeminiProvider', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider();
  });

  describe('convertMessagesToGeminiFormat', () => {
    it('should handle string content', () => {
      const messages: IMessage[] = [
        {
          role: ContentGeneratorRole.USER,
          content: 'Hello world',
        },
      ];

      const result = provider['convertMessagesToGeminiFormat'](messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].parts).toHaveLength(1);
      expect(result[0].parts[0]).toEqual({ text: 'Hello world' });
    });

    it('should handle PDF content with inlineData', () => {
      const pdfContent = {
        inlineData: {
          data: 'base64encodedpdfdata',
          mimeType: 'application/pdf',
        },
      };

      const messages: IMessage[] = [
        {
          role: ContentGeneratorRole.USER,
          // @ts-expect-error Testing with non-string content
          content: pdfContent,
        },
      ];

      const result = provider['convertMessagesToGeminiFormat'](messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].parts).toHaveLength(1);
      expect(result[0].parts[0]).toEqual(pdfContent);
    });

    it('should handle mixed content (text and inline data)', () => {
      const mixedContent = [
        { text: 'Here is a PDF file:' },
        {
          inlineData: {
            data: 'base64encodedpdfdata',
            mimeType: 'application/pdf',
          },
        },
        { text: 'Please analyze this document.' },
      ];

      const messages: IMessage[] = [
        {
          role: ContentGeneratorRole.USER,
          // @ts-expect-error Testing with non-string content
          content: mixedContent,
        },
      ];

      const result = provider['convertMessagesToGeminiFormat'](messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].parts).toHaveLength(3);
      expect(result[0].parts[0]).toEqual({ text: 'Here is a PDF file:' });
      expect(result[0].parts[1]).toEqual({
        inlineData: {
          data: 'base64encodedpdfdata',
          mimeType: 'application/pdf',
        },
      });
      expect(result[0].parts[2]).toEqual({
        text: 'Please analyze this document.',
      });
    });

    it('should handle multiple files in content', () => {
      const multiFileContent = [
        { text: 'Here are multiple files:' },
        {
          inlineData: {
            data: 'base64pdf1',
            mimeType: 'application/pdf',
          },
        },
        {
          inlineData: {
            data: 'base64image',
            mimeType: 'image/png',
          },
        },
      ];

      const messages: IMessage[] = [
        {
          role: ContentGeneratorRole.USER,
          // @ts-expect-error Testing with non-string content
          content: multiFileContent,
        },
      ];

      const result = provider['convertMessagesToGeminiFormat'](messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].parts).toHaveLength(3);
      expect(result[0].parts[1]).toEqual({
        inlineData: {
          data: 'base64pdf1',
          mimeType: 'application/pdf',
        },
      });
      expect(result[0].parts[2]).toEqual({
        inlineData: {
          data: 'base64image',
          mimeType: 'image/png',
        },
      });
    });

    it('should handle assistant messages with mixed content', () => {
      const messages: IMessage[] = [
        {
          role: ContentGeneratorRole.ASSISTANT,
          content: 'Here is the analysis',
        },
      ];

      const result = provider['convertMessagesToGeminiFormat'](messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('model');
      expect(result[0].parts).toHaveLength(1);
      expect(result[0].parts[0]).toEqual({ text: 'Here is the analysis' });
    });
  });
});
