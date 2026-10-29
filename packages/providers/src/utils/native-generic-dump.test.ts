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

const chainRows: IContent[] = [
  ...rows.slice(0, 3),
  { speaker: 'human', blocks: [{ type: 'text', text: 'gap' }] },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'signed',
        sourceField: 'thinking',
        signature: 'sig',
      },
    ],
  },
  {
    speaker: 'ai',
    metadata: { cacheAnchor: true },
    blocks: [{ type: 'text', text: '  reply 雪' }, ...rows[3].blocks],
  },
  {
    speaker: 'ai',
    blocks: [
      { type: 'code', code: 'next()', language: 'ts' },
      ...rows[4].blocks,
    ],
  },
];
async function journalDump(
  providerName: string,
  strip: string,
  contents: IContent[],
): Promise<{
  readonly actual: string;
  readonly expected: string;
  readonly creates: Awaited<ReturnType<typeof operationFileCreates>>;
}> {
  const history = new HistoryService();
  try {
    history.addAll(structuredClone(contents));
    await history.waitForCommit();
    const snapshot = await history.openDumpSnapshot();
    try {
      const policy = {
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': strip,
      };
      const expected = JSON.stringify(
        buildProviderDumpBody({
          providerName,
          model: 'test-model',
          history: contents,
          policy,
        }),
        null,
        2,
      );
      let actual = '';
      const creates = await operationFileCreates(async () => {
        actual = await stringify(
          buildProviderDumpBodyStream({
            providerName,
            model: 'test-model',
            history: snapshot,
            policy,
          }),
        );
      }, true);
      return { actual, expected, creates };
    } finally {
      await snapshot.close();
    }
  } finally {
    await history.dispose();
  }
}

describe('native generic raw dump', () => {
  it('serializes an empty journal without scratch', async () => {
    const result = await journalDump('anthropic', 'none', []);
    expect(result.creates).toStrictEqual({ files: [], directories: [] });
    expect(result.actual).toBe(result.expected);
  });
  it('refuses a raw source without an indexed or caller-owned capability before consuming it', async () => {
    const creates = await operationFileCreates(async () => {
      await expect(
        stringify(
          buildProviderDumpBodyStream({
            providerName: 'anthropic',
            history: {
              async *rows() {
                yield await Promise.reject<IContent>(
                  new Error('Unindexed source consumed'),
                );
              },
            },
          }),
        ),
      ).rejects.toThrow(
        'Anthropic dump requires caller-owned rows or a pinned raw journal source',
      );
    }, true);
    expect(creates).toStrictEqual({ files: [], directories: [] });
  });
  it('reopens the same raw journal pin after later history publication without changing tool occurrences', async () => {
    const history = new HistoryService();
    try {
      history.addAll(structuredClone(chainRows));
      const snapshot = await history.openDumpSnapshot();
      try {
        const params = {
          providerName: 'anthropic',
          model: 'test-model',
          history: snapshot,
          policy: { 'reasoning.includeInContext': true },
        };
        const expected = JSON.stringify(
          buildProviderDumpBody({ ...params, history: chainRows }),
          null,
          2,
        );
        const creates = await operationFileCreates(async () => {
          expect(await stringify(buildProviderDumpBodyStream(params))).toBe(
            expected,
          );
          expect(await stringify(buildProviderDumpBodyStream(params))).toBe(
            expected,
          );
        }, true);
        expect(creates).toStrictEqual({ files: [], directories: [] });
        history.add({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'later' }],
        });
        await history.waitForCommit();
        const after = await operationFileCreates(async () => {
          expect(await stringify(buildProviderDumpBodyStream(params))).toBe(
            expected,
          );
        }, true);
        expect(after).toStrictEqual({ files: [], directories: [] });
      } finally {
        await snapshot.close();
      }
    } finally {
      await history.dispose();
    }
  });
  for (const strip of ['none', 'all', 'allButLast']) {
    it(`anthropic caller arrays preserve ${strip} raw bytes without scratch`, async () => {
      const policy = {
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': strip,
      };
      const history: IContent[] = structuredClone(rows);
      const expected = JSON.stringify(
        buildProviderDumpBody({
          providerName: 'anthropic',
          model: 'test-model',
          history,
          policy,
        }),
        null,
        2,
      );
      let actual = '';
      const creates = await operationFileCreates(async () => {
        actual = await stringify(
          buildProviderDumpBodyStream({
            providerName: 'anthropic',
            model: 'test-model',
            history,
            policy,
          }),
        );
      }, true);
      expect(creates).toStrictEqual({ files: [], directories: [] });
      expect(actual).toBe(expected);
    });
    it(`anthropic journal chains preserve ${strip} signed reasoning, media and anchors without scratch`, async () => {
      const result = await journalDump('anthropic', strip, chainRows);
      expect(result.creates).toStrictEqual({ files: [], directories: [] });
      expect(result.actual).toBe(result.expected);
    });
    for (const providerName of ['openai', 'anthropic']) {
      it(`${providerName} keeps ${strip} reasoning, raw media and tool bytes without scratch`, async () => {
        const result = await journalDump(providerName, strip, rows);
        expect(result.creates).toStrictEqual({ files: [], directories: [] });
        expect(result.actual).toBe(result.expected);
      });
    }
  }
});
