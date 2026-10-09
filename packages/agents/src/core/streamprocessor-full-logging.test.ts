/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/disk-text-fixture.js';

const factsSchema = z.object({
  mode: z.string(),
  source: z.boolean(),
  large: z.boolean(),
  output: z.string(),
  error: z.string().optional(),
  trace: z.array(
    z.object({
      category: z.string(),
      chars: z.number().optional(),
      sha256: z.string().optional(),
      error: z.string().optional(),
    }),
  ),
  bodies: z.array(z.object({ bytes: z.number(), sha256: z.string() })),
  expectedBody: z.object({ bytes: z.number(), sha256: z.string() }).optional(),
  estimate: z.unknown(),
  oracle: z.unknown(),
  owners: z.array(z.object({ closed: z.boolean(), count: z.number() })),
  activeBodies: z.number(),
  liveOriginalRows: z.number(),
  liveReadRows: z.number(),
  events: z.array(z.record(z.unknown())),
  chunkRecords: z.number(),
  requestTextSha256: z.string().optional(),
  requestRows: z.array(z.unknown()).optional(),
  hooks: z.array(z.unknown()),
  directory: z.array(z.string()),
  shapeMeasurements: z.number().optional(),
});
type Facts = z.infer<typeof factsSchema>;
function wireOracle(facts: Facts): { bytes: number; sha256: string } {
  if (facts.expectedBody === undefined)
    throw new Error('Missing independent HTTP oracle');
  return facts.expectedBody;
}
async function worker(
  mode: string,
  source = true,
  large = false,
  entry: 'stream' | 'chat' = 'stream',
): Promise<Facts> {
  const evidence = process.env.ISSUE854_LOGGING_EVIDENCE;
  if (evidence === undefined)
    throw new Error(
      'ISSUE854_LOGGING_EVIDENCE must name a disposable evidence directory',
    );
  const root = join(
    evidence,
    `worker-${entry}-${mode}-${source}-${large}-${process.pid}`,
  );
  mkdirSync(root, { recursive: true });
  const runtime = join(root, 'runtime');
  mkdirSync(runtime, { recursive: true });
  const fd = openSync(join(root, 'worker.log'), 'w');
  const child = Bun.spawn(
    [
      'bun',
      'packages/agents/src/core/streamprocessor-logging-worker.ts',
      root,
      mode,
      source ? 'source' : 'eager',
      large ? 'large' : 'small',
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TMPDIR: runtime,
        ISSUE854_LOGGING_ENTRY: entry,
        LLXPRT_CONFIG_HOME: join(root, 'config'),
        LLXPRT_DATA_HOME: join(root, 'data'),
        LLXPRT_CACHE_HOME: join(root, 'cache'),
        LLXPRT_LOG_HOME: join(root, 'logs'),
        LLXPRT_DEBUG:
          'llxprt:gemini:stream-processor,llxprt:provider:openai-responses:logging',
        DEBUG_OUTPUT: 'file',
      },
      stdin: 'ignore',
      stdout: fd,
      stderr: fd,
    },
  );
  const exit = await child.exited;
  closeSync(fd);
  if (exit !== 0)
    throw new Error(
      `Logging worker exit ${exit}: ${readFileSync(join(root, 'worker.log'), 'utf8')}`,
    );
  return factsSchema.parse(
    JSON.parse(readFileSync(join(root, 'result.json'), 'utf8')),
  );
}
function assertOwners(facts: Facts): void {
  expect(facts.owners.every((owner) => owner.closed)).toBe(true);
  expect(facts.activeBodies).toBe(0);
}
function apiRequests(facts: Facts): Array<Record<string, unknown>> {
  return facts.events.filter(
    (event) => event['event.name'] === 'llxprt_code.api_request',
  );
}
function assertPair(facts: Facts, attempts = 1): void {
  const requests = apiRequests(facts);
  expect(requests).toHaveLength(attempts * 2);
  for (let index = 0; index < requests.length; index += 2) {
    expect(typeof requests[index].request_text).toBe('string');
    expect(requests[index + 1].schema_version).toBe(2);
    expect(requests[index].prompt_id).toBe('real-logging');
    expect(requests[index + 1].prompt_id).toBe('real-logging');
    expect(requests[index + 1].row_count).toBe(facts.mode === 'hook' ? 1 : 65);
  }
  expect(facts.chunkRecords).toBeGreaterThan(0);
  const exportedHashes = requests
    .filter((_event, index) => index % 2 === 0)
    .map((event) => {
      if (typeof event.request_text !== 'string')
        throw new Error('Missing legacy request text');
      return createHash('sha256').update(event.request_text).digest('hex');
    });
  expect(
    facts.trace
      .filter((event) => event.category === 'agent.api_request')
      .map((event) => event.sha256),
  ).toStrictEqual(exportedHashes);
}

function assertEventOrder(facts: Facts): void {
  const request = [
    'llxprt_code.api_request',
    'conversation_request',
    'conversation_request_complete',
    'llxprt_code.api_request',
    'llxprt_code.api_request_complete',
  ];
  const failed = [
    ...request,
    'conversation_response',
    'llxprt_code.api_error',
    'llxprt_code.api_error',
  ];
  const success = [
    ...request,
    'token_usage',
    'llxprt_code.api_response',
    'conversation_response',
    'llxprt_code.api_response',
  ];
  let expected = success;
  if (['error', 'abort'].includes(facts.mode)) expected = failed;
  if (facts.mode === 'retry') expected = [...failed, ...success];
  if (facts.mode === 'hook') expected = ['llxprt_code.hook_call', ...success];
  expect(facts.events.map((event) => event['event.name'])).toStrictEqual(
    expected,
  );
}
function assertEagerFailure(facts: Facts): void {
  expect(facts.error).toBeDefined();
  expect(facts.estimate).toBeNull();
  expect(facts.trace[facts.trace.length - 1]?.category).toBe('agent.api_error');
}
function assertResponseTokens(facts: Facts): void {
  const responses = facts.events.filter(
    (event) => event['event.name'] === 'llxprt_code.api_response',
  );
  expect(responses).toHaveLength(2);
  for (const event of responses)
    expect(event).toMatchObject({
      input_token_count: 123,
      output_token_count: 1,
      total_token_count: 124,
    });
}
function assertEagerSuccess(facts: Facts): void {
  expect(facts.error).toBeUndefined();
  expect(facts.estimate).toStrictEqual(facts.oracle);
  expect(facts.output).toBe('finished');
  assertResponseTokens(facts);
}
function assertOriginalRows(facts: Facts, attempts: number): void {
  expect(facts.bodies).toStrictEqual(
    Array.from({ length: attempts }, () => wireOracle(facts)),
  );
  expect(facts.requestRows).toHaveLength(65);
  for (let index = 0; index < 64; index++)
    expect(facts.requestRows?.[index]).toMatchObject(diskTextRow(index, false));
}
function assertReplacement(facts: Facts): void {
  expect(facts.requestRows).toStrictEqual([
    { blocks: [{ text: 'new context', type: 'text' }], speaker: 'human' },
  ]);
}

describe('genuine StreamProcessor source fail-fast logging', () => {
  it.each([
    'enabled',
    'conversation',
    'shape',
    'retry',
    'hook',
    'error',
    'abort',
  ])(
    'fails fast for unsupported enabled source logging mode %s before reading history or HTTP',
    async (mode) => {
      const facts = await worker(mode);
      expect(facts.error).toContain(
        mode === 'shape'
          ? 'source token-usage shape logging'
          : 'source request logging',
      );
      expect(facts.bodies).toHaveLength(0);
      expect(facts.owners).toHaveLength(0);
      expect(facts.estimate).toBeNull();
      expect(facts.trace.map((event) => event.category)).toStrictEqual([
        'agent.api_error',
      ]);
      expect(apiRequests(facts)).toHaveLength(0);
      expect(
        facts.events.some(
          (event) => event['event.name'] === 'llxprt_code.api_error',
        ),
      ).toBe(true);
      expect(facts.hooks).toHaveLength(0);
      assertOwners(facts);
    },
    60000,
  );
});

describe('genuine source disabled logging', () => {
  it.each([false, true])(
    'keeps real source disabled-log HTTP bytes and native complete estimate, oversized=%s',
    async (large) => {
      const facts = await worker('disabled', true, large);
      expect(facts.error).toBeUndefined();
      expect(facts.output).toBe('finished');
      assertResponseTokens(facts);
      expect(facts.bodies).toStrictEqual([wireOracle(facts)]);
      expect(facts.estimate).toStrictEqual(facts.oracle);
      expect(apiRequests(facts)).toHaveLength(2);
      expect(
        apiRequests(facts).every(
          (event) =>
            event.request_text === undefined && event.artifact_id === undefined,
        ),
      ).toBe(true);
      expect(facts.chunkRecords).toBe(0);
      expect(facts.liveOriginalRows).toBe(0);
      expect(facts.liveReadRows).toBe(0);
      expect(
        facts.directory.some(
          (name) =>
            name.startsWith('request-') || name.startsWith('conversation-'),
        ),
      ).toBe(false);
      expect(facts.bodies[0].bytes).toBeGreaterThan(
        large ? 10 * 1024 * 1024 : 0,
      );
      assertOwners(facts);
    },
    600000,
  );
});

describe('genuine eager paired logging counterparts', () => {
  it.each(['enabled', 'retry', 'hook', 'error', 'abort'])(
    'measures the genuine enabled eager counterpart %s with paired legacy order',
    async (mode) => {
      const facts = await worker(mode, false);
      const attempts = mode === 'retry' ? 2 : 1;
      assertPair(facts, attempts);
      assertEventOrder(facts);
      expect(facts.bodies).toHaveLength(attempts);
      if (mode === 'hook') assertReplacement(facts);
      else assertOriginalRows(facts, attempts);
      if (['error', 'abort'].includes(mode)) assertEagerFailure(facts);
      else assertEagerSuccess(facts);
      assertOwners(facts);
    },
    60000,
  );
});

describe('actual ChatSession enabled-source fallback', () => {
  it.each([
    'enabled',
    'conversation',
    'shape',
    'retry',
    'hook',
    'error',
    'abort',
  ])(
    'preserves fail-fast diagnostics before localhost HTTP for %s',
    async (mode) => {
      const facts = await worker(mode, true, false, 'chat');
      expect(facts.error).toContain(
        mode === 'shape'
          ? 'source token-usage shape logging'
          : 'source request logging',
      );
      expect(facts.bodies).toHaveLength(0);
      expect(apiRequests(facts)).toHaveLength(0);
      expect(facts.owners).toHaveLength(0);
      expect(facts.hooks).toHaveLength(0);
      expect(facts.estimate).toBeNull();
      assertOwners(facts);
    },
    60000,
  );
});

describe('actual ChatSession disabled-source localhost', () => {
  it.each([false, true])(
    'preserves HTTP digest and native estimate with logging off, large=%s',
    async (large) => {
      const facts = await worker('disabled', true, large, 'chat');
      expect(facts.error).toBeUndefined();
      expect(facts.output).toBe('finished');
      expect(facts.bodies).toStrictEqual([wireOracle(facts)]);
      expect(facts.estimate).toStrictEqual(facts.oracle);
      expect(facts.chunkRecords).toBe(0);
      expect(facts.liveOriginalRows).toBe(0);
      expect(facts.liveReadRows).toBe(0);
      expect(
        apiRequests(facts).every(
          (event) =>
            event.request_text === undefined && event.artifact_id === undefined,
        ),
      ).toBe(true);
      assertResponseTokens(facts);
      assertOwners(facts);
    },
    600000,
  );
});

describe('actual ChatSession legacy eager localhost controls', () => {
  it.each(['enabled', 'retry', 'hook', 'error', 'abort'])(
    'preserves paired scalar order, tokens and HTTP for %s',
    async (mode) => {
      const facts = await worker(mode, false, false, 'chat');
      const attempts = mode === 'retry' ? 2 : 1;
      expect(facts.bodies).toHaveLength(attempts);
      assertPair(facts, attempts);
      assertEventOrder(facts);
      if (mode === 'hook') assertReplacement(facts);
      else assertOriginalRows(facts, attempts);
      if (['error', 'abort'].includes(mode)) assertEagerFailure(facts);
      else assertEagerSuccess(facts);
      assertOwners(facts);
    },
    60000,
  );
});

if (process.env.ISSUE854_LOGGING_FULL === '1') {
  describe('required full-context source acceptance remains RED', () => {
    it.each([false, true])(
      'supports actual logging-on history without dropping legacy entries, oversized=%s',
      async (large) => {
        const facts = await worker('enabled', true, large);
        expect(facts.error).toBeUndefined();
        expect(facts.bodies).toStrictEqual([wireOracle(facts)]);
        expect(facts.estimate).toStrictEqual(facts.oracle);
        assertPair(facts);
        assertOwners(facts);
      },
      600000,
    );
  });
  describe('required ChatSession full-context source acceptance', () => {
    it.each([false, true])(
      'supports actual ChatSession logging-on source without losing legacy entries, oversized=%s',
      async (large) => {
        const facts = await worker('enabled', true, large, 'chat');
        expect(facts.error).toBeUndefined();
        expect(facts.bodies).toStrictEqual([wireOracle(facts)]);
        expect(facts.estimate).toStrictEqual(facts.oracle);
        assertPair(facts);
        assertOwners(facts);
      },
      600000,
    );
  });
}

function assertSourceWire(facts: Facts, attempts: number): void {
  expect(facts.bodies).toStrictEqual(
    Array.from({ length: attempts }, () => wireOracle(facts)),
  );
}

function assertSourceHookReplacement(facts: Facts): void {
  expect(facts.hooks).toHaveLength(2);
  expect(facts.hooks[0]).toMatchObject({
    input: {
      hook_event_name: 'BeforeModel',
      llm_request: { contents: expect.any(Array) },
    },
  });
  const hookInput = z
    .object({
      input: z.object({
        llm_request: z.object({ contents: z.array(z.unknown()).min(1) }),
      }),
    })
    .parse(facts.hooks[0]);
  expect(hookInput.input.llm_request.contents).toHaveLength(65);
  expect(facts.hooks[1]).toMatchObject({
    output: {
      hookSpecificOutput: {
        llm_request: {
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'new context' }],
            },
          ],
        },
      },
    },
  });
}

function registerRequiredSourceModes(entry: 'stream' | 'chat'): void {
  describe(`required logging-on source modes through ${entry}`, () => {
    it.each(['conversation', 'retry', 'hook', 'error', 'abort'])(
      'completes actual logging-on source HTTP and distinct observations for %s',
      async (mode) => {
        const facts = await worker(mode, true, false, entry);
        const attempts = mode === 'retry' ? 2 : 1;
        expect(facts.bodies).toHaveLength(attempts);
        expect(apiRequests(facts)).toHaveLength(attempts * 2);
        expect(
          facts.events.filter(
            (event) => event['event.name'] === 'conversation_request_complete',
          ),
        ).toHaveLength(attempts);
        if (mode === 'hook') assertSourceHookReplacement(facts);
        else assertSourceWire(facts, attempts);
        if (['error', 'abort'].includes(mode)) assertEagerFailure(facts);
        else assertEagerSuccess(facts);
        expect(facts.liveOriginalRows).toBe(0);
        expect(facts.liveReadRows).toBe(0);
        assertOwners(facts);
      },
      600000,
    );
  });
}

if (
  process.env.ISSUE854_LOGGING_FULL === '1' &&
  process.env.ISSUE854_LOGGING_MODES_REQUIRED === '1'
) {
  registerRequiredSourceModes('stream');
  registerRequiredSourceModes('chat');
}
