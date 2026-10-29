/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { WireRoute } from './wireBodyCapture.js';
import type { HashedWireBody } from './local-wire-hash-sink.js';

const messageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready'), baseURL: z.string(), pid: z.number() }),
  z.object({ kind: z.literal('sample') }),
  z.object({
    kind: z.literal('body'),
    bytes: z.number(),
    chunks: z.number(),
    sha256: z.string(),
    contentLength: z.string().optional(),
    entries: z.number(),
  }),
]);

export interface IsolatedWireHashSink {
  readonly route: WireRoute;
  body(): Promise<
    HashedWireBody & { readonly entries: number; readonly chunks: number }
  >;
  close(): Promise<void>;
}

export async function isolatedWireHashSink(
  route: WireRoute,
  sample: () => Promise<void>,
): Promise<IsolatedWireHashSink> {
  let ready: ((baseURL: string) => void) | undefined;
  let failedReady: ((error: Error) => void) | undefined;
  const started = new Promise<string>((resolve, reject) => {
    ready = resolve;
    failedReady = reject;
  });
  let delivered:
    | ((
        body: HashedWireBody & {
          readonly entries: number;
          readonly chunks: number;
        },
      ) => void)
    | undefined;
  let failedBody: ((error: Error) => void) | undefined;
  const received = new Promise<
    HashedWireBody & { readonly entries: number; readonly chunks: number }
  >((resolve, reject) => {
    delivered = resolve;
    failedBody = reject;
  });
  const child = spawn(
    process.execPath,
    [join(import.meta.dir, 'wire-hash-sink-worker.ts'), route.id],
    { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
  );
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Hash sink exited ${code}`)),
    );
  });
  child.on('message', (value: unknown) => {
    const message = messageSchema.parse(value);
    if (message.kind === 'ready') {
      if (process.env.SEND_PEAK_LOG !== undefined)
        appendFileSync(
          `${process.env.SEND_PEAK_LOG}.sink-pids.jsonl`,
          `${JSON.stringify({ pid: message.pid, parent: process.pid, route: route.id })}\n`,
        );
      ready?.(message.baseURL);
    } else if (message.kind === 'body')
      delivered?.({ ...message, contentLength: message.contentLength });
    else
      void sample().then(() => {
        child.send('continue');
      });
  });
  void exited.catch((error: unknown) => {
    const failure = error instanceof Error ? error : new Error(String(error));
    failedReady?.(failure);
    failedBody?.(failure);
  });
  const baseURL = await started;
  return {
    route: { ...route, baseURL },
    body: () => received,
    async close(): Promise<void> {
      child.send('close');
      await exited;
    },
  };
}
