/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for the Gemini-owned context-dump conversion (#2763).
 *
 * The /dumpcontext wire shaping for Gemini history lives in this plugin: the
 * CLI command delegates to the active provider's `buildContextDumpBody` and
 * writes the returned body verbatim. These tests own the shape contract that
 * used to sit in the CLI suite against the pre-move base implementation.
 */

import { describe, it, expect } from 'bun:test';
import { buildGeminiDumpContents } from '../gemini/geminiDumpConversion.js';
import { GeminiProvider } from '../gemini/GeminiProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

describe('buildGeminiDumpContents', () => {
  it('shapes human, model, and tool turns into Gemini wire contents', () => {
    const history: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Ping' },
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
          { type: 'text', text: 'Pong' },
          {
            type: 'tool_call',
            id: 'call_1',
            name: 'lookup',
            parameters: { id: 7 },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_1',
            toolName: 'lookup',
            result: { ok: true },
          },
        ],
      },
    ];

    expect(buildGeminiDumpContents(history)).toStrictEqual([
      {
        role: 'user',
        parts: [
          { text: 'Ping' },
          { inlineData: { mimeType: 'image/png', data: 'abc123' } },
        ],
      },
      {
        role: 'model',
        parts: [
          { text: 'Pong' },
          {
            functionCall: { id: 'call_1', name: 'lookup', args: { id: 7 } },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'call_1',
              name: 'lookup',
              response: expect.objectContaining({ result: '{"ok":true}' }),
            },
          },
        ],
      },
    ]);
  });

  it('truncates an oversized tool response and keeps following media parts', () => {
    const longResult = Array.from({ length: 200 }, (_, i) => `line-${i}`).join(
      '\n',
    );
    const history: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_1',
            toolName: 'search',
            result: longResult,
          },
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'base64',
            data: 'image-data',
          },
        ],
      },
    ];
    const config = {
      getEphemeralSettings: () => ({
        'tool-output-max-tokens': 5,
        'tool-output-truncate-mode': 'warn',
      }),
    };

    const contents = buildGeminiDumpContents(
      history,
      // Gemini-3 models carry follow-up media inside functionResponse.parts;
      // older models put them in sibling parts.
      'gemini-3-pro',
      config,
    ) as Array<{ parts: Array<Record<string, unknown>> }>;

    const functionResponse = contents[0].parts[0].functionResponse as Record<
      string,
      unknown
    >;
    expect(functionResponse.response).toMatchObject({
      status: 'success',
      truncated: true,
      limitMessage: expect.stringContaining(
        'search output exceeded token limit',
      ),
    });
    expect(functionResponse.parts).toStrictEqual([
      { inlineData: { mimeType: 'image/png', data: 'image-data' } },
    ]);
  });
});

describe('GeminiProvider.buildContextDumpBody', () => {
  it('wraps the converted contents with the active model', () => {
    const provider = new GeminiProvider();
    const history: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Ping' }] },
    ];

    const body = provider.buildContextDumpBody(history, 'gemini-2.5-pro') as {
      model?: string;
      contents?: unknown[];
    };

    expect(body.model).toBe('gemini-2.5-pro');
    expect(body.contents).toStrictEqual([
      { role: 'user', parts: [{ text: 'Ping' }] },
    ]);
  });

  it('omits the model field when no model is active', () => {
    const provider = new GeminiProvider();
    const history: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Ping' }] },
    ];

    const body = provider.buildContextDumpBody(history) as Record<
      string,
      unknown
    >;

    expect('model' in body).toBe(false);
    expect(body.contents).toStrictEqual([
      { role: 'user', parts: [{ text: 'Ping' }] },
    ]);
  });
});
