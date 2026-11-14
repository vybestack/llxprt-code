/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4084: the `execute_tool_script` response reaches the model as one
 * whole JSON envelope. A result over the code mode byte limit or over the
 * call's tool output token budget becomes a named RESULT_TOO_LARGE envelope
 * with its completed-call accounting, never the ordinary token-limit guidance
 * or a clipped string. A real public Agent talks to a local OpenAI-compatible
 * endpoint, so the assertions read the tool message the provider received.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalMode, createAgent } from '@vybestack/llxprt-code-agents';
import type { Agent, AgentConfig } from '@vybestack/llxprt-code-agents';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { physicalHookCommand } from '../api/__tests__/helpers/physicalHookCommand.js';
import {
  startScriptedEndpoint,
  stopReply,
  toolCallReply,
  type ScriptedEndpoint,
} from '../api/__tests__/helpers/refusal-endpoint.js';
import { assertNoLiveWrappers } from './__tests__/runtime-test-helpers.js';

setDefaultTimeout(90_000);

/** 800 short records: about 3,200 tokens and 11,000 bytes of JSON. */
const RECORDS_SCRIPT = {
  source:
    'const found = await tools["glob"]({ pattern: "*.txt" }); if (!found.ok) throw new Error(found.error.message); return Array.from({ length: 800 }, (_, i) => "record_" + i);',
  tools: ['glob'],
  purpose: 'return many records',
};

interface Envelope {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
  readonly callCount: number;
  readonly partial: boolean;
  readonly completedCalls: ReadonlyArray<{ tool: string; status: string }>;
  readonly logs: readonly string[];
}

describe('execute_tool_script response size (issue #4084)', () => {
  let workingDir: string;
  let endpoint: ScriptedEndpoint | undefined;
  let agent: Agent | undefined;
  let configHome: string;
  const previousConfigHome = process.env.LLXPRT_CONFIG_HOME;

  beforeAll(() => {
    configHome = realpathSync(mkdtempSync(join(tmpdir(), 'cm-budget-home-')));
    process.env.LLXPRT_CONFIG_HOME = configHome;
  });

  afterAll(() => {
    if (previousConfigHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousConfigHome;
    rmSync(configHome, { recursive: true, force: true });
  });

  beforeEach(() => {
    workingDir = realpathSync(mkdtempSync(join(tmpdir(), 'cm-budget-')));
    writeFileSync(join(workingDir, 'a.txt'), 'alpha\n');
  });

  afterEach(async () => {
    await agent?.dispose();
    agent = undefined;
    await endpoint?.stop();
    endpoint = undefined;
    rmSync(workingDir, { recursive: true, force: true });
    assertNoLiveWrappers();
  });

  /** Runs the script and returns the tool message the provider received. */
  async function scriptToolMessage(
    settings: Readonly<Record<string, unknown>>,
    config: Partial<AgentConfig> = {},
  ): Promise<string> {
    endpoint = await startScriptedEndpoint([
      toolCallReply('execute_tool_script', RECORDS_SCRIPT),
      stopReply('done'),
    ]);
    agent = await createAgent({
      provider: 'openai',
      model: 'scripted-model',
      workingDir,
      approvalMode: ApprovalMode.YOLO,
      auth: { apiKey: 'local-test-key', baseUrl: endpoint.url },
      ...config,
    });
    for (const [key, value] of Object.entries({
      'refusal.retries': 0,
      'refusal.rewrite': false,
      'code-mode': 'on',
      ...settings,
    }))
      agent.setEphemeralSetting(key, value);
    for await (const _event of agent.stream('gather the records')) {
      // drain
    }
    const requests = endpoint.requests();
    expect(requests).toHaveLength(2);
    const toolMessages = requests[1].messages.filter(
      (message) => message.role === 'tool',
    );
    expect(toolMessages).toHaveLength(1);
    return String(toolMessages[0].content);
  }

  /** The whole `output:` section of the tool message, parsed strictly. */
  function envelopeOf(toolMessage: string): Envelope {
    const marker = '\noutput:\n';
    const start = toolMessage.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    return JSON.parse(toolMessage.slice(start + marker.length)) as Envelope;
  }

  it('delivers a result within the budget as the whole JSON envelope', async () => {
    const envelope = envelopeOf(await scriptToolMessage({}));

    expect(envelope.ok).toBe(true);
    expect(envelope.value).toHaveLength(800);
    expect(envelope.completedCalls).toStrictEqual([
      { tool: 'glob', status: 'ok' },
    ]);
  });

  for (const mode of ['warn', 'truncate', 'sample']) {
    it(`returns an intact RESULT_TOO_LARGE envelope when the result is over a lower token budget (${mode} mode)`, async () => {
      const message = await scriptToolMessage({
        'tool-output-max-tokens': 1000,
        'tool-output-truncate-mode': mode,
      });
      const envelope = envelopeOf(message);

      expect(message).not.toContain('exceeded token limit');
      expect(message).not.toContain('truncated');
      expect(envelope.ok).toBe(false);
      expect(envelope.error?.code).toBe('RESULT_TOO_LARGE');
      expect(envelope.error?.message).toContain('token');
      expect(envelope.callCount).toBe(1);
      expect(envelope.completedCalls).toStrictEqual([
        { tool: 'glob', status: 'ok' },
      ]);
    });
  }

  it('returns an intact RESULT_TOO_LARGE envelope when the result is over code-mode-max-result-bytes', async () => {
    const envelope = envelopeOf(
      await scriptToolMessage({ 'code-mode-max-result-bytes': 1000 }),
    );

    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('RESULT_TOO_LARGE');
    expect(envelope.error?.message).toContain('1000 bytes');
    expect(envelope.completedCalls).toStrictEqual([
      { tool: 'glob', status: 'ok' },
    ]);
  });

  it('limits the response in history like any tool output once an AfterTool hook extends it', async () => {
    const hook = join(workingDir, 'after-hook.ts');
    writeFileSync(
      hook,
      `process.stdout.write(JSON.stringify({ systemMessage: "hook note ".repeat(800) }));\n`,
    );
    await scriptToolMessage(
      { 'tool-output-max-tokens': 1000, 'tool-output-truncate-mode': 'warn' },
      {
        settings: { enableHooks: true },
        hooks: {
          [HookEventName.AfterTool]: [
            {
              matcher: 'execute_tool_script',
              hooks: [
                { type: HookType.Command, command: physicalHookCommand(hook) },
              ],
            },
          ],
        },
      },
    );

    const history = (await agent?.getHistory()) ?? [];
    const responses = history.flatMap((content) =>
      content.blocks.filter((block) => block.type === 'tool_response'),
    );
    expect(responses).toHaveLength(1);
    expect(JSON.stringify(responses[0].result)).toContain(
      'execute_tool_script output exceeded token limit',
    );
  });
});
