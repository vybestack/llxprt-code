/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type {
  ContentBlock,
  DiscoveredMCPResource,
} from '@vybestack/llxprt-code-core';
import { processResourceAttachments } from './atCommandResourceHelpers.js';
import { ToolCallStatus } from '../types.js';

const resources: DiscoveredMCPResource[] = [
  { serverName: 'docs', uri: 'file:///first', name: 'first', discoveredAt: 1 },
  {
    serverName: 'docs',
    uri: 'file:///second',
    name: 'second',
    discoveredAt: 1,
  },
];

describe('MCP resource attachments', () => {
  it('preserves mention order and maps text and binary responses into prompt blocks', async () => {
    const parts: ContentBlock[] = [];
    const result = await processResourceAttachments({
      resourceAttachments: resources,
      processedQueryParts: parts,
      readResource: async (server, uri) => {
        if (server !== 'docs') throw new Error('Wrong MCP scope');
        return uri === resources[0].uri
          ? { contents: [{ text: 'first document' }] }
          : { contents: [{ blob: 'YWJj', mimeType: 'application/pdf' }] };
      },
      addItem: () => {
        throw new Error('Successful reads should not publish errors');
      },
      userMessageTimestamp: 1,
    });
    expect(parts).toStrictEqual([
      { type: 'text', text: '\nContent from @docs:file:///first:\n' },
      { type: 'text', text: 'first document' },
      { type: 'text', text: '\nContent from @docs:file:///second:\n' },
      {
        type: 'text',
        text: '[Binary resource content application/pdf, 3 bytes]',
      },
    ]);
    expect(
      Array.isArray(result) && result.map((item) => item.status),
    ).toStrictEqual([ToolCallStatus.Success, ToolCallStatus.Success]);
  });

  it.each([
    [
      'unavailable',
      async (): Promise<unknown> => {
        throw new Error('transport unavailable');
      },
    ],
    ['malformed', async (): Promise<unknown> => ({ contents: 'invalid' })],
    ['empty', async (): Promise<unknown> => ({ contents: [] })],
  ])(
    'stops on the first %s resource without submitting partial context',
    async (_name, read) => {
      const parts: ContentBlock[] = [];
      const visited: string[] = [];
      const result = await processResourceAttachments({
        resourceAttachments: resources,
        processedQueryParts: parts,
        readResource: async (_server, uri) => {
          visited.push(uri);
          return read();
        },
        addItem: () => 1,
        userMessageTimestamp: 1,
      });
      expect(visited).toStrictEqual([resources[0].uri]);
      expect(parts).toStrictEqual([]);
      expect(result).toMatchObject({
        processedQuery: null,
        error: expect.stringContaining('Error reading resource file:///first'),
      });
    },
  );
});
