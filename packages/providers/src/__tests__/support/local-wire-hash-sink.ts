/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { WireRoute } from './wireBodyCapture.js';

export interface HashedWireBody {
  readonly bytes: number;
  readonly sha256: string;
  readonly contentLength: string | undefined;
}

export interface LocalWireHashSink {
  readonly route: WireRoute;
  readonly requests: readonly HashedWireBody[];
  readonly entries: () => number;
  close(): Promise<void>;
}

function samplingInterval(
  length: string | undefined,
  checkpoints?: number,
): number {
  if (checkpoints === undefined) return 1024 * 1024;
  const interval = Math.max(1, Math.ceil(Number(length) / checkpoints));
  if (!Number.isFinite(interval))
    throw new Error('Missing measured body length');
  return interval;
}

export async function localWireHashSink(
  route: WireRoute,
  onBytes?: (bytes: number, chunks: number) => Promise<void>,
  checkpoints?: number,
): Promise<LocalWireHashSink> {
  const requests: HashedWireBody[] = [];
  let entries = 0;
  const server = createServer((request, response) => {
    entries += 1;
    void (async (): Promise<void> => {
      if (request.url?.endsWith(route.endpoint) !== true) {
        throw new Error(`Expected ${route.endpoint}, received ${request.url}`);
      }
      const hash = createHash('sha256');
      let bytes = 0;
      let chunks = 0;
      const interval = samplingInterval(
        request.headers['content-length'],
        checkpoints,
      );
      let nextSample = 0;
      for await (const chunk of request) {
        if (!Buffer.isBuffer(chunk)) throw new Error('Expected socket bytes');
        chunks++;
        hash.update(chunk);
        bytes += chunk.byteLength;
        if (bytes >= nextSample) {
          nextSample =
            checkpoints === undefined
              ? bytes + interval
              : (Math.floor(bytes / interval) + 1) * interval;
          await onBytes?.(bytes, chunks);
        }
      }
      await onBytes?.(bytes, chunks);
      requests.push({
        bytes,
        sha256: hash.digest('hex'),
        contentLength: request.headers['content-length'],
      });
      const reply = route.respond();
      response.writeHead(reply.status, Object.fromEntries(reply.headers));
      response.end(await reply.text());
    })().catch((error: unknown) =>
      response.destroy(
        error instanceof Error ? error : new Error(String(error)),
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing local socket');
  const baseURL = `http://127.0.0.1:${address.port}${new URL(route.baseURL).pathname}`;
  return {
    route: {
      ...route,
      baseURL,
      ...(route.id === 'openai-responses-via-openai'
        ? {
            providerSettings: {
              ...route.providerSettings,
              apiMode: 'responses',
            },
          }
        : {}),
    },
    requests,
    entries: () => entries,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
        server.closeAllConnections();
      }),
  };
}
