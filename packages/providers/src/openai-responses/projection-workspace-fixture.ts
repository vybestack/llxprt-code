/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deserialize } from 'node:v8';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { GenerateChatOptions } from '../IProvider.js';
import {
  projectionGate,
  projectionInstructions,
  projectionModel,
  projectionRuntime,
} from './projection-ownership-fixture.js';
export function singleAttemptOptions(
  options: GenerateChatOptions,
): GenerateChatOptions {
  if (options.runtime === undefined || options.settings === undefined) {
    throw new Error('Workspace test requires explicit runtime and settings');
  }
  return {
    ...options,
    invocation: createRuntimeInvocationContext({
      runtime: options.runtime,
      settings: options.settings,
      providerName: 'openai-responses',
      ephemeralsSnapshot: { 'prompt-caching': 'off', retries: 1, retrywait: 0 },
    }),
  };
}

export function registerProjectionWorkspace(): () => string {
  let root = '';
  let previousTmpdir: string | undefined;
  let previousConfig: string | undefined;
  beforeEach(() => {
    previousTmpdir = process.env.TMPDIR;
    previousConfig = process.env.LLXPRT_CONFIG_HOME;
    root = mkdtempSync(
      join(process.cwd(), 'tmp/projection-workspace-lifecycle-'),
    );
    mkdirSync(join(root, 'config'));
    process.env.TMPDIR = root;
    process.env.LLXPRT_CONFIG_HOME = join(root, 'config');
  });
  afterEach(() => {
    writeFileSync(
      join(root, 'remaining.json'),
      JSON.stringify(snapshotWorkspaces(root)),
    );
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    if (previousConfig === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousConfig;
  });
  return () => root;
}

export function snapshotWorkspaces(root = tmpdir()): string[] {
  return readdirSync(root).filter((name) =>
    name.startsWith('responses-request-snapshot-'),
  );
}

export function reopenSnapshot(
  root: string,
  name: string,
): readonly IContent[] {
  const bytes = readFileSync(join(root, name, 'rows'));
  const rows: IContent[] = [];
  for (let offset = 0; offset < bytes.length; ) {
    const length = bytes.readDoubleLE(offset);
    const row: IContent = deserialize(
      bytes.subarray(offset + 8, offset + 8 + length),
    );
    rows.push(row);
    offset += 8 + length;
  }
  return rows;
}

export function workspaceRows(failure?: () => void): {
  readonly rows: ProviderRequestRows;
  readonly expected: readonly IContent[];
  readonly state: { active: number; opened: number; pulled: number };
} {
  const expected: readonly IContent[] = [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'First "row"; \\ 雪.' }],
    },
    { speaker: 'human', blocks: [{ type: 'text', text: 'Second row.' }] },
  ];
  const state = { active: 0, opened: 0, pulled: 0 };
  return {
    expected,
    state,
    rows: {
      count: expected.length,
      async *openReader(): AsyncGenerator<IContent, void> {
        state.active++;
        state.opened++;
        try {
          for (const row of expected) {
            state.pulled++;
            yield row;
            failure?.();
          }
        } finally {
          state.active--;
        }
      },
    },
  };
}

export function workspaceBody(rows: readonly IContent[]): {
  bytes: number;
  sha256: string;
} {
  const body = JSON.stringify({
    model: projectionModel,
    input: rows.map((row) => ({
      role: 'user',
      content: row.blocks
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join(''),
    })),
    stream: true,
    instructions: projectionInstructions,
  });
  return {
    bytes: Buffer.byteLength(body),
    sha256: createHash('sha256').update(body).digest('hex'),
  };
}

export function workspaceEndpoint(
  root: string,
  retry: boolean,
): {
  readonly server: Bun.Server<undefined>;
  readonly arrived: ReturnType<typeof projectionGate>;
  readonly uploaded: ReturnType<typeof projectionGate>;
  readonly readBody: ReturnType<typeof projectionGate>;
  readonly respond: ReturnType<typeof projectionGate>;
  readonly observations: Array<{
    snapshots: string[];
    bytes: number;
    sha256: string;
  }>;
} {
  const arrived = projectionGate();
  const uploaded = projectionGate();
  const readBody = projectionGate();
  const respond = projectionGate();
  const observations: Array<{
    snapshots: string[];
    bytes: number;
    sha256: string;
  }> = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      arrived.release();
      await readBody.wait;
      if (request.body === null) throw new Error('Missing upload body');
      const bytes = new Uint8Array(
        await new Response(request.body).arrayBuffer(),
      );
      observations.push({
        snapshots: snapshotWorkspaces(root),
        bytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      uploaded.release();
      await respond.wait;
      if (retry && observations.length === 1)
        return new Response('{"error":{"message":"retry"}}', { status: 503 });
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"finished"}\n\ndata: {"type":"response.completed","response":{"id":"resp_workspace","status":"completed","output":[]}}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  return { server, arrived, uploaded, readBody, respond, observations };
}

export async function withWorkspaceRuntime<T>(
  root: string,
  consume: (
    setup: Awaited<ReturnType<typeof projectionRuntime>>,
    http: ReturnType<typeof workspaceEndpoint>,
  ) => Promise<T>,
  retry = false,
): Promise<T> {
  const http = workspaceEndpoint(root, retry);
  const setup = await projectionRuntime(
    `http://127.0.0.1:${http.server.port}/v1`,
    root,
  );
  try {
    return await consume(setup, http);
  } finally {
    http.readBody.release();
    http.respond.release();
    await http.server.stop(true);
    await setup.config.dispose();
  }
}

export function onlySnapshot(root: string): string {
  const names = snapshotWorkspaces(root);
  expect(names).toHaveLength(1);
  return names[0];
}
