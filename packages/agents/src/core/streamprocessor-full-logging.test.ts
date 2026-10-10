/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  closeSync,
  openSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

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
  const root = mkdtempSync(
    join(tmpdir(), `streamprocessor-logging-${entry}-${mode}-`),
  );
  const runtime = join(root, 'runtime');
  mkdirSync(runtime, { recursive: true });
  const fd = openSync(join(root, 'worker.log'), 'w');
  const child = Bun.spawn(
    [
      process.execPath,
      join(
        import.meta.dir,
        '__tests__/support/streamprocessor-logging-worker.ts',
      ),
      root,
      mode,
      source ? 'source' : 'eager',
      large ? 'large' : 'small',
    ],
    {
      cwd: join(import.meta.dir, '../../../..'),
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
  const facts = factsSchema.parse(
    JSON.parse(readFileSync(join(root, 'result.json'), 'utf8')),
  );
  // Kept on failure so the worker log stays inspectable.
  rmSync(root, { recursive: true, force: true });
  return facts;
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

function assertSourceLogging(facts: Facts, mode: string): void {
  expect(facts.error).toBeUndefined();
  expect(facts.output).toBe('finished');
  expect(facts.bodies).toStrictEqual([wireOracle(facts)]);
  expect(facts.estimate).toStrictEqual(facts.oracle);
  assertResponseTokens(facts);
  const requests = apiRequests(facts);
  expect(requests).toHaveLength(2);
  // The agent never fabricates a full-context string on the source route.
  expect(requests.every((event) => event.request_text === undefined)).toBe(
    true,
  );
  const names = facts.events.map((event) => event['event.name']);
  expect(names.includes('conversation_request')).toBe(mode !== 'shape');
  expect(names.includes('conversation_response')).toBe(mode !== 'shape');
  if (mode === 'enabled') {
    expect(requests[1].row_count).toBe(65);
    expect(requests[1].artifact_id).toBeDefined();
    expect(facts.chunkRecords).toBeGreaterThan(0);
  } else {
    expect(facts.chunkRecords).toBe(mode === 'conversation' ? 3 : 0);
  }
  if (mode === 'shape') expect(facts.shapeMeasurements).toBe(1);
  expect(facts.liveOriginalRows).toBe(0);
  expect(facts.liveReadRows).toBe(0);
  assertOwners(facts);
}

describe('genuine StreamProcessor source logging', () => {
  it.each(['enabled', 'conversation', 'shape'])(
    'streams the source request with logging mode %s and no agent full-context string',
    async (mode) => {
      const facts = await worker(mode);
      expect(facts.error).toBeUndefined();
      assertSourceLogging(facts, mode);
    },
    60000,
  );
});

describe('genuine source disabled logging', () => {
  it('keeps real source disabled-log HTTP bytes and native complete estimate', async () => {
    const facts = await worker('disabled', true);
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
    expect(facts.bodies[0].bytes).toBeGreaterThan(0);
    assertOwners(facts);
  }, 600000);
});

describe('actual ChatSession enabled-source logging', () => {
  it.each(['enabled', 'conversation', 'shape'])(
    'streams the source request with logging mode %s through ChatSession',
    async (mode) => {
      const facts = await worker(mode, true, false, 'chat');
      expect(facts.error).toBeUndefined();
      assertSourceLogging(facts, mode);
    },
    60000,
  );
});

describe('actual ChatSession disabled-source localhost', () => {
  it('preserves HTTP digest and native estimate with logging off', async () => {
    const facts = await worker('disabled', true, false, 'chat');
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
  }, 600000);
});

describe('oversized source logging acceptance', () => {
  it.each(['stream'] as const)(
    'logs an oversized source request through %s without an agent string',
    async (entry) => {
      const facts = await worker('enabled', true, true, entry);
      expect(facts.error).toBeUndefined();
      assertSourceLogging(facts, 'enabled');
    },
    600000,
  );
});

function assertSourceWire(facts: Facts, attempts: number): void {
  expect(facts.bodies).toStrictEqual(
    Array.from({ length: attempts }, () => wireOracle(facts)),
  );
}

// Bun 1.3.14 rewrites an array in the actual value to `{}` when toMatchObject
// compares it with an asymmetric matcher such as expect.any(Array). Validate the
// recorded hook input with a schema first and assert on the parsed copy.
const recordedHookSchema = z.object({
  input: z.object({
    hook_event_name: z.string(),
    llm_request: z.object({ contents: z.array(z.unknown()) }),
  }),
});

function assertSourceHookReplacement(facts: Facts): void {
  expect(facts.hooks).toHaveLength(2);
  const recorded = recordedHookSchema.parse(facts.hooks[0]);
  expect(recorded.input.hook_event_name).toBe('BeforeModel');
  expect(recorded.input.llm_request.contents).toHaveLength(65);
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

describe('recorded source hook assertions', () => {
  it('keep the recorded hook contents an array after asserting them', () => {
    const rows = Array.from({ length: 65 }, (_, index) => ({ index }));
    const facts = {
      hooks: [
        {
          input: {
            hook_event_name: 'BeforeModel',
            llm_request: { contents: rows },
          },
        },
        {
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
        },
      ],
    } as Facts;
    assertSourceHookReplacement(facts);
    assertSourceHookReplacement(facts);
    expect(Array.isArray(rows)).toBe(true);
    expect(
      recordedHookSchema.parse(facts.hooks[0]).input.llm_request.contents,
    ).toHaveLength(65);
  });
});

function registerRequiredSourceModes(entry: 'stream' | 'chat'): void {
  describe(`required logging-on source modes through ${entry}`, () => {
    it.each(['conversation', 'retry', 'error', 'abort'])(
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
        assertSourceWire(facts, attempts);
        if (['error', 'abort'].includes(mode)) assertEagerFailure(facts);
        else assertEagerSuccess(facts);
        expect(facts.liveOriginalRows).toBe(0);
        expect(facts.liveReadRows).toBe(0);
        assertOwners(facts);
      },
      600000,
    );
    it('delivers the source BeforeModel hook full-request contents and applies its replacement', async () => {
      const facts = await worker('hook', true, false, entry);
      expect(facts.hooks).toHaveLength(2);
      assertSourceHookReplacement(facts);
      assertOwners(facts);
    }, 600000);
  });
}

registerRequiredSourceModes('stream');
registerRequiredSourceModes('chat');
