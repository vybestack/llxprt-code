/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readdirSync } from 'node:fs';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import type { GenerateChatOptions } from '../../../IProvider.js';
import { requestSelection } from './request-selection.js';
import {
  projectionRuntime,
  type ProjectionRuntime,
} from './projection-ownership-fixture.js';

const completed =
  'data: {"type":"response.output_text.delta","delta":"ok"}\n\n' +
  'data: {"type":"response.completed","response":{"id":"resp_s","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n';

export interface SourceRouteHarness {
  readonly setup: ProjectionRuntime;
  /** Request bodies received by the local endpoint, oldest first. */
  readonly bodies: string[];
  /** Number of leading requests answered with a retryable 503. */
  failFirst: number;
  options(
    list: readonly IContent[],
    ephemerals: Record<string, unknown>,
    runtime?: ProviderRuntimeContext,
  ): GenerateChatOptions;
  /** The eager array route for the same rows: the independent baseline. */
  arrayOptions(
    list: readonly IContent[],
    ephemerals: Record<string, unknown>,
  ): GenerateChatOptions;
  project(options: GenerateChatOptions): Promise<PromptEnvelopeProjection>;
  /** Sends through the projection token, the way the agent does. */
  sendProjected(options: GenerateChatOptions): Promise<void>;
  close(): Promise<void>;
}

export function rowsOf(list: readonly IContent[]): ProviderRequestRows {
  return {
    count: list.length,
    async *openReader(signal?: AbortSignal): AsyncGenerator<IContent, void> {
      for (const row of list) {
        signal?.throwIfAborted();
        yield structuredClone(row);
      }
    },
  };
}

export function promptDirs(): Set<string> {
  return new Set(
    readdirSync(getScratchRoot()).filter((name) =>
      name.startsWith('responses-prompt-keys-'),
    ),
  );
}

export async function startSourceRouteHarness(): Promise<SourceRouteHarness> {
  const bodies: string[] = [];
  const state = { failFirst: 0 };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      bodies.push(await request.text());
      if (state.failFirst > 0) {
        state.failFirst--;
        return new Response('{"error":{"message":"retry"}}', { status: 503 });
      }
      return new Response(completed, {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  const setup = await projectionRuntime(
    `http://127.0.0.1:${server.port}/v1`,
    process.cwd(),
  );
  const build = (
    list: readonly IContent[],
    ephemerals: Record<string, unknown>,
    selection: boolean,
    runtime?: ProviderRuntimeContext,
  ): GenerateChatOptions => {
    const base = setup.options(
      selection
        ? requestSelection({ ...rowsOf(list), close: () => {} })
        : rowsOf(list),
    );
    if (base.invocation === undefined)
      throw new Error('Missing fixture invocation');
    return {
      ...base,
      invocation: createRuntimeInvocationContext({
        runtimeId: runtime?.runtimeId ?? base.invocation.runtimeId,
        providerName: setup.provider.name,
        ephemeralsSnapshot: {
          ...base.invocation.ephemerals,
          retries: 2,
          retrywait: 0,
          ...ephemerals,
        },
      }),
    };
  };
  return {
    setup,
    bodies,
    get failFirst(): number {
      return state.failFirst;
    },
    set failFirst(value: number) {
      state.failFirst = value;
    },
    options: (list, ephemerals, runtime) =>
      build(list, ephemerals, true, runtime),
    arrayOptions: (list, ephemerals) => build(list, ephemerals, false),
    project: (opts) => setup.provider.projectPromptEnvelope(opts),
    async sendProjected(opts): Promise<void> {
      const projection = await setup.provider.projectPromptEnvelope(opts);
      for await (const _ of setup.provider.generateChatCompletion({
        ...opts,
        promptEnvelopeTransportToken: projection.transportToken,
      }));
    },
    async close(): Promise<void> {
      await server.stop(true);
      await setup.config.dispose();
    },
  };
}
