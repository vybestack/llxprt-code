/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { journalSendFixture } from '../__tests__/support/journal-send-fixture.js';
import { rowsSelection } from '../__tests__/support/wireBodyCapture.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import {
  buildNormalizedOptions,
  captureResponsesTestRequest,
  type ResponsesTestDeps,
} from './responses-request.test-helpers.js';
import { buildDiskTextResponsesContext } from './responses-disk-text-projection.js';
import { NativeResponsesPrompt } from './native-responses-body.js';

const deps: ResponsesTestDeps = {
  providerName: 'openai-responses',
  logger: new DebugLogger('native-diagnostic-test'),
  requestBaseURL: 'https://example.test/v1',
  requestHeaders: undefined,
  defaultModel: 'gpt-5.6',
  isCodexMode: () => false,
  getCodexAccountId: async () => '',
  resolveAuthTokenForPrompt: async () => 'test',
  shouldRetryOnError: () => false,
  getUnallowedModelParameters: () => new Set(),
};
const rows: readonly IContent[] = [
  {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'look' },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'AQI=',
      },
    ],
  },
];

async function prepare(
  selection: ProviderRequestSelection,
): ReturnType<typeof buildDiskTextResponsesContext> {
  const request = captureResponsesTestRequest(
    buildNormalizedOptions({
      contents: [],
      requestRows: selection,
      contentCount: selection.count,
      invocation: createRuntimeInvocationContext({
        fetch: (input, init) => globalThis.fetch(input, init),
        runtimeId: 'native-dump',
        providerName: 'openai-responses',
        ephemeralsSnapshot: { 'responses-stateful': false },
      }),
      resolved: {
        model: 'gpt-5.6',
        baseURL: deps.requestBaseURL,
        authToken: 'test',
      },
    }),
    deps,
  );
  return buildDiskTextResponsesContext(request, deps);
}

async function dump(selection: ProviderRequestSelection): Promise<Buffer> {
  const prepared = await prepare(selection);
  const source = prepared.sourcePrompt;
  try {
    const chunks: Uint8Array[] = [];
    const bytes = source.body(prepared.request, 'dump');
    for await (const chunk of bytes) chunks.push(chunk);
    return Buffer.concat(chunks);
  } finally {
    await prepared.mediaRequest.release();
  }
}

describe('native Responses diagnostic projection', () => {
  it('summarizes media exactly as the existing diagnostic writer does without a body copy', async () => {
    const expected = await dump(rowsSelection(rows));
    const fixture = await journalSendFixture(rows, [], {
      directory: 'tmp/responses-native/fixtures',
    });
    try {
      let actual: Buffer | undefined;
      const created = await operationFileCreates(async () => {
        actual = await dump(fixture.selection);
      }, true);
      expect(actual).toStrictEqual(expected);
      expect(actual?.toString()).not.toContain('AQI=');
      expect(created).toStrictEqual({ files: [], directories: [] });
    } finally {
      await fixture.close();
    }
  });
});

async function collect(bytes: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of bytes) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe('native Responses frame diagnostics', () => {
  it('preserves the native WebSocket frame bytes and leaves its extra type out of request dumps', async () => {
    const fixture = await journalSendFixture(rows, [], {
      directory: 'tmp/dump-native/fixtures',
    });
    const prepared = await prepare(fixture.selection);
    try {
      const source = prepared.sourcePrompt;
      if (!(source instanceof NativeResponsesPrompt))
        throw new Error('Expected native prompt');
      const request = { ...prepared.request, type: 'caller-type' };
      const expected = await collect(
        source.body({ ...request, type: 'response.create' }),
      );
      expect(await collect(source.frame(request))).toStrictEqual(expected);
      expect((await collect(source.dump.bytes())).toString()).not.toContain(
        'response.create',
      );
    } finally {
      await prepared.mediaRequest.release();
      await fixture.close();
    }
  });
});
