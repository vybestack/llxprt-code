/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readAtOf } from '../../../__tests__/requestRowsTestSupport.js';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import {
  getScratchRoot,
  removeScratchRoot,
} from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { GenerateChatOptions } from '../../../IProvider.js';
import { acquireRequestRows } from '../../../utils/requestRowsLease.js';
import type { RequestRowsScope } from '../../../utils/requestRowsLease.js';
import {
  projectionGate,
  projectionInstructions,
  projectionModel,
  projectionRuntime,
  type ProjectionRuntime,
} from './projection-ownership-fixture.js';
export function singleAttemptOptions(
  options: GenerateChatOptions,
): GenerateChatOptions {
  if (options.invocation === undefined) {
    throw new Error('Workspace test requires an explicit invocation');
  }
  return {
    ...options,
    invocation: createRuntimeInvocationContext({
      runtimeId: options.invocation.runtimeId,
      providerName: 'openai-responses',
      ephemeralsSnapshot: {
        ...options.invocation.ephemerals,
        'prompt-caching': 'off',
        retries: 1,
        retrywait: 0,
      },
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
    root = mkdtempSync(join(tmpdir(), 'projection-workspace-lifecycle-'));
    mkdirSync(join(root, 'config'));
    process.env.TMPDIR = root;
    process.env.LLXPRT_CONFIG_HOME = join(root, 'config');
    // Snapshot workspaces live in the process scratch root; start a fresh one
    // under this test's TMPDIR.
    removeScratchRoot();
  });
  afterEach(() => {
    writeFileSync(
      join(root, 'remaining.json'),
      JSON.stringify(snapshotWorkspaces(root)),
    );
    removeScratchRoot();
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    if (previousConfig === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousConfig;
  });
  return () => root;
}

/**
 * Lists the request's staged-rows workspaces in the process scratch root: the
 * rows a call without `requestRows` is staged into before its body is built.
 */
export function snapshotWorkspaces(_fixtureRoot?: string): string[] {
  return readdirSync(getScratchRoot())
    .filter((name) => name.startsWith('provider-normalization-'))
    .sort();
}

/** Lists the prompt-key file workspaces the request body is served from. */
export function promptKeyWorkspaces(_fixtureRoot?: string): string[] {
  return readdirSync(getScratchRoot())
    .filter((name) => name.startsWith('responses-prompt-keys-'))
    .sort();
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
      readAt: readAtOf(expected),
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

/**
 * A projection runtime whose plain-rows options are staged once by the
 * request's owner, the way the retry and logging wrappers hand rows to a
 * provider; `closeRows` ends that ownership.
 */
export type WorkspaceRuntime = ProjectionRuntime & {
  readonly closeRows: () => Promise<void>;
};

export async function withWorkspaceRuntime<T>(
  root: string,
  consume: (
    setup: WorkspaceRuntime,
    http: ReturnType<typeof workspaceEndpoint>,
  ) => Promise<T>,
  retry = false,
): Promise<T> {
  const http = workspaceEndpoint(root, retry);
  const runtime = await projectionRuntime(
    `http://127.0.0.1:${http.server.port}/v1`,
    root,
  );
  const scopes: RequestRowsScope[] = [];
  const setup: WorkspaceRuntime = {
    ...runtime,
    options: (rows, signal, ephemerals) => {
      const options = runtime.options(rows, signal, ephemerals);
      if (options.requestRows !== undefined) return options;
      const scope = acquireRequestRows(options);
      scopes.push(scope);
      return scope.options;
    },
    closeRows: async () => {
      await Promise.all(scopes.splice(0).map((scope) => scope.close()));
    },
  };
  try {
    return await consume(setup, http);
  } finally {
    http.readBody.release();
    http.respond.release();
    await http.server.stop(true);
    await setup.closeRows();
    await setup.config.dispose();
  }
}

export function onlySnapshot(root: string): string {
  const names = snapshotWorkspaces(root);
  expect(names).toHaveLength(1);
  return names[0];
}
