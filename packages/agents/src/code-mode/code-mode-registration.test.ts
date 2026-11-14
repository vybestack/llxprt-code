/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4084: the `code-mode` setting decides whether a session lists and
 * advertises the code mode tools, and `/set` (the agent's ephemeral setting
 * write) applies to the next model request. A real public Agent talks to a
 * local OpenAI-compatible endpoint, so the assertions read the tool
 * declarations the provider actually received.
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
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  startScriptedEndpoint,
  stopReply,
  toolCallReply,
  type EndpointReply,
  type ScriptedEndpoint,
  type WireRequest,
} from '../api/__tests__/helpers/refusal-endpoint.js';
import { assertNoLiveWrappers } from './__tests__/runtime-test-helpers.js';

setDefaultTimeout(90_000);

const CODE_MODE_TOOLS = ['discover_tool_api', 'execute_tool_script'];

function advertised(request: WireRequest | undefined): string[] {
  const tools = (request?.['tools'] ?? []) as ReadonlyArray<{
    function?: { name?: string };
  }>;
  return tools.map((tool) => tool.function?.name ?? '').sort();
}

function codeModeToolsIn(request: WireRequest | undefined): string[] {
  return advertised(request).filter((name) => CODE_MODE_TOOLS.includes(name));
}

function listed(agent: Agent): string[] {
  return agent.tools
    .list()
    .map((tool) => tool.name)
    .filter((name) => CODE_MODE_TOOLS.includes(name))
    .sort();
}

describe('code mode setting (issue #4084)', () => {
  let workingDir: string;
  let endpoint: ScriptedEndpoint | undefined;
  let agent: Agent | undefined;
  let configHome: string;
  const previousConfigHome = process.env.LLXPRT_CONFIG_HOME;

  // Profiles are saved under the config home; one home for the file keeps
  // the prompt files the first agent installs there for the later ones.
  beforeAll(() => {
    configHome = realpathSync(mkdtempSync(join(tmpdir(), 'cm-home-')));
    process.env.LLXPRT_CONFIG_HOME = configHome;
  });

  afterAll(() => {
    if (previousConfigHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousConfigHome;
    rmSync(configHome, { recursive: true, force: true });
  });

  beforeEach(() => {
    workingDir = realpathSync(mkdtempSync(join(tmpdir(), 'cm-set-')));
  });

  afterEach(async () => {
    await agent?.dispose();
    agent = undefined;
    await endpoint?.stop();
    endpoint = undefined;
    rmSync(workingDir, { recursive: true, force: true });
    assertNoLiveWrappers();
  });

  async function start(
    replies: readonly EndpointReply[],
    settings: Readonly<Record<string, unknown>> = {},
  ): Promise<Agent> {
    endpoint = await startScriptedEndpoint(replies);
    agent = await createAgent({
      provider: 'openai',
      model: 'scripted-model',
      workingDir,
      approvalMode: ApprovalMode.YOLO,
      auth: { apiKey: 'local-test-key', baseUrl: endpoint.url },
    });
    for (const [key, value] of Object.entries({
      'refusal.retries': 0,
      'refusal.rewrite': false,
      ...settings,
    }))
      agent.setEphemeralSetting(key, value);
    return agent;
  }

  async function prompt(target: Agent, text: string): Promise<void> {
    for await (const _event of target.stream(text)) {
      // drain
    }
  }

  it('lists and advertises neither tool by default', async () => {
    const session = await start([stopReply('hello')]);
    await prompt(session, 'hi');

    const requests = endpoint?.requests() ?? [];
    expect(requests).toHaveLength(1);
    expect(advertised(requests[0])).toContain('read_file');
    expect(codeModeToolsIn(requests[0])).toStrictEqual([]);
    expect(listed(session)).toStrictEqual([]);
    expect(session.getEphemeralSetting('code-mode')).toBeUndefined();
  });

  it('advertises both tools on the next request after /set code-mode on, and drops them after off', async () => {
    const session = await start([
      stopReply('one'),
      stopReply('two'),
      stopReply('three'),
    ]);
    await prompt(session, 'first');
    session.setEphemeralSetting('code-mode', 'on');
    expect(listed(session)).toStrictEqual(CODE_MODE_TOOLS);
    await prompt(session, 'second');
    session.setEphemeralSetting('code-mode', 'off');
    await prompt(session, 'third');

    const requests = endpoint?.requests() ?? [];
    expect(requests.map(codeModeToolsIn)).toStrictEqual([
      [],
      CODE_MODE_TOOLS,
      [],
    ]);
    expect(listed(session)).toStrictEqual([]);
  });

  it('runs a script the model asks for once /set has turned code mode on', async () => {
    writeFileSync(join(workingDir, 'a.txt'), 'alpha\n');
    const session = await start([
      toolCallReply('execute_tool_script', {
        source:
          'const r = await tools["read_file"]({ absolute_path: ' +
          JSON.stringify(join(workingDir, 'a.txt')) +
          ' }); return r.ok ? r.value.text.trim() : r.error.code;',
        tools: ['read_file'],
        purpose: 'read one file',
      }),
      stopReply('done'),
    ]);
    session.setEphemeralSetting('code-mode', 'on');
    await prompt(session, 'read it');

    const requests = endpoint?.requests() ?? [];
    expect(requests).toHaveLength(2);
    const followUp = JSON.stringify(requests[1]?.messages);
    expect(followUp).toContain('\\"ok\\":true');
    expect(followUp).toContain('alpha');
  });

  it('keeps the settings out of the provider request and saves them into the profile', async () => {
    const session = await start([stopReply('hello')], {
      'code-mode': 'on',
      'code-mode-max-calls': 12,
    });
    await prompt(session, 'hi');

    const profile = session.captureProfile();
    expect(profile.ephemeralSettings).toMatchObject({
      'code-mode': 'on',
      'code-mode-max-calls': 12,
    });
    expect(JSON.stringify(profile.modelParams)).not.toContain('code-mode');
    for (const request of endpoint?.requests() ?? []) {
      const keys = Object.keys(request);
      expect(keys.filter((key) => key.startsWith('code-mode'))).toStrictEqual(
        [],
      );
      expect(JSON.stringify(request)).not.toContain('code-mode-max-calls');
    }
  });

  it('turns code mode on when a profile that opts in is applied', async () => {
    const session = await start([stopReply('one'), stopReply('two')]);
    await prompt(session, 'before');
    const current = session.captureProfile();
    await session.profiles.applySnapshot({
      ...current,
      ephemeralSettings: { ...current.ephemeralSettings, 'code-mode': 'on' },
    });
    await prompt(session, 'after');

    const requests = endpoint?.requests() ?? [];
    expect(session.getEphemeralSetting('code-mode')).toBe('on');
    expect(listed(session)).toStrictEqual(CODE_MODE_TOOLS);
    expect(requests.map(codeModeToolsIn)).toStrictEqual([[], CODE_MODE_TOOLS]);
  });

  it('advertises only the code mode and direct control tools with the compact surface, while scripts still call the hidden tools', async () => {
    writeFileSync(join(workingDir, 'b.txt'), 'bravo\n');
    const session = await start(
      [
        toolCallReply('execute_tool_script', {
          source:
            'const r = await tools["read_file"]({ absolute_path: ' +
            JSON.stringify(join(workingDir, 'b.txt')) +
            ' }); return r.ok ? r.value.text.trim() : r.error.code;',
          tools: ['read_file'],
          purpose: 'read a hidden tool',
        }),
        stopReply('done'),
      ],
      { 'code-mode': 'on', 'code-mode-tool-surface': 'compact' },
    );
    await prompt(session, 'read it');

    const requests = endpoint?.requests() ?? [];
    const offered = advertised(requests[0]);
    expect(offered).toContain('execute_tool_script');
    expect(offered).toContain('discover_tool_api');
    expect(offered).toContain('todo_write');
    expect(offered).toContain('task');
    expect(offered).toContain('write_file');
    expect(offered).toContain('replace');
    for (const hidden of [
      'read_file',
      'glob',
      'search_file_content',
      'run_shell_command',
      'list_directory',
    ])
      expect(offered).not.toContain(hidden);
    expect(session.tools.list().map((tool) => tool.name)).toContain(
      'read_file',
    );
    const followUp = JSON.stringify(requests[1]?.messages);
    expect(followUp).toContain('\\"ok\\":true');
    expect(followUp).toContain('bravo');
    expect(advertised(requests[1])).toStrictEqual(offered);
  });

  it('switches between compact and alongside on the next request', async () => {
    const session = await start([stopReply('one'), stopReply('two')], {
      'code-mode': 'on',
      'code-mode-tool-surface': 'compact',
    });
    await prompt(session, 'first');
    session.setEphemeralSetting('code-mode-tool-surface', 'alongside');
    await prompt(session, 'second');

    const requests = endpoint?.requests() ?? [];
    expect(advertised(requests[0])).not.toContain('read_file');
    expect(advertised(requests[1])).toContain('read_file');
    expect(codeModeToolsIn(requests[1])).toStrictEqual(CODE_MODE_TOOLS);
  });

  it('fails a script with a clear message when a profile carries an invalid limit', async () => {
    const session = await start(
      [
        toolCallReply('execute_tool_script', {
          source: 'return 1;',
          tools: ['glob'],
          purpose: 'invalid limit',
        }),
        stopReply('done'),
      ],
      { 'code-mode': 'on', 'code-mode-max-calls': 0 },
    );
    await prompt(session, 'go');

    const followUp = JSON.stringify(endpoint?.requests()[1]?.messages);
    expect(followUp).toContain(
      'Invalid code mode setting: code-mode-max-calls must be a whole number of calls from 1 to 10000',
    );
  });
});
