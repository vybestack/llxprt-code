/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '../session/session-settings-owner.js';

import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';

import { afterEach, describe, expect, it } from 'bun:test';
import { createTaskRegistration } from '@vybestack/llxprt-code-agents';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import {
  initializeTestMcpRuntime,
  installTestWorkspaceFilesystem,
} from '@vybestack/llxprt-code-test-utils/core/config.js';
import { RuntimePolicyOwner } from '../policy/policy-owner.js';
import { WorkspaceDefinitionOwner } from '../services/workspace-definition-owner.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from './config.js';
import {
  createToolRegistry,
  type TaskToolRegistration,
} from './toolRegistryFactory.js';

const createFilesystem = installTestWorkspaceFilesystem();
let configs: readonly Config[] = [];
let settingsOwners: readonly SessionSettingsOwner[] = [];
let policies: readonly RuntimePolicyOwner[] = [];
let definitionRoots: ReadonlyArray<{
  root: string;
  owner: WorkspaceDefinitionOwner;
}> = [];

function configuration(): Config {
  const config = new Config({
    sessionId: 'construction-inversion',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    model: 'fixture',
    debugMode: false,
    trustedFolder: true,
    coreTools: ['InjectedTaskTool', 'TaskTool'],
  });
  configs = [...configs, config];
  return config;
}

async function assemble(config: Config, descriptor?: TaskToolRegistration) {
  const root = await mkdtemp(join(tmpdir(), 'definition-inversion-'));
  const definitions = new WorkspaceDefinitionOwner(
    join(root, 'profiles'),
    join(root, 'subagents'),
  );
  definitionRoots = [...definitionRoots, { root, owner: definitions }];
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  const settingsOwner = new SessionSettingsOwner(settings);
  settingsOwners = [...settingsOwners, settingsOwner];
  const policy = new RuntimePolicyOwner(config);
  policies = [...policies, policy];
  const filesystem = createFilesystem({
    targetDir: config.getTargetDir(),
    includeDirectories: config.getConfiguredIncludeDirectories(),
    isTrusted: () =>
      new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      }).isTrustedFolder(),
  });
  const sessionRegistration =
    descriptor === undefined
      ? undefined
      : {
          ...descriptor,
          create: (
            config,
            profiles,
            subagents,
            bus,
            paths,
            readMcpInstructions,
          ) =>
            descriptor.create(
              config,
              profiles,
              subagents,
              bus,
              paths,
              readMcpInstructions,
              emptyInstructionReads,
              () => settingsOwner.createChildStore(),
              () => settingsOwner.readTaskPolicy(),
              () => settingsOwner.readSubagentRunPolicy(),
              () => settingsOwner.readToolGovernance([]),
            ),
          buildArgs: (
            config,
            profiles,
            subagents,
            bus,
            paths,
            readMcpInstructions,
          ) =>
            descriptor.buildArgs(
              config,
              profiles,
              subagents,
              bus,
              paths,
              readMcpInstructions,
              emptyInstructionReads,
              () => settingsOwner.createChildStore(),
              () => settingsOwner.readTaskPolicy(),
              () => settingsOwner.readSubagentRunPolicy(),
              () => settingsOwner.readToolGovernance([]),
            ),
        };
  const result = await createToolRegistry(
    config,
    config,
    policy.session.messageBus,
    () => settingsOwner.readRegistryPolicy(config.getExcludeTools() ?? []),
    () => settingsOwner.readToolExecutionPolicy(),
    filesystem.paths,
    filesystem.files,
    filesystem.ignore,
    filesystem.scans,
    undefined,
    undefined,
    sessionRegistration,
    undefined,
    true,
    definitions.profileReads,
    definitions.subagentReads,
    undefined,
    policy.trust,
  );
  return { ...result, messageBus: policy.session.messageBus };
}

describe('P01 construction inversion contracts', () => {
  afterEach(async () => {
    for (const { root, owner } of definitionRoots) {
      await owner.dispose();
      await rm(root, { recursive: true, force: true });
    }
    definitionRoots = [];
    for (const owner of settingsOwners) await owner.dispose();
    settingsOwners = [];
    for (const policy of policies) await policy.dispose();
    policies = [];
    const closing = configs;
    configs = [];
    const results = await Promise.allSettled(
      closing.map((config) => config.dispose()),
    );
    const errors = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (errors.length > 0)
      throw new AggregateError(errors, 'Config fixture disposal failed');
  });

  it('builds a child task from independently supplied session policy ports', () => {
    const config = configuration();
    const settings = new SessionSettingsOwner(new SettingsService());
    settingsOwners = [...settingsOwners, settings];
    const policy = new RuntimePolicyOwner(config);
    policies = [...policies, policy];
    const filesystem = createFilesystem({
      targetDir: config.getTargetDir(),
      includeDirectories: [],
      isTrusted: () => true,
    });
    const tool = createTaskRegistration().create(
      config,
      undefined,
      undefined,
      policy.session.messageBus,
      filesystem.paths,
      () => undefined,
      emptyInstructionReads,
      () => settings.createChildStore(),
      () => settings.readTaskPolicy(),
      () => settings.readSubagentRunPolicy(),
      () => settings.readToolGovernance([]),
    );
    expect(
      tool
        .build({ subagent_name: 'child', goal_prompt: 'Use parent policy' })
        .getDescription(),
    ).toContain('child');
  });

  it('initializes workspace infrastructure without constructing a session client', async () => {
    const config = configuration();
    const owner = await initializeTestMcpRuntime(config);
    try {
      expect(owner.toolSelection).toBeDefined();
      expect(owner.workspaceSkills.operations.list()).toStrictEqual([]);
      expect('skillManager' in config).toBe(false);
      expect('agentClient' in config).toBe(false);
      expect('agentClientFactory' in config).toBe(false);
    } finally {
      await owner.dispose();
    }
  });

  it('keeps exactly one workspace registry through repeated initialization requests', async () => {
    const config = configuration();
    const owner = await initializeTestMcpRuntime(config);
    try {
      const tool = new MockTool({ name: 'workspace_probe' });
      owner.toolPublication.registerTool(tool);
      const retained = owner.toolPublication.getTool(tool.name);
      await config.ensureInitialized();
      expect(
        new Set([tool, retained, owner.toolPublication.getTool(tool.name)])
          .size,
      ).toBe(1);
      expect(owner.toolSelection.getAllToolNames()).toStrictEqual([tool.name]);
    } finally {
      await owner.dispose();
    }
  });

  it('uses injected TaskToolRegistration metadata instead of the concrete class name', async () => {
    const config = configuration();
    const descriptor = {
      ...createTaskRegistration(),
      className: 'InjectedTaskTool',
    };
    const { registry, allPotentialTools, messageBus } = await assemble(
      config,
      descriptor,
    );
    const records = allPotentialTools.filter(
      (record) => record.displayName === 'task',
    );
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.isRegistered).toBe(true);
    expect(record.toolName).not.toBe(record.toolClass?.name);
    expect(record.args[0]).toBe(config);
    expect(record.args[3]).toBe(messageBus);
    const tool = registry.getTool('task');
    if (tool === undefined || record.toolClass === undefined)
      throw new Error('Missing actual constructed task');
    expect(tool instanceof record.toolClass).toBe(true);
    expect(tool.schema.parametersJsonSchema).toHaveProperty(
      'properties.goal_prompt',
    );
    expect(
      tool
        .build({
          subagent_name: 'helper',
          goal_prompt: 'A configured child task',
        })
        .getDescription(),
    ).toContain('helper');
  });

  it('records disabled TaskTool diagnostic when registration is missing', async () => {
    const { registry, allPotentialTools } = await assemble(configuration());
    const records = allPotentialTools.filter(
      (record) => record.displayName === 'task',
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      toolClass: undefined,
      toolName: 'TaskTool',
      displayName: 'task',
      isRegistered: false,
      reason: 'TaskTool registration was not provided by the composition root',
      args: [],
    });
    expect(registry.getTool('task')).toBeUndefined();
  });
});
