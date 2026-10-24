/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { buildProviderDumpBodyStream } from './providerRequestConversion.js';
import { buildProviderDumpBody } from './__tests__/support/arrayDumpBody.js';
import { streamPrettyJson } from './streamPrettyJson.js';

const rows: IContent[] = [
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'orphan',
        toolName: 'read',
        result: 'lost',
      },
    ],
  },
  {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'Describe 雪' },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'YQ==',
      },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      { type: 'thinking', thought: 'first', sourceField: 'reasoning_content' },
      { type: 'tool_call', id: 'call_a', name: 'read', parameters: {} },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call_a',
        toolName: 'read',
        result: 'one',
      },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'Yg==',
      },
      {
        type: 'media',
        mimeType: 'application/pdf',
        encoding: 'base64',
        data: 'JVBERi0=',
      },
      {
        type: 'media',
        mimeType: 'audio/wav',
        encoding: 'base64',
        data: 'AAAA',
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call_a',
        toolName: 'read',
        result: 'two',
      },
      {
        type: 'media',
        mimeType: 'video/mp4',
        encoding: 'url',
        data: 'https://example.com/video.mp4',
      },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      { type: 'thinking', thought: 'last', sourceField: 'reasoning_content' },
      { type: 'text', text: 'answer' },
    ],
  },
];
async function stringify(value: unknown): Promise<string> {
  let result = '';
  for await (const chunk of streamPrettyJson(value)) result += chunk;
  return result;
}

describe('native generic raw dump', () => {
  for (const strip of ['none', 'all', 'allButLast']) {
    it(`openai keeps ${strip} reasoning, raw media and tool bytes without scratch`, async () => {
      const history = new HistoryService();
      try {
        history.addAll(structuredClone(rows));
        await history.waitForCommit();
        const snapshot = await history.openDumpSnapshot();
        try {
          const policy = {
            'reasoning.includeInContext': true,
            'reasoning.stripFromContext': strip,
          };
          const expected = JSON.stringify(
            buildProviderDumpBody({
              providerName: 'openai',
              model: 'test-model',
              history: rows,
              policy,
            }),
            null,
            2,
          );
          let actual = '';
          const creates = await operationFileCreates(async () => {
            actual = await stringify(
              buildProviderDumpBodyStream({
                providerName: 'openai',
                model: 'test-model',
                history: snapshot,
                policy,
              }),
            );
          }, true);
          expect(creates).toStrictEqual({ files: [], directories: [] });
          expect(actual).toBe(expected);
        } finally {
          await snapshot.close();
        }
      } finally {
        await history.dispose();
      }
    });
  }
});
