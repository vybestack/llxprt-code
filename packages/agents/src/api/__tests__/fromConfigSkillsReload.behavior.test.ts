/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2615: shared Config skill reload across live sessions.
 *
 * Two agents A and B share the same initialized Config (same-label plain
 * fromConfig). After A is disposed and a new skill is added, B.skills.reload()
 * must refresh B's session registry, B's client provider declaration, and B's
 * confirmation bus must handle activation. A's disposed bus must receive no
 * publication.
 */

import { describe, it, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import {
  ACTIVATE_SKILL_TOOL_NAME,
  ActivateSkillTool,
  ToolConfirmationOutcome,
} from '@vybestack/llxprt-code-tools';
import { buildFactoryLessConfig } from './helpers/buildCliStyleConfig.js';
import { AgentImpl } from '../agentImpl.js';

interface ProviderToolDeclaration {
  readonly name: string;
  readonly parametersJsonSchema?: unknown;
}

/**
 * Reads the skill names the model may pass to activate_skill from the
 * declarations ChatSession sends with the next provider request. Throws
 * rather than returning empty if the shape moves.
 */
function modelVisibleSkillNames(agent: Agent): string[] {
  if (!(agent instanceof AgentImpl)) {
    throw new Error('Expected the real Agent implementation');
  }
  const chat = agent.agentClient.getChat() as unknown as {
    generationConfig?: {
      tools?: Array<{ functionDeclarations?: ProviderToolDeclaration[] }>;
    };
  };
  const toolGroups = chat.generationConfig?.tools;
  if (!Array.isArray(toolGroups) || toolGroups.length === 0) {
    throw new Error(
      'ChatSession carries no tool groups; ChatSession.setTools may have changed shape',
    );
  }
  const declarations = toolGroups[0]?.functionDeclarations;
  if (!Array.isArray(declarations)) {
    throw new Error(
      'ChatSession tool group has no functionDeclarations; ChatSession.setTools may have changed shape',
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

describe('shared Config skill reload across live sessions @issue:2615', () => {
  it('B.skills.reload after A disposal refreshes B registry, B client declaration, and B confirmation bus with no A publication', async () => {
    const workspace = mkdtempSync(
      join(tmpdir(), 'llxprt-shared-config-skill-reload-'),
    );
    writeSkill(workspace, 'alpha');
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      { skillsSupport: true, workingDir: workspace },
    );
    const busA = built.messageBus;
    const busB = new MessageBus(
      built.config.getPolicyEngine(),
      built.config.getDebugMode(),
    );
    const routedA: unknown[] = [];
    const routedB: unknown[] = [];
    busA.subscribe(MessageBusType.UPDATE_POLICY, (update) =>
      routedA.push(update),
    );
    busB.subscribe(MessageBusType.UPDATE_POLICY, (update) =>
      routedB.push(update),
    );

    let agentA: Agent | undefined;
    let agentB: Agent | undefined;
    try {
      agentA = await fromConfig({ config: built.config, messageBus: busA });
      agentB = await fromConfig({ config: built.config, messageBus: busB });

      // Drain a turn for B so the chat session and its tool list exist.
      for await (const _event of agentB.stream('hello')) {
        void _event;
      }

      // Both agents see the initial skill alpha.
      expect(agentA.skills.list().map((s) => s.name)).toContain('alpha');
      expect(agentB.skills.list().map((s) => s.name)).toContain('alpha');
      expect(modelVisibleSkillNames(agentB)).toContain('alpha');

      // Dispose A: its skill surface subscriber is removed.
      await agentA.dispose();
      agentA = undefined;

      // Add a new skill to the shared Config's skill manager by writing
      // to the filesystem and then calling reload (which re-runs discovery).
      writeSkill(workspace, 'beta');

      // B.skills.reload() must refresh B's session registry, B's client
      // declaration, and B's confirmation bus.
      await agentB.skills.reload();

      // B registry includes the new skill.
      expect(agentB.skills.list().map((s) => s.name)).toContain('beta');

      // B client provider declaration includes the new skill.
      expect(modelVisibleSkillNames(agentB)).toContain('beta');

      // B confirmation bus handles activation.
      const tool = agentB.getToolRegistry().getTool(ACTIVATE_SKILL_TOOL_NAME);
      expect(tool).toBeInstanceOf(ActivateSkillTool);
      if (!(tool instanceof ActivateSkillTool)) {
        throw new Error('Expected an activation tool');
      }
      const confirmation = await tool
        .build({ name: 'beta' })
        .shouldConfirmExecute(new AbortController().signal);
      expect(confirmation).not.toBe(false);
      if (confirmation !== false) {
        await confirmation.onConfirm(ToolConfirmationOutcome.ProceedAlways);
      }
      expect(routedB.length).toBeGreaterThan(0);

      // A's disposed bus received no publication.
      expect(routedA).toStrictEqual([]);

      // B's bus identity is preserved.
      expect(agentB.getMessageBus()).toBe(busB);
    } finally {
      await agentB?.dispose();
      await agentA?.dispose();
      await built.cleanup();
      rmSync(workspace, { recursive: true, force: true });
      busA.removeAllListeners();
      busB.removeAllListeners();
    }
  });
});
