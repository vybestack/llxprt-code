/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'node:os';
import { describe, expect, it, vi } from 'bun:test';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { AgentImpl } from '../../agents/src/api/agentImpl.js';
import type * as acp from '@agentclientprotocol/sdk';
import {
  DebugLogger,
  MessageBus,
  ShellJobManager,
  type Config,
} from '@vybestack/llxprt-code-core';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type { SkillDefinition } from '@vybestack/llxprt-code-core/skills/skillLoader.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  BaseDeclarativeTool,
  Kind,
  ShellTool,
  type IShellToolHost,
  type ToolInvocation,
  type ToolResult,
  type ToolRegistry,
} from '@vybestack/llxprt-code-tools';
import {
  ACQUISITION_HARD_MAX_BYTES,
  ACQUISITION_MIN_BYTES,
  DEFAULT_ACQUISITION_BUDGET_BYTES,
} from '@vybestack/llxprt-code-tools/acquisition.js';
import {
  buildZedSessionToolRegistry,
  buildZedTerminalSetup,
} from './zed-terminal-setup.js';
import { createSessionScopedConfig } from './zed-session-config.js';
import { RecordingConnection } from './__tests__/zed-test-helpers.js';
import { buildFactoryLessConfig } from '../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';

class DeferredMcpTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  readonly serverName = 'shared-mcp-server';

  constructor() {
    super(
      'mcp__shared__search',
      'MCP Search',
      'Deferred search',
      Kind.Other,
      { type: 'object', properties: {} },
      true,
      false,
    );
  }

  protected createInvocation(
    _params: Record<string, unknown>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    throw new Error('not used');
  }
}

function configFixture(outputLimit?: number): Config {
  // #2534 D2: ToolRegistry receives the settings service as a direct
  // constructor argument via config.getSettingsService(), so the double
  // provides a real (empty) settings service.
  return {
    getPolicyEngine: () => undefined,
    getDebugMode: () => false,
    getTargetDir: () => '/project',
    getEphemeralSetting: (key: string) =>
      key === 'shell-output-retention-max-bytes' ? outputLimit : undefined,
    getSettingsService: () => new SettingsService(),
  } as unknown as Config;
}

describe('Zed per-session activation tool ownership', () => {
  it('refreshes a Zed session skill before its first model turn', async () => {
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      { skillsSupport: true },
    );
    const sessionConfig = createSessionScopedConfig(
      built.config,
      built.config.getFileSystemService(),
    );
    let agent: Agent | undefined;
    try {
      agent = await fromConfig({
        config: sessionConfig,
        sessionId: 'zed-cold-skill-refresh',
      });
      const skill: SkillDefinition = {
        name: 'cold-skill',
        description: 'Available before the first turn',
        location: '/skills/cold-skill/SKILL.md',
        body: 'Cold skill instructions',
        source: 'project',
      };
      const skillManager = built.config.getSkillManager();
      vi.spyOn(skillManager, 'discoverSkills').mockResolvedValue(undefined);
      vi.spyOn(skillManager, 'getSkills').mockReturnValue([skill]);
      vi.spyOn(skillManager, 'getSkill').mockReturnValue(skill);

      await built.config.refreshSkills(agent.getMessageBus());

      expect(
        agent.getToolRegistry().getTool('activate_skill')?.schema.description,
      ).toContain('cold-skill');
    } finally {
      await agent?.dispose();
      await built.cleanup();
    }
  });

  it('reloads B and C on the cold surviving same-label Zed session after its peer closes', async () => {
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      { skillsSupport: true },
    );
    let firstAgent: Agent | undefined;
    let secondAgent: Agent | undefined;
    let firstRegistry: ToolRegistry | undefined;
    let secondRegistry: ToolRegistry | undefined;
    const firstConfig = createSessionScopedConfig(
      built.config,
      built.config.getFileSystemService(),
      built.config.getTargetDir(),
      () => firstRegistry,
    );
    const secondConfig = createSessionScopedConfig(
      built.config,
      built.config.getFileSystemService(),
      built.config.getTargetDir(),
      () => secondRegistry,
    );
    const skill = (name: string): SkillDefinition => ({
      name,
      description: `Use ${name} on the surviving session`,
      location: `/skills/${name}/SKILL.md`,
      body: `${name} instructions`,
      source: 'project',
    });
    const skillA = skill('skill-a');
    const skillB = skill('skill-b');
    const skillC = skill('skill-c');
    let availableSkills = [skillA];
    try {
      const skillManager = built.config.getSkillManager();
      vi.spyOn(skillManager, 'discoverSkills').mockResolvedValue(undefined);
      vi.spyOn(skillManager, 'getSkills').mockImplementation(
        () => availableSkills,
      );
      vi.spyOn(skillManager, 'getSkill').mockImplementation(
        (name) =>
          availableSkills.find((candidate) => candidate.name === name) ?? null,
      );
      firstAgent = await fromConfig({
        config: firstConfig,
        sessionId: 'shared-zed-skill-label',
      });
      built.config.setEphemeralSetting('mcp.lazy', true);
      built.config.getToolRegistry().registerTool(new DeferredMcpTool());
      await built.config.refreshMcpContext(firstAgent.getMessageBus());
      firstRegistry = buildZedSessionToolRegistry(
        firstConfig,
        built.config.getToolRegistry(),
        firstAgent.getMessageBus(),
      );

      secondAgent = await fromConfig({
        config: secondConfig,
        sessionId: 'shared-zed-skill-label',
      });
      secondRegistry = buildZedSessionToolRegistry(
        secondConfig,
        built.config.getToolRegistry(),
        secondAgent.getMessageBus(),
      );
      expect(secondRegistry.getTool('activate_skill')).not.toBe(
        firstRegistry.getTool('activate_skill'),
      );
      const firstBus = firstAgent.getMessageBus();
      const secondBus = secondAgent.getMessageBus();
      expect(secondBus).not.toBe(firstBus);
      if (!(secondAgent instanceof AgentImpl)) {
        throw new Error('Expected the real surviving agent');
      }
      const coldClient = secondAgent.agentClient;
      expect(coldClient.isInitialized()).toBe(false);
      expect(
        secondAgent.getToolRegistry().getTool('activate_skill')?.schema
          .description,
      ).toContain('skill-a');
      await firstAgent.dispose();
      const disposedBusUpdates: unknown[] = [];
      firstBus.subscribe(MessageBusType.UPDATE_POLICY, (update) => {
        disposedBusUpdates.push(update);
      });
      const policyUpdates: unknown[] = [];
      secondBus.subscribe(MessageBusType.UPDATE_POLICY, (update) => {
        policyUpdates.push(update);
      });

      availableSkills = [skillB, skillC];
      await built.config.refreshSkills(firstAgent.getMessageBus());
      expect(secondAgent.agentClient.isInitialized()).toBe(false);
      const refreshedTool = secondAgent
        .getToolRegistry()
        .getTool('activate_skill');
      expect(refreshedTool?.schema.description).toContain('skill-b');
      expect(refreshedTool?.schema.description).toContain('skill-c');
      expect(refreshedTool?.schema.description).not.toContain('skill-a');
      const reloadedRegistry = buildZedSessionToolRegistry(
        secondConfig,
        built.config.getToolRegistry(),
        secondBus,
      );
      const invocation = reloadedRegistry
        .getTool('activate_skill')!
        .build({ name: 'skill-b' });
      const confirmation = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );
      expect(confirmation).not.toBe(false);
      if (confirmation !== false) {
        await confirmation.onConfirm(ToolConfirmationOutcome.ProceedAlways);
      }
      const result = await invocation.execute(new AbortController().signal);
      expect(String(result.llmContent)).toContain('skill-b instructions');
      expect(policyUpdates).toHaveLength(1);
      const firstMcp = firstRegistry.getTool('activate_mcp_server');
      const secondMcp = secondRegistry.getTool('activate_mcp_server');
      expect(firstMcp).toBeDefined();
      expect(secondMcp).toBeDefined();
      expect(secondMcp).not.toBe(firstMcp);
      const activated = await secondMcp!
        .build({ name: 'shared-mcp-server' })
        .execute(new AbortController().signal);
      expect(String(activated.llmContent)).toContain('now activated');
      expect(secondRegistry.listDeferredMcpServers()).toStrictEqual([]);
      expect(firstRegistry.listDeferredMcpServers()).toStrictEqual([
        'shared-mcp-server',
      ]);
      expect(disposedBusUpdates).toStrictEqual([]);
    } finally {
      await Promise.allSettled([firstAgent?.dispose(), secondAgent?.dispose()]);
      await built.cleanup();
    }
  }, 30000);
});

const messageBus = new MessageBus();

describe('buildZedTerminalSetup', () => {
  it('keeps task execution bound to each live Zed session across another session disposal', async () => {
    const built = await buildFactoryLessConfig('plain-text.jsonl');
    let firstAgent: Agent | undefined;
    let secondAgent: Agent | undefined;
    let firstSetup: ReturnType<typeof buildZedTerminalSetup> | undefined;
    let secondSetup: ReturnType<typeof buildZedTerminalSetup> | undefined;
    const firstConfig = createSessionScopedConfig(
      built.config,
      built.config.getFileSystemService(),
      built.config.getTargetDir(),
      () => firstSetup?.registry,
    );
    const secondConfig = createSessionScopedConfig(
      built.config,
      built.config.getFileSystemService(),
      built.config.getTargetDir(),
      () => secondSetup?.registry,
    );
    const connection = new RecordingConnection();
    const logger = new DebugLogger('llxprt:zed-task-ownership-test');
    try {
      firstAgent = await fromConfig({
        config: firstConfig,
        sessionId: 'shared-zed-task-label',
      });
      firstSetup = buildZedTerminalSetup(
        'shared-zed-task-label',
        firstConfig,
        firstAgent.getToolRegistry(),
        connection as unknown as acp.AgentSideConnection,
        logger,
        firstAgent.getMessageBus(),
        firstAgent.tasks.shellJobs(),
      );
      const firstTextRegistry = buildZedSessionToolRegistry(
        firstConfig,
        firstAgent.getToolRegistry(),
        firstAgent.getMessageBus(),
      );
      secondAgent = await fromConfig({
        config: secondConfig,
        sessionId: 'shared-zed-task-label',
      });
      secondSetup = buildZedTerminalSetup(
        'shared-zed-task-label',
        secondConfig,
        secondAgent.getToolRegistry(),
        connection as unknown as acp.AgentSideConnection,
        logger,
        secondAgent.getMessageBus(),
        secondAgent.tasks.shellJobs(),
      );
      const secondTextRegistry = buildZedSessionToolRegistry(
        secondConfig,
        secondAgent.getToolRegistry(),
        secondAgent.getMessageBus(),
      );
      const firstTask = firstSetup.registry.getTool('task');
      const secondTask = secondSetup.registry.getTool('task');
      expect(firstTask).toBeDefined();
      expect(secondTask).toBeDefined();
      expect(firstTask).not.toBe(secondTask);
      expect(firstTextRegistry.getTool('task')).toBe(firstTask);
      expect(secondTextRegistry.getTool('task')).toBe(secondTask);
      const execute = async (): Promise<string> => {
        const result = await secondTask!
          .build({
            subagent_name: 'missing-worker',
            goal_prompt: 'Check session ownership',
            async: true,
          })
          .execute(new AbortController().signal);
        return String(result.llmContent);
      };
      expect(await execute()).toContain('missing-worker');
      await firstAgent.dispose();
      expect(await execute()).toContain('missing-worker');
    } finally {
      await Promise.allSettled([firstAgent?.dispose(), secondAgent?.dispose()]);
      await built.cleanup();
    }
  }, 30000);

  it('does not enable a shell tool excluded from the base registry', () => {
    const baseRegistry = {
      getAllTools: vi.fn(() => []),
    } as unknown as ToolRegistry;

    const setup = buildZedTerminalSetup(
      'session-1',
      configFixture(),
      baseRegistry,
      new RecordingConnection() as unknown as acp.AgentSideConnection,
      new DebugLogger('llxprt:zed-terminal-setup-test'),
      messageBus,
      new ShellJobManager(),
    );

    expect(setup.registry.getTool(ShellTool.Name)).toBeUndefined();
  });

  it('registers a terminal-backed ShellTool when the base registry includes one', () => {
    const baseShellTool = new ShellTool({} as unknown as IShellToolHost);
    const baseRegistry = {
      getAllTools: vi.fn(() => [baseShellTool]),
    } as unknown as ToolRegistry;

    const setup = buildZedTerminalSetup(
      'session-1',
      configFixture(),
      baseRegistry,
      new RecordingConnection() as unknown as acp.AgentSideConnection,
      new DebugLogger('llxprt:zed-terminal-setup-test'),
      messageBus,
      new ShellJobManager(),
    );

    const tool = setup.registry.getTool(ShellTool.Name);
    expect(tool).toBeDefined();
    expect(tool).not.toBe(baseShellTool);
  });

  it.each([
    [
      'the default for an absent setting',
      undefined,
      DEFAULT_ACQUISITION_BUDGET_BYTES,
    ],
    ['the hard maximum for -1', -1, ACQUISITION_HARD_MAX_BYTES],
    ['the default for an invalid zero', 0, DEFAULT_ACQUISITION_BUDGET_BYTES],
    ['the minimum for a small positive value', 100, ACQUISITION_MIN_BYTES],
    [
      'the hard maximum for an excessive value',
      ACQUISITION_HARD_MAX_BYTES + 1,
      ACQUISITION_HARD_MAX_BYTES,
    ],
  ])('passes %s to ACP', async (_description, setting, expectedLimit) => {
    const baseRegistry = {
      getAllTools: vi.fn(() => []),
    } as unknown as ToolRegistry;
    const connection = new RecordingConnection();
    const setup = buildZedTerminalSetup(
      'session-1',
      configFixture(setting),
      baseRegistry,
      connection as unknown as acp.AgentSideConnection,
      new DebugLogger('llxprt:zed-terminal-setup-test'),
      messageBus,
      new ShellJobManager(),
    );

    await setup.terminals.executeShellCommand(
      'echo test',
      '/project',
      () => undefined,
      new AbortController().signal,
    );

    expect(connection.createTerminalCalls).toHaveLength(1);
    expect(connection.createTerminalCalls[0]?.outputByteLimit).toBe(
      expectedLimit,
    );
  });

  it('keeps background shell jobs in their owning Zed agents when sessions share a label', async () => {
    const first = await buildFactoryLessConfig('plain-text.jsonl');
    const second = await buildFactoryLessConfig('plain-text.jsonl');
    let firstAgent: Agent | undefined;
    let secondAgent: Agent | undefined;
    try {
      firstAgent = await fromConfig({
        config: first.config,
        messageBus: first.messageBus,
        sessionId: 'shared-zed-label',
      });
      secondAgent = await fromConfig({
        config: second.config,
        messageBus: second.messageBus,
        sessionId: 'shared-zed-label',
      });
      const connection = new RecordingConnection();
      const logger = new DebugLogger('llxprt:zed-shell-ownership-test');
      const firstSetup = buildZedTerminalSetup(
        'shared-zed-label',
        first.config,
        first.config.getToolRegistry(),
        connection as unknown as acp.AgentSideConnection,
        logger,
        firstAgent.getMessageBus(),
        firstAgent.tasks.shellJobs(),
      );
      const secondSetup = buildZedTerminalSetup(
        'shared-zed-label',
        second.config,
        second.config.getToolRegistry(),
        connection as unknown as acp.AgentSideConnection,
        logger,
        secondAgent.getMessageBus(),
        secondAgent.tasks.shellJobs(),
      );
      const command =
        os.platform() === 'win32' ? 'Start-Sleep -Seconds 60' : 'sleep 60';
      const launch = async (setup: typeof firstSetup): Promise<string> => {
        const tool = setup.registry.getTool(ShellTool.Name);
        if (tool === undefined) throw new Error('Zed shell tool is missing');
        const result = await tool
          .build({ command, is_background: true })
          .execute(new AbortController().signal);
        const id = /Job ID: (shell_\w+)/.exec(String(result.llmContent))?.[1];
        if (id === undefined) throw new Error('Zed shell job did not launch');
        return id;
      };
      const firstJob = await launch(firstSetup);
      const secondJob = await launch(secondSetup);
      expect(firstJob).not.toBe(secondJob);
      expect(firstAgent.tasks.get(firstJob)?.status).toBe('running');
      expect(firstAgent.tasks.get(secondJob)).toBeUndefined();
      expect(secondAgent.tasks.get(secondJob)?.status).toBe('running');
      expect(secondAgent.tasks.get(firstJob)).toBeUndefined();

      await firstAgent.dispose();
      expect(firstAgent.tasks.get(firstJob)).toBeUndefined();
      await expect(launch(firstSetup)).rejects.toThrow('disposing or disposed');
      expect(secondAgent.tasks.get(secondJob)?.status).toBe('running');
      expect(await secondAgent.tasks.cancel(secondJob)).toBe(true);
      const survivor = await launch(secondSetup);
      expect(secondAgent.tasks.get(survivor)?.status).toBe('running');
      expect(await secondAgent.tasks.cancel(survivor)).toBe(true);
    } finally {
      await Promise.allSettled([firstAgent?.dispose(), secondAgent?.dispose()]);
      await Promise.all([first.cleanup(), second.cleanup()]);
    }
  }, 30000);
});
