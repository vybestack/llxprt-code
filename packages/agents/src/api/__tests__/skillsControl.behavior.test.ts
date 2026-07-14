/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P03
 *
 * BEHAVIORAL RED suite for the `agent.skills` sub-controller
 * (AgentSkillsControl). Drives through the PUBLIC ROOT via the buildAgent
 * harness over a real FakeProvider. The REAL SkillManager is reached through
 * Config.getSkillManager() with ZERO mocking.
 *
 * At GREEN: `agent.skills` is wired through AgentSkillsControl, so every
 * positive case exercises the real SkillManager through Config.
 */

import { describe, it, expect } from 'vitest';
import { buildAgent } from './helpers/agentHarness.js';

describe('agent.skills control @plan:PLAN-20260626-RUNTIMEBOUNDARY.P03', () => {
  it('list returns an array of SkillInfo (possibly empty) @scenario:list @given:an agent built normally @when:agent.skills.list() @then:the result is an array', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const skills = agent.skills.list();
      expect(Array.isArray(skills)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('list with includeDisabled:true still returns an array @scenario:list-disabled @given:an agent built normally @when:agent.skills.list({ includeDisabled: true }) @then:the result is an array', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const skills = agent.skills.list({ includeDisabled: true });
      expect(Array.isArray(skills)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('get returns undefined for a non-existent skill name @scenario:get-missing @given:an agent built normally @when:agent.skills.get("does-not-exist-skill") @then:the result is undefined', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      expect(agent.skills.get('does-not-exist-skill')).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('reload resolves without throwing @scenario:reload @given:an agent built normally @when:agent.skills.reload() @then:the promise resolves (no throw)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await expect(agent.skills.reload()).resolves.toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('isAdminEnabled returns a boolean @scenario:is-admin-enabled @given:an agent built normally @when:agent.skills.isAdminEnabled() @then:the result is a boolean', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const result = agent.skills.isAdminEnabled();
      expect(typeof result).toBe('boolean');
    } finally {
      await cleanup();
    }
  });

  it('does not expose skill body or prompt content through SkillInfo @scenario:skill-body-redaction @given:an active extension skill with secret body text @when:agent.skills.list() and get() project public SkillInfo @then:metadata is returned without body/prompt fields', async () => {
    const secretBody = 'SECRET_SKILL_PROMPT_DO_NOT_LEAK';
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      skillsSupport: true,
      extensions: [
        {
          name: 'skill-extension',
          version: '1.0.0',
          isActive: true,
          path: 'memory://skill-extension',
          contextFiles: [],
          skills: [
            {
              name: 'secret-skill',
              description: 'A skill with private prompt text',
              location: 'memory://secret-skill/SKILL.md',
              body: secretBody,
            },
          ],
        },
      ],
    });
    try {
      const listed = agent.skills
        .list()
        .find((skill) => skill.name === 'secret-skill');
      const fetched = agent.skills.get('secret-skill');

      expect(listed).toBeDefined();
      expect(fetched).toBeDefined();
      expect(listed).toMatchObject({
        name: 'secret-skill',
        description: 'A skill with private prompt text',
        location: 'memory://secret-skill/SKILL.md',
      });
      expect(fetched).toMatchObject(listed);
      expect(listed).not.toHaveProperty('body');
      expect(fetched).not.toHaveProperty('body');
      expect(JSON.stringify([listed, fetched])).not.toContain(secretBody);
    } finally {
      await cleanup();
    }
  });
});
