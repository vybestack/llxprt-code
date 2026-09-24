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
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { SimpleExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import {
  ACTIVATE_SKILL_TOOL_NAME,
  ActivateSkillTool,
  ToolConfirmationOutcome,
} from '@vybestack/llxprt-code-tools';
import {
  buildCliStyleConfig,
  buildFactoryLessConfig,
} from './helpers/buildCliStyleConfig.js';
import { AgentImpl } from '../agentImpl.js';

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
      agent = await fromConfig({ config: built.config });
      for await (const _event of agent.stream('hello')) {
        // Drain the turn so the chat session and its tool list exist.
      }

      expect(agent.skills.list().map((skill) => skill.name)).toContain('alpha');
      expect(modelVisibleSkillNames(agent)).toContain('alpha');
    } finally {
      await agent?.dispose().catch(() => {
        /* disposed via cleanup regardless of impl state */
      });
      await built.cleanup();
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('builds activation confirmation on the second plain adopter bus after the first agent disposes', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'llxprt-adopted-skill-bus-'));
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
    const routed: string[] = [];
    busA.subscribe(MessageBusType.UPDATE_POLICY, () => routed.push('A'));
    busB.subscribe(MessageBusType.UPDATE_POLICY, () => routed.push('B'));
    let agentA: Agent | undefined;
    let agentB: Agent | undefined;
    try {
      agentA = await fromConfig({ config: built.config, messageBus: busA });
      await agentA.dispose();
      agentA = undefined;
      agentB = await fromConfig({ config: built.config, messageBus: busB });
      const tool = agentB.getToolRegistry().getTool(ACTIVATE_SKILL_TOOL_NAME);
      expect(tool).toBeInstanceOf(ActivateSkillTool);
      if (!(tool instanceof ActivateSkillTool)) {
        throw new Error('Expected an activation tool');
      }
      const confirmation = await tool
        .build({ name: 'alpha' })
        .shouldConfirmExecute(new AbortController().signal);
      if (confirmation === false) {
        throw new Error('Expected skill activation confirmation');
      }
      await confirmation.onConfirm(ToolConfirmationOutcome.ProceedAlways);
      expect(routed).toStrictEqual(['B']);
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

  it('reloads skills into the caller and other live sessions without reviving a disposed bus', async () => {
    const workspace = mkdtempSync(
      join(tmpdir(), 'llxprt-shared-skill-reload-'),
    );
    writeSkill(workspace, 'alpha');
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      { skillsSupport: true, workingDir: workspace },
    );
    const config = built.config;
    const busA = built.messageBus;
    const busB = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );
    const busC = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );
    const routed: string[] = [];
    busA.subscribe(MessageBusType.UPDATE_POLICY, () => routed.push('A'));
    busB.subscribe(MessageBusType.UPDATE_POLICY, () => routed.push('B'));
    busC.subscribe(MessageBusType.UPDATE_POLICY, () => routed.push('C'));
    let agentA: Agent | undefined;
    let agentB: Agent | undefined;
    let agentC: Agent | undefined;
    try {
      agentA = await fromConfig({ config, messageBus: busA });
      agentB = await fromConfig({ config, messageBus: busB });
      agentC = await fromConfig({ config, messageBus: busC });
      if (!(agentB instanceof AgentImpl) || !(agentC instanceof AgentImpl)) {
        throw new Error('Expected real Agent implementations');
      }
      await agentB.agentClient.setTools();
      await agentC.agentClient.setTools();
      await agentA.dispose();
      agentA = undefined;
      writeSkill(workspace, 'beta');

      await agentB.skills.reload();

      for (const agent of [agentB, agentC]) {
        const activation = agent
          .getToolRegistry()
          .getTool(ACTIVATE_SKILL_TOOL_NAME);
        expect(activation).toBeInstanceOf(ActivateSkillTool);
        expect(activation?.schema.description).toContain('beta');
        expect(agent.skills.get('beta')?.name).toBe('beta');
        expect(modelVisibleSkillNames(agent)).toContain('beta');
      }
      const tool = agentB.getToolRegistry().getTool(ACTIVATE_SKILL_TOOL_NAME);
      if (!(tool instanceof ActivateSkillTool)) {
        throw new Error('Expected the caller session activation tool');
      }
      const confirmation = await tool
        .build({ name: 'beta' })
        .shouldConfirmExecute(new AbortController().signal);
      if (confirmation === false) {
        throw new Error('Expected reloaded skill activation confirmation');
      }
      await confirmation.onConfirm(ToolConfirmationOutcome.ProceedAlways);
      expect(routed).toStrictEqual(['B']);
    } finally {
      await agentC?.dispose();
      await agentB?.dispose();
      await agentA?.dispose();
      await built.cleanup();
      rmSync(workspace, { recursive: true, force: true });
      busA.removeAllListeners();
      busB.removeAllListeners();
      busC.removeAllListeners();
    }
  });

  it('does not route extension skill discovery to the disposed first adopter bus', async () => {
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      { skillsSupport: true },
      { enableExtensionReloading: true },
    );
    const config = built.config;
    const busA = built.messageBus;
    const busB = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );
    const observedBuses: MessageBus[] = [];
    config.setPostSkillDiscoveryToolRegistrar(
      (_registry, _skillService, bus) => {
        observedBuses.push(bus);
      },
    );
    let agentA: Agent | undefined;
    let agentB: Agent | undefined;
    try {
      agentA = await fromConfig({ config, messageBus: busA });
      agentB = await fromConfig({ config, messageBus: busB });
      await agentA.dispose();
      agentA = undefined;
      observedBuses.length = 0;
      const loader = config.getExtensionLoader();
      if (!(loader instanceof SimpleExtensionLoader)) {
        throw new Error('Expected a reloadable extension loader');
      }

      await loader.loadExtension({
        name: 'session-skill-extension',
        version: '1.0.0',
        path: '/extensions/session-skill-extension',
        isActive: true,
        contextFiles: [],
        skills: [
          {
            name: 'session-skill',
            description: 'Skill for the active session',
            location: '/extensions/session-skill-extension/SKILL.md',
            body: 'Session instructions',
            source: 'extension',
          },
        ],
      });

      expect(
        config
          .getSkillManager()
          .getSkills()
          .map((skill) => skill.name),
      ).toContain('session-skill');
      expect(observedBuses).not.toContain(busA);
      expect(observedBuses).toContain(busB);
    } finally {
      await agentB?.dispose();
      await agentA?.dispose();
      await built.cleanup();
      busA.removeAllListeners();
      busB.removeAllListeners();
    }
  });
});
