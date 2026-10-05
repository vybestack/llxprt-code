/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export function createOpenAIDumpHistory(): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'Hello' },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'abc123',
        },
      ],
    },
    {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'Hi' },
        {
          type: 'tool_call',
          id: 'call_1',
          name: 'read_file',
          parameters: { path: 'README.md' },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call_1',
          toolName: 'read_file',
          result: 'contents',
        },
      ],
    },
  ];
}

export function createAnthropicDumpHistory(): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'Question' },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'abc123',
        },
      ],
    },
    {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'Answer' },
        {
          type: 'tool_call',
          id: 'toolu_1',
          name: 'search',
          parameters: { q: 'docs' },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'toolu_1',
          toolName: 'search',
          result: 'found',
        },
      ],
    },
  ];
}
