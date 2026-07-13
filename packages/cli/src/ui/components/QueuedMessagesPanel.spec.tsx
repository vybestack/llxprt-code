/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  extractPreviewText,
  prepareQueuedMessagesPanelView,
} from './QueuedMessagesPanel.js';
import type { QueuedSubmission } from '../hooks/agentStream/types.js';
import type {
  AgentRequestInput,
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core';

function textQuery(text: string): AgentRequestInput {
  return [{ type: 'text', text }];
}

function makeSubmission(text: string): QueuedSubmission {
  return { query: textQuery(text) };
}

describe('QueuedMessagesPanel content preparation', () => {
  describe('preview text extraction', () => {
    it('returns the string directly when query is a string', () => {
      expect(extractPreviewText('hello')).toBe('hello');
    });

    it('extracts text from a single-element content block array', () => {
      const query: AgentRequestInput = [{ type: 'text', text: 'hello' }];
      expect(extractPreviewText(query)).toBe('hello');
    });

    it('extracts text from multi-element content block arrays, space-joined', () => {
      const query: AgentRequestInput = [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ];
      expect(extractPreviewText(query)).toBe('hello world');
    });

    it('returns empty string for empty string input', () => {
      expect(extractPreviewText('')).toBe('');
    });

    it('returns the empty-message placeholder for an empty array', () => {
      expect(extractPreviewText([])).toBe('(empty message)');
    });

    it('extracts text from a single IContent turn', () => {
      const query: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'single turn' }],
      };
      expect(extractPreviewText(query)).toBe('single turn');
    });

    it('extracts text from an IContent array', () => {
      const query: IContent[] = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] },
        { speaker: 'ai', blocks: [{ type: 'text', text: 'second' }] },
      ];
      expect(extractPreviewText(query)).toBe('first second');
    });

    it('handles a typed non-text ContentBlock array', () => {
      const query: ContentBlock[] = [
        {
          type: 'media',
          mimeType: 'image/png',
          data: 'base64...',
          encoding: 'base64',
        },
      ];
      expect(extractPreviewText(query)).toBe('(non-text message)');
    });

    it('skips non-text parts in mixed arrays', () => {
      const query: ContentBlock[] = [
        {
          type: 'media',
          mimeType: 'image/png',
          data: 'base64...',
          encoding: 'base64',
        },
        { type: 'text', text: 'actual text' },
      ];
      expect(extractPreviewText(query)).toBe('actual text');
    });

    it('ignores empty text blocks when joining preview text', () => {
      const query: AgentRequestInput = [
        { type: 'text', text: '' },
        { type: 'text', text: 'content' },
      ];
      expect(extractPreviewText(query)).toBe('content');
    });
  });

  describe('rendering semantics', () => {
    it('prepares an empty view when the queue is empty', () => {
      expect(
        prepareQueuedMessagesPanelView({
          width: 80,
          messages: [],
          columns: 80,
          rows: 24,
        }),
      ).toStrictEqual({ kind: 'empty' });
    });

    it('prepares the collapsed count and next-message preview', () => {
      expect(
        prepareQueuedMessagesPanelView({
          width: 80,
          collapsed: true,
          messages: [makeSubmission('one'), makeSubmission('two')],
          columns: 80,
          rows: 24,
        }),
      ).toStrictEqual({
        kind: 'collapsed',
        width: 80,
        panelHeight: 4,
        summary: '2 queued messages',
        nextPreview: 'one',
      });
    });

    it('prepares a preview for one queued message in collapsed mode', () => {
      expect(
        prepareQueuedMessagesPanelView({
          width: 80,
          collapsed: true,
          messages: [makeSubmission('one')],
          columns: 80,
          rows: 24,
        }),
      ).toStrictEqual({
        kind: 'collapsed',
        width: 80,
        panelHeight: 4,
        summary: '1 queued message',
        nextPreview: 'one',
      });
    });

    it('prepares the expanded heading and numbered queued messages', () => {
      expect(
        prepareQueuedMessagesPanelView({
          width: 80,
          messages: [makeSubmission('one'), makeSubmission('two')],
          columns: 80,
          rows: 40,
        }),
      ).toStrictEqual({
        kind: 'expanded',
        width: 80,
        panelHeight: 8,
        heading: 'Queued Messages (2)',
        messages: [
          { key: 'queued-0-one', number: 1, preview: 'one' },
          { key: 'queued-1-two', number: 2, preview: 'two' },
        ],
        moreCount: 0,
        showMoreIndicator: false,
      });
    });

    it('uses all available message rows without adding a more indicator', () => {
      const view = prepareQueuedMessagesPanelView({
        width: 80,
        messages: [
          makeSubmission('one'),
          makeSubmission('two'),
          makeSubmission('three'),
        ],
        columns: 80,
        rows: 25,
      });

      expect(view).toMatchObject({ kind: 'expanded', moreCount: 0 });
      expect(view.kind === 'expanded' ? view.messages : []).toHaveLength(3);
      expect(
        view.kind === 'expanded' ? view.messages[2] : undefined,
      ).toMatchObject({ number: 3, preview: 'three' });
    });

    it('prepares a compact count-and-message summary for a one-row panel', () => {
      expect(
        prepareQueuedMessagesPanelView({
          width: 80,
          messages: [
            makeSubmission('a long first message'),
            makeSubmission('a long second message'),
          ],
          columns: 20,
          rows: 5,
        }),
      ).toStrictEqual({
        kind: 'compact',
        width: 20,
        summary: '2 queued messages',
      });
    });

    it('falls back to a compact summary when expanded content cannot fit', () => {
      expect(
        prepareQueuedMessagesPanelView({
          width: 80,
          messages: [makeSubmission('one'), makeSubmission('two')],
          columns: 80,
          rows: 10,
        }),
      ).toStrictEqual({
        kind: 'compact',
        width: 80,
        summary: '2 queued messages',
      });
    });

    it('shows only the overflow indicator when one content row cannot fit both', () => {
      expect(
        prepareQueuedMessagesPanelView({
          width: 80,
          messages: [makeSubmission('one'), makeSubmission('two')],
          columns: 80,
          rows: 15,
        }),
      ).toMatchObject({
        kind: 'expanded',
        panelHeight: 3,
        messages: [],
        moreCount: 2,
        showMoreIndicator: true,
      });
    });

    it('truncates previews to the expanded content width', () => {
      const view = prepareQueuedMessagesPanelView({
        width: 20,
        messages: [
          makeSubmission('This queued message is longer than the panel'),
        ],
        columns: 20,
        rows: 20,
      });

      expect(view.kind === 'expanded' ? view.messages[0].preview : '').toBe(
        'This queued m...',
      );
    });

    it('reserves the final row for the remaining-message indicator', () => {
      const view = prepareQueuedMessagesPanelView({
        width: 80,
        messages: [
          makeSubmission('one'),
          makeSubmission('two'),
          makeSubmission('three'),
          makeSubmission('four'),
        ],
        columns: 80,
        rows: 20,
      });

      expect(view).toMatchObject({
        kind: 'expanded',
        moreCount: 3,
        showMoreIndicator: true,
      });
      expect(view.kind === 'expanded' ? view.messages : []).toHaveLength(1);
    });
  });

  describe('collapsed precedence over compact', () => {
    it('stays collapsed even when panelHeight is 1', () => {
      // rows=5 → panelHeight = floor(5 * 0.2) = 1
      const view = prepareQueuedMessagesPanelView({
        width: 80,
        collapsed: true,
        messages: [makeSubmission('one'), makeSubmission('two')],
        columns: 80,
        rows: 5,
      });

      expect(view).toStrictEqual({
        kind: 'collapsed',
        width: 80,
        panelHeight: 1,
        summary: '2 queued messages',
        nextPreview: 'one',
      });
    });

    it('stays collapsed when panelHeight is below the expanded minimum', () => {
      // rows=10 → panelHeight = floor(10 * 0.2) = 2, below MIN_EXPANDED_PANEL_HEIGHT
      const view = prepareQueuedMessagesPanelView({
        width: 80,
        collapsed: true,
        messages: [makeSubmission('one')],
        columns: 80,
        rows: 10,
      });

      expect(view.kind).toBe('collapsed');
    });
  });

  describe('stable key with promptId edge cases', () => {
    it('keeps queue identity keys stable when repeated previews are reordered', () => {
      const first: QueuedSubmission = {
        query: textQuery('same preview'),
        queueId: 41,
      };
      const second: QueuedSubmission = {
        query: textQuery('same preview'),
        queueId: 42,
      };
      const prepareKeys = (messages: readonly QueuedSubmission[]) => {
        const view = prepareQueuedMessagesPanelView({
          width: 80,
          messages,
          columns: 80,
          rows: 40,
        });
        return view.kind === 'expanded'
          ? view.messages.map((message) => message.key)
          : [];
      };

      expect(prepareKeys([first, second])).toStrictEqual([
        'queued-41',
        'queued-42',
      ]);
      expect(prepareKeys([second, first])).toStrictEqual([
        'queued-42',
        'queued-41',
      ]);
    });

    it('falls back to index-based key when promptId is an empty string', () => {
      const submission: QueuedSubmission = {
        query: textQuery('hello'),
        promptId: '',
      };
      const view = prepareQueuedMessagesPanelView({
        width: 80,
        messages: [submission],
        columns: 80,
        rows: 40,
      });

      expect(view.kind).toBe('expanded');
      expect(view.kind === 'expanded' ? view.messages[0].key : '').toBe(
        'queued-0-hello',
      );
    });

    it('uses the promptId for the key when it is a non-empty string', () => {
      const submission: QueuedSubmission = {
        query: textQuery('hello'),
        promptId: 'abc-123',
      };
      const view = prepareQueuedMessagesPanelView({
        width: 80,
        messages: [submission],
        columns: 80,
        rows: 40,
      });

      expect(view.kind).toBe('expanded');
      expect(view.kind === 'expanded' ? view.messages[0].key : '').toBe(
        'queued-abc-123-0',
      );
    });

    it('falls back to index-based key when promptId is undefined', () => {
      const view = prepareQueuedMessagesPanelView({
        width: 80,
        messages: [makeSubmission('hello')],
        columns: 80,
        rows: 40,
      });

      expect(view.kind).toBe('expanded');
      expect(view.kind === 'expanded' ? view.messages[0].key : '').toBe(
        'queued-0-hello',
      );
    });
  });
});
