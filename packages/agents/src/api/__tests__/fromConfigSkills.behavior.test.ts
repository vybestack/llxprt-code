/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3382, second composition root.
 *
 * `Config` cannot construct the skill activation tool itself (issue #2417), so
 * it takes a registrar hook and silently registers nothing when none is
 * supplied. `fromConfig` adopts a Config the caller built, and a caller has no
 * reason to know that hook exists, so an adopted Config with skills enabled
 * would produce an agent whose model was never told any skill exists.
 *
 * `buildCliStyleConfig` deliberately builds and initializes a Config the way an
 * embedder would, without a registrar, which is exactly the case under test.
 * Nothing here installs one.
 */

import { describe, it, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import {
  ToolConfirmationOutcome,
  PolicyDecision,
} from '@vybestack/llxprt-code-core';
import { ACTIVATE_SKILL_TOOL_NAME } from '@vybestack/llxprt-code-tools';

import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

interface ProviderToolDeclaration {
  readonly name: string;
  readonly parametersJsonSchema?: unknown;
}

/**
 * The skill names the model may pass to `activate_skill`, read from the
 * declarations ChatSession will send with the next provider request. Throws
 * rather than returning empty if the shape moves, so a refactor of
 * `ChatSession.setTools` cannot turn this green by accident.
 */
function modelVisibleSkillNames(agent: Agent): string[] {
  const chat = agent.agentClient.getChat() as unknown as {
    generationConfig?: {
      tools?: ProviderToolDeclaration[];
    };
  };
  const toolGroups = chat.generationConfig?.tools;
  if (!Array.isArray(toolGroups) || toolGroups.length === 0) {
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
  const declaration = declarations.find(
    (candidate) => candidate.name === ACTIVATE_SKILL_TOOL_NAME,
  );
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

describe('fromConfig gives the model the skills the config discovered @issue:3382', () => {
  it('offers a skill from an adopted config that supplied no registrar', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'llxprt-fromconfig-skills-'));
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
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
      });
      for await (const _event of agent.stream('hello')) {
        // Drain the turn so the chat session and its tool list exist.
      }

      expect(agent.skills.list().map((skill) => skill.name)).toContain('alpha');
      expect(modelVisibleSkillNames(agent)).toContain('alpha');
      const tool = built.mcpRuntime.toolSelection.getTool(
        ACTIVATE_SKILL_TOOL_NAME,
      );
      if (!tool) throw new Error('Missing published activation tool');
      const confirmation = await tool
        .build({ name: 'alpha' })
        .shouldConfirmExecute(new AbortController().signal);
      if (confirmation === false)
        throw new Error('Missing activation confirmation');
      await confirmation.onConfirm(ToolConfirmationOutcome.ProceedAlways);
      expect(built.mcpRuntime.policyInspection.getRules()).toContainEqual(
        expect.objectContaining({
          toolName: ACTIVATE_SKILL_TOOL_NAME,
          decision: PolicyDecision.ALLOW,
        }),
      );
    } finally {
      await agent?.dispose().catch(() => {
        /* disposed via cleanup regardless of impl state */
      });
      await built.cleanup();
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
