/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import {
  processorFixture,
  sourcePending,
} from './streamprocessor-source-fixture.js';
import {
  modelHookMode,
  registerModelHook,
  type ModelHookMode,
} from './streamprocessor-model-hook-fixture.js';
import {
  registerToolHook,
  toolHookTools,
} from './streamprocessor-tool-hook-fixture.js';
import {
  observeModelBody,
  type ModelBodyObserver,
} from './streamprocessor-model-body-observer.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

function endpoint(mode: ModelHookMode): {
  server: Bun.Server<undefined>;
  bodies: Array<{ bytes: number; sha256: string; text?: string }>;
} {
  const bodies: Array<{ bytes: number; sha256: string; text?: string }> = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      const text = await request.text();
      bodies.push({
        bytes: Buffer.byteLength(text),
        sha256: createHash('sha256').update(text).digest('hex'),
        text: mode === 'large' ? undefined : text,
      });
      if (mode === 'retry' && bodies.length === 1)
        return new Response('retry', { status: 503 });
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"finished"}\n\ndata: {"type":"response.completed","response":{"id":"resp_hook","status":"completed","output":[]}}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  return { server, bodies };
}

/** Tool-selection hook the mode runs under, so a restriction is in effect. */
function selectionMode(mode: ModelHookMode): 'restrict' | 'none' | undefined {
  if (['restrict', 'denied-tool', 'after-restrict'].includes(mode))
    return 'restrict';
  return mode === 'after-omit-tools' ? 'none' : undefined;
}

function oracleTools(mode: ModelHookMode): typeof toolHookTools {
  const selected = selectionMode(mode);
  if (selected === 'none') return [];
  return selected === undefined
    ? toolHookTools
    : toolHookTools.filter((tool) => tool.name === 'weather');
}

function expectedRows(mode: ModelHookMode): IContent[] {
  const rows = [
    ...Array.from({ length: mode === 'large' ? 64 : 1 }, (_, index) =>
      diskTextRow(index, mode === 'large'),
    ),
    sourcePending,
  ];
  if (['none', 'chain-empty-none', 'parallel-empty-none'].includes(mode))
    return [
      { speaker: 'human', blocks: [{ type: 'text', text: 'new context' }] },
    ];
  if (mode === 'ambiguous') return [...rows].reverse();
  return rows.map((row, index) => ({
    ...row,
    blocks: row.blocks.map((block, b) => {
      if (block.type !== 'text') return block;
      if (
        mode === 'replace' ||
        (['edit', 'chain-edit-noop'].includes(mode) &&
          index === rows.length - 1)
      )
        return { ...block, text: block.text.toUpperCase() };
      if (mode === 'boundary' && index === 0 && b === 0)
        return { ...block, text: `${block.text} edited` };
      return block;
    }),
  }));
}

async function oracle(
  setup: Awaited<ReturnType<typeof processorFixture>>,
  mode: ModelHookMode,
): Promise<Awaited<ReturnType<typeof estimatePromptEnvelope>>> {
  const projection = await setup.provider.projectPromptEnvelope({
    contents: {
      async *[Symbol.asyncIterator](): AsyncGenerator<IContent, void, unknown> {
        if (mode === 'large') {
          for (let index = 0; index < 64; index++)
            yield diskTextRow(index, true);
          yield sourcePending;
        } else yield* expectedRows(mode);
      },
    },
    tools: oracleTools(mode),
    config: setup.config,
    runtime: setup.runtime.providerRuntime,
    settings: setup.settings,
    systemInstruction: setup.generation.systemInstruction,
  });
  try {
    return await estimatePromptEnvelope(
      setup.provider.name,
      projection,
      setup.nativeFactory,
    );
  } finally {
    await projection.releaseIfUnsent?.();
  }
}

async function consume(
  setup: Awaited<ReturnType<typeof processorFixture>>,
  mode: ModelHookMode,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer =
    mode === 'cancel' || mode === 'after-cancel'
      ? setInterval(() => {
          if (
            existsSync(join(setup.config.getTargetDir(), 'model-hooks.jsonl'))
          )
            controller.abort(new Error('required cancellation'));
        }, 10)
      : undefined;
  const restrictions: unknown[] = [];
  let output = '';
  try {
    const stream = await setup.processor.makeApiCallAndProcessStream(
      {
        message: 'Answer',
        config: {
          tools: toolHookTools,
          abortSignal: controller.signal,
        },
      },
      'actual-model-worker',
      sourcePending,
    );
    for await (const chunk of stream) {
      restrictions.push(chunk.hookRestrictions);
      output += chunk.content.blocks
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
    }
    return { output, restrictions };
  } catch (error) {
    return {
      output,
      restrictions,
      error: String(error),
      errorName: error instanceof Error ? error.name : undefined,
    };
  } finally {
    clearInterval(timer);
  }
}

async function run(
  root: string,
  mode: ModelHookMode,
  source: boolean,
): Promise<Record<string, unknown>> {
  const http = endpoint(mode);
  const setup = await processorFixture(
    root,
    `http://127.0.0.1:${http.server.port}/v1`,
    mode === 'large',
    mode === 'large' ? 64 : 1,
  );
  const logs: string[] = [];
  const debug = DebugLogger.prototype.debug;
  DebugLogger.prototype.debug = function (...args): void {
    const value = args[0];
    if (typeof value === 'function') {
      const message = value();
      if (
        typeof message === 'string' &&
        message.includes('BeforeModelSnapshot')
      )
        logs.push(message);
    }
    debug.apply(this, args);
  };
  let observer: ModelBodyObserver | undefined;
  try {
    registerModelHook(setup.config, root, mode);
    const selection = selectionMode(mode);
    if (selection !== undefined)
      registerToolHook(setup.config, root, selection);
    const system = setup.config.getHookSystem();
    if (!system) throw new Error('Missing actual HookSystem');
    await system.initialize();
    const expected = await oracle(setup, mode);
    if (source) observer = observeModelBody(setup.history);
    const facts = await consume(setup, mode);
    const path = join(root, 'model-hooks.jsonl');
    return {
      ...facts,
      bodies: http.bodies,
      estimate: setup.processor.getPromptEnvelopeEstimate(),
      oracle: expected,
      owners: setup.history.owners,
      activeBodies: activeRequestBodyCount(),
      hooks: existsSync(path)
        ? readFileSync(path, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        : [],
      logs,
      firstLive: observer?.firstLive() ?? -1,
      lastLive: observer?.lastLive() ?? -1,
      boundary: observer?.boundaryFacts(),
      directories: [
        ...readdirSync(root),
        ...readdirSync(getScratchRoot()),
      ].filter(
        (name) =>
          name.startsWith('boundary-snapshot-') ||
          name.startsWith('hook-output-'),
      ),
      requests: setup.requests,
    };
  } finally {
    observer?.restore();
    DebugLogger.prototype.debug = debug;
    setup.history.dispose();
    await http.server.stop(true);
    await setup.config.dispose();
  }
}
const [root, mode, source, result] = z
  .tuple([z.string(), modelHookMode, z.enum(['true', 'false']), z.string()])
  .parse(process.argv.slice(2));
writeFileSync(
  result,
  JSON.stringify(await run(root, mode, source === 'true'), null, 2),
);
