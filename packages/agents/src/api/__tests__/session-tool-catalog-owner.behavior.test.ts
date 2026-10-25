import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { createMcpApprovalPolicy } from '@vybestack/llxprt-code-core/policy/mcp-approval.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { CoreToolHostAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreToolHostAdapter.js';
import { ToolDispatchAdmission } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ReadFileTool, WriteFileTool } from '@vybestack/llxprt-code-tools';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { SessionToolCatalogOwner } from '../../session/session-tool-catalog-owner.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { createTaskRegistration } from '../runtimeFactories.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent, RouteAAgent } from './helpers/route-a-agent.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** The workspace ports a host builds from one `Config`, with no agent on top. */
interface DomainWorkspace {
  readonly config: Config;
  readonly settingsOwner: SessionSettingsOwner;
  readonly mcpRuntime: McpRuntimeOwner;
  readonly directory: string;
  readonly host: () => CoreToolHostAdapter;
  readonly close: () => Promise<void>;
}

async function openDomainWorkspace(): Promise<DomainWorkspace> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'session-tools-')),
  );
  await writeFile(join(directory, 'input.txt'), 'seven physical apples');
  const selection = toConfigParameters({
    provider: 'fake',
    model: 'fake-model',
    sessionId: randomUUID(),
    workingDir: directory,
    folderTrust: true,
    telemetry: { enabled: false },
    recording: { enabled: false },
  });
  const config = new Config({
    ...selection,
    interactive: true,
    includeDirectories: [
      ...(selection.includeDirectories ?? []),
      process.cwd(),
    ],
  });
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  const settingsOwner = new SessionSettingsOwner(settings);
  settingsOwner.initializeProviderSelection(
    config.getProvider(),
    config.getModel(),
  );
  settingsOwner.bindTelemetry(config);
  const policy = new RuntimePolicyOwner(config);
  const mcpRuntime = await buildTestMcpRuntime(
    config,
    policy.session.messageBus,
    {},
    undefined,
    policy,
  );
  const close = (): Promise<void> =>
    runCleanupSteps([
      () => mcpRuntime.dispose(),
      () => settingsOwner.dispose(),
      () => config.dispose(),
      () => rm(directory, { recursive: true, force: true }),
    ]);
  try {
    await mcpRuntime.initialize();
  } catch (primary) {
    await runCleanupSteps([close]);
    throw primary;
  }
  return {
    config,
    settingsOwner,
    mcpRuntime,
    directory,
    host: () =>
      new CoreToolHostAdapter(
        config,
        mcpRuntime.workspacePaths,
        mcpRuntime.workspaceFiles,
        mcpRuntime.workspaceIgnore,
        mcpRuntime.workspaceScans,
        () => settingsOwner.readToolExecutionPolicy(),
        mcpRuntime.trust,
        settingsOwner.telemetry,
      ),
    close,
  };
}

describe('session executable tool ownership', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });
  useFakeResponsesReplay('plain-text.jsonl');
  const credentials = useOwnedCredentials();

  /**
   * One Route A agent over a workspace that holds `input.txt`. A peer passes
   * the first agent's directory as `workingDir` so both share the workspace.
   */
  async function openWorkspace(
    coreTools?: string[],
    workingDir?: string,
  ): Promise<RouteAAgent> {
    const workspace = await openRouteAAgent({
      authority: credentials().authority,
      config: {
        ...(workingDir === undefined ? {} : { workingDir }),
        coreTools,
        folderTrust: true,
        telemetry: { enabled: false },
        recording: { enabled: false },
      },
    });
    await writeFile(
      join(workingDir ?? workspace.directory, 'input.txt'),
      'seven physical apples',
    );
    return workspace;
  }

  it('publishes executable tooling from independent workspace ports', async () => {
    const workspace = await openDomainWorkspace();
    const { config, settingsOwner, mcpRuntime, directory } = workspace;
    const catalog = new SessionToolCatalogOwner(
      config,
      () => settingsOwner.readRegistryPolicy([]),
      () => settingsOwner.readToolExecutionPolicy(),
      () => Promise.reject(new Error('this scenario makes no requests')),
    );
    const policy = mcpRuntime.policyOwner.session;
    const approval = createMcpApprovalPolicy(
      { ...policy.decisions, ...policy.confirmation },
      async () => undefined,
      () => undefined,
    );
    try {
      await catalog.initialize(
        {
          isWorkspaceStopped: () => mcpRuntime.isStopped(),
          paths: mcpRuntime.workspacePaths,
          files: mcpRuntime.workspaceFiles,
          ignore: mcpRuntime.workspaceIgnore,
          scans: mcpRuntime.workspaceScans,
          diagnostics: mcpRuntime.workspaceLsp.diagnostics,
          ide: mcpRuntime.ide,
          trust: mcpRuntime.trust,
          workspaceSelection: mcpRuntime.toolSelection,
          profiles: mcpRuntime.profileDefinitions,
          subagents: mcpRuntime.subagentDefinitions,
        },
        {
          readMcpInstructions: mcpRuntime.readInstructions,
          bus: policy.messageBus,
          registration: createTaskRegistration(config, {
            messageBus: policy.messageBus,
            readTaskPolicy: () => settingsOwner.readTaskPolicy(),
            readGovernance: () => settingsOwner.readToolGovernance([]),
            launchChild: async () => {
              throw new Error('Reader-only scenario');
            },
          }),
          summarize: async (content) => content,
          approval,
          telemetry: settingsOwner.telemetry,
        },
      );
      const read = catalog.selection.getTool('read_file');
      if (read === undefined) throw new Error('Missing published reader');
      const result = await read.buildAndExecute(
        { absolute_path: join(directory, 'input.txt') },
        new AbortController().signal,
      );
      expect(String(result.llmContent)).toContain('seven physical apples');
    } finally {
      await runCleanupSteps([() => catalog.dispose(), workspace.close]);
    }
  });

  it('registers an argument-specific ShellTool allowlist without registering ReadFileTool', async () => {
    const workspace = await openWorkspace(['ShellTool(git status)']);
    try {
      const shell = workspace.agent.tools.get('run_shell_command');
      expect(shell).toBeDefined();
      expect(workspace.agent.tools.get('read_file')).toBeUndefined();
      if (!shell) throw new Error('Missing governed shell');
      const result = await shell.buildAndExecute(
        { command: 'git status' },
        new AbortController().signal,
      );
      expect(String(result.llmContent)).toContain('not a git repository');
    } finally {
      await workspace.close();
    }
  });

  it('reads and writes physical files without selecting runtime tooling through Config', async () => {
    const workspace = await openWorkspace();
    const { agent, config, directory } = workspace;
    Object.defineProperty(config, 'getToolRegistry', {
      configurable: true,
      value: (): never => {
        throw new Error('Config cannot select executable tooling');
      },
    });
    try {
      const input = agent.tools.get('read_file');
      const output = agent.tools.get('write_file');
      if (!input || !output) throw new Error('Missing physical file tools');
      const result = await input.buildAndExecute(
        { absolute_path: join(directory, 'input.txt') },
        new AbortController().signal,
      );
      expect(String(result.llmContent)).toContain('seven physical apples');
      await output.buildAndExecute(
        {
          absolute_path: join(directory, 'output.txt'),
          content: '49 apple pairs',
        },
        new AbortController().signal,
      );
      expect(await readFile(join(directory, 'output.txt'), 'utf8')).toBe(
        '49 apple pairs',
      );
    } finally {
      await workspace.close();
    }
  });

  it('rejects retained dispatch after disabling a tool and after facade disposal', async () => {
    const workspace = await openWorkspace();
    const { agent, settings, directory } = workspace;
    try {
      const tool = agent.tools.get('write_file');
      if (!tool) throw new Error('Missing write tool');
      const invocation = tool.build({
        absolute_path: join(directory, 'forbidden.txt'),
        content: 'must not be written',
      });
      settings.set('tools.disabled', ['write_file']);
      await expect(
        invocation.execute(new AbortController().signal),
      ).rejects.toThrow('unavailable');
      await expect(readFile(join(directory, 'forbidden.txt'))).rejects.toThrow(
        'ENOENT',
      );
      settings.set('tools.disabled', []);
      await agent.dispose();
      await expect(
        tool.buildAndExecute(
          {
            absolute_path: join(directory, 'closed.txt'),
            content: 'must not be written',
          },
          new AbortController().signal,
        ),
      ).rejects.toThrow('closed');
    } finally {
      await workspace.close();
    }
  });

  it('keeps executable file and shell tooling usable in a peer sharing the workspace', async () => {
    const first = await openWorkspace();
    let second: RouteAAgent | undefined;
    try {
      second = await openWorkspace(undefined, first.directory);
      await first.agent.dispose();
      const read = second.agent.tools.get('read_file');
      const shell = second.agent.tools.get('run_shell_command');
      if (!read || !shell) throw new Error('Peer tooling was withdrawn');
      expect(
        String(
          (
            await read.buildAndExecute(
              { absolute_path: join(first.directory, 'input.txt') },
              new AbortController().signal,
            )
          ).llmContent,
        ),
      ).toContain('seven physical apples');
      const output = await shell.buildAndExecute(
        { command: 'printf "%s" "$((7 * 7))"' },
        new AbortController().signal,
      );
      expect(String(output.llmContent)).toContain('49');
    } finally {
      await runCleanupSteps([() => second?.close(), first.close]);
    }
  });

  it('rejects a retained session shell invocation without writing after facade close', async () => {
    const workspace = await openWorkspace();
    const { agent, directory } = workspace;
    try {
      const shell = agent.tools.get('run_shell_command');
      if (!shell) throw new Error('Missing shell tooling');
      const invocation = shell.build({
        command: 'printf forbidden > retained-shell.txt',
      });
      await agent.dispose();
      await expect(
        invocation.execute(new AbortController().signal),
      ).rejects.toThrow('closed');
      await expect(
        readFile(join(directory, 'retained-shell.txt')),
      ).rejects.toThrow('ENOENT');
    } finally {
      await workspace.close();
    }
  });

  it('denies retained file dispatch through buildAndExecute after its session closes', async () => {
    const workspace = await openWorkspace();
    const { agent, directory } = workspace;
    const signal = new AbortController().signal;
    const tool = agent.tools.get('write_file');
    if (!tool) throw new Error('Missing executable writer');
    const file = join(directory, 'validated-retained.txt');
    try {
      await agent.dispose();
      await expect(
        tool.buildAndExecute(
          { absolute_path: file, content: 'forbidden' },
          signal,
        ),
      ).rejects.toThrow('closed');
      await expect(readFile(file, 'utf8')).rejects.toThrow('ENOENT');
    } finally {
      await workspace.close();
    }
  });

  it('rejects a retained async task status invocation after session closure', async () => {
    const workspace = await openWorkspace();
    const { agent } = workspace;
    try {
      const status = agent.tools.get('check_async_tasks');
      if (!status) throw new Error('Missing task status tooling');
      const invocation = status.build({});
      await agent.dispose();
      await expect(
        invocation.execute(new AbortController().signal),
      ).rejects.toThrow('closed');
    } finally {
      await workspace.close();
    }
  });

  it('denies retained asynchronous-status dispatch through buildAndExecute after session closure', async () => {
    const workspace = await openWorkspace();
    const { agent } = workspace;
    try {
      const status = agent.tools.get('check_async_tasks');
      if (!status) throw new Error('Missing task status tooling');
      await agent.dispose();
      await expect(
        status.buildAndExecute({}, new AbortController().signal),
      ).rejects.toThrow('closed');
    } finally {
      await workspace.close();
    }
  });

  it('closes retained executable admission synchronously when facade disposal starts', async () => {
    const workspace = await openWorkspace();
    const { agent, directory } = workspace;
    const writer = agent.tools.get('write_file');
    if (!writer) throw new Error('Missing writer');
    try {
      const closing = agent.dispose();
      expect(() =>
        writer.build({
          absolute_path: join(directory, 'late.txt'),
          content: 'forbidden',
        }),
      ).toThrow('closed');
      await closing;
      await expect(
        readFile(join(directory, 'late.txt'), 'utf8'),
      ).rejects.toThrow('ENOENT');
    } finally {
      await workspace.close();
    }
  });

  it('rejects file reads through buildAndExecute with the caller abort reason when admission is already cancelled', async () => {
    const workspace = await openWorkspace();
    const { agent, directory } = workspace;
    try {
      const tool = agent.tools.get('read_file');
      if (!tool) throw new Error('Missing reader');
      const cancelled = new AbortController();
      const failure = new Error('Caller cancelled physical read');
      cancelled.abort(failure);
      await expect(
        tool.buildAndExecute(
          { absolute_path: join(directory, 'input.txt') },
          cancelled.signal,
        ),
      ).rejects.toBe(failure);
    } finally {
      await workspace.close();
    }
  });
});

describe('tool dispatch admission binding', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });
  function boundReader(
    admission: ToolDispatchAdmission,
    workspace: DomainWorkspace,
  ): ReadFileTool {
    const bound = admission.bind(
      new ReadFileTool(workspace.host()),
      () => true,
    );
    if (!(bound instanceof ReadFileTool)) throw new Error('Missing reader');
    return bound;
  }

  it('denies validated dispatch of a bound file writer after the admission closes', async () => {
    const workspace = await openDomainWorkspace();
    try {
      const admission = new ToolDispatchAdmission();
      const writer = admission.bind(
        new WriteFileTool(workspace.host()),
        () => true,
      );
      const file = join(workspace.directory, 'validated-retained.txt');
      await admission.close();
      await expect(
        writer.validateBuildAndExecute(
          { absolute_path: file, content: 'forbidden' },
          new AbortController().signal,
        ),
      ).rejects.toThrow('closed');
      await expect(readFile(file, 'utf8')).rejects.toThrow('ENOENT');
    } finally {
      await workspace.close();
    }
  });

  it('denies direct dispatch of a bound reader without a signal after the admission closes', async () => {
    const workspace = await openDomainWorkspace();
    try {
      const admission = new ToolDispatchAdmission();
      const reader = boundReader(admission, workspace);
      const params = { absolute_path: join(workspace.directory, 'input.txt') };
      expect(String((await reader.execute(params)).llmContent)).toContain(
        'seven physical apples',
      );
      await admission.close();
      await expect(reader.execute(params)).rejects.toThrow('closed');
    } finally {
      await workspace.close();
    }
  });

  it('rejects direct dispatch of a bound reader with the caller abort reason when the signal is already aborted', async () => {
    const workspace = await openDomainWorkspace();
    try {
      const reader = boundReader(new ToolDispatchAdmission(), workspace);
      const cancelled = new AbortController();
      const failure = new Error('Caller cancelled physical read');
      cancelled.abort(failure);
      await expect(
        reader.execute(
          { absolute_path: join(workspace.directory, 'input.txt') },
          cancelled.signal,
        ),
      ).rejects.toBe(failure);
    } finally {
      await workspace.close();
    }
  });
});
