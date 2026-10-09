/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  buildChronologyTrace,
  type ChronologyTraceEntry,
} from '@vybestack/llxprt-code-core/services/history/historyChronology.js';
import {
  buildProviderDumpBody,
  buildProviderDumpBodyStream,
} from './providerRequestConversion.js';
import { dumpRequestContext, dumpRequestContextStream } from './dumpContext.js';
import { streamPrettyJson } from './streamPrettyJson.js';
import { collectJournalRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dump-stream-contract-'));
const row = (index: number): IContent => ({
  speaker: index % 2 === 0 ? 'human' : 'ai',
  blocks: [{ type: 'text', text: `row-${index}: "雪"\n${'x'.repeat(1024)}` }],
  metadata: {
    chronology: { seq: index + 1, userTurn: index, step: 1, recordedAt: index },
  },
});
async function stringify(value: unknown): Promise<string> {
  let text = '';
  for await (const chunk of streamPrettyJson(value)) text += chunk;
  return text;
}
const varied: IContent[] = [
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'orphan',
        toolName: 'read_file',
        result: 'lost',
      },
    ],
  },
  {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'caption' },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'data:image/png;base64,YQ==',
      },
      {
        type: 'media',
        mimeType: 'application/pdf',
        encoding: 'url',
        data: 'https://example.com/a.pdf',
      },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'first',
        sourceField: 'thinking',
        signature: 'sig',
      },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: 'answer' },
      {
        type: 'tool_call',
        id: 'call_1',
        name: 'read_file',
        parameters: '{"path":"x"}',
      },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'interruption' }] },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call_1',
        toolName: 'read_file',
        result: { text: 'result' },
      },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'Yg==',
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'missing',
        toolName: 'read_file',
        result: '',
      },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'foreign',
        sourceField: 'thinking',
        signature: 'foreign',
      },
    ],
    metadata: { model: 'foreign' },
  },
  {
    speaker: 'ai',
    blocks: [
      { type: 'thinking', thought: 'last', sourceField: 'thinking' },
      { type: 'code', code: 'hello()', language: 'ts' },
    ],
  },
  {
    speaker: 'human',
    blocks: [{ type: 'text', text: '' }],
    metadata: {
      isSummary: true,
      chronologyReplaced: { fromSeq: 1, toSeq: 8, itemCount: 8 },
    },
  },
];

async function eagerDumpPath(
  history: HistoryService,
  providerName: string,
  count: number,
  chronology: ChronologyTraceEntry[],
): Promise<string> {
  let filePath = '';
  await collectJournalRowsForAssertions(history, async (rows) => {
    const expected = await dumpRequestContext(
      {
        url: 'immediate-context-dump',
        method: 'DUMP',
        body: buildProviderDumpBody({
          providerName,
          model: 'test-model',
          history: [...rows],
        }),
      },
      providerName,
      `eager-${providerName}-${count}`,
      chronology,
      { media: 'raw' },
    );
    filePath = path.join(expected.dumpDir, expected.requestFilename);
  });
  return filePath;
}

async function expectScale(
  providerName: string,
  count: number,
): Promise<{ actual: string; expected: string }> {
  spyOn(Storage, 'getGlobalCacheDir').mockReturnValue(root);
  const ownership = new RowOwnership();
  const counters = createRowCounters();
  const history = new HistoryService({
    attachmentCounters: { ...counters.counters, ownership },
  });
  try {
    for (let index = 0; index < count; index++) history.add(row(index));
    await history.waitForTokenUpdates();
    await history.waitForCommit();
    const snapshot = await history.openDumpSnapshot();
    try {
      const params = {
        providerName,
        model: 'test-model',
        history: snapshot,
      };
      const result = await dumpRequestContextStream(
        {
          url: 'immediate-context-dump',
          method: 'DUMP',
          body: buildProviderDumpBodyStream(params),
        },
        providerName,
        `stream-${providerName}-${count}`,
        snapshot.chronology(),
        { media: 'raw' },
      );
      expect(
        ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      expect(ownership.snapshot().liveRows).toBe(0);
      const eagerChronology: ChronologyTraceEntry[] = [];
      for await (const entry of history.getChronologyTrace())
        eagerChronology.push(entry);
      const expectedPath = await eagerDumpPath(
        history,
        providerName,
        count,
        eagerChronology,
      );
      const actualText = await fs.readFile(
        path.join(result.dumpDir, result.requestFilename),
        'utf8',
      );
      const expectedText = await fs.readFile(expectedPath, 'utf8');
      return {
        actual: actualText.replace(
          /"timestamp": "[^"]+"/,
          '"timestamp": "fixed"',
        ),
        expected: expectedText.replace(
          /"timestamp": "[^"]+"/,
          '"timestamp": "fixed"',
        ),
      };
    } finally {
      await snapshot.close();
    }
  } finally {
    history.dispose();
  }
}
async function expectVaried(
  providerName: string,
  policy: string,
): Promise<{ actual: string; expected: string }> {
  const history = new HistoryService();
  try {
    history.addAll(structuredClone(varied));
    const snapshot = await history.openDumpSnapshot();
    try {
      const settings = {
        get: (key: string): unknown =>
          key === 'reasoning.stripFromContext' ? policy : true,
      };
      const params = { providerName, model: 'test-model', settings };
      let eager: Record<string, unknown> = {};
      await collectJournalRowsForAssertions(history, (rows) => {
        eager = buildProviderDumpBody({
          ...params,
          history: [...rows],
        });
      });
      const actual = await stringify(
        buildProviderDumpBodyStream({ ...params, history: snapshot }),
      );
      const chronology = await stringify(snapshot.chronology());
      await collectJournalRowsForAssertions(history, (chronologyRows) => {
        expect(chronology).toBe(
          JSON.stringify(buildChronologyTrace([...chronologyRows]), null, 2),
        );
      });
      return { actual, expected: JSON.stringify(eager, null, 2) };
    } finally {
      await snapshot.close();
    }
  } finally {
    history.dispose();
  }
}
describe('bounded dump provider contract', () => {
  afterEach(() => {
    spyOn(Storage, 'getGlobalCacheDir').mockRestore();
  });
  for (const providerName of ['openai', 'anthropic', 'backend']) {
    for (const count of [512, 8192]) {
      it(`${providerName} writes ${count} journal rows with eager format parity`, async () => {
        const result = await expectScale(providerName, count);
        expect(result.actual).toBe(result.expected);
      }, 120000);
    }
    for (const policy of ['none', 'all', 'allButLast']) {
      it(`${providerName} preserves media, tool repair and ${policy} reasoning bytes`, async () => {
        const result = await expectVaried(providerName, policy);
        expect(result.actual).toBe(result.expected);
      });
    }
  }
  it('pins body and chronology membership across later mutation', async () => {
    const history = new HistoryService();
    try {
      history.add(row(0));
      const snapshot = await history.openDumpSnapshot();
      try {
        history.add(row(1));
        const body = await stringify(
          buildProviderDumpBodyStream({
            providerName: 'backend',
            history: snapshot,
          }),
        );
        expect(body).toContain('row-0');
        expect(body).not.toContain('row-1');
        expect(JSON.parse(await stringify(snapshot.chronology()))).toHaveLength(
          1,
        );
      } finally {
        await snapshot.close();
      }
    } finally {
      history.dispose();
    }
  });
  it('does not pull ahead of a paused writer and returns the source on abandonment', async () => {
    let pulls = 0;
    let closed = false;
    async function* source(): AsyncIterable<IContent> {
      try {
        for (let index = 0; index < 8192; index++) {
          pulls++;
          yield row(index);
        }
      } finally {
        closed = true;
      }
    }
    const body = buildProviderDumpBodyStream({
      providerName: 'backend',
      history: { rows: source },
    });
    const iterator = streamPrettyJson(body)[Symbol.asyncIterator]();
    for (let index = 0; index < 15 && pulls === 0; index++)
      await iterator.next();
    expect(pulls).toBe(1);
    await iterator.return(undefined);
    expect({ pulls, closed }).toStrictEqual({ pulls: 1, closed: true });
  });
  it('propagates source failures without swallowing them', async () => {
    async function* source(): AsyncIterable<IContent> {
      yield row(0);
      throw new Error('journal read failure');
    }
    const body = buildProviderDumpBodyStream({
      providerName: 'backend',
      history: { rows: source },
    });
    await expect(stringify(body)).rejects.toThrow('journal read failure');
  });
});
