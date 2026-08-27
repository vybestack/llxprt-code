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
 * The whole production chain runs for real: skill files on disk, the real
 * SkillManager, the real ActivateSkillTool, a real ToolRegistry, the real
 * AgentClient.setTools(), and the real ChatSession. Only the registrar hook is
 * supplied by the test, because wiring it is the composition root's job and the
 * standalone `createAgent` composition does not currently do it (issue #3382).
 * When #3382 is fixed this test should drop `setPostSkillDiscoveryToolRegistrar`
 * and rely on production wiring instead.
 */

import { describe, it, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ActivateSkillTool } from '@vybestack/llxprt-code-tools/tools/activate-skill.js';
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
 */
function providerToolDeclarations(config: Config): ProviderToolDeclaration[] {
  const chat = config.getAgentClient().getChat() as unknown as {
    generationConfig?: {
      tools?: Array<{ functionDeclarations?: ProviderToolDeclaration[] }>;
    };
  };
  return chat.generationConfig?.tools?.[0]?.functionDeclarations ?? [];
}

function activateSkillDeclaration(
  config: Config,
): ProviderToolDeclaration | undefined {
  return providerToolDeclarations(config).find(
    (declaration) => declaration.name === ACTIVATE_SKILL_TOOL_NAME,
  );
}

/** The skill names the model is allowed to pass to `activate_skill`. */
function modelVisibleSkillNames(config: Config): string[] {
  const declaration = activateSkillDeclaration(config);
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
 * Installs the composition-root registrar, drives one turn so a live chat
 * session exists to be refreshed, then performs the first reload, which stands
 * in for the startup registration a real CLI session gets.
 */
async function installRegistrarAndSettle(agent: Agent): Promise<Config> {
  const config = internalConfig(agent);
  config.setPostSkillDiscoveryToolRegistrar(
    (toolRegistry, skillService, messageBus) => {
      toolRegistry.unregisterTool(ActivateSkillTool.Name);
      if (skillService.listSkills().length > 0) {
        toolRegistry.registerTool(
          new ActivateSkillTool(skillService, messageBus),
        );
      }
    },
  );
  for await (const _event of agent.stream('hello')) {
    // Drain the turn so the chat session and its tool list exist.
  }
  await agent.skills.reload();
  return config;
}

async function withWorkspace(
  initialSkills: string[],
  run: (ctx: {
    agent: Agent;
    config: Config;
    workspace: string;
  }) => Promise<void>,
): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), 'llxprt-skill-reload-'));
  for (const name of initialSkills) {
    writeSkill(workspace, name);
  }
  const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
    skillsSupport: true,
    workingDir: workspace,
  });
  try {
    const config = await installRegistrarAndSettle(agent);
    await run({ agent, config, workspace });
  } finally {
    await cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
}

describe('skill reload reaches the model @issue:3379', () => {
  it('offers a skill that existed before the reload', async () => {
    await withWorkspace(['alpha'], async ({ config }) => {
      expect(modelVisibleSkillNames(config)).toEqual(['alpha']);
    });
  });

  it('offers a skill added on disk after the session started', async () => {
    await withWorkspace(['alpha'], async ({ agent, config, workspace }) => {
      expect(modelVisibleSkillNames(config)).toEqual(['alpha']);

      writeSkill(workspace, 'beta');
      await agent.skills.reload();

      expect(modelVisibleSkillNames(config).sort()).toEqual(['alpha', 'beta']);
      expect(activateSkillDeclaration(config)?.description).toContain("'beta'");
    });
  });

  it('stops offering a skill removed from disk', async () => {
    await withWorkspace(
      ['alpha', 'beta'],
      async ({ agent, config, workspace }) => {
        expect(modelVisibleSkillNames(config).sort()).toEqual([
          'alpha',
          'beta',
        ]);

        removeSkill(workspace, 'beta');
        await agent.skills.reload();

        expect(modelVisibleSkillNames(config)).toEqual(['alpha']);
        expect(activateSkillDeclaration(config)?.description).not.toContain(
          "'beta'",
        );
      },
    );
  });

  it('offers the first skill in a session that started with none', async () => {
    await withWorkspace([], async ({ agent, config, workspace }) => {
      expect(activateSkillDeclaration(config)).toBeUndefined();

      writeSkill(workspace, 'alpha');
      await agent.skills.reload();

      expect(modelVisibleSkillNames(config)).toEqual(['alpha']);
    });
  });

  it('withdraws the tool once the last skill goes away', async () => {
    await withWorkspace(['alpha'], async ({ agent, config, workspace }) => {
      expect(activateSkillDeclaration(config)).toBeDefined();

      removeSkill(workspace, 'alpha');
      await agent.skills.reload();

      expect(activateSkillDeclaration(config)).toBeUndefined();
    });
  });
});
