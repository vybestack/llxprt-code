/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4084: a subagent gets code mode from its own profile. The parent
 * launches it through the real `task` tool; the child talks to a local
 * OpenAI-compatible endpoint whose replies ask for scripts. The assertions
 * read what the child's model received and what the child display saw.
 */

import { afterEach, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ApprovalMode,
  toConfigParameters,
  type Agent,
} from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import { fromConfig } from '../api/fromConfig.js';
import {
  startScriptedEndpoint,
  stopReply,
  toolCallReply,
  type EndpointReply,
  type ScriptedEndpoint,
  type WireRequest,
} from '../api/__tests__/helpers/refusal-endpoint.js';
import { processesMatching, waitFor } from './__tests__/script-agent.js';
import { assertNoLiveWrappers } from './__tests__/runtime-test-helpers.js';

setDefaultTimeout(120_000);

const CHILD_MODEL = 'code-mode-child-model';

interface ChildScript {
  readonly source: string;
  readonly tools: readonly string[];
}

interface Harness {
  readonly agent: Agent;
  readonly endpoint: ScriptedEndpoint;
  readonly directory: string;
  /** Nested calls the child display saw: tool, agent ID, script run. */
  readonly nested: Array<{ tool: string; agentId: string | undefined }>;
  childRequests(): WireRequest[];
  runTask(
    goal: string,
    options?: {
      readonly whitelist?: readonly string[];
      readonly signal?: AbortSignal;
    },
  ): Promise<unknown>;
}

let harness: Harness | undefined;
let config: Config | undefined;

async function cleanUp(): Promise<void> {
  await harness?.agent.dispose();
  await config?.dispose();
  await harness?.endpoint.stop();
  if (harness !== undefined)
    await rm(harness.directory, { recursive: true, force: true });
  harness = undefined;
  config = undefined;
  assertNoLiveWrappers();
}

function lastMessage(request: WireRequest): string {
  return JSON.stringify(request.messages[request.messages.length - 1]);
}

/**
 * The child's model: the first request of a launch asks for the script the
 * goal names; once the script result is in, it answers with text.
 */
function childReplies(
  scripts: Readonly<Record<string, ChildScript>>,
): (request: WireRequest) => EndpointReply {
  return (request) => {
    if (request.model !== CHILD_MODEL) return stopReply('parent');
    const last = lastMessage(request);
    if (last.includes('"role":"tool"')) return stopReply('child done');
    const goal = Object.keys(scripts).find((name) => last.includes(name));
    if (goal === undefined) return stopReply('no script');
    return toolCallReply('execute_tool_script', {
      source: scripts[goal].source,
      tools: scripts[goal].tools,
      purpose: `child ${goal}`,
    });
  };
}

async function setUp(
  childSettings: Readonly<Record<string, unknown>>,
  scripts: (workspace: string) => Readonly<Record<string, ChildScript>>,
  interactive: boolean,
): Promise<Harness> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'code-mode-subagent-')),
  );
  await writeFile(join(directory, 'note.txt'), 'child-visible\n');
  const endpoint = await startScriptedEndpoint(
    childReplies(scripts(directory)),
  );
  const profiles = new ProfileManager(join(directory, 'profiles'));
  await profiles.saveProfile('cm-child', {
    version: 1,
    provider: 'openai',
    model: CHILD_MODEL,
    modelParams: {},
    ephemeralSettings: {
      'auth-key': 'local-test-key',
      'base-url': endpoint.url,
      ...childSettings,
    },
  });
  const subagents = new SubagentManager(join(directory, 'subagents'), profiles);
  await subagents.saveSubagent(
    'cm-child',
    'cm-child',
    'Gather what the goal asks for.',
  );
  config = new Config({
    ...toConfigParameters({
      provider: 'openai',
      model: 'code-mode-parent-model',
      workingDir: directory,
      approvalMode: ApprovalMode.YOLO,
      folderTrust: true,
      interactive,
      telemetry: { enabled: false },
      recording: { enabled: false },
    }),
    profileDirectory: join(directory, 'profiles'),
    subagentDirectory: join(directory, 'subagents'),
    sessionId: `code-mode-subagent-${interactive ? 'i' : 'n'}`,
  });
  const agent = await fromConfig(
    config,
    new SettingsService(),
    {
      activation: {
        provider: 'openai',
        model: 'code-mode-parent-model',
        cliOverrides: { key: 'local-test-key', baseUrl: endpoint.url },
      },
    },
    new CredentialAuthority(),
  );
  const nested: Harness['nested'] = [];
  agent.tools.subscribeChildTools({
    onToolCallsUpdate: (_id, calls) => {
      for (const call of calls)
        if (
          call.request.script !== undefined &&
          call.status === 'success' &&
          !nested.some((seen) => seen.tool === call.request.callId)
        )
          nested.push({
            tool: call.request.callId,
            agentId: call.request.agentId,
          });
    },
  });
  const task = agent.tools.get('task');
  if (task === undefined) throw new Error('task tool unavailable');
  return {
    agent,
    endpoint,
    directory,
    nested,
    childRequests: () =>
      endpoint.requests().filter((request) => request.model === CHILD_MODEL),
    runTask: (goal, options = {}) =>
      task.buildAndExecute(
        {
          subagent_name: 'cm-child',
          goal_prompt: goal,
          async: false,
          ...(options.whitelist === undefined
            ? {}
            : { tool_whitelist: [...options.whitelist] }),
        },
        options.signal ?? new AbortController().signal,
      ),
  };
}

function advertised(request: WireRequest | undefined): string[] {
  const tools = (request?.['tools'] ?? []) as ReadonlyArray<{
    function?: { name?: string };
  }>;
  return tools.map((tool) => tool.function?.name ?? '');
}

/** The script result the child's model received after `goal`'s script. */
function scriptResultFor(requests: WireRequest[], goal: string): string {
  const index = requests.findIndex((request) =>
    lastMessage(request).includes(goal),
  );
  return lastMessage(requests[index + 1]);
}

const READ_NOTE = (directory: string): ChildScript => ({
  source: `const r = await tools["read_file"]({ absolute_path: ${JSON.stringify(join(directory, 'note.txt'))} }); return r.ok ? r.value.text.trim() : r.error.code;`,
  tools: ['read_file'],
});

describe.each([
  ['non-interactive', false],
  ['interactive', true],
])('code mode in a subagent (%s child path)', (_label, interactive) => {
  afterEach(cleanUp);

  it('runs a script within the child whitelist, attributed to the child agent, and refuses tools outside it', async () => {
    harness = await setUp(
      {
        'code-mode': 'on',
        'tools.allowed': ['read_file', 'execute_tool_script'],
      },
      (workspace) => ({
        GOAL_READ: READ_NOTE(workspace),
        GOAL_GLOB: { source: 'return 1;', tools: ['glob'] },
        GOAL_TASK: { source: 'return 1;', tools: ['task'] },
      }),
      interactive,
    );
    await harness.runTask('GOAL_READ');
    await harness.runTask('GOAL_GLOB');
    await harness.runTask('GOAL_TASK');

    const requests = harness.childRequests();
    expect(advertised(requests[0])).toContain('execute_tool_script');
    expect(advertised(requests[0])).not.toContain('glob');
    expect(scriptResultFor(requests, 'GOAL_READ')).toContain('child-visible');
    expect(scriptResultFor(requests, 'GOAL_GLOB')).toContain(
      'TOOL_NOT_ADMITTED',
    );
    expect(scriptResultFor(requests, 'GOAL_TASK')).toContain(
      'TOOL_NOT_SCRIPTABLE',
    );
    expect(harness.nested).toHaveLength(1);
    expect(harness.nested[0].agentId).toMatch(/^cm-child-/);
  });
});

describe('code mode in a subagent (issue #4084)', () => {
  afterEach(cleanUp);

  it('leaves code mode off in a child whose profile does not enable it, even with the parent on', async () => {
    harness = await setUp({}, () => ({}), false);
    harness.agent.setEphemeralSetting('code-mode', 'on');
    await harness.runTask('GOAL_NONE');

    const requests = harness.childRequests();
    expect(requests.length).toBeGreaterThan(0);
    expect(advertised(requests[0])).toContain('read_file');
    expect(advertised(requests[0])).not.toContain('execute_tool_script');
    expect(advertised(requests[0])).not.toContain('discover_tool_api');
  });

  it('keeps an explicit empty task whitelist empty', async () => {
    harness = await setUp({ 'code-mode': 'on' }, () => ({}), false);
    await harness.runTask('GOAL_NONE', { whitelist: [] });

    const requests = harness.childRequests();
    expect(requests.length).toBeGreaterThan(0);
    expect(advertised(requests[0])).toStrictEqual([]);
  });

  it('cannot raise the caller limits: a child asking for more calls gets the caller ceiling', async () => {
    harness = await setUp(
      { 'code-mode': 'on', 'code-mode-max-calls': 50 },
      (workspace) => ({
        GOAL_MANY: {
          source: `for (let i = 0; i < 3; i++) await tools["read_file"]({ absolute_path: ${JSON.stringify(join(workspace, 'note.txt'))} }); return "all";`,
          tools: ['read_file'],
        },
      }),
      false,
    );
    harness.agent.setEphemeralSetting('code-mode-max-calls', 2);
    await harness.runTask('GOAL_MANY');

    expect(scriptResultFor(harness.childRequests(), 'GOAL_MANY')).toContain(
      'CALL_LIMIT',
    );
  });

  it('cancels a running child script when the parent aborts the task', async () => {
    // A command line no other process on the machine carries.
    const sleep = `sleep 31.${Date.now() % 100000}`;
    harness = await setUp(
      { 'code-mode': 'on' },
      () => ({
        GOAL_SLEEP: {
          source: `await tools["run_shell_command"]({ command: ${JSON.stringify(sleep)} }); return 1;`,
          tools: ['run_shell_command'],
        },
      }),
      false,
    );
    const controller = new AbortController();
    const running = harness.runTask('GOAL_SLEEP', {
      signal: controller.signal,
    });
    await waitFor(
      () => processesMatching(sleep).length > 0,
      'the nested sleep command',
    );
    controller.abort();
    await running.catch(() => undefined);

    await waitFor(
      () => processesMatching(sleep).length === 0,
      'the nested sleep command to end',
    );
    expect(processesMatching(sleep)).toStrictEqual([]);
  });
});
