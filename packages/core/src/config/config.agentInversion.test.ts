import { installTestWorkspaceSkills } from '../__tests__/workspace-skill-fixture.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '../session/session-settings-owner.js';

import type { MessageBus } from '../confirmation-bus/message-bus.js';

import { afterEach, describe, expect, it } from 'bun:test';
import { createTaskRegistration } from '@vybestack/llxprt-code-agents';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { composeWorkspaceSkills } from './skill-tool-sync.js';
import { WorkspaceToolCatalogOwner } from '../services/workspace-tool-catalog-owner.js';
import { initializeParser } from '../utils/shell-parser.js';
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

describe('P01 construction inversion contracts', () => {
  const createFilesystem = installTestWorkspaceFilesystem();

  const acquireSkills = installTestWorkspaceSkills();

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

  async function assemble(
    config: Config,
    descriptor?: (
      config: Config,
      settings: SessionSettingsOwner,
      bus: MessageBus,
    ) => TaskToolRegistration,
  ) {
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
    const sessionRegistration = descriptor?.(
      config,
      settingsOwner,
      policy.session.messageBus,
    );
    const result = await createToolRegistry({
      config,
      host: config,
      messageBus: policy.session.messageBus,
      readTaskSchemaPolicy: () =>
        settingsOwner.readRegistryPolicy(config.getExcludeTools() ?? []),
      readExecution: () => settingsOwner.readToolExecutionPolicy(),
      workspace: {
        paths: filesystem.paths,
        files: filesystem.files,
        ignore: filesystem.ignore,
        scans: filesystem.scans,
        trust: policy.trust,
      },
      definitions: {
        profiles: definitions.profileReads,
        subagents: definitions.subagentReads,
      },
      registration: sessionRegistration,
    });
    return { ...result, messageBus: policy.session.messageBus };
  }

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
    const tool = createTaskRegistration(config, {
      messageBus: policy.session.messageBus,
      readTaskPolicy: () => settings.readTaskPolicy(),
      readGovernance: () => settings.readToolGovernance([]),
      launchChild: async () => {
        throw new Error('Description-only scenario');
      },
    }).create();
    expect(
      tool
        .build({ subagent_name: 'child', goal_prompt: 'Use parent policy' })
        .getDescription(),
    ).toContain('child');
  });

  it('initializes workspace infrastructure without constructing a session client', async () => {
    const config = configuration();
    const skills = await acquireSkills(config);
    const policy = new RuntimePolicyOwner(config);
    policies = [...policies, policy];
    const tools = new WorkspaceToolCatalogOwner(
      config,
      policy.session.messageBus,
      policy.trust,
    );
    try {
      await initializeParser();
      await tools.initialize();
      expect(tools.selection).toBeDefined();
      expect(skills.operations.list()).toStrictEqual([]);
      expect('skillManager' in config).toBe(false);
      expect('agentClient' in config).toBe(false);
      expect('agentClientFactory' in config).toBe(false);
    } finally {
      await tools.dispose();
      await skills.dispose();
    }
  });

  it('keeps exactly one workspace registry through repeated initialization requests', async () => {
    const config = configuration();
    const policy = new RuntimePolicyOwner(config);
    policies = [...policies, policy];
    const catalog = new WorkspaceToolCatalogOwner(
      config,
      policy.session.messageBus,
      policy.trust,
    );
    const filesystem = createFilesystem({
      targetDir: config.getTargetDir(),
      includeDirectories: [],
      isTrusted: () => policy.trust.isTrustedFolder(),
    });
    const skills = composeWorkspaceSkills(
      config,
      (directory, approved) =>
        filesystem.admitSkillDirectory(directory, approved),
      () => filesystem.notifyTrustChanged(),
      policy.trust,
      () => policy.session.messageBus,
      { reloadPolicy: async () => ({}), registerTools: () => {} },
      () => {
        const lease = catalog.acceptSkillPublication();
        return {
          registry: lease.registry,
          publish: async () => {},
          release: lease.release,
        };
      },
    );
    try {
      await initializeParser();
      await catalog.initialize();
      await skills.initialize();
      const tool = new MockTool({ name: 'workspace_probe' });
      catalog.publication.registerTool(tool);
      const retained = catalog.publication.getTool(tool.name);
      await skills.initialize();
      expect(
        new Set([tool, retained, catalog.publication.getTool(tool.name)]).size,
      ).toBe(1);
      expect(catalog.selection.getAllToolNames()).toStrictEqual([tool.name]);
    } finally {
      await skills.dispose();
      await catalog.dispose();
    }
  });

  it('uses injected TaskToolRegistration metadata instead of the concrete class name', async () => {
    const config = configuration();
    const descriptor = (
      config: Config,
      settings: SessionSettingsOwner,
      bus: MessageBus,
    ): TaskToolRegistration => ({
      ...createTaskRegistration(config, {
        messageBus: bus,
        readTaskPolicy: () => settings.readTaskPolicy(),
        readGovernance: () => settings.readToolGovernance([]),
        launchChild: async () => {
          throw new Error('Registration-only scenario');
        },
      }),
      className: 'InjectedTaskTool',
    });
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
    expect(record.args[1]).toHaveProperty('messageBus', messageBus);
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
