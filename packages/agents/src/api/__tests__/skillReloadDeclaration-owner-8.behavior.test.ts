import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { clientSkillNames } from './helpers/skill-declaration-reads.js';
import { openSkillWorkspaceSession } from './helpers/skill-workspace-session.js';

import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';

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

function writeSkill(workspace: string, name: string): void {
  const skillDir = join(workspace, '.llxprt', 'skills', name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: The ${name} skill\n---\n\n${name} instructions\n`,
    'utf-8',
  );
}

describe('enabled extension joint root shutdown', () => {
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
  const firstCredentials = useOwnedCredentials();

  const secondCredentials = useOwnedCredentials();

  it('withdraws skills, MCP and subagents while preserving a same-label independent root', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'joint-skill-shutdown-'));
    const evidence = join(workspace, 'mcp');
    mkdirSync(evidence);
    writeSkill(workspace, 'native');
    const definitions = new WorkspaceDefinitionOwner(
      join(workspace, 'profiles'),
      join(workspace, 'subagents'),
    );

    const {
      config: firstCallerConfig,
      mcp: firstCallerMcp,
      close: firstCallerClose,
      client: firstCallerClient,
    } = await openSkillWorkspaceSession({
      authority: firstCredentials().authority,
      overrides: {
        skillsSupport: true,
        folderTrust: true,
        workingDir: workspace,
        definitionOwner: definitions,
        definitionOwnership: 'caller',
      },
      parameters: { enableExtensionReloading: true },
    });

    const {
      mcp: secondCallerMcp,
      close: secondCallerClose,
      client: secondCallerClient,
    } = await openSkillWorkspaceSession({
      authority: secondCredentials().authority,
      overrides: {
        skillsSupport: true,
        folderTrust: true,
        workingDir: workspace,
        sessionId: firstCallerConfig.getSessionId(),
      },
      parameters: { enableExtensionReloading: true },
    });

    const loader = firstCallerMcp.extensionOperations;
    const siblingLoader = secondCallerMcp.extensionOperations;
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
      await loader.load(extension);
      await firstCallerMcp.awaitDiscovery();
      await siblingLoader.load({ ...extension, mcpServers: {} });
      expect(firstCallerConfig.getEnableExtensionReloading()).toBe(true);
      expect(clientSkillNames(firstCallerClient).sort()).toStrictEqual([
        'extension-skill',
        'native',
      ]);
      const catalog = firstCallerMcp.toolSelection;
      const mcpNames = catalog
        .getAllTools()
        .filter(
          (tool) => 'serverName' in tool && tool.serverName === 'arithmetic',
        )
        .map((tool) => tool.name);
      expect(mcpNames).toHaveLength(1);
      const subagents = firstCallerMcp.subagentDefinitions;
      expect(await subagents.listSubagents()).toContain('extension-agent');
      await firstCallerMcp.dispose();
      expect(firstCallerMcp.isStopped()).toBe(true);
      expect(loader.list()).toStrictEqual([]);
      expect(() => catalog.getAllTools()).toThrow('closed');
      expect(() => subagents.listSubagents()).toThrow('closed');
      expect(await definitions.subagentReads.listSubagents()).not.toContain(
        'extension-agent',
      );
      expect(clientSkillNames(firstCallerClient)).toStrictEqual([]);
      expect(secondCallerMcp.isStopped()).toBe(false);
      expect(clientSkillNames(secondCallerClient).sort()).toStrictEqual([
        'extension-skill',
        'native',
      ]);
      expect(siblingLoader.list()).toHaveLength(1);
      await secondCallerMcp.workspaceSkills.operations.reload();
      expect(clientSkillNames(secondCallerClient).sort()).toStrictEqual([
        'extension-skill',
        'native',
      ]);
    } finally {
      await firstCallerClose();
      await definitions.dispose();
      await secondCallerClose();
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
