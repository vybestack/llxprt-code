/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  hookSessionRuntime,
  readHookDefinitions,
} from '@vybestack/llxprt-code-core/hooks/hook-configuration.js';
import { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import {
  processorFixture,
  sourcePending,
} from './streamprocessor-source-fixture.js';
import {
  observedHook,
  registerToolHook,
  toolHookMode,
  toolHookTools,
  type ToolHookMode,
} from './streamprocessor-tool-hook-fixture.js';

function endpoint(): { server: Bun.Server<undefined>; bodies: string[] } {
  const bodies: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      bodies.push(await request.text());
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"finished"}\n\ndata: {"type":"response.completed","response":{"id":"resp_hook","status":"completed","output":[]}}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  return { server, bodies };
}

async function oracle(
  setup: Awaited<ReturnType<typeof processorFixture>>,
  mode: ToolHookMode,
): Promise<Awaited<ReturnType<typeof estimatePromptEnvelope>>> {
  const tools = toolHookTools.filter(
    (tool) =>
      mode !== 'none' &&
      (mode !== 'restrict' || tool.name.startsWith('weather')),
  );
  const projection = await setup.provider.projectPromptEnvelope({
    contents: {
      async *[Symbol.asyncIterator]() {
        yield diskTextRow(0, false);
        yield sourcePending;
      },
    },
    invocation: captureProviderInvocation(
      createProviderRuntimeContext({
        settingsService: setup.settings,
        runtimeId: setup.runtime.state.runtimeId,
      }),
      setup.provider.name,
    ),
    systemInstruction: setup.generation.systemInstruction,
    tools,
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

async function run(
  root: string,
  mode: ToolHookMode,
): Promise<Record<string, unknown>> {
  mkdirSync(root, { recursive: true });
  const http = endpoint();
  const setup = await processorFixture(
    root,
    `http://127.0.0.1:${http.server.port}/v1`,
    false,
    1,
  );
  let hooks: SessionHookOwner | undefined;
  try {
    registerToolHook(setup.config, root, mode);
    hooks = new SessionHookOwner(
      readHookDefinitions(setup.config),
      hookSessionRuntime(
        setup.config,
        new WorkspaceTrustLifecycle({
          localTrust: setup.config.initialWorkspaceTrust,
        }),
        RootTelemetry.prepare({
          enabled: false,
          sessionId: setup.config.getSessionId(),
          maxBytes: 1024,
          maxFiles: 1,
        }),
      ),
      true,
      new MessageBus(),
    );
    if (mode === 'disabled') hooks.setDisabledHooks(['actual-tool-hook']);
    let error: string | undefined;
    const restrictions = [];
    let output = '';
    try {
      const stream = await setup.processor.makeApiCallAndProcessStream(
        {
          message: 'Answer',
          config: {
            tools: toolHookTools,
          },
          hookOwner: hooks.execution({
            sessionId: () => setup.config.getSessionId(),
            transcriptPath: () => undefined,
          }),
        },
        'actual-hook-worker',
        sourcePending,
      );
      for await (const chunk of stream) {
        restrictions.push(chunk.hookRestrictions);
        output += chunk.content.blocks
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('');
      }
    } catch (caught) {
      error = String(caught);
    }
    return {
      error,
      output,
      restrictions,
      bodies: http.bodies.map((text) => ({
        bytes: Buffer.byteLength(text),
        sha256: createHash('sha256').update(text).digest('hex'),
        text,
      })),
      estimate: setup.processor.getPromptEnvelopeEstimate(),
      oracle: await oracle(setup, mode),
      owners: setup.history.owners,
      registry: hooks.listHooks().map((hook) => ({
        enabled: hook.enabled,
        eventName: hook.eventName,
        config: { command: hook.name },
      })),
      activeBodies: activeRequestBodyCount(),
      ...observedHook(root),
    };
  } finally {
    setup.history.dispose();
    await hooks?.dispose();
    await http.server.stop(true);
    await setup.config.dispose();
  }
}

const [root, mode, , resultPath] = z
  .tuple([z.string(), toolHookMode, z.enum(['true', 'false']), z.string()])
  .parse(process.argv.slice(2));
writeFileSync(
  resultPath,
  JSON.stringify(await run(root, toolHookMode.parse(mode)), null, 2),
);
