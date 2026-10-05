/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { SubagentLaunchResult } from '../subagentOrchestrator.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function localTransport(directory: string): Promise<{
  baseUrl: string;
  count(): number;
  digest(): string;
  rejectNext(): void;
  close(): Promise<void>;
}> {
  let count = 0;
  let digest = '';
  let rejectNext = false;
  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    try {
      if (request.url !== '/v1/responses')
        throw new Error(`Unexpected URL ${request.url}`);
      if (
        request.headers.authorization !== 'Bearer childaccept-not-a-credential'
      )
        throw new Error('Unexpected credential');
      const body = await readBody(request);
      count += 1;
      digest = createHash('sha256').update(body).digest('hex');
      await writeFile(join(directory, `request-${count}.json`), body);
      if (rejectNext) {
        rejectNext = false;
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            error: { message: 'local refusal', type: 'server_error' },
          }),
        );
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        'data: {"type":"content.delta","delta":"ok"}\n\ndata: {"type":"response.completed","response":{"id":"resp_child_local","status":"completed"}}\n\ndata: [DONE]\n\n',
      );
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  };
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing listener address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    count: () => count,
    digest: () => digest,
    rejectNext: () => {
      rejectNext = true;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

export async function sendChildHistory(
  child: SubagentLaunchResult,
  contents: AsyncIterable<IContent> = child.runtime.history.getCuratedForProviderStream(),
): Promise<void> {
  const runtime = child.runtime.runtimeContext.providerRuntime;
  const provider = child.runtime.providerAdapter.getActiveProvider();
  if (runtime.config === undefined) throw new Error('No child config');
  const options = createProviderCallOptions({
    providerName: 'openai-responses',
    runtime,
    config: runtime.config,
    settings: runtime.config.getSettingsService(),
    systemInstruction: 'child acceptance',
    ephemerals: {
      'prompt-caching': 'off',
      'responses-stateful': true,
      retries: 2,
      retrywait: 0,
    },
    contents,
  });
  for await (const _chunk of provider.generateChatCompletion({
    ...options,
    contents,
  })) {
    /* drain */
  }
}
