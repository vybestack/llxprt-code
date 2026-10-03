/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import { SkillManager } from '@vybestack/llxprt-code-core/skills/skillManager.js';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { ACTIVATE_SKILL_TOOL_NAME } from '@vybestack/llxprt-code-tools';
import {
  SimpleExtensionLoader,
  type LlxprtExtension,
} from '@vybestack/llxprt-code-core';
import {
  buildCliStyleConfig,
  buildFactoryLessConfig,
} from './helpers/buildCliStyleConfig.js';

function skillExtension(name: string): LlxprtExtension {
  return {
    name,
    version: '1.0.0',
    path: `memory://${name}`,
    isActive: true,
    contextFiles: [],
    skills: [
      {
        name,
        description: `${name} instructions`,
        location: `memory://${name}/SKILL.md`,
        body: `${name} instructions`,
      },
    ],
  };
}

function declaration(agent: Agent): string {
  return JSON.stringify(
    agent
      .getToolRegistry()
      .getFunctionDeclarations()
      .find((tool) => tool.name === ACTIVATE_SKILL_TOOL_NAME) ?? null,
  );
}
describe('agents workspace skill discovery', () => {
  it('does not discover or expose extension skills when skill support is disabled', async () => {
    const loader = new SimpleExtensionLoader([skillExtension('disabled')]);
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      {},
      { extensionLoader: loader },
    );
    let agent: Agent | undefined;
    try {
      agent = await fromConfig({ config: built.config });
      expect(agent.skills.list().map((skill) => skill.name)).not.toContain(
        'disabled',
      );
      expect(declaration(agent)).not.toContain('disabled');
    } finally {
      await agent?.dispose();
      await built.cleanup();
    }
  }, 30000);

  it('installs extension skills before either borrowed session publishes its first tool view, independently of Config skill mutation', async () => {
    const loader = new SimpleExtensionLoader([skillExtension('initial')]);
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      {},
      {
        skillsSupport: true,
        enableExtensionReloading: true,
        extensionLoader: loader,
      },
    );
    let a: Agent | undefined;
    let b: Agent | undefined;
    try {
      a = await fromConfig({ config: built.config, sessionId: 'shared' });
      b = await fromConfig({ config: built.config, sessionId: 'shared' });
      expect(declaration(a)).toContain('initial');
      expect(declaration(b)).toContain('initial');
      built.config.getSkillManager().clearSkills();
      expect(a.skills.list().map((skill) => skill.name)).toContain('initial');
      expect(b.skills.list().map((skill) => skill.name)).toContain('initial');
      const activation = b.getToolRegistry().getTool(ACTIVATE_SKILL_TOOL_NAME);
      if (activation === undefined)
        throw new Error('Skill tool was not published');
      const result = await activation
        .build({ name: 'initial' })
        .execute(new AbortController().signal);
      expect(result.llmContent).toContain('initial instructions');
      expect(declaration(b)).toContain('initial');
    } finally {
      await a?.dispose();
      await b?.dispose();
      await built.cleanup();
    }
  }, 30000);

  it('uses workspace skill settings rather than the Config-owned manager state', async () => {
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      {},
      {
        skillsSupport: true,
        adminSkillsEnabled: false,
        disabledSkills: ['restricted'],
        extensions: [skillExtension('restricted')],
      },
    );
    let agent: Agent | undefined;
    try {
      built.config.getSkillManager().setAdminSettings(true);
      built.config.getSkillManager().setDisabledSkills([]);
      agent = await fromConfig({ config: built.config });
      expect(agent.skills.isAdminEnabled()).toBe(false);
      expect(agent.skills.list().map((skill) => skill.name)).not.toContain(
        'restricted',
      );
      expect(
        agent.skills
          .list({ includeDisabled: true })
          .find((skill) => skill.name === 'restricted')?.disabled,
      ).toBe(true);
    } finally {
      await agent?.dispose();
      await built.cleanup();
    }
  }, 30000);

  it('publishes late extension load, unload and restart only to live sessions after one is disposed', async () => {
    const loader = new SimpleExtensionLoader([]);
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      {},
      {
        skillsSupport: true,
        enableExtensionReloading: true,
        extensionLoader: loader,
      },
    );
    let a: Agent | undefined;
    let b: Agent | undefined;
    try {
      a = await fromConfig({ config: built.config, sessionId: 'shared' });
      b = await fromConfig({ config: built.config, sessionId: 'shared' });
      const late = skillExtension('late');
      await loader.loadExtension(late);
      expect(declaration(a)).toContain('late');
      expect(declaration(b)).toContain('late');
      await a.dispose();
      await loader.restartExtension(late);
      expect(declaration(b)).toContain('late');
      await loader.unloadExtension(late);
      expect(declaration(b)).not.toContain('late');
      expect(b.skills.list().map((skill) => skill.name)).not.toContain('late');
    } finally {
      await a?.dispose();
      await b?.dispose();
      await built.cleanup();
    }
  }, 30000);

  it('discovers one shared skill snapshot per extension transition and replays it to a late borrower', async () => {
    const loader = new SimpleExtensionLoader([]);
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      {},
      {
        skillsSupport: true,
        enableExtensionReloading: true,
        extensionLoader: loader,
      },
    );
    let a: Agent | undefined;
    let b: Agent | undefined;
    let c: Agent | undefined;
    try {
      a = await fromConfig({ config: built.config });
      b = await fromConfig({ config: built.config });
      const original = SkillManager.prototype.discoverSkills;
      let discoveries = 0;
      const spy = vi
        .spyOn(SkillManager.prototype, 'discoverSkills')
        .mockImplementation(async function (
          this: SkillManager,
          storage,
          extensions,
        ) {
          discoveries++;
          await original.call(this, storage, extensions);
        });
      try {
        await loader.loadExtension(skillExtension('replayed'));
        expect(discoveries).toBe(2);
        expect(declaration(a)).toContain('replayed');
        expect(declaration(b)).toContain('replayed');
        c = await fromConfig({ config: built.config });
        expect(declaration(c)).toContain('replayed');
        expect(discoveries).toBeLessThan(3);
      } finally {
        spy.mockRestore();
      }
    } finally {
      await a?.dispose();
      await b?.dispose();
      await c?.dispose();
      await built.cleanup();
    }
  }, 30000);

  it('releases a failed bootstrap borrower without leaving a second workspace refresh subscriber', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl', {
      skillsSupport: true,
    });
    const factory = built.config.getAgentClientFactory();
    if (factory === undefined) throw new Error('Missing client factory');
    let agent: Agent | undefined;
    try {
      built.config.setAgentClientFactory(() => {
        throw new Error('session client could not start');
      });
      await expect(fromConfig({ config: built.config })).rejects.toThrow(
        'session client could not start',
      );
      built.config.setAgentClientFactory(factory);
      agent = await fromConfig({ config: built.config });
      const original = SkillManager.prototype.discoverSkills;
      let discoveries = 0;
      const spy = vi
        .spyOn(SkillManager.prototype, 'discoverSkills')
        .mockImplementation(async function (
          this: SkillManager,
          storage,
          extensions,
        ) {
          discoveries++;
          await original.call(this, storage, extensions);
        });
      try {
        // The caller-owned Config's source discovery and one live workspace
        // owner each refresh once. The failed borrower's owner must be gone.
        await built.config.refreshSkills(built.messageBus);
        expect(discoveries).toBe(2);
        expect(agent.skills.list()).toBeDefined();
      } finally {
        spy.mockRestore();
      }
    } finally {
      built.config.setAgentClientFactory(factory);
      await agent?.dispose();
      await built.config.dispose();
      await built.cleanup();
    }
  }, 30000);

  it('keeps published declarations after a failed discovery and retries for both borrowed sessions', async () => {
    const loader = new SimpleExtensionLoader([]);
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      {},
      {
        skillsSupport: true,
        enableExtensionReloading: true,
        extensionLoader: loader,
      },
    );
    let a: Agent | undefined;
    let b: Agent | undefined;
    try {
      a = await fromConfig({ config: built.config });
      b = await fromConfig({ config: built.config });
      const original = SkillManager.prototype.discoverSkills;
      let discoveries = 0;
      const failure = vi
        .spyOn(SkillManager.prototype, 'discoverSkills')
        .mockImplementation(async function (
          this: SkillManager,
          storage,
          extensions,
        ) {
          discoveries++;
          if (discoveries === 2) throw new Error('discovery failed');
          await original.call(this, storage, extensions);
        });
      try {
        await expect(
          loader.loadExtension(skillExtension('retry')),
        ).rejects.toThrow('discovery failed');
        expect(declaration(a)).not.toContain('retry');
        expect(declaration(b)).not.toContain('retry');
        await loader.loadExtension({
          ...skillExtension('no-skills'),
          skills: [],
        });
        expect(declaration(a)).toContain('retry');
        expect(declaration(b)).toContain('retry');
      } finally {
        failure.mockRestore();
      }
    } finally {
      await a?.dispose();
      await b?.dispose();
      await built.cleanup();
    }
  }, 30000);
});
