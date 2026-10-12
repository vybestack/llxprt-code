import { registerActivateSkillTool } from '../../skill-tool-registrar.js';
import type { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { internalWorkspace } from './helpers/agentHarness.js';
import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end coverage for issue #3379.
 *
 * `/skills reload` used to refresh SkillManager and stop there, so a skill
 * added on disk never reached the model. The model learns which skills exist
 * from exactly one place: the `activate_skill` declaration carried in the tool
 * list that ChatSession hands to the provider on every request. These tests
 * therefore assert on that declaration rather than on which functions were
 * called.
 *
 * The whole production chain runs for real, with nothing supplied by the test:
 * skill files on disk, the real SkillManager, the registrar `createAgent`
 * installs, the real ActivateSkillTool, a real ToolRegistry, the real
 * AgentClient.setTools(), and the real ChatSession.
 *
 * This file used to install the registrar itself, because `createAgent` did not
 * (issue #3382). Now that it does, these cases also cover that wiring: removing
 * it from `createAgent` fails every test here.
 */

import { describe, it, expect, vi } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { ACTIVATE_SKILL_TOOL_NAME } from '@vybestack/llxprt-code-tools';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  buildAgent,
  internalConfig,
  type Agent,
} from './helpers/agentHarness.js';

interface ProviderToolDeclaration {
  readonly name: string;
  readonly description?: string;
  readonly parametersJsonSchema?: unknown;
}

/**
 * Reads the tool declarations ChatSession will send with the next provider
 * request. `generationConfig` is the object handed to the provider, so this is
 * the model's actual view rather than a proxy for it.
 *
 * There is no public read seam for this, so the shape is reached directly.
 * Every step is checked and throws on a mismatch rather than returning an
 * empty list, because a silent `?? []` here would let a refactor of
 * `ChatSession.setTools` turn these assertions green while the model saw
 * nothing.
 */
function providerToolDeclarations(
  agent: Pick<Agent, 'agentClient'>,
): ProviderToolDeclaration[] {
  const chat = agent.agentClient.getChat() as unknown as {
    generationConfig?: {
      tools?: ProviderToolDeclaration[];
    };
  };
  const toolGroups = chat.generationConfig?.tools;
  if (toolGroups === undefined) return [];
  if (!Array.isArray(toolGroups)) {
    throw new Error(
      'ChatSession carries no tool groups; ChatSession.setTools may have changed shape',
    );
  }
  const declarations = toolGroups;
  if (!Array.isArray(declarations)) {
    throw new Error(
      'ChatSession has no declarations; ChatSession.setTools may have changed shape',
    );
  }
  return declarations;
}

function activateSkillDeclaration(
  agent: Pick<Agent, 'agentClient'>,
): ProviderToolDeclaration | undefined {
  return providerToolDeclarations(agent).find(
    (declaration) => declaration.name === ACTIVATE_SKILL_TOOL_NAME,
  );
}

/** The skill names the model is allowed to pass to `activate_skill`. */
function modelVisibleSkillNames(agent: Pick<Agent, 'agentClient'>): string[] {
  const declaration = activateSkillDeclaration(agent);
  if (!declaration) {
    return [];
  }
  const schema = declaration.parametersJsonSchema as {
    properties?: { name?: { enum?: string[] } };
  };
  return schema.properties?.name?.enum ?? [];
}

function writeSkill(workspace: string, name: string): void {
  const skillDir = join(workspace, '.llxprt', 'skills', name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: The ${name} skill\n---\n\n${name} instructions\n`,
    'utf-8',
  );
}

function removeSkill(workspace: string, name: string): void {
  rmSync(join(workspace, '.llxprt', 'skills', name), {
    recursive: true,
    force: true,
  });
}

/**
 * Drives one turn so a live chat session exists with a tool list, which is the
 * state a reload has to update. The registrar is already installed by
 * `createAgent`; nothing here supplies it.
 */
async function settle(agent: Agent): Promise<Config> {
  for await (const _event of agent.stream('hello')) {
    // Drain the turn so the chat session and its tool list exist.
  }
  return internalConfig(agent);
}

async function withWorkspace(
  initialSkills: string[],
  run: (ctx: {
    agent: Agent;
    config: Config;
    workspace: string;
  }) => Promise<void>,
  operations?: WorkspaceSkillAssemblyOperations,
): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), 'llxprt-skill-reload-'));
  for (const name of initialSkills) {
    writeSkill(workspace, name);
  }
  // The storage-isolation preload points LLXPRT_AGENTS_HOME at a temp root,
  // so discovery never reads the real ~/.agents/skills here; the strict set
  // assertions only ever see this workspace's skills.
  const fixture =
    operations === undefined
      ? undefined
      : await buildCliStyleConfig(
          'plain-text.jsonl',
          {
            skillsSupport: true,
            workingDir: workspace,
          },
          {},
          {},
          undefined,
          operations,
        );
  const { agent, cleanup } =
    fixture === undefined
      ? await buildAgent('plain-text.jsonl', {
          skillsSupport: true,
          workingDir: workspace,
        })
      : {
          agent: await fromConfig({
            config: fixture.config,
            settingsOwner: fixture.settingsOwner,
            settingsService: fixture.settingsService,
            providerManager: fixture.providerManager,
            agentClient: fixture.agentClient,
            mcpRuntime: fixture.mcpRuntime,
          }),
          cleanup: fixture.cleanup,
        };
  try {
    const config = await settle(agent);
    await run({ agent, config, workspace });
  } finally {
    await agent.dispose();
    await cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
}

describe('skill reload reaches the model @issue:3379', () => {
  /**
   * No reload happens here. This is the startup path: `createAgent` installs
   * the registrar, `Config.initialize` discovers the skill and rebuilds the
   * tool, and the first turn hands the declaration to the chat session. Before
   * issue #3382 the public Agent API supplied no registrar, so this produced no
   * activate_skill tool at all.
   */
  it('offers a skill discovered at startup, with no reload @issue:3382', async () => {
    await withWorkspace(['alpha'], async ({ agent }) => {
      expect(modelVisibleSkillNames(agent)).toStrictEqual(['alpha']);
    });
  });

  it('offers a skill added on disk after the session started', async () => {
    await withWorkspace(['alpha'], async ({ agent, workspace }) => {
      expect(modelVisibleSkillNames(agent)).toStrictEqual(['alpha']);

      writeSkill(workspace, 'beta');
      await agent.skills.reload();

      expect(modelVisibleSkillNames(agent).sort()).toStrictEqual([
        'alpha',
        'beta',
      ]);
      expect(activateSkillDeclaration(agent)?.description).toContain("'beta'");
    });
  });
  it('discovers and publishes skills without a Config skill runtime', async () => {
    await withWorkspace(['alpha'], async ({ agent, config, workspace }) => {
      expect('skillManager' in config).toBe(false);
      expect('getSkillManager' in config).toBe(false);
      expect('reloadSkills' in config).toBe(false);
      expect('refreshSkills' in config).toBe(false);
      writeSkill(workspace, 'beta');
      await agent.skills.reload();
      expect(modelVisibleSkillNames(agent).sort()).toStrictEqual([
        'alpha',
        'beta',
      ]);
    });
  });

  it('retains published skills when a reload cannot rebuild the activation tool', async () => {
    let failRegistration = false;
    await withWorkspace(
      ['alpha'],
      async ({ agent, workspace }) => {
        failRegistration = true;
        writeSkill(workspace, 'beta');
        await expect(agent.skills.reload()).rejects.toThrow(
          'registration failed',
        );
        expect(agent.skills.list().map((skill) => skill.name)).toStrictEqual([
          'alpha',
        ]);
        expect(modelVisibleSkillNames(agent)).toStrictEqual(['alpha']);
        failRegistration = false;
        await agent.skills.reload();
        expect(modelVisibleSkillNames(agent).sort()).toStrictEqual([
          'alpha',
          'beta',
        ]);
      },
      {
        reloadPolicy: async () => ({}),
        registerTools: (...args) => {
          if (failRegistration) throw new Error('registration failed');
          registerActivateSkillTool(...args);
        },
      },
    );
  });

  it('stops offering a skill removed from disk', async () => {
    await withWorkspace(['alpha', 'beta'], async ({ agent, workspace }) => {
      expect(modelVisibleSkillNames(agent).sort()).toStrictEqual([
        'alpha',
        'beta',
      ]);

      removeSkill(workspace, 'beta');
      await agent.skills.reload();

      expect(modelVisibleSkillNames(agent)).toStrictEqual(['alpha']);
      expect(activateSkillDeclaration(agent)?.description).not.toContain(
        "'beta'",
      );
    });
  });

  it('offers the first skill in a session that started with none', async () => {
    await withWorkspace([], async ({ agent, workspace }) => {
      expect(activateSkillDeclaration(agent)).toBeUndefined();

      writeSkill(workspace, 'alpha');
      await agent.skills.reload();

      expect(modelVisibleSkillNames(agent)).toStrictEqual(['alpha']);
    });
  });

  it('withdraws the tool once the last skill goes away', async () => {
    await withWorkspace(['alpha'], async ({ agent, workspace }) => {
      expect(activateSkillDeclaration(agent)).toBeDefined();

      removeSkill(workspace, 'alpha');
      await agent.skills.reload();

      expect(activateSkillDeclaration(agent)).toBeUndefined();
    });
  });
});

describe('workspace skill root lifetime @issue:2615', () => {
  it('keeps same-project same-label workspace catalogues and policy independent', async () => {
    await withWorkspace(
      ['alpha'],
      async ({ agent: first, config, workspace }) => {
        const second = await buildAgent('plain-text.jsonl', {
          skillsSupport: true,
          workingDir: workspace,
          sessionId: config.getSessionId(),
        });
        try {
          await settle(second.agent);
          config.setDisabledSkills(['alpha']);
          expect(first.skills.list()).toStrictEqual([]);
          expect(
            second.agent.skills.list().map((skill) => skill.name),
          ).toStrictEqual(['alpha']);
          writeSkill(workspace, 'beta');
          await first.skills.reload();
          expect(modelVisibleSkillNames(first)).toStrictEqual(['beta']);
          expect(modelVisibleSkillNames(second.agent)).toStrictEqual(['alpha']);
          await first.dispose();
          await second.agent.skills.reload();
          expect(modelVisibleSkillNames(second.agent).sort()).toStrictEqual([
            'alpha',
            'beta',
          ]);
        } finally {
          await second.cleanup();
        }
      },
    );
  });

  it('keeps caller Config identity and skills alive after borrowed facade disposal', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'borrowed-workspace-skills-'));
    writeSkill(workspace, 'alpha');
    const built = await buildCliStyleConfig('plain-text.jsonl', {
      skillsSupport: true,
      workingDir: workspace,
    });
    let agent: Agent | undefined;
    try {
      agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        config: built.config,
        providerManager: built.providerManager,
        agentClient: built.agentClient,
        mcpRuntime: built.mcpRuntime,
      });
      expect(internalConfig(agent)).toBe(built.config);
      await settle(agent);
      await agent.dispose();
      writeSkill(workspace, 'beta');
      await built.mcpRuntime.workspaceSkills.operations.reload();
      expect(
        built.mcpRuntime.workspaceSkills.operations
          .list()
          .map((skill) => skill.name)
          .sort(),
      ).toStrictEqual(['alpha', 'beta']);
      expect('skillManager' in built.config).toBe(false);
    } finally {
      await agent?.dispose();
      await built.cleanup();
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('publishes actual extension skills on load, restart and exact unload', async () => {
    const workspace = mkdtempSync(
      join(tmpdir(), 'extension-workspace-skills-'),
    );
    writeSkill(workspace, 'native');
    const built = await buildCliStyleConfig(
      'plain-text.jsonl',
      { skillsSupport: true, workingDir: workspace },
      {},
      { enableExtensionReloading: true },
    );
    let agent: Agent | undefined;
    try {
      agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        config: built.config,
        providerManager: built.providerManager,
        agentClient: built.agentClient,
        mcpRuntime: built.mcpRuntime,
      });
      await settle(agent);
      const loader = built.mcpRuntime.extensionOperations;
      const extension = {
        name: 'skill-pack',
        version: '1',
        isActive: true,
        path: workspace,
        contextFiles: [],
        skills: [
          {
            name: 'extension-skill',
            description: 'Extension instructions',
            body: 'Actual extension body',
            location: join(workspace, 'SKILL.md'),
          },
        ],
      };
      await loader.load(extension);
      expect(modelVisibleSkillNames(agent).sort()).toStrictEqual([
        'extension-skill',
        'native',
      ]);
      await loader.restart(extension);
      expect(modelVisibleSkillNames(agent).sort()).toStrictEqual([
        'extension-skill',
        'native',
      ]);
      await loader.unload(extension);
      expect(modelVisibleSkillNames(agent)).toStrictEqual(['native']);
      expect(agent.skills.get('extension-skill')).toBeUndefined();
    } finally {
      await agent?.dispose();
      await built.cleanup();
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

function publicationGate(): { promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('workspace skill publication compensation', () => {
  it('restores actual provider declarations and registration after publication mutates then rejects', async () => {
    await withWorkspace(
      ['alpha'],
      async ({ agent, config, workspace }) => {
        expect(modelVisibleSkillNames(agent)).toStrictEqual(['alpha']);
        const publish = agent.agentClient.setTools.bind(agent.agentClient);
        const fault = vi
          .spyOn(agent.agentClient, 'setTools')
          .mockImplementationOnce(async () => {
            await publish();
            expect(modelVisibleSkillNames(agent).sort()).toStrictEqual([
              'beta',
            ]);
            throw new Error('publication failed after mutation');
          });
        writeSkill(workspace, 'beta');
        try {
          await expect(agent.skills.reload()).rejects.toThrow(
            'publication failed after mutation',
          );
          expect(config.getDisabledSkills()).toStrictEqual([]);
          expect(agent.skills.list().map((skill) => skill.name)).toStrictEqual([
            'alpha',
          ]);
          expect(modelVisibleSkillNames(agent)).toStrictEqual(['alpha']);
        } finally {
          fault.mockRestore();
        }
      },
      {
        reloadPolicy: async () => ({ disabledSkills: ['alpha'] }),
        registerTools: registerActivateSkillTool,
      },
    );
  });

  it('reports the publication and compensation failures after restoring the real registration', async () => {
    await withWorkspace(['alpha'], async ({ agent, workspace }) => {
      expect(modelVisibleSkillNames(agent)).toStrictEqual(['alpha']);
      const publish = agent.agentClient.setTools.bind(agent.agentClient);
      const failed = new Error('candidate publication failed');
      const compensation = new Error('compensation publication failed');
      const fault = vi
        .spyOn(agent.agentClient, 'setTools')
        .mockImplementationOnce(async () => {
          await publish();
          throw failed;
        })
        .mockImplementationOnce(async () => {
          await publish();
          throw compensation;
        });
      writeSkill(workspace, 'beta');
      try {
        const error: unknown = await agent.skills
          .reload()
          .catch((reason: unknown) => reason);
        if (!(error instanceof Error) || !('cause' in error))
          throw new Error(
            'Expected a control error with its publication cause',
          );
        expect(error.cause).toBeInstanceOf(AggregateError);
        if (!(error.cause instanceof AggregateError))
          throw new Error('Expected aggregated publication errors');
        expect(error.cause.errors).toStrictEqual([failed, compensation]);
        expect(modelVisibleSkillNames(agent)).toStrictEqual(['alpha']);
      } finally {
        fault.mockRestore();
      }
    });
  });

  it('joins accepted queued reloads before withdrawing declarations and denying disposed activation', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'queued-workspace-skills-'));
    writeSkill(workspace, 'alpha');
    const built = await buildCliStyleConfig('plain-text.jsonl', {
      skillsSupport: true,
      workingDir: workspace,
    });
    const agent = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      config: built.config,
      providerManager: built.providerManager,
      agentClient: built.agentClient,
      mcpRuntime: built.mcpRuntime,
    });
    const entered = publicationGate();
    const released = publicationGate();
    const owner = built.mcpRuntime.workspaceSkills;
    let disposal: Promise<void> | undefined;
    await settle(agent);
    const publish = built.agentClient.setTools.bind(built.agentClient);
    const publications: string[][] = [];
    const fault = vi
      .spyOn(built.agentClient, 'setTools')
      .mockImplementation(async () => {
        await publish();
        publications.push(modelVisibleSkillNames(agent).sort());
        if (publications.length === 1) {
          entered.release();
          await released.promise;
        }
      });
    try {
      writeSkill(workspace, 'beta');
      const first = owner.operations.reload();
      await entered.promise;
      writeSkill(workspace, 'gamma');
      const queued = owner.operations.reload();
      disposal = owner.dispose();
      await expect(owner.operations.activate('alpha')).rejects.toThrow(
        'disposed',
      );
      await expect(owner.operations.reload()).rejects.toThrow('disposed');
      released.release();
      await first;
      await queued;
      await disposal;
      expect(publications).toStrictEqual([
        ['alpha', 'beta'],
        ['alpha', 'beta', 'gamma'],
        [],
      ]);
      expect(owner.operations.list()).toStrictEqual([]);
      expect(modelVisibleSkillNames(agent)).toStrictEqual([]);
      expect(agent.tools.get(ACTIVATE_SKILL_TOOL_NAME)).toBeUndefined();
      expect(built.mcpRuntime.isStopped()).toBe(false);
      expect(built.agentClient.isInitialized()).toBe(true);
      await built.agentClient.setTools();
    } finally {
      released.release();
      fault.mockRestore();
      await disposal;
      await agent.dispose();
      await built.cleanup();
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('enabled extension joint root shutdown', () => {
  it('withdraws skills, MCP and subagents while preserving a same-label independent root', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'joint-skill-shutdown-'));
    const evidence = join(workspace, 'mcp');
    mkdirSync(evidence);
    writeSkill(workspace, 'native');
    const definitions = new WorkspaceDefinitionOwner(
      join(workspace, 'profiles'),
      join(workspace, 'subagents'),
    );
    const first = await buildCliStyleConfig(
      'plain-text.jsonl',
      {
        skillsSupport: true,
        folderTrust: true,
        workingDir: workspace,
        definitionOwner: definitions,
        definitionOwnership: 'caller',
      },
      {},
      { enableExtensionReloading: true },
    );
    const second = await buildCliStyleConfig(
      'plain-text.jsonl',
      {
        skillsSupport: true,
        folderTrust: true,
        workingDir: workspace,
        sessionId: first.config.getSessionId(),
      },
      {},
      { enableExtensionReloading: true },
    );
    const agent = await fromConfig({
      settingsOwner: first.settingsOwner,
      settingsService: first.settingsService,
      config: first.config,
      providerManager: first.providerManager,
      agentClient: first.agentClient,
      mcpRuntime: first.mcpRuntime,
      mcpOwnership: 'agent',
    });
    const sibling = await fromConfig({
      settingsOwner: second.settingsOwner,
      settingsService: second.settingsService,
      config: second.config,
      providerManager: second.providerManager,
      agentClient: second.agentClient,
      mcpRuntime: second.mcpRuntime,
    });
    const loader = first.mcpRuntime.extensionOperations;
    const siblingLoader = second.mcpRuntime.extensionOperations;
    const extension = {
      name: 'joint-pack',
      version: '1',
      isActive: true,
      path: workspace,
      contextFiles: [],
      skills: [
        {
          name: 'extension-skill',
          description: 'Extension instructions',
          body: 'Joint extension body',
          location: join(workspace, 'SKILL.md'),
        },
      ],
      subagents: [
        {
          name: 'extension-agent',
          profile: 'fake',
          systemPrompt: 'Review locally',
        },
      ],
      mcpServers: {
        arithmetic: {
          command: process.execPath,
          args: [
            resolveRepositoryFixture(
              import.meta.url,
              'scripts/tests/mcp-standalone-stdio-fixture.ts',
            ),
            evidence,
          ],
        },
      },
    };
    try {
      await settle(agent);
      await settle(sibling);
      await loader.load(extension);
      await first.mcpRuntime.awaitDiscovery();
      await siblingLoader.load({ ...extension, mcpServers: {} });
      expect(first.config.getEnableExtensionReloading()).toBe(true);
      expect(modelVisibleSkillNames(agent).sort()).toStrictEqual([
        'extension-skill',
        'native',
      ]);
      const catalog = first.mcpRuntime.toolSelection;
      const mcpNames = catalog
        .getAllTools()
        .filter(
          (tool) => 'serverName' in tool && tool.serverName === 'arithmetic',
        )
        .map((tool) => tool.name);
      expect(mcpNames).toHaveLength(1);
      const subagents = first.mcpRuntime.subagentDefinitions;
      expect(await subagents.listSubagents()).toContain('extension-agent');
      await agent.dispose();
      expect(first.mcpRuntime.isStopped()).toBe(true);
      expect(loader.list()).toStrictEqual([]);
      expect(() => catalog.getAllTools()).toThrow('closed');
      expect(() => subagents.listSubagents()).toThrow('closed');
      expect(await definitions.subagentReads.listSubagents()).not.toContain(
        'extension-agent',
      );
      expect(
        modelVisibleSkillNames({ agentClient: first.agentClient }),
      ).toStrictEqual([]);
      expect(second.mcpRuntime.isStopped()).toBe(false);
      expect(modelVisibleSkillNames(sibling).sort()).toStrictEqual([
        'extension-skill',
        'native',
      ]);
      expect(siblingLoader.list()).toHaveLength(1);
      await second.mcpRuntime.workspaceSkills.operations.reload();
      expect(modelVisibleSkillNames(sibling).sort()).toStrictEqual([
        'extension-skill',
        'native',
      ]);
    } finally {
      await agent.dispose();
      await sibling.dispose();
      await first.cleanup();
      await definitions.dispose();
      await second.cleanup();
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('workspace skill required publication ports', () => {
  it('rejects an enabled reload without its MessageBus', async () => {
    await withWorkspace(['alpha'], async ({ agent, workspace }) => {
      const runtime = internalWorkspace(agent);
      const session = runtime.policyOwner.session;
      const descriptor = Object.getOwnPropertyDescriptor(session, 'messageBus');
      if (!descriptor)
        throw new Error('Missing retained session bus descriptor');
      Object.defineProperty(session, 'messageBus', {
        configurable: true,
        get: () => undefined,
      });
      writeSkill(workspace, 'beta');
      try {
        await expect(agent.skills.reload()).rejects.toThrow(
          'Missing workspace skill MessageBus',
        );
        expect(modelVisibleSkillNames(agent)).toStrictEqual(['alpha']);
      } finally {
        Object.defineProperty(session, 'messageBus', descriptor);
      }
    });
  });

  it('rejects an enabled reload without its registrar instead of silently publishing stale declarations', async () => {
    let missingRegistrar = false;
    await withWorkspace(
      ['alpha'],
      async ({ agent, workspace }) => {
        missingRegistrar = true;
        writeSkill(workspace, 'beta');
        try {
          await expect(agent.skills.reload()).rejects.toThrow(
            'Missing workspace skill registrar',
          );
          expect(modelVisibleSkillNames(agent)).toStrictEqual(['alpha']);
          expect(agent.skills.list().map((skill) => skill.name)).toStrictEqual([
            'alpha',
          ]);
        } finally {
          missingRegistrar = false;
        }
      },
      {
        reloadPolicy: async () => ({}),
        registerTools: (...args) => {
          if (missingRegistrar)
            throw new Error('Missing workspace skill registrar');
          registerActivateSkillTool(...args);
        },
      },
    );
  });

  it('attempts republication and aggregates a failed real registration restore', async () => {
    let registration: ReturnType<typeof vi.spyOn> | undefined;
    let failRestore = false;
    const failed = new Error('publication failed');
    const restore = new Error('registration restore failed');
    await withWorkspace(
      ['alpha'],
      async ({ agent, workspace }) => {
        failRestore = true;
        const publish = agent.agentClient.setTools.bind(agent.agentClient);
        const fault = vi
          .spyOn(agent.agentClient, 'setTools')
          .mockImplementationOnce(async () => {
            await publish();
            throw failed;
          });
        writeSkill(workspace, 'beta');
        try {
          const error: unknown = await agent.skills
            .reload()
            .catch((reason: unknown) => reason);
          if (
            !(error instanceof Error) ||
            !('cause' in error) ||
            !(error.cause instanceof AggregateError)
          )
            throw new Error('Expected aggregate control cause');
          expect(error.cause.errors).toStrictEqual([failed, restore]);
          expect(modelVisibleSkillNames(agent)).toStrictEqual([]);
          expect(agent.skills.list().map((skill) => skill.name)).toStrictEqual([
            'alpha',
          ]);
        } finally {
          fault.mockRestore();
          registration?.mockRestore();
          failRestore = false;
        }
        await agent.skills.reload();
        expect(modelVisibleSkillNames(agent).sort()).toStrictEqual([
          'alpha',
          'beta',
        ]);
      },
      {
        reloadPolicy: async () => ({}),
        registerTools: (tools, skills, bus) => {
          registerActivateSkillTool(tools, skills, bus);
          if (failRestore)
            registration = vi
              .spyOn(tools, 'registerTool')
              .mockImplementationOnce(() => {
                throw restore;
              });
        },
      },
    );
  });
});
