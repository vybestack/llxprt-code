/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'bun:test';
import { ActivateSkillTool } from './activate-skill.js';
import type { ISkillService, SkillInfo } from '../interfaces/index.js';
import type { IToolMessageBus } from '../interfaces/IToolMessageBus.js';

describe('ActivateSkillTool', () => {
  let mockSkillService: ISkillService;
  let tool: ActivateSkillTool;
  const mockMessageBus = {
    publish: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  } as unknown as IToolMessageBus;

  beforeEach(() => {
    const skills: SkillInfo[] = [
      {
        name: 'test-skill',
        description: 'A test skill',
        location: '/path/to/test-skill/SKILL.md',
      },
    ];
    mockSkillService = {
      activateSkill: vi.fn().mockResolvedValue({
        success: true,
        instructions: 'Skill instructions content.',
        description: 'A test skill',
        location: '/path/to/test-skill/SKILL.md',
        resourceDirectory: '/path/to/test-skill',
      }),
      getSkillManager: vi.fn().mockReturnValue({
        getSkills: vi.fn().mockReturnValue(skills),
        getSkill: vi
          .fn()
          .mockImplementation((name: string) =>
            name === 'test-skill' ? skills[0] : null,
          ),
      }),
      listSkills: vi.fn().mockReturnValue(skills),
      getSkill: vi
        .fn()
        .mockImplementation((name: string) =>
          name === 'test-skill' ? skills[0] : null,
        ),
    } satisfies ISkillService;
    tool = new ActivateSkillTool(mockSkillService, mockMessageBus);
  });

  it('should return enhanced description', () => {
    const params = { name: 'test-skill' };
    const invocation = tool.build(params);
    expect(invocation.getDescription()).toBe('"test-skill": A test skill');
  });

  it('should return enhanced confirmation details', async () => {
    const params = { name: 'test-skill' };
    const invocation = tool.build(params);
    const details = await invocation.shouldConfirmExecute(
      new AbortController().signal,
    );

    expect(details).not.toBe(false);
    if (details === false) throw new Error('unreachable: narrowing failed');
    expect(details.title).toBe('Activate Skill: test-skill');
    expect(details.type).toBe('info');
    if (details.type !== 'info') {
      throw new Error('Expected informational confirmation details');
    }
    expect(details.prompt).toContain('enable the specialized agent skill');
    expect(details.prompt).toContain('A test skill');
    expect(details.prompt).not.toContain('Mock folder structure');
  });

  it('should activate a valid skill and return its content in XML tags', async () => {
    const params = { name: 'test-skill' };
    const invocation = tool.build(params);
    const result = await invocation.execute(new AbortController().signal);

    expect(mockSkillService.activateSkill).toHaveBeenCalledWith('test-skill');
    expect(result.llmContent).toContain('<activated_skill name="test-skill">');
    expect(result.llmContent).toContain('<instructions>');
    expect(result.llmContent).toContain('Skill instructions content.');
    expect(result.llmContent).toContain('</instructions>');
    expect(result.llmContent).toContain('<resource_directory>');
    expect(result.llmContent).toContain('/path/to/test-skill');
    expect(result.llmContent).toContain('</activated_skill>');
    expect(result.returnDisplay).toContain('Skill **test-skill** activated');
  });

  it('should throw error if skill is not in enum', async () => {
    const params = { name: 'non-existent' };
    expect(() => tool.build(params as { name: string })).toThrow(Error);
  });

  it('should return an error if skill content cannot be read', async () => {
    (
      mockSkillService.activateSkill as Mock<
        typeof mockSkillService.activateSkill
      >
    ).mockResolvedValue({
      success: false,
      error: 'Skill "test-skill" not found. Available skills are: ',
      availableSkills: [],
    });
    const params = { name: 'test-skill' };
    const invocation = tool.build(params);
    const result = await invocation.execute(new AbortController().signal);

    expect(result.llmContent).toContain('Error: Skill "test-skill" not found.');
  });

  it('should validate that name is provided', () => {
    expect(() =>
      tool.build({ name: '' } as unknown as { name: string }),
    ).toThrow(Error);
  });

  /**
   * Issue #3379: the model only learns which skills exist from this tool's
   * declaration, and that declaration is built from the skill list captured
   * when the instance is constructed. Rebuilding the instance is therefore the
   * mechanism that refreshes the model-facing skill list after a reload.
   */
  describe('declaration reflects the skill list at construction @issue:3379', () => {
    function serviceListing(names: string[]): ISkillService {
      const skills: SkillInfo[] = names.map((name) => ({
        name,
        description: `${name} description`,
        location: `/skills/${name}/SKILL.md`,
      }));
      return {
        activateSkill: vi.fn(),
        getSkillManager: vi.fn(),
        listSkills: vi.fn().mockReturnValue(skills),
        getSkill: vi
          .fn()
          .mockImplementation(
            (name: string) => skills.find((s) => s.name === name) ?? null,
          ),
        getFolderStructure: vi.fn().mockResolvedValue(''),
      } as unknown as ISkillService;
    }

    function enumeratedNames(instance: ActivateSkillTool): string[] {
      const schema = instance.schema.parametersJsonSchema as {
        properties?: { name?: { enum?: string[] } };
      };
      return schema.properties?.name?.enum ?? [];
    }

    it('enumerates every listed skill and names them in the description', () => {
      const instance = new ActivateSkillTool(
        serviceListing(['alpha', 'beta']),
        mockMessageBus,
      );

      expect(enumeratedNames(instance)).toEqual(['alpha', 'beta']);
      expect(instance.description).toContain("Available: 'alpha', 'beta'");
      expect(instance.build({ name: 'beta' })).toBeDefined();
    });

    it('reflects a changed skill list when reconstructed', () => {
      const before = new ActivateSkillTool(
        serviceListing(['alpha']),
        mockMessageBus,
      );
      expect(() => before.build({ name: 'gamma' })).toThrow(Error);

      const after = new ActivateSkillTool(
        serviceListing(['alpha', 'gamma']),
        mockMessageBus,
      );

      expect(enumeratedNames(after)).toEqual(['alpha', 'gamma']);
      expect(after.build({ name: 'gamma' })).toBeDefined();
    });

    it('enumerates no names when no skills are listed', () => {
      const instance = new ActivateSkillTool(
        serviceListing([]),
        mockMessageBus,
      );

      expect(enumeratedNames(instance)).toEqual([]);
      expect(instance.description).not.toContain('Available:');
    });
  });
});
