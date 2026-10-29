/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import type { ToolFormat } from '@vybestack/llxprt-code-tools/IToolFormatter.js';
import {
  createCorpus,
  type Corpus,
} from '../__tests__/support/wireBodyCorpus.js';
import { observeNativeBodies } from '../__tests__/support/native-body-lifecycle.js';
import type { ChatBodyOptions } from './OpenAIChatBodyBuilder.js';
import { prepareNativePlainRequest } from './native-chat-body.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { rowsSelection } from '../__tests__/support/wireBodyCapture.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import {
  buildContinuationMessages,
  buildMessagesWithReasoning,
  type ContinuationToolCall,
} from './OpenAIRequestBuilder.js';
import {
  CHAT_ROUTES,
  captureContinuation,
} from '../__tests__/support/chatSendCapture.js';
import { seededHistory } from './__tests__/support/chatBodyCorpus.js';

type StripPolicy = 'none' | 'all' | 'allButLast';

interface Settings {
  readonly toolFormat: ToolFormat | undefined;
  readonly strip: StripPolicy;
  readonly include: boolean;
}

const liveBodies = observeNativeBodies();

const FORMATS: ReadonlyArray<ToolFormat | undefined> = [
  undefined,
  'openai',
  'kimi',
  'mistral',
];
const POLICIES: readonly StripPolicy[] = ['none', 'all', 'allButLast'];
const SYSTEM = 'You are a careful assistant.';
const ENVELOPE = {
  model: 'golden-model',
  messages: [],
  stream: true,
  tools: [{ type: 'function', function: { name: 'read_file' } }],
  tool_choice: 'auto',
  stream_options: { include_usage: true },
};
const TOOL_CALLS: ContinuationToolCall[] = [
  {
    id: 'call_continuation',
    type: 'function',
    function: { name: 'get_weather', arguments: '{"city":"SF"}' },
  },
  {
    id: 'call_second',
    type: 'function',
    function: { name: 'read_file', arguments: '{"path":"/a"}' },
  },
];

function allSettings(): Settings[] {
  return FORMATS.flatMap((toolFormat) =>
    POLICIES.flatMap((strip) =>
      [true, false].map((include) => ({ toolFormat, strip, include })),
    ),
  );
}

function reasoningOf(settings: Settings): ChatBodyOptions['reasoning'] {
  return {
    invocation: {
      ephemerals: {
        'reasoning.stripFromContext': settings.strip,
        'reasoning.includeInContext': settings.include,
      },
    },
  };
}

async function prepareContinuation(
  rows: readonly IContent[],
  settings: Settings,
  requestRows?: ProviderRequestSelection,
): ReturnType<typeof prepareNativePlainRequest> {
  const selection =
    requestRows ??
    rowsSelection(
      rows.map((row) => ({
        ...row,
        blocks: Array.isArray(row.blocks) ? row.blocks : [],
      })),
    );
  const options: NormalizedGenerateChatOptions = {
    contents: [],
    requestRows: selection,
    contentCount: rows.length,
    metadata: {},
    invocation: createRuntimeInvocationContext({
      fetch: (input, init) => globalThis.fetch(input, init),
      runtimeId: 'continuation-test',
      providerName: 'openai',
      ephemeralsSnapshot: {
        'reasoning.stripFromContext': settings.strip,
        'reasoning.includeInContext': settings.include,
      },
    }),
    resolved: { model: 'golden-model', authToken: 'test-token' },
    systemInstruction: SYSTEM,
  };
  return prepareNativePlainRequest(
    ENVELOPE,
    selection,
    options,
    { estimate: false, dump: false },
    {},
    settings.toolFormat,
  );
}

/** The array route's continuation request: the bytes before D4. */
function oracleBytes(rows: readonly IContent[], settings: Settings): Buffer {
  const messages = buildMessagesWithReasoning(
    structuredClone([...rows]),
    reasoningOf(settings),
    settings.toolFormat,
    undefined,
  );
  const withSystem = [{ role: 'system', content: SYSTEM }, ...messages];
  const continued = buildContinuationMessages(
    TOOL_CALLS,
    withSystem as never,
    settings.toolFormat,
  );
  return Buffer.from(
    JSON.stringify({ ...ENVELOPE, messages: continued, stream: true }),
    'utf8',
  );
}

async function continuationBytes(
  rows: readonly IContent[],
  settings: Settings,
): Promise<Buffer> {
  const request = await prepareContinuation(rows, settings);
  try {
    const body = await request.continuation.build(TOOL_CALLS);
    try {
      const handle = body.spool.openStream();
      try {
        return Buffer.from(await new Response(handle.stream).arrayBuffer());
      } finally {
        await handle.dispose();
      }
    } finally {
      await body.release();
    }
  } finally {
    await request.release();
  }
}

function firstDifference(
  label: string,
  actual: Buffer,
  expected: Buffer,
): string | undefined {
  if (actual.equals(expected)) return undefined;
  let offset = 0;
  while (offset < actual.length && actual[offset] === expected[offset])
    offset++;
  const excerpt = (bytes: Buffer): string =>
    bytes.subarray(Math.max(0, offset - 40), offset + 80).toString('latin1');
  return `${label}: first difference at byte ${offset} (continuation ${actual.length} bytes, array ${expected.length} bytes)\ncontinuation: ${excerpt(actual)}\narray:        ${excerpt(expected)}`;
}

function scratchNames(): Set<string> {
  return new Set(readdirSync(getScratchRoot()));
}

describe('native chat continuation request', () => {
  it('equals the array continuation for every setting over seeded histories', async () => {
    const differences: string[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const rows = seededHistory(seed);
      for (const settings of allSettings()) {
        const difference = firstDifference(
          `seed ${seed} ${JSON.stringify(settings)}`,
          await continuationBytes(rows, settings),
          oracleBytes(rows, settings),
        );
        if (difference !== undefined) differences.push(difference);
      }
    }
    expect(differences).toStrictEqual([]);
  }, 180_000);

  it('leaves out reasoning even where the first request carried it', async () => {
    const rows: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'think' }] },
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'secret plan', sourceField: 'thinking' },
          { type: 'text', text: 'answer' },
        ],
      },
    ];
    const settings: Settings = {
      toolFormat: undefined,
      strip: 'none',
      include: true,
    };
    const first = buildMessagesWithReasoning(
      structuredClone(rows),
      reasoningOf(settings),
      settings.toolFormat,
      undefined,
    );
    expect(JSON.stringify(first)).toContain('secret plan');
    const text = (await continuationBytes(rows, settings)).toString('utf8');
    expect(text).not.toContain('reasoning_content');
    expect(text).not.toContain('secret plan');
    expect(text).toContain('answer');
  });

  it('carries the ids of the first request on the Kimi and Mistral formats', async () => {
    const rows: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'go' }] },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_call_1',
            name: 'read_file',
            parameters: { path: '/x' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_call_1',
            toolName: 'read_file',
            result: 'contents',
          },
        ],
      },
    ];
    for (const toolFormat of ['kimi', 'mistral'] as const) {
      const settings: Settings = { toolFormat, strip: 'none', include: false };
      const actual = await continuationBytes(rows, settings);
      expect(
        firstDifference(toolFormat, actual, oracleBytes(rows, settings)),
      ).toBeUndefined();
      const body = JSON.parse(actual.toString('utf8')) as {
        messages: Array<{ tool_calls?: Array<{ id: string }> }>;
      };
      const mappedId = body.messages.find(
        (message) =>
          message.tool_calls?.some(
            (call) => call.id !== 'call_continuation',
          ) === true,
      )?.tool_calls?.[0]?.id;
      expect(mappedId).toBeDefined();
      expect(mappedId).not.toBe('hist_call_1');
    }
  });

  it('keeps the member order of the first request and sets stream', async () => {
    const settings: Settings = {
      toolFormat: 'openai',
      strip: 'none',
      include: false,
    };
    const body = JSON.parse(
      (await continuationBytes([], settings)).toString('utf8'),
    ) as Record<string, unknown>;
    expect(Object.keys(body)).toStrictEqual(Object.keys(ENVELOPE));
    expect(body['stream']).toBe(true);
  });

  it('releases its native body and mapping when the rows fail', async () => {
    const before = scratchNames();
    const spools = liveBodies();
    await continuationBytes(seededHistory(3), {
      toolFormat: 'kimi',
      strip: 'none',
      include: true,
    });
    expect(scratchNames()).toStrictEqual(before);
    expect(liveBodies()).toBe(spools);

    let fail = false;
    const source = rowsSelection(
      seededHistory(3).map((row) => ({
        ...row,
        blocks: Array.isArray(row.blocks) ? row.blocks : [],
      })),
    );
    const selected: ProviderRequestSelection = {
      ...source,
      readAt(index, signal) {
        if (fail) throw new Error('rows are gone');
        return source.readAt(index, signal);
      },
      async *openReader(signal) {
        if (fail) throw new Error('rows are gone');
        yield* source.openReader(signal);
      },
    };
    const request = await prepareContinuation(
      seededHistory(3),
      {
        toolFormat: 'kimi',
        strip: 'none',
        include: false,
      },
      selected,
    );
    fail = true;
    try {
      const consume = async (): Promise<void> => {
        const body = await request.continuation.build(TOOL_CALLS);
        try {
          const handle = body.spool.openStream();
          try {
            await new Response(handle.stream).arrayBuffer();
          } finally {
            await handle.dispose();
          }
        } finally {
          await body.release();
        }
      };
      await expect(consume()).rejects.toThrow('rows are gone');
    } finally {
      await request.release();
    }
    expect(scratchNames()).toStrictEqual(before);
    expect(liveBodies()).toBe(spools);
    expect(() => request.spool.openStream()).toThrow('disposed');
    await expect(request.continuation.build(TOOL_CALLS)).rejects.toThrow(
      'released',
    );
  });

  describe('golden corpus histories', () => {
    let corpus: Corpus;
    beforeAll(async () => {
      corpus = await createCorpus();
    });
    afterAll(async () => {
      await corpus.dispose();
    });

    it('is sent through the provider and every native body is released afterwards', async () => {
      const history = corpus.histories.find(
        (candidate) => candidate.id === 'tool-calls-with-results',
      );
      expect(history).toBeDefined();
      for (const route of CHAT_ROUTES) {
        for (const source of ['stream', 'rows'] as const) {
          const before = scratchNames();
          const spools = liveBodies();
          const sent = await captureContinuation(
            route,
            history!,
            source,
            corpus.binding,
          );
          expect(sent.continuation.contentLength).toBe('present');
          expect(sent.continuation.length).toBeGreaterThan(sent.first.length);
          expect(scratchNames()).toStrictEqual(before);
          expect(liveBodies()).toBe(spools);
        }
      }
    });

    it('match the array continuation for histories without stored media', async () => {
      const differences: string[] = [];
      for (const history of corpus.histories) {
        if (history.usesMediaReferences === true) continue;
        for (const settings of allSettings()) {
          const difference = firstDifference(
            `${history.id} ${JSON.stringify(settings)}`,
            await continuationBytes(history.rows, settings),
            oracleBytes(history.rows, settings),
          );
          if (difference !== undefined) differences.push(difference);
        }
      }
      expect(differences).toStrictEqual([]);
    }, 180_000);
  });
});
