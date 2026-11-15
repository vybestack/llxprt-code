/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { DumpRetentionCoordinator } from '../utils/dump-retention.js';
import type { DumpAttemptContext } from '../utils/dumpAttemptContext.js';
import {
  configureDumpCapture,
  createCaptureBuffer,
  createReasoningCaptureFetch,
} from './vercelReasoningCapture.js';

const configHome = mkdtempSync(join(tmpdir(), 'llxprt-vercel-dump-'));
const originalConfigHome = process.env['LLXPRT_CONFIG_HOME'];
const originalCacheHome = process.env['LLXPRT_CACHE_HOME'];
delete process.env['LLXPRT_CACHE_HOME'];
process.env['LLXPRT_CONFIG_HOME'] = configHome;
const dumpDir = join(Storage.getGlobalCacheDir(), 'dumps');
const logger = new DebugLogger('llxprt:test:vercel-dump');

describe('OpenAI Vercel refusal dumps', () => {
  afterAll(() => {
    if (originalConfigHome === undefined)
      delete process.env['LLXPRT_CONFIG_HOME'];
    else process.env['LLXPRT_CONFIG_HOME'] = originalConfigHome;
    if (originalCacheHome === undefined)
      delete process.env['LLXPRT_CACHE_HOME'];
    else process.env['LLXPRT_CACHE_HOME'] = originalCacheHome;
    rmSync(configHome, { recursive: true, force: true });
  });
  it('writes the linked request and complete refusal SSE response', async () => {
    let writtenDump: { outcome: string; baseId: string } | undefined;
    const attemptContext: DumpAttemptContext = {
      promptId: 'prompt-vercel-1',
      attemptIndex: 0,
      runtimeId: 'runtime-vercel-test',
      pairedSuccess: false,
      retentionCoordinator: new DumpRetentionCoordinator(),
      recordDump(outcome, baseId) {
        writtenDump = { outcome, baseId };
      },
    };
    const sse = [
      `data: ${JSON.stringify({
        choices: [
          { delta: { content: 'partial refusal output' }, finish_reason: null },
        ],
      })}`,
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'refusal' }],
      })}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(sse);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing local Vercel endpoint port');

    try {
      const captureBuffer = createCaptureBuffer();
      captureBuffer.dumpMode = 'error';
      captureBuffer.attemptContext = attemptContext;
      captureBuffer.providerName = 'openaivercel';
      const captureFetch = createReasoningCaptureFetch(
        captureBuffer,
        logger,
        fetch,
      );
      const response = await captureFetch(
        `http://127.0.0.1:${address.port}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'fixture', stream: true }),
        },
      );
      await response.text();
      await captureBuffer.parsePromise;

      expect(writtenDump?.outcome).toBe('refusal');
      expect(writtenDump?.baseId).toBeString();
      const files = readdirSync(dumpDir).sort();
      expect(files).toHaveLength(2);
      const requestFile = files.find((file) => file.endsWith('-request.json'));
      const responseFile = files.find((file) =>
        file.endsWith('-response.json'),
      );
      expect(requestFile).toBeString();
      expect(responseFile).toBeString();
      const request = JSON.parse(
        readFileSync(join(dumpDir, requestFile ?? ''), 'utf8'),
      ) as Record<string, unknown>;
      const responseDump = JSON.parse(
        readFileSync(join(dumpDir, responseFile ?? ''), 'utf8'),
      ) as Record<string, unknown>;
      expect(request['promptId']).toBe('prompt-vercel-1');
      expect(responseDump['relatedRequestFile']).toBe(
        `${writtenDump?.baseId}-request.json`,
      );
      expect(responseDump['promptId']).toBe('prompt-vercel-1');
      expect(JSON.stringify(responseDump)).toContain('partial refusal output');
      expect(JSON.stringify(responseDump)).toContain('refusal');
      expect(JSON.stringify(responseDump)).toContain('[DONE]');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('captures Vercel JSON refusal responses', async () => {
    let recordedOutcome: string | undefined;
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: { role: 'assistant', content: 'json refusal output' },
              finish_reason: 'refusal',
            },
          ],
        }),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing local Vercel endpoint port');

    try {
      const captureBuffer = createCaptureBuffer();
      captureBuffer.dumpMode = 'error';
      captureBuffer.attemptContext = {
        promptId: 'prompt-vercel-json',
        attemptIndex: 1,
        runtimeId: 'runtime-vercel-test',
        pairedSuccess: false,
        retentionCoordinator: new DumpRetentionCoordinator(),
        recordDump(outcome) {
          recordedOutcome = outcome;
        },
      };
      captureBuffer.providerName = 'openaivercel';
      const captureFetch = createReasoningCaptureFetch(
        captureBuffer,
        logger,
        fetch,
      );
      const response = await captureFetch(
        `http://127.0.0.1:${address.port}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'fixture', stream: false }),
        },
      );
      await response.text();

      expect(recordedOutcome).toBe('refusal');
      const files = readdirSync(dumpDir).sort();
      expect(files).toHaveLength(4);
      const responses = files
        .filter((file) => file.endsWith('-response.json'))
        .map((file) => JSON.parse(readFileSync(join(dumpDir, file), 'utf8')));
      expect(JSON.stringify(responses)).toContain('json refusal output');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each([
    ['one-byte cap', 1, 14],
    ['immediate age cap', 1_000_000, 1e-12],
  ])(
    'applies invocation %s without attempt identity',
    async (_, maxBytes, maxAgeDays) => {
      const server = createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'local refusal output',
                },
                finish_reason: 'refusal',
              },
            ],
          }),
        );
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('Missing local Vercel endpoint port');

      try {
        const expired = join(dumpDir, 'expired-singleton-request.json');
        writeFileSync(expired, 'expired');
        utimesSync(expired, new Date(0), new Date(0));
        const values = new Map<string, unknown>([
          ['dumpcontext', 'error'],
          ['dump-retention-max-bytes', maxBytes],
          ['dump-retention-max-age-days', maxAgeDays],
        ]);
        const captureBuffer = createCaptureBuffer();
        configureDumpCapture(
          captureBuffer,
          {
            invocation: {
              getEphemeral: <T>(key: string) =>
                values.get(key) as T | undefined,
            },
          },
          {},
        );
        captureBuffer.providerName = 'openaivercel';
        const response = await createReasoningCaptureFetch(
          captureBuffer,
          logger,
          fetch,
        )(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'fixture', stream: false }),
        });
        await response.text();

        const files = readdirSync(dumpDir);
        expect(files).not.toContain('expired-singleton-request.json');
        expect(files.length).toBeLessThanOrEqual(maxBytes === 1 ? 0 : 2);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});
