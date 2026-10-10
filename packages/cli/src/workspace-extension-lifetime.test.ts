import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { buildCliStyleConfig } from '../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import { loadExtension } from './config/extension.js';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function visibleSkills(agent: Pick<Agent, 'agentClient'>): string[] {
  const chat: unknown = agent.agentClient.getChat();
  if (!isRecord(chat) || !isRecord(chat.generationConfig))
    throw new Error('Missing real chat declarations');
  const tools = chat.generationConfig.tools;
  if (tools === undefined) return [];
  if (!Array.isArray(tools)) throw new Error('Missing real tools');
  for (const declaration of tools) {
    if (!isRecord(declaration) || declaration.name !== 'activate_skill')
      continue;
    const schema = declaration.parametersJsonSchema;
    if (
      !isRecord(schema) ||
      !isRecord(schema.properties) ||
      !isRecord(schema.properties.name)
    )
      throw new Error('Invalid real skill schema');
    const names = schema.properties.name.enum;
    if (
      !Array.isArray(names) ||
      !names.every((name: unknown) => typeof name === 'string')
    )
      throw new Error('Invalid real skill names');
    return names
      .filter((name: unknown): name is string => typeof name === 'string')
      .sort();
  }
  return [];
}

async function filesystemExtension(
  workspace: string,
  name: string,
  mcp = false,
): Promise<LlxprtExtension> {
  const directory = join(workspace, name);
  const skills = join(directory, 'skills', name);
  await mkdir(skills, { recursive: true });
  await writeFile(
    join(skills, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} instructions\n---\n\nRead ${name} locally.\n`,
  );
  await writeFile(
    join(directory, 'llxprt-extension.json'),
    JSON.stringify({
      name,
      version: '1',
      subagents: [
        {
          name: `${name}-agent`,
          profile: 'fake',
          systemPrompt: `Review ${name}`,
        },
      ],
      ...(mcp
        ? {
            mcpServers: {
              arithmetic: {
                command: process.execPath,
                args: [
                  resolve(
                    import.meta.dirname,
                    '../../../scripts/tests/mcp-standalone-stdio-fixture.ts',
                  ),
                  directory,
                ],
              },
            },
          }
        : {}),
    }),
  );
  const extension = loadExtension({
    extensionDir: directory,
    workspaceDir: workspace,
  });
  if (extension === null)
    throw new Error('Filesystem extension failed to load');
  return extension;
}

async function withExtensions(
  run: (context: {
    agent: Agent;
    built: Awaited<ReturnType<typeof buildCliStyleConfig>>;
    workspace: string;
    initial: LlxprtExtension;
    definitionOwner: WorkspaceDefinitionOwner;
  }) => Promise<void>,
): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), 'llxprt-extension-owner-'));
  const initial = await filesystemExtension(workspace, 'alpha', true);
  const definitionOwner = new WorkspaceDefinitionOwner(
    join(workspace, 'profiles'),
    join(workspace, 'subagents'),
  );
  const built = await buildCliStyleConfig(
    'plain-text.jsonl',
    {
      workingDir: workspace,
      definitionOwner,
      definitionOwnership: 'caller',
      skillsSupport: true,
      extensions: [initial],
    },
    {},
    { enableExtensionReloading: true },
  );
  const agent = await fromConfig({
    settingsService: built.settingsService,
    config: built.config,
    providerManager: built.providerManager,
    agentClient: built.agentClient,
    mcpRuntime: built.mcpRuntime,
    mcpOwnership: 'agent',
  });
  try {
    for await (const event of agent.stream('hello')) void event;
    await built.mcpRuntime.awaitDiscovery();
    const adopted = built.mcpRuntime.extensionOperations.list()[0];
    await run({ agent, built, workspace, initial: adopted, definitionOwner });
  } finally {
    await agent.dispose();
    await built.cleanup();
    await definitionOwner.dispose();
    await rm(workspace, { recursive: true, force: true });
  }
}

function gate(): { promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  return { promise, release };
}

describe('filesystem workspace extension ownership', () => {
  it('publishes startup, ordered restart and exact unload across model, MCP and subagents', async () => {
    await withExtensions(async ({ agent, built, workspace, initial }) => {
      const operations = built.mcpRuntime.extensionOperations;
      const beta = await filesystemExtension(workspace, 'beta');
      const catalog = {
        getToolsByServer: (server: string) =>
          built.mcpRuntime.toolSelection
            .getAllTools()
            .filter(
              (tool) =>
                'serverName' in tool &&
                Reflect.get(tool, 'serverName') === server,
            ),
      };
      const subagents = built.mcpRuntime.subagentDefinitions;
      expect(visibleSkills(agent)).toStrictEqual(['alpha']);
      expect(catalog.getToolsByServer('arithmetic')).toHaveLength(1);
      expect(await subagents.listSubagents()).toContain('alpha-agent');
      await operations.load(beta);
      expect(visibleSkills(agent)).toStrictEqual(['alpha', 'beta']);
      const previous = new Set(catalog.getToolsByServer('arithmetic'));
      await operations.restart(initial);
      await built.mcpRuntime.awaitDiscovery();
      expect(catalog.getToolsByServer('arithmetic')).toHaveLength(1);
      expect(
        catalog
          .getToolsByServer('arithmetic')
          .some((tool) => previous.has(tool)),
      ).toBe(false);
      expect(visibleSkills(agent)).toStrictEqual(['alpha', 'beta']);
      await operations.unload(initial);
      expect(operations.list()).toStrictEqual([beta]);
      expect(visibleSkills(agent)).toStrictEqual(['beta']);
      expect(catalog.getToolsByServer('arithmetic')).toStrictEqual([]);
      expect(await subagents.listSubagents()).not.toContain('alpha-agent');
      expect(await subagents.listSubagents()).toContain('beta-agent');
    });
  }, 30000);

  it('rolls back a failed load while another extension remains live and can restart', async () => {
    await withExtensions(async ({ agent, built, workspace, initial }) => {
      const beta = await filesystemExtension(workspace, 'beta');
      const publish = agent.agentClient.setTools.bind(agent.agentClient);
      const failed = new Error('publication rejected after update');
      const fault = vi
        .spyOn(agent.agentClient, 'setTools')
        .mockImplementationOnce(async () => {
          await publish();
          throw failed;
        });
      try {
        await expect(
          built.mcpRuntime.extensionOperations.load(beta),
        ).rejects.toThrow(failed.message);
        expect(built.config.getExtensions()).toStrictEqual([initial]);
        expect(visibleSkills(agent)).toStrictEqual(['alpha']);
        expect(
          await built.mcpRuntime.subagentDefinitions.listSubagents(),
        ).not.toContain('beta-agent');
        expect(
          built.mcpRuntime.toolSelection
            .getAllTools()
            .filter(
              (tool) =>
                'serverName' in tool &&
                Reflect.get(tool, 'serverName') === 'arithmetic',
            ),
        ).toHaveLength(1);
      } finally {
        fault.mockRestore();
      }
      await built.mcpRuntime.extensionOperations.restart(initial);
      expect(visibleSkills(agent)).toStrictEqual(['alpha']);
    });
  }, 30000);

  it('joins accepted load and restart before root disposal withdraws the actual declarations', async () => {
    await withExtensions(
      async ({ agent, built, workspace, initial, definitionOwner }) => {
        const beta = await filesystemExtension(workspace, 'beta');
        const entered = gate();
        const release = gate();
        const publish = agent.agentClient.setTools.bind(agent.agentClient);
        const fault = vi
          .spyOn(agent.agentClient, 'setTools')
          .mockImplementationOnce(async () => {
            await publish();
            entered.release();
            await release.promise;
          });
        try {
          const loading = built.mcpRuntime.extensionOperations.load(beta);
          await entered.promise;
          const restart = built.mcpRuntime.extensionOperations.restart(initial);
          const closing = agent.dispose();
          await expect(
            built.mcpRuntime.extensionOperations.load(beta),
          ).rejects.toThrow('closed');
          release.release();
          await Promise.all([loading, restart, closing]);
          expect(built.mcpRuntime.extensionOperations.list()).toStrictEqual([]);
          expect(() => built.mcpRuntime.toolSelection.getAllTools()).toThrow(
            'closed',
          );
          expect(() =>
            built.mcpRuntime.subagentDefinitions.listSubagents(),
          ).toThrow('closed');
          expect(
            await definitionOwner.subagentReads.listSubagents(),
          ).toStrictEqual([]);
          expect(
            visibleSkills({ agentClient: built.agentClient }),
          ).toStrictEqual([]);
        } finally {
          release.release();
          fault.mockRestore();
        }
      },
    );
  }, 30000);
});
