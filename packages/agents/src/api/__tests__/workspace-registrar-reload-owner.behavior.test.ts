/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

import { registerActivateSkillTool } from '../../skill-tool-registrar.js';
import { fromConfig } from '../fromConfig.js';
import { z } from 'zod';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import type { SkillPolicy } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';

describe('workspace registrar and skill reload root admission', () => {
  let directory: string;
  let reloadPolicy: () => Promise<Partial<SkillPolicy>>;
  let fixture: Awaited<ReturnType<typeof buildCliStyleConfig>> | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'workspace-registrar-admission-'));
    await writeSkill('alpha');
    reloadPolicy = async () => ({});
    const evidence = join(directory, 'mcp');
    await mkdir(evidence);
    fixture = await buildCliStyleConfig(
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
    const failures = await fixture.mcpRuntime.awaitDiscovery();
    if (failures.size > 0)
      throw new Error(
        `Physical MCP discovery failed: ${JSON.stringify(Array.from(failures))}`,
      );
  });

  afterEach(async () => {
    try {
      await fixture?.cleanup();
    } finally {
      fixture = undefined;
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

  function current(): Awaited<ReturnType<typeof buildCliStyleConfig>> {
    if (fixture === undefined) throw new Error('Fixture has not initialized');
    return fixture;
  }

  it('discovers actual skill files, activates their contents and registers their schema', async () => {
    const { mcpRuntime } = current();
    const skill = mcpRuntime.workspaceSkills.operations.find('alpha');
    if (skill === undefined)
      throw new Error('Physical skill was not discovered');
    const result =
      await mcpRuntime.workspaceSkills.operations.activate('alpha');
    expect(
      mcpRuntime.toolSelection
        .getFunctionDeclarations()
        .map((tool) => tool.name),
    ).toContain('mcp__arithmetic__sum');
    expect(result.success).toBe(true);
    if (result.instructions === undefined)
      throw new Error('Skill activation did not return instructions');
    expect(await readFile(skill.location, 'utf8')).toContain(
      result.instructions,
    );
    expect(
      mcpRuntime.toolSelection
        .getFunctionDeclarations()
        .map((tool) => tool.name),
    ).toContain('activate_skill');
    expect(
      mcpRuntime.workspaceSkills.operations.list().map((entry) => entry.name),
    ).toStrictEqual(['alpha']);
  });

  it('does not retain registrar or skill reload executable authority on Config', () => {
    const { config } = current();
    for (const name of [
      'postSkillDiscoveryToolRegistrar',
      'getPostSkillDiscoveryToolRegistrar',
      'setPostSkillDiscoveryToolRegistrar',
      '_onReload',
      'getSkillSettingsReloader',
    ]) {
      expect(name in config).toBe(false);
    }
  });

  it('rejects a skill reload admitted after root closure without publishing new files', async () => {
    const { mcpRuntime } = current();
    expect(
      mcpRuntime.workspaceSkills.operations.list().map((skill) => skill.name),
    ).toStrictEqual(['alpha']);
    await writeSkill('beta');
    mcpRuntime.closeAdmission();
    await expect(
      mcpRuntime.workspaceSkills.operations.reload(),
    ).rejects.toThrow(/closed|disposed|stopped/);
    expect(
      mcpRuntime.workspaceSkills.operations.list().map((skill) => skill.name),
    ).toStrictEqual(['alpha']);
  });
  function gate(): { promise: Promise<void>; release(): void } {
    let release = (): void => {
      throw new Error('Gate not initialized');
    };
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  function modelNames(
    client: ReturnType<typeof current>['agentClient'],
  ): string[] {
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
    const built = current();
    const agent = await fromConfig({
      config: built.config,
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      providerManager: built.providerManager,
      agentClient: built.agentClient,
      mcpRuntime: built.mcpRuntime,
    });
    if (turn)
      for await (const event of agent.stream('hello')) {
        if (event.type === 'error') throw new Error('Physical turn failed');
      }
    return agent;
  }

  it('publishes a reload accepted before root closure and denies the next reload', async () => {
    const built = current();
    const agent = await adopted();
    const entered = gate();
    const released = gate();
    reloadPolicy = async () => {
      entered.release();
      await released.promise;
      return {};
    };
    try {
      expect(modelNames(built.agentClient)).toStrictEqual(['alpha']);
      await writeSkill('beta');
      const accepted = built.mcpRuntime.workspaceSkills.operations.reload();
      await entered.promise;
      built.mcpRuntime.closeAdmission();
      await expect(
        built.mcpRuntime.workspaceSkills.operations.reload(),
      ).rejects.toThrow(/closed|disposed/);
      expect(modelNames(built.agentClient)).toStrictEqual(['alpha']);
      released.release();
      await accepted;
      expect(modelNames(built.agentClient)).toStrictEqual(['alpha', 'beta']);
      expect(
        built.mcpRuntime.workspaceSkills.operations.find('beta')?.location,
      ).toBe(join(directory, '.agents', 'skills', 'beta', 'SKILL.md'));
      await built.mcpRuntime.dispose();
      expect(modelNames(built.agentClient)).toStrictEqual([]);
    } finally {
      released.release();
      await agent.dispose();
    }
  });

  it('joins held publication and compensation before retiring the catalog', async () => {
    const built = current();
    const agent = await adopted();
    const entered = gate();
    const released = gate();
    const primary = new Error('Held publication failed after mutation');
    const publish = built.agentClient.setTools.bind(built.agentClient);
    const publications: string[][] = [];
    let candidateHeld = false;
    const fault = vi
      .spyOn(built.agentClient, 'setTools')
      .mockImplementation(async (...args) => {
        await publish(...args);
        const names = modelNames(built.agentClient);
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
      const accepted = built.mcpRuntime.workspaceSkills.operations.reload();
      const result = accepted.catch((error: unknown) => error);
      await entered.promise;
      built.mcpRuntime.closeAdmission();
      let retired = false;
      disposal = built.mcpRuntime.dispose().then(() => {
        retired = true;
      });
      await Promise.resolve();
      expect(retired).toBe(false);
      await expect(
        built.mcpRuntime.workspaceSkills.operations.reload(),
      ).rejects.toThrow(/closed|disposed/);
      released.release();
      expect(await result).toBe(primary);
      await disposal;
      expect(publications).toStrictEqual([['alpha', 'beta'], ['alpha'], []]);
      expect(modelNames(built.agentClient)).toStrictEqual([]);
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
      const built = current();
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
        await built.mcpRuntime.workspaceSkills.operations.reload();
        expect(
          built.mcpRuntime.workspaceSkills.operations
            .list()
            .map((skill) => skill.name)
            .sort(),
        ).toStrictEqual(['alpha', 'beta', 'gamma']);
        expect(built.mcpRuntime.isStopped()).toBe(false);
      } finally {
        await first.dispose();
        await second.dispose();
      }
    },
  );
});
