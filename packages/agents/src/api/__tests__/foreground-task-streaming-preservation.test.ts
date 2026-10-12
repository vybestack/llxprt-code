/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createSessionSettingsFixture } from './helpers/session-settings-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';

import { describe, expect, it, spyOn } from 'bun:test';
import { SubagentOrchestrator } from '../../core/subagentOrchestrator.js';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ApprovalMode,
  fromConfig,
  toConfigParameters,
  type Agent,
} from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import type { LiveOutputUpdate } from '@vybestack/llxprt-code-tools';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { escapeShellArg } from '@vybestack/llxprt-code-core/utils/shell-utils.js';

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function chunk(content: string, finished = false): string {
  return `data: ${JSON.stringify({
    id: 'foreground-stream',
    object: 'chat.completion.chunk',
    model: 'child-model',
    choices: [
      { index: 0, delta: { content }, finish_reason: finished ? 'stop' : null },
    ],
  })}\n\n`;
}

function appendData(updates: readonly LiveOutputUpdate[]): string[] {
  return updates.flatMap((update) =>
    update.mode === 'append' ? [update.data] : [],
  );
}

async function waitForDescendant(path: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!existsSync(path)) {
    if (Date.now() > deadline)
      throw new Error('Task hook descendant was not admitted');
    await sleep(10);
  }
}

async function exercise(
  deltas: readonly string[],
  expected: string,
  withHooks = false,
  retirement?: 'cancel' | 'dispose',
  interactive = true,
): Promise<readonly string[]> {
  let statuses: readonly string[] = [];
  const directory = await mkdtemp(join(tmpdir(), 'foreground-task-streaming-'));
  const hookScript = join(directory, 'before-child-model.ts');
  const observed = gate();
  const entered = gate();
  const updates: LiveOutputUpdate[] = [];
  const handlers: Array<Promise<void>> = [];
  const errors: unknown[] = [];
  const requestedModels: string[] = [];
  const requestedBodies: string[] = [];
  const server = createServer((request, response) => {
    const work = (async (): Promise<void> => {
      const buffers: Buffer[] = [];
      for await (const part of request) buffers.push(Buffer.from(part));
      const body = z
        .object({ model: z.literal('child-model') })
        .passthrough()
        .parse(JSON.parse(Buffer.concat(buffers).toString('utf8')));
      requestedModels.push(body.model);
      requestedBodies.push(JSON.stringify(body));
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(chunk('LIVE: a complete streaming sentence. '));
      entered.release();
      await observed.promise;
      for (const delta of deltas) response.write(chunk(delta));
      response.end(chunk('', true) + 'data: [DONE]\n\n');
    })().catch((error: unknown) => {
      errors.push(error);
      response.destroy(error instanceof Error ? error : undefined);
    });
    handlers.push(work);
  });
  let config: Config | undefined;
  let mcp: McpRuntimeOwner | undefined;
  let agent: Agent | undefined;
  let channel: ReturnType<Agent['tools']['openClientChannel']> | undefined;
  let unsubscribe: (() => void) | undefined;
  const controller = new AbortController();
  const launchedSessionIds: string[] = [];
  let restoreLaunchObservation: (() => void) | undefined;
  let scheduling: Array<PromiseSettledResult<unknown>> | undefined;
  let acceptedScheduling:
    | Promise<Array<PromiseSettledResult<unknown>>>
    | undefined;
  try {
    if (withHooks)
      await writeFile(
        hookScript,
        `import { appendFileSync } from 'node:fs';
const input = JSON.parse(await Bun.stdin.text());
appendFileSync('hook-inputs.jsonl', JSON.stringify(input) + ${JSON.stringify('\n')});
${
  retirement === undefined
    ? ''
    : `const { spawn } = await import('node:child_process');
spawn(process.execPath, [${JSON.stringify(join(directory, 'hook-descendant.ts'))}], { stdio: 'inherit' });
await Bun.sleep(3000);
`
}
console.log(JSON.stringify({ hookSpecificOutput: { llm_request: { contents: [...input.llm_request.contents, { speaker: 'human', blocks: [{ type: 'text', text: 'physical child hook instruction' }] }] } } }));
`,
      );
    if (retirement !== undefined)
      await writeFile(
        join(directory, 'hook-descendant.ts'),
        `import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
writeFileSync('task-hook-child.pid', String(process.pid));
await Bun.sleep(1500);
writeFileSync('task-hook-late', 'privileged');
`,
      );
    if (withHooks) {
      const actualLaunch = SubagentOrchestrator.prototype.launch;
      const observation = spyOn(
        SubagentOrchestrator.prototype,
        'launch',
      ).mockImplementation(async function (
        this: SubagentOrchestrator,
        ...args: Parameters<SubagentOrchestrator['launch']>
      ) {
        const launched = await actualLaunch.apply(this, args);
        launchedSessionIds.push(
          launched.runtime.runtimeContext.state.sessionId,
        );
        return launched;
      });
      restoreLaunchObservation = () => observation.mockRestore();
    }
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing HTTP port');
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    const profiles = new ProfileManager(join(directory, 'profiles'));
    await profiles.saveProfile('stream-child', {
      version: 1,
      provider: 'openai',
      model: 'child-model',
      modelParams: {},
      ephemeralSettings: { 'auth-key': 'local-test-key', 'base-url': baseUrl },
    });
    const subagents = new SubagentManager(
      join(directory, 'subagents'),
      profiles,
    );
    await subagents.saveSubagent(
      'stream-child',
      'stream-child',
      'Return the requested text.',
    );
    const factories = createAgentRuntimeFactoryBindings();
    config = new Config({
      ...toConfigParameters({
        provider: 'openai',
        model: 'parent-model',
        workingDir: directory,
        approvalMode: ApprovalMode.YOLO,
        folderTrust: true,
        interactive,
        coreTools: ['task'],
        telemetry: { enabled: false },
        recording: { enabled: false },
      }),
      profileDirectory: join(directory, 'profiles'),
      subagentDirectory: join(directory, 'subagents'),
      sessionId: 'foreground-streaming-session',
      enableHooks: withHooks,
      hooks: withHooks
        ? {
            [HookEventName.BeforeModel]: [
              {
                hooks: [
                  {
                    type: HookType.Command,
                    command: `exec ${escapeShellArg(process.execPath, 'bash')} ${escapeShellArg(hookScript, 'bash')}`,
                  },
                ],
              },
            ],
          }
        : undefined,
    });
    mcp = await McpRuntimeOwner.create(createTestOAuthBinding(), config);
    agent = await fromConfig({
      ...createSessionSettingsFixture(config),
      runtimeFactoryBindings: factories,
      config,
      mcpRuntime: mcp,
      mcpOwnership: 'caller',
      activation: {
        provider: 'openai',
        model: 'parent-model',
        cliOverrides: { key: 'local-test-key', baseUrl },
      },
    });
    const completed = gate();
    let completedCalls: Parameters<
      NonNullable<Parameters<Agent['tools']['openClientChannel']>[0]>
    >[0] = [];
    channel = agent.tools.openClientChannel((calls) => {
      completedCalls = calls;
      statuses = calls.map((call) => call.status);
      completed.release();
    });
    unsubscribe = channel.subscribe({
      outputUpdateHandler: (_callId, update) => {
        updates.push(update);
        if (
          update.mode === 'append' &&
          update.data.includes('LIVE: a complete streaming sentence. ')
        )
          observed.release();
      },
    });
    await channel.ready;
    const scheduled = channel.schedule(
      {
        callId: 'foreground-task',
        name: 'task',
        args: {
          subagent_name: 'stream-child',
          goal_prompt: 'Return text.',
          async: false,
          timeout_seconds: 5,
        },
        isClientInitiated: true,
        prompt_id: 'foreground-stream',
      },
      controller.signal,
    );
    acceptedScheduling = Promise.allSettled([scheduled]);
    if (retirement !== undefined) {
      const pidFile = join(directory, 'task-hook-child.pid');
      await waitForDescendant(pidFile);
      const pid = Number(await readFile(pidFile, 'utf8'));
      if (retirement === 'dispose') await agent.dispose();
      else {
        controller.abort(new Error('public Task hook cancellation'));
        await channel.release();
      }
      scheduling = await acceptedScheduling;
      expect(pid).toBeGreaterThan(1);
      expect(() => process.kill(pid, 0)).toThrow(/ESRCH|No such process/);
      await sleep(1600);
      expect(existsSync(join(directory, 'task-hook-late'))).toBe(false);
      const inputs = (
        await readFile(join(directory, 'hook-inputs.jsonl'), 'utf8')
      )
        .trim()
        .split('\n')
        .map((line) =>
          z
            .object({
              session_id: z.string(),
              llm_request: z.object({ model: z.string() }),
            })
            .parse(JSON.parse(line)),
        );
      expect(inputs).toHaveLength(1);
      expect(inputs[0].llm_request.model).toBe('child-model');
      expect(launchedSessionIds).toStrictEqual([inputs[0].session_id]);
      expect(inputs[0].session_id).not.toBe(agent.getRuntimeId());
      expect(requestedModels).toStrictEqual([]);
      expect(scheduling).toStrictEqual([
        { status: 'fulfilled', value: undefined },
      ]);
      expect(completedCalls).toHaveLength(1);
      expect(completedCalls[0].status).toBe('cancelled');
    } else {
      await Promise.race([entered.promise, scheduled]);
      await scheduled;
      await completed.promise;
      const appended = appendData(updates);
      expect(completedCalls).toHaveLength(1);
      expect(completedCalls[0].status).toBe('success');
      const response = z
        .object({
          responseParts: z.tuple([
            z.object({
              type: z.literal('tool_response'),
              toolName: z.literal('task'),
              result: z.object({ output: z.string() }),
            }),
          ]),
        })
        .parse(completedCalls[0].response);
      expect(JSON.parse(response.responseParts[0].result.output)).toMatchObject(
        {
          terminate_reason: 'GOAL',
          emitted_vars: {},
          final_message: (
            'LIVE: a complete streaming sentence. ' + deltas.join('')
          ).trim(),
        },
      );
      expect(completedCalls[0].response.resultDisplay).toContain(
        `Final message:\n${('LIVE: a complete streaming sentence. ' + deltas.join('')).trim()}\n\nEmitted variables: _(none)_`,
      );
      expect(appended[0]).toMatch(
        /^<subagent name="stream-child" id="stream-child-[^"]+">\n$/,
      );
      expect(appended[appended.length - 1]).toBe(
        appended[0].replace('<subagent', '</subagent'),
      );
      expect(appended.slice(1, -1).join('')).toBe(
        `LIVE: a complete streaming sentence. ${expected}`,
      );
      expect(requestedModels).toStrictEqual(['child-model']);
      expect(
        requestedBodies.some((body) =>
          body.includes('physical child hook instruction'),
        ),
      ).toBe(withHooks);
      if (withHooks) {
        const records = (
          await readFile(join(directory, 'hook-inputs.jsonl'), 'utf8')
        )
          .trim()
          .split('\n')
          .map((line) =>
            z
              .object({
                cwd: z.string(),
                session_id: z.string(),
                llm_request: z.object({
                  model: z.string(),
                  version: z.literal(2),
                }),
              })
              .parse(JSON.parse(line)),
          );
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          cwd: directory,
          llm_request: { model: 'child-model', version: 2 },
        });
        expect(records[0].session_id).not.toBe('foreground-streaming-session');
        expect(launchedSessionIds).toStrictEqual([records[0].session_id]);
      }
      expect(agent.tasks.list()).toStrictEqual([]);
      const evidence = process.env['FOREGROUND_STREAM_EVIDENCE'];
      if (evidence)
        await writeFile(
          join(evidence, `${deltas.length}-${expected.length}.json`),
          JSON.stringify(
            { deltas, expected, updates, result: completedCalls[0].response },
            null,
            2,
          ),
        );
    }
  } catch (error) {
    errors.push(error);
  } finally {
    observed.release();
    controller.abort();
    unsubscribe?.();
    for (const cleanup of [
      async (): Promise<void> => channel?.release(),
      async (): Promise<void> => agent?.dispose(),
      async (): Promise<void> => {
        await acceptedScheduling;
      },
      async (): Promise<void> => mcp?.dispose(),
      async (): Promise<void> => config?.dispose(),
      async (): Promise<void> => {
        restoreLaunchObservation?.();
      },
      async (): Promise<void> => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await Promise.all(handlers);
      },
      async (): Promise<void> =>
        rm(directory, { recursive: true, force: true }),
    ])
      await cleanup().catch((error: unknown) => {
        errors.push(error);
      });
  }
  if (errors.length > 0)
    throw new AggregateError(
      errors,
      'Foreground streaming preservation failed',
    );
  return statuses;
}

describe('public Agent foreground TaskTool streaming preservation', () => {
  it.skipIf(process.platform === 'win32').each([
    { retirement: 'cancel', interactive: true },
    { retirement: 'dispose', interactive: true },
    { retirement: 'cancel', interactive: false },
    { retirement: 'dispose', interactive: false },
  ] satisfies Array<{
    retirement: 'cancel' | 'dispose';
    interactive: boolean;
  }>)(
    'joins the actual Task child hook process at the %j retirement boundary',
    async ({ retirement, interactive }) => {
      expect.hasAssertions();
      expect(
        await exercise([], '', true, retirement, interactive),
      ).toStrictEqual(['cancelled']);
    },
  );
  it('keeps standalone whitespace between empty wire deltas', async () => {
    expect.hasAssertions();
    await exercise(
      ['a', '', ' ', '', 'b', '\t', '', 'c', '\n', '', 'd'],
      'a b\tc\nd',
    );
  });
  it('normalizes a CRLF split across wire deltas to one LF', async () => {
    expect.hasAssertions();
    await exercise(['a\r', '\nb'], 'a\nb');
  });
  it('flushes a final lone CR', async () => {
    expect.hasAssertions();
    await exercise(['hello', '\r'], 'hello\n');
  });
  it('retains wrapper-looking model content literally', async () => {
    expect.hasAssertions();
    await exercise(
      [
        '<subagent name="not-wrapper">begin',
        '</subagent name="not-wrapper">end',
      ],
      '<subagent name="not-wrapper">begin</subagent name="not-wrapper">end',
    );
  });
  it('executes the inherited physical BeforeModel hook for the actual task child session', async () => {
    expect(await exercise(['owned-child'], 'owned-child', true)).toStrictEqual([
      'success',
    ]);
  });
});
