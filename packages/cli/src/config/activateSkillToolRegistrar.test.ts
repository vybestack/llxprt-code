/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for the composition-root skill activation registrar.
 *
 * Issue #3379: the registered activation tool captures the available skill
 * names at construction time, so re-running discovery has to produce a tool
 * whose declaration reflects the new skill set.
 */

import { describe, it, expect } from 'bun:test';
import {
  ACTIVATE_SKILL_TOOL_NAME,
  ToolRegistry,
  type ISkillService,
  type IToolMessageBus,
  type SkillInfo,
  type SkillManager,
} from '@vybestack/llxprt-code-tools';
import type { MessageBus } from '@vybestack/llxprt-code-core';
import { registerActivateSkillTool } from './activateSkillToolRegistrar.js';

/**
 * The registry and the registrar hook describe the same bus through different
 * interfaces, so the stub satisfies both.
 */
const messageBus = {
  publish() {},
  subscribe() {},
  unsubscribe() {},
} as unknown as IToolMessageBus & MessageBus;

function skillInfo(name: string): SkillInfo {
  return {
    name,
    description: `${name} description`,
    location: `/skills/${name}/SKILL.md`,
  };
}

/**
 * Minimal skill service whose skill list can be swapped between registrar
 * invocations, mirroring what re-running discovery does to the real adapter.
 */
class FakeSkillService implements ISkillService {
  constructor(private skills: SkillInfo[]) {}

  setSkills(skills: SkillInfo[]): void {
    this.skills = skills;
  }

  getSkillManager(): SkillManager {
    return {
      getSkills: () => this.listSkills(),
      getSkill: (name: string) => this.getSkill(name),
    };
  }

  listSkills(): SkillInfo[] {
    return this.skills;
  }

  getSkill(name: string): SkillInfo | null {
    return this.skills.find((skill) => skill.name === name) ?? null;
  }

  async activateSkill(name: string) {
    const skill = this.getSkill(name);
    if (!skill) {
      return {
        success: false as const,
        availableSkills: this.skills.map((s) => s.name),
      };
    }
    return {
      success: true as const,
      instructions: `${name} instructions`,
      description: skill.description,
      location: skill.location,
      folderStructure: '',
      resourceDirectory: `/skills/${name}`,
    };
  }

  async getFolderStructure(): Promise<string> {
    return '';
  }
}

function createRegistry(): ToolRegistry {
  return new ToolRegistry({}, messageBus);
}

function activateSkillDeclaration(registry: ToolRegistry) {
  return registry
    .getFunctionDeclarations()
    .find((declaration) => declaration.name === ACTIVATE_SKILL_TOOL_NAME);
}

function enumeratedSkillNames(registry: ToolRegistry): string[] {
  const declaration = activateSkillDeclaration(registry);
  if (!declaration) {
    throw new Error(`${ACTIVATE_SKILL_TOOL_NAME} is not registered`);
  }
  const schema = (declaration.parametersJsonSchema ??
    declaration.parameters) as {
    properties?: { name?: { enum?: string[] } };
  };
  return schema.properties?.name?.enum ?? [];
}

describe('registerActivateSkillTool @issue:3379', () => {
  it('registers the activation tool enumerating every available skill', () => {
    const registry = createRegistry();
    const skillService = new FakeSkillService([
      skillInfo('alpha'),
      skillInfo('beta'),
    ]);

    registerActivateSkillTool(registry, skillService, messageBus);

    expect(enumeratedSkillNames(registry)).toEqual(['alpha', 'beta']);
  });

  it('names the available skills in the tool description', () => {
    const registry = createRegistry();
    const skillService = new FakeSkillService([skillInfo('alpha')]);

    registerActivateSkillTool(registry, skillService, messageBus);

    expect(activateSkillDeclaration(registry)?.description).toContain(
      "Available: 'alpha'",
    );
  });

  it('exposes a newly discovered skill when invoked again', () => {
    const registry = createRegistry();
    const skillService = new FakeSkillService([skillInfo('alpha')]);
    registerActivateSkillTool(registry, skillService, messageBus);

    skillService.setSkills([skillInfo('alpha'), skillInfo('gamma')]);
    registerActivateSkillTool(registry, skillService, messageBus);

    expect(enumeratedSkillNames(registry)).toEqual(['alpha', 'gamma']);
    expect(activateSkillDeclaration(registry)?.description).toContain(
      "'gamma'",
    );
  });

  it('drops a skill that is no longer available when invoked again', () => {
    const registry = createRegistry();
    const skillService = new FakeSkillService([
      skillInfo('alpha'),
      skillInfo('gamma'),
    ]);
    registerActivateSkillTool(registry, skillService, messageBus);

    skillService.setSkills([skillInfo('alpha')]);
    registerActivateSkillTool(registry, skillService, messageBus);

    expect(enumeratedSkillNames(registry)).toEqual(['alpha']);
    expect(activateSkillDeclaration(registry)?.description).not.toContain(
      "'gamma'",
    );
  });

  it('leaves the tool unregistered when no skills are available', () => {
    const registry = createRegistry();

    registerActivateSkillTool(registry, new FakeSkillService([]), messageBus);

    expect(activateSkillDeclaration(registry)).toBeUndefined();
  });

  it('unregisters the tool once the last skill goes away', () => {
    const registry = createRegistry();
    const skillService = new FakeSkillService([skillInfo('alpha')]);
    registerActivateSkillTool(registry, skillService, messageBus);
    expect(activateSkillDeclaration(registry)).toBeDefined();

    skillService.setSkills([]);
    registerActivateSkillTool(registry, skillService, messageBus);

    expect(activateSkillDeclaration(registry)).toBeUndefined();
  });

  it('registers the tool for a session that started with no skills', () => {
    const registry = createRegistry();
    const skillService = new FakeSkillService([]);
    registerActivateSkillTool(registry, skillService, messageBus);
    expect(activateSkillDeclaration(registry)).toBeUndefined();

    skillService.setSkills([skillInfo('alpha')]);
    registerActivateSkillTool(registry, skillService, messageBus);

    expect(enumeratedSkillNames(registry)).toEqual(['alpha']);
  });

  it('keeps the previous tool registered when building the replacement fails', () => {
    const registry = createRegistry();
    const skillService = new FakeSkillService([skillInfo('alpha')]);
    registerActivateSkillTool(registry, skillService, messageBus);

    const exploding = new FakeSkillService([skillInfo('beta')]);
    exploding.listSkills = () => {
      throw new Error('discovery blew up');
    };

    expect(() =>
      registerActivateSkillTool(registry, exploding, messageBus),
    ).toThrow('discovery blew up');

    // Config.reloadSkills() lets this propagate and never reaches setTools(),
    // so the live chat session still advertises activate_skill. Removing it
    // here would leave the model calling a tool the registry no longer has.
    expect(enumeratedSkillNames(registry)).toEqual(['alpha']);
  });
});
