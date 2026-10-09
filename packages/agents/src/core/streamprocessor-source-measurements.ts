/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { heapSize } from 'bun:jsc';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { projectionEndpoint } from '@vybestack/llxprt-code-providers/openai-responses/projection-ownership-fixture.js';
import { observeDiskBody } from '@vybestack/llxprt-code-providers/openai-responses/disk-text-body-observer.js';
import {
  processorFixture,
  sourcePending,
  type ObservedHistory,
} from './streamprocessor-source-fixture.js';

export async function sourceHeap(): Promise<number> {
  for (let round = 0; round < 8; round++) {
    await Bun.sleep(0);
    Bun.gc(true);
  }
  return heapSize();
}
export async function warmSourceProcessor(root: string): Promise<void> {
  const http = projectionEndpoint(true);
  const setup = await processorFixture(
    root,
    `http://127.0.0.1:${http.server.port}/v1`,
    false,
    1,
  );
  const observer = observeDiskBody();
  observer.resume.release();
  http.readBody.release();
  http.respond.release();
  try {
    const stream = await setup.processor.makeApiCallAndProcessStream(
      {
        message: 'Warm',
        config: { requestHistorySource: 'responses-disk-text' },
      },
      'warm-source',
      sourcePending,
    );
    for await (const _chunk of stream) {
      /* Warm the actual response/history lifecycle. */
    }
    await sourceHeap();
  } finally {
    observer.restore();
    setup.history.dispose();
    await http.server.stop(true);
    await setup.config.dispose();
  }
}
export async function measureSourceUpload(
  started: Promise<AsyncGenerator<ModelStreamChunk>>,
  http: ReturnType<typeof projectionEndpoint>,
  observer: ReturnType<typeof observeDiskBody>,
  history: ObservedHistory,
) {
  await Promise.race([
    observer.first.wait,
    started.then(() => {
      throw new Error('No actual BODY demand');
    }),
  ]);
  const firstHeap = await sourceHeap();
  const liveFirst = history.references.filter(
    (row) => row.deref() !== undefined,
  ).length;
  const inputLiveFirst = history.inputReferences.filter(
    (row) => row.deref() !== undefined,
  ).length;
  const ownersFirst = history.owners.map((owner) => ({ ...owner }));
  const firstDemand = { ...observer.state };
  observer.resume.release();
  await http.arrived.wait;
  const receiverHeap = await sourceHeap();
  http.readBody.release();
  await http.uploaded.wait;
  await observer.last.wait;
  const lastHeap = await sourceHeap();
  const liveLast = history.references.filter(
    (row) => row.deref() !== undefined,
  ).length;
  const inputLiveLast = history.inputReferences.filter(
    (row) => row.deref() !== undefined,
  ).length;
  http.respond.release();
  const stream = await started;
  const output: string[] = [];
  for await (const chunk of stream)
    output.push(
      ...chunk.content.blocks.flatMap((block) =>
        block.type === 'text' ? [block.text] : [],
      ),
    );
  const finalHeap = await sourceHeap();
  return {
    firstHeap,
    receiverHeap,
    lastHeap,
    finalHeap,
    liveFirst,
    liveLast,
    inputLiveFirst,
    inputLiveLast,
    ownersFirst,
    firstDemand,
    output: output.join(''),
  };
}
