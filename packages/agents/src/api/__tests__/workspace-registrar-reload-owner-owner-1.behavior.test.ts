import { openSkillsCaller } from './helpers/skills-fixture-caller.js';
import { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerActivateSkillTool } from '../../skill-tool-registrar.js';
import { AgentConfig } from '../config-types.js';
import { AgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

import { SkillPolicy } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';
import { z } from 'zod';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';

describe('workspace registrar and skill reload root admission', () => {
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

  const credentials = useOwnedCredentials();

  let caller: Awaited<ReturnType<typeof openSkillsCaller>>;

  async function openCaller(
    fixture: string,
    overrides: Readonly<Partial<AgentConfig>> = {},
    suppliedFactories: Readonly<Partial<AgentRuntimeFactoryBindings>> = {},
    skillSettings: Pick<
      ConfigParameters,
      'enableExtensionReloading' | 'storageRoot'
    > = {},
    extensionLoader?: ExtensionLoader,
    skillOperations?: WorkspaceSkillAssemblyOperations,
  ): Promise<void> {
    caller = await openSkillsCaller({
      fixture: new URL('./fixtures/' + fixture, import.meta.url),
      overrides,
      authority: credentials().authority,
      factories: suppliedFactories,
      parameters: skillSettings,
      extensionLoader,
      operations: skillOperations,
    });
  }

  let directory: string;

  let reloadPolicy: () => Promise<Partial<SkillPolicy>>;

  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'workspace-registrar-admission-')),
    );
    await writeSkill('alpha');
    reloadPolicy = async () => ({});
    const evidence = join(directory, 'mcp');
    await mkdir(evidence);
    await openCaller(
      'plain-text.jsonl',
      {
        workingDir: directory,
        skillsSupport: true,
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
        harness: { includeProcessCwd: false },
      },
      {},
      {},
      undefined,
      {
        reloadPolicy: () => reloadPolicy(),
        registerTools: registerActivateSkillTool,
      },
    );
    const failures = await caller.mcp.awaitDiscovery();
    if (failures.size > 0)
      throw new Error(
        `Physical MCP discovery failed: ${JSON.stringify(Array.from(failures))}`,
      );
  });

  afterEach(async () => {
    try {
      await caller.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  async function writeSkill(name: string): Promise<void> {
    const root = join(directory, '.agents', 'skills', name);
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Instructions for ${name}\n---\n\nUse the ${name} operation.\n`,
    );
  }

  function gate(): { promise: Promise<void>; release(): void } {
    let release = (): void => {
      throw new Error('Gate not initialized');
    };
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  function modelNames(client: AgentClientContract): string[] {
    const parsed = z
      .object({
        generationConfig: z.object({
          tools: z
            .array(
              z.object({
                name: z.string(),
                parametersJsonSchema: z.unknown().optional(),
              }),
            )
            .optional(),
        }),
      })
      .parse(client.getChat());
    const declaration = parsed.generationConfig.tools?.find(
      (entry) => entry.name === 'activate_skill',
    );
    if (declaration === undefined) return [];
    return z
      .object({
        properties: z.object({ name: z.object({ enum: z.array(z.string()) }) }),
      })
      .parse(declaration.parametersJsonSchema)
      .properties.name.enum.sort();
  }

  async function adopted(
    turn = true,
  ): Promise<Awaited<ReturnType<typeof fromConfig>>> {
    const agent = await fromConfig(
      caller.config,
      caller.settings,
      {},
      caller.settingsOwner,
      caller.manager,
      undefined,
      undefined,
      caller.mcp,
      undefined,
      caller.client,
    );
    if (turn)
      for await (const event of agent.stream('hello')) {
        if (event.type === 'error') throw new Error('Physical turn failed');
      }
    return agent;
  }

  it('publishes a reload accepted before root closure and denies the next reload', async () => {
    const agent = await adopted();
    const entered = gate();
    const released = gate();
    reloadPolicy = async () => {
      entered.release();
      await released.promise;
      return {};
    };
    try {
      expect(modelNames(caller.client)).toStrictEqual(['alpha']);
      await writeSkill('beta');
      const accepted = caller.mcp.workspaceSkills.operations.reload();
      await entered.promise;
      caller.mcp.closeAdmission();
      await expect(
        caller.mcp.workspaceSkills.operations.reload(),
      ).rejects.toThrow(/closed|disposed/);
      expect(modelNames(caller.client)).toStrictEqual(['alpha']);
      released.release();
      await accepted;
      expect(modelNames(caller.client)).toStrictEqual(['alpha', 'beta']);
      expect(caller.mcp.workspaceSkills.operations.find('beta')?.location).toBe(
        join(directory, '.agents', 'skills', 'beta', 'SKILL.md'),
      );
      await caller.mcp.dispose();
      expect(modelNames(caller.client)).toStrictEqual([]);
    } finally {
      released.release();
      await agent.dispose();
    }
  });

  it('joins held publication and compensation before retiring the catalog', async () => {
    const agent = await adopted();
    const entered = gate();
    const released = gate();
    const primary = new Error('Held publication failed after mutation');
    const publish = caller.client.setTools.bind(caller.client);
    const publications: string[][] = [];
    let candidateHeld = false;
    const fault = vi
      .spyOn(caller.client, 'setTools')
      .mockImplementation(async (...args) => {
        await publish(...args);
        const names = modelNames(caller.client);
        if (candidateHeld || names.includes('beta')) publications.push(names);
        if (!candidateHeld && names.includes('beta')) {
          candidateHeld = true;
          entered.release();
          await released.promise;
          throw primary;
        }
      });
    let disposal: Promise<void> | undefined;
    try {
      await writeSkill('beta');
      const accepted = caller.mcp.workspaceSkills.operations.reload();
      const result = accepted.catch((error: unknown) => error);
      await entered.promise;
      caller.mcp.closeAdmission();
      let retired = false;
      disposal = caller.mcp.dispose().then(() => {
        retired = true;
      });
      await Promise.resolve();
      expect(retired).toBe(false);
      await expect(
        caller.mcp.workspaceSkills.operations.reload(),
      ).rejects.toThrow(/closed|disposed/);
      released.release();
      expect(await result).toBe(primary);
      await disposal;
      expect(publications).toStrictEqual([['alpha', 'beta'], ['alpha'], []]);
      expect(modelNames(caller.client)).toStrictEqual([]);
    } finally {
      released.release();
      fault.mockRestore();
      await disposal;
      await agent.dispose();
    }
  });

  it.each([false, true])(
    'closes borrowed facades in either order without closing their caller root: %s',
    async (reverse) => {
      const first = await adopted();
      const second = await adopted(false);
      try {
        const [closing, surviving] = reverse
          ? [second, first]
          : [first, second];
        await closing.dispose();
        await expect(closing.skills.reload()).rejects.toThrow('closed');
        await writeSkill('beta');
        await surviving.skills.reload();
        expect(
          surviving.skills
            .list()
            .map((skill) => skill.name)
            .sort(),
        ).toStrictEqual(['alpha', 'beta']);
        await surviving.dispose();
        await expect(surviving.skills.reload()).rejects.toThrow('closed');
        await writeSkill('gamma');
        await caller.mcp.workspaceSkills.operations.reload();
        expect(
          caller.mcp.workspaceSkills.operations
            .list()
            .map((skill) => skill.name)
            .sort(),
        ).toStrictEqual(['alpha', 'beta', 'gamma']);
        expect(caller.mcp.isStopped()).toBe(false);
      } finally {
        await first.dispose();
        await second.dispose();
      }
    },
  );
});
