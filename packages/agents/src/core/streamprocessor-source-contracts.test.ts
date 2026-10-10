/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import {
  escapeShellArg,
  getShellConfiguration,
} from '@vybestack/llxprt-code-core/utils/shell-utils.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import { projectionEndpoint } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/projection-ownership-fixture.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  processorFixture,
  sourcePending,
  sourceWireOracle,
} from './__tests__/support/streamprocessor-source-fixture.js';
import { TokenUsageLogger } from './TokenUsageLogger.js';
import { toolHookWorker } from './__tests__/support/streamprocessor-tool-hook-fixture.js';
import { modelHookWorker } from './__tests__/support/streamprocessor-model-hook-fixture.js';

const root = sourceRootSetup();
function hook(
  config: Config,
  event: HookEventName,
  path: string,
  action = '',
): void {
  const script = `(async()=>{let data='';for await(const chunk of process.stdin)data+=chunk;const input=JSON.parse(data);require('node:fs').writeFileSync(${JSON.stringify(path)},JSON.stringify(input));${action}})();`;
  const hooks = config.getHooks();
  if (hooks === undefined) throw new Error('Missing test hook config');
  hooks[event] = [
    {
      hooks: [
        {
          type: HookType.Command,
          command: `exec node -e ${escapeShellArg(script, getShellConfiguration().shell)}`,
        },
      ],
    },
  ];
}
function unblock(http: ReturnType<typeof projectionEndpoint>): void {
  http.readBody.release();
  http.respond.release();
}
async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) {
    /* Complete the actual history lifecycle. */
  }
}
async function dispose(
  setup: Awaited<ReturnType<typeof processorFixture>>,
  http: ReturnType<typeof projectionEndpoint>,
): Promise<void> {
  setup.history.dispose();
  await http.server.stop(true);
  await setup.config.dispose();
}

describe('source tool-selection hook failures', () => {
  it('sends without restriction when the tool-selection hook command fails', async () => {
    const http = projectionEndpoint(false);
    unblock(http);
    const setup = await processorFixture(
      root(),
      `http://127.0.0.1:${http.server.port}/v1`,
      false,
      1,
    );
    const hooks = setup.config.getHooks();
    if (hooks === undefined) throw new Error('Missing hooks');
    hooks[HookEventName.BeforeToolSelection] = [
      { hooks: [{ type: HookType.Command, command: 'exit 1' }] },
    ];
    try {
      await drain(
        await setup.processor.makeApiCallAndProcessStream(
          {
            message: 'Answer',
            config: {},
          },
          'failing-tool-hook',
          sourcePending,
        ),
      );
      expect(http.bodies).toHaveLength(1);
      expect(setup.history.owners.every((owner) => owner.closed)).toBe(true);
    } finally {
      await dispose(setup, http);
    }
  }, 60000);
});

describe('actual StreamProcessor source contract safety', () => {
  it('executes an enabled BeforeModel with full disk history and no eager fallback', async () => {
    const source = await modelHookWorker(root(), 'edit');
    expect(source.error).toBeUndefined();
    expect(source.hooks[0]).toMatchObject({
      input: {
        hook_event_name: 'BeforeModel',
        llm_request: { contents: [{ speaker: 'human' }, { speaker: 'human' }] },
      },
    });
    expect(source.estimate).toStrictEqual(source.oracle);
    expect(source.firstLive).toBe(0);
    expect(source.lastLive).toBe(0);
    expect(source.boundary).toMatchObject({ first: 0, last: 0, closed: 1 });
    expect(source.bodies).toHaveLength(1);
  }, 60000);
  it('executes an enabled AfterModel against the pinned request rows', async () => {
    const http = projectionEndpoint(false);
    unblock(http);
    const setup = await processorFixture(
      root(),
      `http://127.0.0.1:${http.server.port}/v1`,
      false,
      1,
    );
    const observed = join(root(), 'after-model-input.json');
    hook(setup.config, HookEventName.AfterModel, observed);
    try {
      await drain(
        await setup.processor.makeApiCallAndProcessStream(
          {
            message: 'Answer',
            config: {},
          },
          'after-model',
          sourcePending,
        ),
      );
      expect(JSON.parse(readFileSync(observed, 'utf8'))).toMatchObject({
        hook_event_name: 'AfterModel',
        llm_request: { contents: [{ speaker: 'human' }, { speaker: 'human' }] },
      });
      expect(http.bodies).toHaveLength(1);
      expect(setup.history.owners.every((owner) => owner.closed)).toBe(true);
    } finally {
      await dispose(setup, http);
    }
  }, 60000);
});

describe('actual source tool-selection hook', () => {
  it('executes the real tool-selection hook and preserves its neutral restriction at HTTP', async () => {
    const result = await toolHookWorker(root(), 'none');
    expect(result.error).toBeUndefined();
    expect(result.hookInput).toMatchObject({
      llm_request: {
        model: 'gpt-5.6',
        contents: [],
        tools: [{ name: 'weather' }, { name: 'calendar' }],
      },
    });
    expect(result.restrictions.length).toBeGreaterThan(0);
    expect(
      result.restrictions.every(
        (value) => JSON.stringify(value) === '{"allowedToolNames":[]}',
      ),
    ).toBe(true);
    expect(result.bodies).toHaveLength(1);
    expect(result.owners.every((owner) => owner.closed)).toBe(true);
    expect(result.estimate).toStrictEqual(result.oracle);
    expect(result.activeBodies).toBe(0);
  }, 60000);
});

describe('actual source runtime-disabled hook', () => {
  it('allows a registered but runtime-disabled model hook without invoking it', async () => {
    const http = projectionEndpoint(false);
    unblock(http);
    const setup = await processorFixture(
      root(),
      `http://127.0.0.1:${http.server.port}/v1`,
      false,
      1,
    );
    const observed = join(root(), 'disabled-hook.json');
    hook(setup.config, HookEventName.BeforeModel, observed);
    const system = setup.config.getHookSystem();
    if (system === undefined) throw new Error('Missing actual hook system');
    await system.initialize();
    for (const entry of system.getAllHooks()) {
      system
        .getRegistry()
        .setHookEnabled(entry.config.name ?? entry.config.command, false);
    }
    try {
      const stream = await setup.processor.makeApiCallAndProcessStream(
        {
          message: 'Answer',
          config: {},
        },
        'disabled-model-hook',
        sourcePending,
      );
      for await (const _chunk of stream) {
        /* Complete the actual history lifecycle. */
      }
      expect(existsSync(observed)).toBe(false);
      expect(http.bodies).toHaveLength(1);
    } finally {
      await dispose(setup, http);
    }
  }, 60000);
});

describe('actual source response ownership', () => {
  it.each(['return', 'abort'] as const)(
    'closes the disk owner and progressive body after actual response %s',
    async (mode) => {
      const http = projectionEndpoint(false);
      unblock(http);
      const setup = await processorFixture(
        root(),
        `http://127.0.0.1:${http.server.port}/v1`,
        false,
        1,
      );
      const controller = new AbortController();
      try {
        const stream = await setup.processor.makeApiCallAndProcessStream(
          {
            message: 'Answer',
            config: {
              abortSignal: controller.signal,
            },
          },
          'response-close',
          sourcePending,
        );
        expect((await stream.next()).done).toBe(false);
        if (mode === 'abort') controller.abort(new Error('source abort'));
        await stream.return(undefined);
        expect(setup.history.owners.every((owner) => owner.closed)).toBe(true);
        expect(activeRequestBodyCount()).toBe(0);
      } finally {
        await dispose(setup, http);
      }
    },
    60000,
  );
});

describe('actual source token-usage contract', () => {
  it('sends with token-usage shape logging enabled', async () => {
    const http = projectionEndpoint(false);
    unblock(http);
    const setup = await processorFixture(
      root(),
      `http://127.0.0.1:${http.server.port}/v1`,
      false,
      1,
    );
    setup.compression.tokenUsageLogger = new TokenUsageLogger(
      true,
      join(root(), 'token-usage.jsonl'),
    );
    try {
      await drain(
        await setup.processor.makeApiCallAndProcessStream(
          {
            message: 'Answer',
            config: {},
          },
          'usage-log',
          sourcePending,
        ),
      );
      expect(http.bodies).toHaveLength(1);
      expect(setup.history.owners.every((owner) => owner.closed)).toBe(true);
    } finally {
      await dispose(setup, http);
    }
  }, 60000);
});

if (process.env.ISSUE854_STREAM_FULL_CONTRACTS === '1') {
  describe('remaining full StreamProcessor source acceptance', () => {
    it('executes BeforeModel replacement with full history visible through real HTTP', async () => {
      const http = projectionEndpoint(false);
      unblock(http);
      const setup = await processorFixture(
        root(),
        `http://127.0.0.1:${http.server.port}/v1`,
      );
      const observed = join(root(), 'required-before.json');
      hook(
        setup.config,
        HookEventName.BeforeModel,
        observed,
        `input.llm_request.contents.at(-1).blocks[0].text=input.llm_request.contents.at(-1).blocks[0].text.toUpperCase();console.log(JSON.stringify({hookSpecificOutput:{llm_request:input.llm_request}}));`,
      );
      try {
        const stream = await setup.processor.makeApiCallAndProcessStream(
          {
            message: 'Answer',
            config: {},
          },
          'required-before',
          sourcePending,
        );
        for await (const _chunk of stream) {
          /* Drain the provider. */
        }
        expect(JSON.parse(readFileSync(observed, 'utf8'))).toMatchObject({
          llm_request: {
            contents: expect.arrayContaining([
              expect.objectContaining({ speaker: 'ai' }),
            ]),
          },
        });
        expect(http.bodies).toStrictEqual([
          sourceWireOracle(false, {
            speaker: 'human',
            blocks: sourcePending.blocks.map((block) =>
              block.type === 'text'
                ? { ...block, text: block.text.toUpperCase() }
                : block,
            ),
          }),
        ]);
      } finally {
        await dispose(setup, http);
      }
    }, 60000);
  });
  describe('required disk source full-context logging', () => {
    it('sends with full-context telemetry logging enabled and no retained history owners', async () => {
      const http = projectionEndpoint(false);
      unblock(http);
      const setup = await processorFixture(
        root(),
        `http://127.0.0.1:${http.server.port}/v1`,
      );
      setup.config.updateTelemetrySettings({ enabled: true, logPrompts: true });
      try {
        const stream = await setup.processor.makeApiCallAndProcessStream(
          {
            message: 'Answer',
            config: {},
          },
          'required-logs',
          sourcePending,
        );
        for await (const _chunk of stream) {
          /* Drain the provider. */
        }
        expect(http.bodies).toHaveLength(1);
        expect(setup.requests.map((event) => event.promptId)).toStrictEqual([
          'required-logs',
        ]);
      } finally {
        await dispose(setup, http);
      }
    }, 60000);
    it('performs the existing compression escalation and reports its overflow error', async () => {
      const http = projectionEndpoint(false);
      unblock(http);
      const setup = await processorFixture(
        root(),
        `http://127.0.0.1:${http.server.port}/v1`,
      );
      setup.settings.set('context-limit', 4000);
      try {
        await expect(
          setup.processor.makeApiCallAndProcessStream(
            {
              message: 'Answer',
              config: {},
            },
            'required-compression',
            sourcePending,
          ),
        ).rejects.toThrow(
          'Request still exceeds the safety-adjusted context limit',
        );
      } finally {
        await dispose(setup, http);
      }
    }, 60000);
  });
}
