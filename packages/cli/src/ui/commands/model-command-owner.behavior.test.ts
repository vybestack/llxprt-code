/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { createSessionModelCommand } from '../../runtime/session-model-command.js';
import { createModelCommand } from './modelCommand.js';
import type { SlashCommand } from './types.js';

describe('registered model command ownership', () => {
  const credentials = useOwnedCredentials();
  let root: string;
  let previousResponses: string | undefined;
  let previousPrompts: string | undefined;
  let prompts: string;
  const agents: Agent[] = [];

  beforeAll(async () => {
    previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
    prompts = await mkdtemp(join(tmpdir(), 'model-command-prompts-'));
    await mkdir(join(prompts, 'core'), { recursive: true });
    await writeFile(
      join(prompts, 'core', 'default.md'),
      'Test model-selection system prompt.',
    );
    process.env.LLXPRT_PROMPTS_DIR = prompts;
  });

  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(prompts, { recursive: true, force: true });
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'model-command-owner-'));
    previousResponses = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../../agents/src/api/__tests__/fixtures/multi-turn-text.jsonl',
        import.meta.url,
      ),
    );
  });

  afterEach(async () => {
    try {
      await Promise.all(agents.splice(0).map((agent) => agent.dispose()));
    } finally {
      if (previousResponses === undefined)
        delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previousResponses;
      await rm(root, { recursive: true, force: true });
    }
  });

  async function owner(label: string): Promise<Agent> {
    const workingDir = join(root, label);
    await mkdir(workingDir);
    const agent = await createAgent({
      credentialAuthority: credentials().authority,
      provider: 'fake',
      model: `${label}-initial`,
      workingDir,
      sessionId: 'same-model-command-label',
      harness: {
        forceInteractive: false,
        forceConfirmations: false,
        includeProcessCwd: false,
      },
      mcpEnabled: false,
      lsp: false,
    });
    agents.push(agent);
    return agent;
  }

  function loader(agent: Agent): BuiltinCommandLoader {
    return new BuiltinCommandLoader(
      createModelCommand(createSessionModelCommand(agent), (provider, model) =>
        agent.session.recordRecordingEvent({
          type: 'provider_switch',
          provider,
          model,
        }),
      ),
      null,
      'agent',
    );
  }

  async function registered(agent: Agent): Promise<SlashCommand> {
    const registry = await CommandService.create(
      [loader(agent)],
      new AbortController().signal,
    );
    const command = registry
      .getCommands()
      .find((item) => item.name === 'model');
    if (!command?.action)
      throw new Error('Registered model command is unavailable');
    return command;
  }

  async function execute(
    command: SlashCommand,
    args: string,
    decoy: Agent,
  ): Promise<unknown> {
    if (!command.action) throw new Error('Model action is unavailable');
    return command.action(
      createMockCommandContext({ services: { agent: decoy } }),
      args,
    );
  }

  it('keeps selection and recording with the registered owners despite different invocation owners', async () => {
    const left = await owner('left');
    const right = await owner('right');
    const leftCommand = await registered(left);
    const rightCommand = await registered(right);
    const initialReplies = await Promise.all([
      left.chat('materialize the left recording', { mcpDiscovery: 'skip' }),
      right.chat('materialize the right recording', { mcpDiscovery: 'skip' }),
    ]);
    expect(initialReplies.map((reply) => reply.text)).toStrictEqual([
      'turn one reply',
      'turn one reply',
    ]);
    await Promise.all([
      left.session.setRecording({ enabled: true }),
      right.session.setRecording({ enabled: true }),
    ]);
    const [leftResult, rightResult] = await Promise.all([
      execute(leftCommand, 'left-selected', right),
      execute(rightCommand, 'right-selected', left),
    ]);
    expect(leftResult).toMatchObject({
      type: 'message',
      messageType: 'info',
      content: "Switched from left-initial to left-selected in provider 'fake'",
    });
    expect(rightResult).toMatchObject({
      type: 'message',
      messageType: 'info',
      content:
        "Switched from right-initial to right-selected in provider 'fake'",
    });
    expect(left.getModel()).toBe('left-selected');
    expect(right.getModel()).toBe('right-selected');
    const leftPath = left.session.getRecording().path;
    const rightPath = right.session.getRecording().path;
    if (!leftPath || !rightPath)
      throw new Error('Owner recording paths are unavailable');
    const [leftLog, rightLog] = await Promise.all([
      readFile(leftPath, 'utf8'),
      readFile(rightPath, 'utf8'),
    ]);
    expect(leftLog).toContain('left-selected');
    expect(leftLog).not.toContain('right-selected');
    expect(rightLog).toContain('right-selected');
    expect(rightLog).not.toContain('left-selected');
  }, 30000);

  it('runs the synchronously loaded action against its bound owner', async () => {
    const agent = await owner('sync');
    const command = loader(agent)
      .loadCommandsSync()
      .find((item) => item.name === 'model');
    if (!command) throw new Error('Sync registry did not load model');
    const result = await execute(command, 'sync-selected', agent);
    expect(result).toMatchObject({ messageType: 'info' });
    expect(agent.getModel()).toBe('sync-selected');
  }, 30000);

  it('opens filtered model browsing without changing the selected model', async () => {
    const agent = await owner('browse');
    const result = await execute(
      await registered(agent),
      'search --provider fake --tools --vision --reasoning --audio --all',
      agent,
    );
    expect(result).toStrictEqual({
      type: 'dialog',
      dialog: 'models',
      dialogData: {
        initialSearch: 'search',
        initialFilters: {
          tools: true,
          vision: true,
          reasoning: true,
          audio: true,
        },
        includeDeprecated: false,
        providerOverride: 'fake',
        showAllProviders: true,
      },
    });
    expect(agent.getModel()).toBe('browse-initial');
  }, 30000);

  it('opens an unfiltered browser for an empty argument', async () => {
    const agent = await owner('empty');
    const result = await execute(await registered(agent), '', agent);
    expect(result).toMatchObject({
      type: 'dialog',
      dialog: 'models',
      dialogData: {
        initialFilters: {
          tools: false,
          vision: false,
          reasoning: false,
          audio: false,
        },
        showAllProviders: false,
      },
    });
    expect(agent.getModel()).toBe('empty-initial');
  }, 30000);

  it('reports busy selection without modifying an admitted run', async () => {
    const agent = await owner('busy');
    const command = await registered(agent);
    const stream = agent.stream('hold the current turn', {
      mcpDiscovery: 'skip',
    });
    const run = stream[Symbol.asyncIterator]();
    try {
      const first = await run.next();
      expect(first.done).toBe(false);
      const result = await execute(command, 'must-not-select', agent);
      expect(result).toMatchObject({ type: 'message', messageType: 'error' });
      expect(agent.getModel()).toBe('busy-initial');
      let reachedTerminal = false;
      for await (const event of stream) {
        reachedTerminal = reachedTerminal || event.type === 'done';
      }
      expect(reachedTerminal).toBe(true);
      const after = await execute(command, 'after-run', agent);
      expect(after).toMatchObject({ messageType: 'info' });
      expect(agent.getModel()).toBe('after-run');
    } finally {
      await run.return?.();
    }
  }, 30000);

  it('does not reroute a retired owner command to a surviving invocation owner', async () => {
    const left = await owner('retired');
    const right = await owner('surviving');
    const leftCommand = await registered(left);
    const rightCommand = await registered(right);
    await left.dispose();
    const rejected = await execute(leftCommand, 'late-selection', right);
    expect(rejected).toMatchObject({ type: 'message', messageType: 'error' });
    expect(right.getModel()).toBe('surviving-initial');
    const result = await execute(rightCommand, 'surviving-selected', right);
    expect(result).toMatchObject({ messageType: 'info' });
    expect(right.getModel()).toBe('surviving-selected');
    expect(await right.generate('continue with the surviving owner')).toContain(
      'reply',
    );
  }, 30000);
});
